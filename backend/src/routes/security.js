import { Router } from 'express'
import { recordAuditEvent } from '../audit/auditLog.js'
import { query } from '../db/pool.js'
import { HttpError } from '../lib/httpError.js'
import { isUuid } from '../lib/validate.js'
import { authenticateToken } from '../middleware/authenticate.js'
import { requireRole } from '../middleware/requireRole.js'
import { EVENT_TYPES } from '../security/events.js'

// Security dashboard API, SECURITY_ADMIN only. Shows security events and the
// audit trail, never clinical content: patients appear only as record ids, and
// audit metadata is limited to the whitelisted keys below. Every read is itself
// audited (SECURITY_AUDIT_VIEW).
const router = Router()

router.use(authenticateToken(), requireRole('SECURITY_ADMIN', { resource: 'SECURITY_CONSOLE' }))
router.use((req, res, next) => {
  res.set('Cache-Control', 'private, no-store')
  next()
})

// Audit metadata keys a security reviewer may see. Anything else (for example the
// condition codes of a decision-support run) is dropped.
const SAFE_METADATA = new Set([
  'required_roles', 'method', 'path', 'section', 'scope', 'consent_scope', 'filters', 'suppressed', 'suppression',
  'suppressed_cells', 'event_type', 'severity', 'failed_login_count', 'locked', 'email_attempted', 'token_hint',
  'clinician_attested', 'security_event_id', 'resource', 'expires_at', 'purpose_code',
])

function validationError(field, message) {
  return new HttpError(400, 'VALIDATION_FAILED', message, {
    body: { error: 'VALIDATION_FAILED', message, details: [{ field, message }] },
  })
}

function auditView(req, view, metadata = {}) {
  return recordAuditEvent({
    req,
    user: req.user,
    action: 'SECURITY_AUDIT_VIEW',
    resourceType: 'security',
    resourceId: view,
    outcome: 'SUCCESS',
    metadata,
  })
}

// Staff accounts are shown by name; patient accounts only as "Patient account".
const actorSql = `CASE WHEN u.role = 'PATIENT' THEN 'Patient account' ELSE u.display_name END`

router.get('/summary', async (req, res) => {
  const [events, activity, chain, denied] = await Promise.all([
    query(`SELECT severity, count(*)::int AS n FROM audit.security_events WHERE status = 'OPEN' GROUP BY severity`),
    query(
      `SELECT count(*) FILTER (WHERE outcome = 'DENIED')::int AS denied,
              count(*) FILTER (WHERE action = 'LOGIN' AND outcome = 'FAILURE')::int AS failed_logins,
              count(*) FILTER (WHERE action = 'ANALYTICS_QUERY')::int AS analytics_queries,
              count(*) FILTER (WHERE action = 'ANALYTICS_QUERY' AND (metadata->>'suppressed')::boolean)::int AS suppressed_queries,
              count(*) FILTER (WHERE action = 'SECURITY_EVENT')::int AS security_events,
              count(*) FILTER (WHERE action IN ('PATIENT_RECORD_VIEW', 'QR_PATIENT_ACCESS') AND outcome = 'SUCCESS')::int AS record_views
         FROM audit.audit_logs WHERE occurred_at > now() - interval '24 hours'`,
    ),
    query(
      `SELECT audit.verify_chain() AS broken_at,
              (SELECT count(*)::int FROM audit.audit_logs) AS entries,
              (SELECT max(occurred_at) FROM audit.audit_logs) AS last_entry_at`,
    ),
    query(
      `SELECT user_role AS role, resource_id AS resource, count(*)::int AS n
         FROM audit.audit_logs
        WHERE action = 'ACCESS_DENIED' AND occurred_at > now() - interval '7 days'
        GROUP BY 1, 2 ORDER BY n DESC, 1, 2 LIMIT 8`,
    ),
  ])
  const open = Object.fromEntries(events.rows.map((r) => [r.severity, r.n]))
  const a = activity.rows[0]
  const c = chain.rows[0]
  await auditView(req, 'summary')
  res.json({
    openEvents: { HIGH: open.HIGH ?? 0, MEDIUM: open.MEDIUM ?? 0, LOW: open.LOW ?? 0, total: events.rows.reduce((s, r) => s + r.n, 0) },
    last24Hours: {
      deniedRequests: a.denied,
      failedLogins: a.failed_logins,
      analyticsQueries: a.analytics_queries,
      suppressedAnalyticsQueries: a.suppressed_queries,
      securityEvents: a.security_events,
      patientRecordAccesses: a.record_views,
    },
    auditLog: {
      entries: c.entries,
      lastEntryAt: c.last_entry_at,
      chainIntact: c.broken_at === null,
      brokenAtSequence: c.broken_at === null ? null : Number(c.broken_at),
    },
    deniedLast7Days: denied.rows.map((r) => ({ role: r.role, resource: r.resource, count: r.n })),
  })
})

router.get('/events', async (req, res) => {
  const status = req.query.status ?? 'OPEN'
  if (!['OPEN', 'RESOLVED', 'ALL'].includes(status)) throw validationError('status', 'Use OPEN, RESOLVED or ALL.')
  const { rows } = await query(
    `SELECT e.*, ${actorSql} AS actor, u.email AS actor_email, r.display_name AS resolved_by_name
       FROM audit.security_events e
       LEFT JOIN identity.users u ON u.id = e.user_id
       LEFT JOIN identity.users r ON r.id = e.resolved_by
      WHERE $1 = 'ALL' OR e.status::text = $1
      ORDER BY (e.status = 'OPEN') DESC,
               CASE e.severity WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 ELSE 2 END,
               e.detected_at DESC
      LIMIT 200`,
    [status],
  )
  await auditView(req, 'events', { status })
  res.json({
    events: rows.map((e) => ({
      id: e.id,
      detectedAt: e.detected_at,
      type: e.event_type,
      title: EVENT_TYPES[e.event_type] ?? e.event_type,
      severity: e.severity,
      summary: e.summary,
      details: e.details,
      status: e.status,
      user: e.user_id
        ? { id: e.user_id, role: e.user_role, name: e.actor, email: e.user_role === 'PATIENT' ? null : e.actor_email }
        : null,
      resolvedBy: e.resolved_by_name,
      resolvedAt: e.resolved_at,
      resolutionNote: e.resolution_note,
    })),
  })
})

router.post('/events/:eventId/resolve', async (req, res) => {
  const { eventId } = req.params
  if (!isUuid(eventId)) throw validationError('eventId', 'Not a valid event id.')
  const note = typeof req.body?.note === 'string' ? req.body.note.trim() : ''
  if (note.length < 3 || note.length > 500) throw validationError('note', 'Give a resolution note of 3 to 500 characters.')

  const { rows } = await query(
    `UPDATE audit.security_events
        SET status = 'RESOLVED', resolved_by = $2, resolved_at = now(), resolution_note = $3
      WHERE id = $1 AND status = 'OPEN'
      RETURNING id, event_type, user_id, resolved_at`,
    [eventId, req.user.id, note],
  )
  if (!rows[0]) {
    const exists = await query('SELECT status FROM audit.security_events WHERE id = $1', [eventId])
    if (!exists.rows[0]) throw new HttpError(404, 'NOT_FOUND', 'No such security event.')
    throw new HttpError(409, 'ALREADY_RESOLVED', 'This security event is already resolved.')
  }
  await recordAuditEvent({
    req,
    user: req.user,
    action: 'SECURITY_EVENT_RESOLVE',
    resourceType: 'security_event',
    resourceId: eventId,
    outcome: 'SUCCESS',
    reason: note,
    metadata: { event_type: rows[0].event_type },
  })
  res.json({ id: rows[0].id, status: 'RESOLVED', resolvedAt: rows[0].resolved_at })
})

const AUDIT_FILTERS = ['action', 'outcome', 'role', 'limit', 'before']

router.get('/audit', async (req, res) => {
  const unknown = Object.keys(req.query).filter((k) => !AUDIT_FILTERS.includes(k))
  if (unknown.length) throw validationError(unknown[0], `Unknown parameter. Allowed: ${AUDIT_FILTERS.join(', ')}.`)
  const { action, outcome, role } = req.query
  if (action !== undefined && !/^[A-Z][A-Z0-9_]{1,60}$/.test(action)) throw validationError('action', 'Not a valid action name.')
  if (outcome !== undefined && !['SUCCESS', 'FAILURE', 'DENIED'].includes(outcome)) throw validationError('outcome', 'Use SUCCESS, FAILURE or DENIED.')
  if (role !== undefined && !['PATIENT', 'CLINICIAN', 'ADMIN', 'SECURITY_ADMIN'].includes(role)) throw validationError('role', 'Not a role.')
  const limit = req.query.limit === undefined ? 50 : Number(req.query.limit)
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw validationError('limit', 'Use 1 to 200.')
  const before = req.query.before === undefined ? null : Number(req.query.before)
  if (before !== null && (!Number.isInteger(before) || before < 1)) throw validationError('before', 'Use a sequence number.')

  const { rows } = await query(
    `SELECT a.chain_seq, a.occurred_at, a.user_id, a.user_role, a.action, a.resource_type, a.resource_id,
            a.patient_id, a.outcome, a.reason, a.ip_address, a.metadata, ${actorSql} AS actor
       FROM audit.audit_logs a
       LEFT JOIN identity.users u ON u.id = a.user_id
      WHERE ($1::text IS NULL OR a.action = $1)
        AND ($2::text IS NULL OR a.outcome = $2::audit.outcome)
        AND ($3::text IS NULL OR a.user_role = $3::identity.user_role)
        AND ($4::bigint IS NULL OR a.chain_seq < $4)
      ORDER BY a.chain_seq DESC
      LIMIT $5`,
    [action ?? null, outcome ?? null, role ?? null, before, limit],
  )
  await auditView(req, 'audit', { filters: { action, outcome, role } })
  res.json({
    entries: rows.map((r) => ({
      sequence: Number(r.chain_seq),
      occurredAt: r.occurred_at,
      actor: r.user_id ? { id: r.user_id, role: r.user_role, name: r.actor } : null,
      action: r.action,
      resourceType: r.resource_type,
      resourceId: r.resource_id,
      patientRecordId: r.patient_id,
      outcome: r.outcome,
      reason: r.reason,
      ipAddress: r.ip_address,
      metadata: Object.fromEntries(Object.entries(r.metadata ?? {}).filter(([k]) => SAFE_METADATA.has(k))),
    })),
    nextBefore: rows.length === limit ? Number(rows.at(-1).chain_seq) : null,
  })
})

export default router
