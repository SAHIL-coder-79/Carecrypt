import { Router } from 'express'
import { recordAuditEvent } from '../audit/auditLog.js'
import { query } from '../db/pool.js'
import { HttpError } from '../lib/httpError.js'
import { authenticateToken } from '../middleware/authenticate.js'
import { requireRole } from '../middleware/requireRole.js'
import {
  auditPatientAccess,
  authorizePatientAccess,
  parsePatientId,
  sectionsFor,
} from '../patients/access.js'
import {
  buildRecentActivity,
  toAllergy,
  toChronicCondition,
  toDemographics,
  toDiagnosisEntry,
  toMedications,
  toVisit,
} from '../patients/record.js'
import * as repo from '../patients/repository.js'
import { parseNewVisit } from '../patients/visitInput.js'
import { assertNoAllergyConflict, assertReferenceCodes, insertVisit } from '../patients/visitWriter.js'

// Identifiable patient records. Only CLINICIAN (with an active consent) and
// PATIENT (own record) get past requireRole; ADMIN and SECURITY_ADMIN are
// refused before any patient data is read.
const router = Router()

// Applied per route (not router.use) so a refusal can record which patient was targeted.
const guard = [
  authenticateToken(),
  requireRole('CLINICIAN', 'PATIENT', { resource: 'PATIENT_RECORD', patientParam: 'patientId', securityEvent: true }),
  (req, res, next) => {
    res.set('Cache-Control', 'no-store')
    next()
  },
]

// Writing a visit is for clinicians only.
const writeGuard = [
  authenticateToken(),
  requireRole('CLINICIAN', { resource: 'PATIENT_RECORD_WRITE', patientParam: 'patientId', securityEvent: true }),
  (req, res, next) => {
    res.set('Cache-Control', 'no-store')
    next()
  },
]

// Patients the caller may open. ?search= filters clinicians' consented patients
// by name or MRN; it never searches beyond them.
router.get('/', guard, async (req, res) => {
  const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : ''
  const rows =
    req.user.role === 'CLINICIAN'
      ? await repo.listConsentedPatients(req.user.id, { search: search || null })
      : await repo.getOwnPatientSummary(req.user.id)

  await recordAuditEvent({
    req,
    user: req.user,
    action: search ? 'PATIENT_SEARCH' : 'PATIENT_LIST_VIEW',
    resourceType: 'patient',
    outcome: 'SUCCESS',
    metadata: { count: rows.length, ...(search ? { query_length: search.length } : {}) },
  })

  res.json({
    patients: rows.map((p) => ({
      id: p.id,
      mrn: p.mrn,
      fullName: `${p.first_name} ${p.last_name}`,
      ageYears: p.age_years,
      gender: p.gender,
      location: { city: p.city, district: p.district },
      consentScope: p.scope ?? 'FULL_RECORD',
      consentExpiresAt: p.expires_at ? new Date(p.expires_at).toISOString() : null,
      lastVisitAt: p.last_visit_at ? new Date(p.last_visit_at).toISOString() : null,
    })),
  })
})

// Loads the patient row; with a valid grant a missing row can only mean the
// record was deactivated, so 404 reveals nothing new.
async function loadPatient(patientId) {
  const patient = await repo.getPatient(patientId)
  if (!patient) throw new HttpError(404, 'NOT_FOUND', 'Patient record not found.')
  return patient
}

function accessInfo(grant, sections) {
  return { via: grant.via, scope: grant.scope, sections }
}

// Full longitudinal record.
router.get('/:patientId', guard, async (req, res) => {
  const patientId = parsePatientId(req.params.patientId)
  const grant = await authorizePatientAccess(req, patientId, { section: 'record' })
  const sections = sectionsFor(grant.scope)
  const patient = await loadPatient(patientId)

  const [allergyRows, conditionRows, medicationRows, visitRows, consentRows, accessRows] = await Promise.all([
    repo.getAllergies(patientId),
    repo.getChronicConditions(patientId),
    repo.getMedicationHistory(patientId),
    sections.visitHistory ? repo.getVisits(patientId) : null,
    repo.getConsentEvents(patientId),
    grant.via === 'SELF' ? repo.getAccessEvents(patientId) : null,
  ])

  const allergies = allergyRows.map(toAllergy)
  const visitHistory = visitRows ? visitRows.map(toVisit) : null

  await auditPatientAccess(req, patientId, 'record', grant)

  res.json({
    patient: {
      id: patient.id,
      mrn: patient.mrn,
      demographics: toDemographics(patient, sections),
      allergies,
      chronicConditions: conditionRows.map(toChronicCondition),
      medications: toMedications(medicationRows, sections),
      visitHistory,
      recentActivity: buildRecentActivity({
        visits: visitHistory,
        allergies,
        consents: consentRows,
        accessEvents: accessRows,
      }),
    },
    access: accessInfo(grant, sections),
  })
})

router.get('/:patientId/visits', guard, async (req, res) => {
  const patientId = parsePatientId(req.params.patientId)
  const grant = await authorizePatientAccess(req, patientId, { section: 'visits', minimumScope: 'VISIT_HISTORY' })
  await loadPatient(patientId)
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 100)
  const visits = (await repo.getVisits(patientId, { limit })).map(toVisit)
  await auditPatientAccess(req, patientId, 'visits', grant)
  res.json({ patientId, visits, access: accessInfo(grant, sectionsFor(grant.scope)) })
})

router.get('/:patientId/medications', guard, async (req, res) => {
  const patientId = parsePatientId(req.params.patientId)
  const grant = await authorizePatientAccess(req, patientId, { section: 'medications' })
  const sections = sectionsFor(grant.scope)
  await loadPatient(patientId)
  const medications = toMedications(await repo.getMedicationHistory(patientId), sections)
  await auditPatientAccess(req, patientId, 'medications', grant)
  res.json({ patientId, ...medications, access: accessInfo(grant, sections) })
})

router.get('/:patientId/conditions', guard, async (req, res) => {
  const patientId = parsePatientId(req.params.patientId)
  const grant = await authorizePatientAccess(req, patientId, { section: 'conditions' })
  const sections = sectionsFor(grant.scope)
  await loadPatient(patientId)
  const [chronic, diagnoses] = await Promise.all([
    repo.getChronicConditions(patientId),
    sections.diagnosisHistory ? repo.getDiagnosisHistory(patientId) : null,
  ])
  await auditPatientAccess(req, patientId, 'conditions', grant)
  res.json({
    patientId,
    chronicConditions: chronic.map(toChronicCondition),
    diagnosisHistory: diagnoses ? diagnoses.map(toDiagnosisEntry) : null,
    access: accessInfo(grant, sections),
  })
})

// Add a visit. Needs an active consent covering at least the visit history, a
// valid body, known reference codes and no conflict with a recorded drug allergy.
router.post('/:patientId/visits', writeGuard, async (req, res) => {
  const patientId = parsePatientId(req.params.patientId)
  const grant = await authorizePatientAccess(req, patientId, {
    section: 'visit_create',
    minimumScope: 'VISIT_HISTORY',
    action: 'VISIT_CREATE',
  })
  const input = parseNewVisit(req.body)
  await loadPatient(patientId)
  await assertReferenceCodes(input)
  await assertNoAllergyConflict(patientId, input.medications)

  const visitId = await insertVisit({ patientId, clinicianId: grant.clinicianId, input })
  const [row] = await repo.getVisits(patientId, { visitId })

  await recordAuditEvent({
    req,
    user: req.user,
    action: 'VISIT_CREATE',
    resourceType: 'visit',
    resourceId: visitId,
    patientId,
    outcome: 'SUCCESS',
    reason: `Consent ${grant.scope}`,
    metadata: {
      symptoms: input.symptoms.length,
      diagnoses: input.diagnoses.map((d) => d.code),
      clinician_attested: true,
      decision_support_analysis_id: input.decisionSupport?.analysisId ?? null,
      medications: input.medications.map((m) => m.code),
    },
  })

  res.status(201).json({ visit: toVisit(row) })
})

// Who has used this patient's record: for the patient only (their own record).
// Built from the audit log. Clinicians are named; administrators appear by role
// only. The patient's own record views are left out as noise.
const historyGuard = [
  authenticateToken(),
  requireRole('PATIENT', { resource: 'ACCESS_HISTORY', patientParam: 'patientId', securityEvent: true }),
  (req, res, next) => {
    res.set('Cache-Control', 'no-store')
    next()
  },
]

const ACCESS_ACTIONS = {
  PATIENT_RECORD_VIEW: ['Opened your record', 'Tried to open your record'],
  QR_PATIENT_ACCESS: ['Scanned your CareCrypt card', 'Scanned your CareCrypt card'],
  SMARTCARE_ANALYZE: ['Ran SmartCare decision support on your record', 'Tried to run SmartCare on your record'],
  VISIT_CREATE: ['Recorded a visit', 'Tried to record a visit'],
  ACCESS_DENIED: ['Tried to open your record', 'Tried to open your record'],
  CONSENT_GRANT: ['Granted access', 'Tried to grant access'],
  CONSENT_REVOKE: ['Withdrew access', 'Tried to withdraw access'],
  QR_CARD_ISSUE: ['Issued a new CareCrypt card', 'Tried to issue a card'],
}
const ROLE_ACTOR = { ADMIN: 'An administrator', SECURITY_ADMIN: 'A security administrator' }

router.get('/:patientId/access-log', historyGuard, async (req, res) => {
  const patientId = parsePatientId(req.params.patientId)
  await authorizePatientAccess(req, patientId, { section: 'access_history', action: 'ACCESS_HISTORY_VIEW' })

  const { rows } = await query(
    `SELECT a.chain_seq, a.occurred_at, a.action, a.outcome, a.user_id, a.user_role,
            u.display_name, f.name AS facility
       FROM audit.audit_logs a
       LEFT JOIN identity.users u ON u.id = a.user_id
       LEFT JOIN clinical.clinicians c ON c.user_id = a.user_id
       LEFT JOIN clinical.facilities f ON f.id = c.facility_id
      WHERE a.patient_id = $1
        AND a.action = ANY($2::text[])
        AND NOT (a.user_id = $3 AND a.action = 'PATIENT_RECORD_VIEW')
      ORDER BY a.chain_seq DESC
      LIMIT 200`,
    [patientId, Object.keys(ACCESS_ACTIONS), req.user.id],
  )
  await recordAuditEvent({
    req,
    user: req.user,
    action: 'ACCESS_HISTORY_VIEW',
    resourceType: 'patient',
    resourceId: patientId,
    patientId,
    outcome: 'SUCCESS',
    metadata: { returned: rows.length },
  })

  const entries = rows.map((r) => {
    const self = r.user_id === req.user.id
    const refused = r.outcome !== 'SUCCESS'
    return {
      id: String(r.chain_seq),
      occurredAt: r.occurred_at,
      actor: self
        ? { kind: 'SELF', name: 'You' }
        : r.user_role === 'CLINICIAN'
          ? { kind: 'CLINICIAN', name: r.display_name, facility: r.facility }
          : { kind: r.user_role ?? 'UNKNOWN', name: ROLE_ACTOR[r.user_role] ?? 'Unknown account' },
      action: r.action,
      description: ACCESS_ACTIONS[r.action][refused ? 1 : 0],
      outcome: refused ? 'REFUSED' : 'ALLOWED',
    }
  })
  const others = entries.filter((e) => e.actor.kind !== 'SELF')
  res.json({
    patientId,
    summary: {
      clinicians: new Set(others.filter((e) => e.actor.kind === 'CLINICIAN' && e.outcome === 'ALLOWED').map((e) => e.actor.name)).size,
      allowedAccesses: others.filter((e) => e.outcome === 'ALLOWED').length,
      refusedAttempts: others.filter((e) => e.outcome === 'REFUSED').length,
      lastAccessAt: others.find((e) => e.outcome === 'ALLOWED')?.occurredAt ?? null,
    },
    entries,
  })
})

export default router
