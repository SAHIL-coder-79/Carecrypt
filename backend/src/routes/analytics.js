import { Router } from 'express'
import { parseFilters, runCustomQuery } from '../analytics/customQuery.js'
import * as data from '../analytics/repository.js'
import { analyticsQuery } from '../db/analyticsPool.js'
import { recordAuditEvent } from '../audit/auditLog.js'
import { HttpError } from '../lib/httpError.js'
import { authenticateToken } from '../middleware/authenticate.js'
import { requireRole } from '../middleware/requireRole.js'
import { openInferenceEvent, raiseSecurityEvent } from '../security/events.js'
import { detect, NARROWING_STEPS, PROBING_SUPPRESSED, recentQueries, WINDOW_MINUTES } from '../security/inference.js'

// ADMIN population analytics. Aggregate only: every response is built from the
// suppressed views in the analytics schema, read through the carecrypt_analytics
// login, which has no access to patients, visits or any other row-level table.
// No response contains a patient id, MRN, name, contact detail, address,
// individual history, prescription or visit.
const router = Router()

router.use(authenticateToken(), requireRole('ADMIN', { resource: 'AGGREGATE_ANALYTICS' }))

router.use((req, res, next) => {
  res.set('Cache-Control', 'private, no-store')
  next()
})

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

function validationError(details) {
  return new HttpError(400, 'VALIDATION_FAILED', 'Invalid analytics filter.', {
    body: { error: 'VALIDATION_FAILED', message: 'Invalid analytics filter.', details },
  })
}

// Accepts only the listed query parameters, so an unexpected one is an error, not silently ignored.
function readQuery(req, allowed) {
  const unknown = Object.keys(req.query).filter((k) => !allowed.includes(k))
  if (unknown.length > 0) {
    throw validationError(unknown.map((field) => ({ field, message: `Unknown parameter. Allowed: ${allowed.join(', ') || 'none'}.` })))
  }
  for (const [field, value] of Object.entries(req.query)) {
    if (typeof value !== 'string') throw validationError([{ field, message: 'Give this parameter once.' }])
  }
  return req.query
}

function checkCategory(category, categories) {
  if (category === undefined) return null
  const known = categories.map((c) => c.category)
  if (!known.includes(category)) {
    throw validationError([{ field: 'category', message: `Unknown category. Allowed: ${known.join(', ')}.` }])
  }
  return category
}

function audit(req, view, filters, suppressedCells) {
  return recordAuditEvent({
    req,
    user: req.user,
    action: 'ANALYTICS_VIEW',
    resourceType: 'analytics',
    resourceId: view,
    outcome: 'SUCCESS',
    metadata: { filters, suppressed_cells: suppressedCells },
  })
}

const LABEL = 'Aggregate, de-identified analytics'

router.get('/overview', async (req, res) => {
  readQuery(req, [])
  const overview = await data.loadOverview()
  const [categories, signals] = await Promise.all([data.loadCategories(overview), data.loadSignals()])
  const privacy = data.privacy(overview.k, categories)
  await audit(req, 'overview', {}, privacy.suppressedCells)
  res.json({
    label: LABEL,
    totals: overview.totals,
    period: overview.period,
    topCategories: categories.filter((c) => !c.suppressed).slice(0, 5),
    signals,
    privacy,
  })
})

router.get('/by-location', async (req, res) => {
  const q = readQuery(req, ['category'])
  const overview = await data.loadOverview()
  const [locations, categories] = await Promise.all([data.loadLocations(overview), data.loadCategories(overview)])
  const category = checkCategory(q.category, categories)
  const matrix = await data.loadLocationCategory(overview, locations, categories)
  const privacy = data.privacy(overview.k, locations, matrix)
  await audit(req, 'by-location', { category }, privacy.suppressedCells)
  res.json({
    label: LABEL,
    locations,
    byCategory: category ? matrix.filter((c) => c.category === category) : matrix,
    categories: categories.map((c) => c.category),
    filters: { category },
    privacy,
  })
})

router.get('/by-condition', async (req, res) => {
  const q = readQuery(req, ['category'])
  const overview = await data.loadOverview()
  const categories = await data.loadCategories(overview)
  const category = checkCategory(q.category, categories)
  const conditions = await data.loadConditions(overview, categories)
  const privacy = data.privacy(overview.k, categories, conditions)
  await audit(req, 'by-condition', { category }, privacy.suppressedCells)
  res.json({
    label: LABEL,
    categories,
    conditions: category ? conditions.filter((c) => c.category === category) : conditions,
    filters: { category },
    privacy,
  })
})

router.get('/by-time', async (req, res) => {
  const q = readQuery(req, ['category', 'from', 'to'])
  for (const field of ['from', 'to']) {
    if (q[field] !== undefined && !MONTH.test(q[field])) {
      throw validationError([{ field, message: 'Use a month in the form YYYY-MM.' }])
    }
  }
  if (q.from && q.to && q.from > q.to) throw validationError([{ field: 'from', message: '"from" must not be after "to".' }])

  const overview = await data.loadOverview()
  const categories = await data.loadCategories(overview)
  const category = checkCategory(q.category, categories)
  const months = await data.loadMonths(overview)
  const byCategory = await data.loadCategoryMonths(overview, months, categories)
  const inRange = (c) => (!q.from || c.month >= q.from) && (!q.to || c.month <= q.to)
  const privacy = data.privacy(overview.k, months, byCategory)
  await audit(req, 'by-time', { category, from: q.from ?? null, to: q.to ?? null }, privacy.suppressedCells)
  res.json({
    label: LABEL,
    granularity: 'month',
    period: overview.period,
    months: months.filter(inRange),
    byCategory: byCategory.filter((c) => inRange(c) && (!category || c.category === category)),
    categories: categories.map((c) => c.category),
    filters: { category, from: q.from ?? null, to: q.to ?? null },
    privacy,
  })
})

router.get('/by-age-group', async (req, res) => {
  readQuery(req, [])
  const overview = await data.loadOverview()
  const ageGroups = await data.loadAgeBands(overview)
  const privacy = data.privacy(overview.k, ageGroups)
  await audit(req, 'by-age-group', {}, privacy.suppressedCells)
  res.json({ label: LABEL, ageGroups, privacy })
})

// GET /api/analytics/query?district=Pune&category=INFECTIOUS&month=2026-09
// One aggregate count for any combination of filters (state, district, category,
// condition, month, ageBand, gender). Small or subtractable answers come back
// suppressed. Every query is audited (ANALYTICS_QUERY) and checked for inference
// patterns; a detected pattern raises a security event and blocks further custom
// queries by this user until a SECURITY_ADMIN resolves it.
router.get('/query', async (req, res) => {
  const filters = parseFilters(req.query)

  const blocking = await openInferenceEvent(req.user.id)
  if (blocking) {
    await recordAuditEvent({
      req,
      user: req.user,
      action: 'ANALYTICS_QUERY',
      resourceType: 'analytics',
      resourceId: 'query',
      outcome: 'DENIED',
      reason: 'Blocked pending security review',
      metadata: { filters, security_event_id: blocking.id },
    })
    throw new HttpError(403, 'ANALYTICS_QUERY_BLOCKED', 'Custom queries are paused pending a security review.', {
      body: {
        error: 'ANALYTICS_QUERY_BLOCKED',
        message: 'Custom analytics queries from this account are paused until a security administrator reviews a flagged query pattern. The standard dashboard is still available.',
        securityEventId: blocking.id,
      },
    })
  }

  const result = await runCustomQuery(filters)
  await recordAuditEvent({
    req,
    user: req.user,
    action: 'ANALYTICS_QUERY',
    resourceType: 'analytics',
    resourceId: 'query',
    outcome: 'SUCCESS',
    metadata: {
      filters,
      suppressed: result.suppressed,
      suppression: result.suppression,
      ...(result.riskFilters && { risk_filters: result.riskFilters }),
    },
  })

  const finding = detect(await recentQueries(req.user.id))
  const event = finding ? await raiseSecurityEvent({ req, user: req.user, ...finding }) : null

  res.json({
    label: LABEL,
    filters,
    result: {
      patientCount: result.patientCount,
      caseCount: result.caseCount,
      suppressed: result.suppressed,
      suppression: result.suppression,
    },
    inferenceControl: event
      ? {
          flagged: true,
          securityEvent: { id: event.id, type: event.event_type, severity: event.severity },
          message: 'This sequence of queries looks like an attempt to single out a small group. It has been reported to security, and custom queries are paused until it is reviewed.',
        }
      : { flagged: false },
    privacy: {
      minGroupSize: result.minGroupSize,
      rules: [
        `Answers covering fewer than ${result.minGroupSize} patients are suppressed (SMALL_GROUP).`,
        `Answers that differ from a broader query by fewer than ${result.minGroupSize} patients are suppressed (DIFFERENCE).`,
        'Patients who opted out of secondary use are not counted.',
      ],
    },
  })
})

// GET /api/analytics/privacy: the privacy model in force, and the caller's own
// custom-query standing (queries in the detection window, and whether they are
// paused pending a security review).
router.get('/privacy', async (req, res) => {
  readQuery(req, [])
  const [{ rows }, history, blocking] = await Promise.all([
    analyticsQuery('SELECT min_group_size, updated_at FROM analytics.privacy_settings'),
    recentQueries(req.user.id),
    openInferenceEvent(req.user.id),
  ])
  const k = rows[0].min_group_size
  await audit(req, 'privacy', {}, 0)
  res.json({
    label: LABEL,
    minGroupSize: k,
    settingsUpdatedAt: rows[0].updated_at,
    protections: [
      { key: 'SEPARATE_LOGIN', title: 'Separate database login', text: 'Analytics are read through a login that can see only aggregate views. It cannot read any patient, visit or prescription row.' },
      { key: 'SMALL_GROUP', title: `Minimum group of ${k}`, text: `Any count covering fewer than ${k} patients is withheld.` },
      { key: 'COMPLEMENTARY', title: 'No working it out', text: 'Extra cells are withheld where a hidden count could be recovered by subtracting visible numbers from a total.' },
      { key: 'DIFFERENCE', title: 'No differencing', text: `A custom answer is withheld if it differs from a broader question by fewer than ${k} patients.` },
      { key: 'OPT_OUT', title: 'Patient opt-out', text: 'Patients who opted out of secondary use are never counted.' },
      { key: 'AUDIT', title: 'Everything is logged', text: 'Every dashboard view and custom question is written to the tamper-evident audit log.' },
    ],
    inferenceDetection: {
      windowMinutes: WINDOW_MINUTES,
      rules: [
        { type: 'INFERENCE_NARROWING', severity: 'MEDIUM', text: `${NARROWING_STEPS} or more questions in a row, each narrower than the last, still narrowing after suppressed answers.` },
        { type: 'INFERENCE_DIFFERENCING', severity: 'HIGH', text: 'A question withheld for differencing, after asking the broader question it could be subtracted from.' },
        { type: 'INFERENCE_PROBING', severity: 'MEDIUM', text: `${PROBING_SUPPRESSED} or more suppressed answers within ${WINDOW_MINUTES} minutes.` },
      ],
    },
    myCustomQueries: {
      inWindow: history.length,
      suppressedInWindow: history.filter((q) => q.suppressed).length,
      paused: Boolean(blocking),
      securityEventId: blocking?.id ?? null,
    },
  })
})

export default router
