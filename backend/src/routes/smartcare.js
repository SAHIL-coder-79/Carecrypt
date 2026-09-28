import { Router } from 'express'
import { recordAuditEvent } from '../audit/auditLog.js'
import { activeScopeSql } from '../clinicians/consentScope.js'
import { query } from '../db/pool.js'
import { HttpError } from '../lib/httpError.js'
import { isUuid } from '../lib/validate.js'
import { authenticateToken } from '../middleware/authenticate.js'
import { requireRole } from '../middleware/requireRole.js'
import { authorizePatientAccess } from '../patients/access.js'
import { validationError } from '../patients/visitInput.js'
import { analyze } from '../smartcare/adapter.js'
import { loadPatientContext } from '../smartcare/context.js'
import { ENGINE } from '../smartcare/engine.js'
import { recordRun } from '../smartcare/runs.js'

const router = Router()

const CODE = /^[a-z][a-z0-9_]{1,59}$/
const ICD10 = /^[A-Z][0-9]{2}(\.[0-9A-Z]{1,4})?$/
const SEVERITIES = ['MILD', 'MODERATE', 'SEVERE']
const VITALS = {
  temperatureC: [30, 45],
  pulseBpm: [20, 250],
  systolic: [50, 300],
  diastolic: [20, 200],
  respiratoryRate: [4, 80],
  spo2Percent: [50, 100],
}

// POST /api/smartcare/analyze
// Patient-specific clinical decision support. CLINICIAN only, with an active
// consent; the patient's history is read from the record within that consent's
// scope. The output is decision support, never a diagnosis.
router.post(
  '/analyze',
  authenticateToken(),
  requireRole('CLINICIAN', { resource: 'SMARTCARE' }),
  async (req, res) => {
    const request = parseRequest(req.body)
    const grant = await authorizePatientAccess(req, request.patientId, {
      section: 'smartcare',
      action: 'SMARTCARE_ANALYZE',
    })
    const context = await loadPatientContext(request.patientId, grant)
    if (!context.patient) throw new HttpError(404, 'NOT_FOUND', 'Patient record not found.')

    const result = analyze(request, context)
    // Recorded so the visit can reference what was suggested. Creates no diagnosis.
    result.analysisId = await recordRun({ patientId: request.patientId, clinicianId: grant.clinicianId, scope: grant.scope, request, result })

    await recordAuditEvent({
      req,
      user: req.user,
      action: 'SMARTCARE_ANALYZE',
      resourceType: 'patient',
      resourceId: request.patientId,
      patientId: request.patientId,
      outcome: 'SUCCESS',
      reason: `Consent ${grant.scope}`,
      metadata: {
        engine: `${result.engine.name} ${result.engine.version}`,
        symptoms: request.currentSymptoms.length,
        analysis_id: result.analysisId,
        top_condition: result.possibleConditions[0]?.code ?? null,
        risk_level: result.overallRisk.level,
        context: {
          chronic_conditions: result.contextUsed.chronicConditions.length,
          visits: result.contextUsed.visitsConsidered,
          medications: result.contextUsed.activeMedications.length,
        },
      },
    })

    res.set('Cache-Control', 'no-store')
    res.json(result)
  },
)

function parseRequest(body) {
  const details = []
  const fail = (field, message) => details.push({ field, message })
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {}

  if (!isUuid(b.patientId)) fail('patientId', 'must be a patient id.')

  const currentSymptoms = []
  if (!Array.isArray(b.currentSymptoms) || b.currentSymptoms.length === 0 || b.currentSymptoms.length > 30) {
    fail('currentSymptoms', 'must list 1 to 30 symptoms.')
  } else {
    b.currentSymptoms.forEach((s, i) => {
      const item = typeof s === 'string' ? { code: s } : s
      if (!item || typeof item.code !== 'string' || !CODE.test(item.code)) {
        return fail(`currentSymptoms[${i}]`, 'must be a symptom code or { code, severity, durationDays }.')
      }
      const severity = item.severity ?? 'MODERATE'
      if (!SEVERITIES.includes(severity)) return fail(`currentSymptoms[${i}].severity`, `must be one of ${SEVERITIES.join(', ')}.`)
      const d = item.durationDays
      if (d !== undefined && d !== null && !(Number.isInteger(d) && d >= 0 && d <= 3650)) {
        return fail(`currentSymptoms[${i}].durationDays`, 'must be a whole number of days.')
      }
      if (!currentSymptoms.some((x) => x.code === item.code)) {
        currentSymptoms.push({ code: item.code, severity, durationDays: d ?? null })
      }
    })
  }

  // Clinician-reported extras (e.g. history the patient mentions that is not yet recorded).
  const list = (value, field, pattern, hint) => {
    if (value === undefined || value === null) return []
    if (!Array.isArray(value) || value.length > 20) return fail(field, 'must be a list of at most 20 entries.'), []
    const out = []
    value.forEach((v, i) => {
      if (typeof v !== 'string' || !pattern.test(v)) fail(`${field}[${i}]`, hint)
      else out.push(v)
    })
    return out
  }
  const relevantHistory = list(
    b.relevantHistory,
    'relevantHistory',
    /^([A-Z][0-9]{2}(\.[0-9A-Z]{1,4})?|[a-z][a-z_]{1,39})$/,
    'must be an ICD-10 code (e.g. E11.9) or a condition key (e.g. diabetes).',
  )
  const medications = list(b.medications, 'medications', CODE, 'must be a medication code (e.g. metformin).')

  const vitals = {}
  if (b.vitals !== undefined && b.vitals !== null) {
    if (typeof b.vitals !== 'object' || Array.isArray(b.vitals)) {
      fail('vitals', 'must be an object.')
    } else {
      for (const [key, value] of Object.entries(b.vitals)) {
        if (value === null || value === undefined) continue
        const range = VITALS[key]
        if (!range) {
          fail(`vitals.${key}`, 'is not a recognised vital sign.')
        } else if (typeof value !== 'number' || !Number.isFinite(value) || value < range[0] || value > range[1]) {
          fail(`vitals.${key}`, `must be a number from ${range[0]} to ${range[1]}.`)
        } else {
          vitals[key] = value
        }
      }
      if ((vitals.systolic === undefined) !== (vitals.diastolic === undefined)) {
        fail('vitals', 'systolic and diastolic blood pressure must be given together.')
      }
    }
  }

  if (b.pregnant !== undefined && typeof b.pregnant !== 'boolean') fail('pregnant', 'must be true or false.')
  if (details.length > 0) throw validationError(details)

  return {
    patientId: b.patientId.toLowerCase(),
    currentSymptoms,
    relevantHistory: relevantHistory.filter((h) => ICD10.test(h) || /^[a-z_]+$/.test(h)),
    medications,
    vitals,
    pregnant: b.pregnant === true,
  }
}

// GET /api/smartcare/runs: the signed-in clinician's own decision-support runs,
// newest first. Suggestions and risk are shown only while the patient's consent
// is active; each run says whether it was reviewed and linked to a saved visit.
router.get('/runs', authenticateToken(), requireRole('CLINICIAN', { resource: 'SMARTCARE' }), async (req, res) => {
  const { rows } = await query(
    `SELECT r.id, r.created_at, r.engine, r.risk_level, r.risk_score, r.suggested_conditions, r.symptom_codes,
            r.visit_id, r.reviewed_at, r.patient_id, r.consent_scope,
            ${activeScopeSql('r.patient_id', 'c.id')} AS scope,
            p.first_name, p.last_name, p.mrn
       FROM clinical.decision_support_runs r
       JOIN clinical.clinicians c ON c.id = r.clinician_id AND c.user_id = $1
       JOIN clinical.patients p ON p.id = r.patient_id
      ORDER BY r.created_at DESC
      LIMIT 50`,
    [req.user.id],
  )
  await recordAuditEvent({
    req,
    user: req.user,
    action: 'SMARTCARE_RUNS_VIEW',
    resourceType: 'decision_support',
    outcome: 'SUCCESS',
    metadata: { returned: rows.length },
  })
  res.set('Cache-Control', 'no-store')
  res.json({
    label: 'Clinical Decision Support',
    disclaimer: 'Decision support only. Final clinical judgment remains with the clinician.',
    engine: ENGINE,
    runs: rows.map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      patient: r.scope ? { id: r.patient_id, fullName: `${r.first_name} ${r.last_name}`, mrn: r.mrn } : null,
      riskLevel: r.scope ? r.risk_level : null,
      suggestedConditions: r.scope ? r.suggested_conditions : null,
      symptomCount: r.symptom_codes.length,
      status: r.visit_id ? 'REVIEWED_AND_LINKED' : 'NOT_LINKED',
      visitId: r.scope ? r.visit_id : null,
      reviewedAt: r.reviewed_at,
      withheld: r.scope ? null : 'NO_ACTIVE_CONSENT',
    })),
  })
})

export default router
