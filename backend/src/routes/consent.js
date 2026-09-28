import { Router } from 'express'
import { recordAuditEvent } from '../audit/auditLog.js'
import * as consents from '../consent/repository.js'
import { HttpError } from '../lib/httpError.js'
import { isUuid, parseUuid } from '../lib/validate.js'
import { authenticateToken } from '../middleware/authenticate.js'
import { requireRole } from '../middleware/requireRole.js'
import { validationError } from '../patients/visitInput.js'

// Patient consent: which clinician may see the patient's record, for what
// purpose and for how long. Record, visit and QR endpoints check it on every
// request, so grants and revocations take effect immediately.
const router = Router()

const SCOPES = ['FULL_RECORD', 'VISIT_HISTORY', 'SUMMARY_ONLY']

const noStore = (req, res, next) => {
  res.set('Cache-Control', 'no-store')
  next()
}

const refuse = (req, reason, resource = 'CONSENT') =>
  new HttpError(403, 'FORBIDDEN', 'This consent action is not permitted.', {
    body: { error: 'FORBIDDEN', role: req.user.role, resource, access: 'DENIED', reason },
  })

// POST /api/consent: a patient grants a clinician access to their own record.
router.post('/', authenticateToken(), requireRole('PATIENT', { resource: 'CONSENT' }), noStore, async (req, res) => {
  const patientId = await consents.findOwnPatientId(req.user.id)
  if (!patientId) throw refuse(req, 'NO_PATIENT_RECORD')

  const body = req.body ?? {}
  // The patient is always the caller; a different patientId in the body is refused.
  if (body.patientId !== undefined && body.patientId !== patientId) {
    await recordAuditEvent({
      req, user: req.user, action: 'CONSENT_GRANT', resourceType: 'consent', patientId: isUuid(body.patientId) ? body.patientId : null,
      outcome: 'DENIED', reason: 'NOT_OWN_RECORD',
    })
    throw refuse(req, 'NOT_OWN_RECORD')
  }

  const details = []
  if (!isUuid(body.clinicianId)) details.push({ field: 'clinicianId', message: 'must be a clinician id.' })
  if (!SCOPES.includes(body.scope)) details.push({ field: 'scope', message: `must be one of ${SCOPES.join(', ')}.` })
  const purpose = typeof body.purpose === 'string' ? body.purpose.trim() : ''
  if (purpose.length < 3 || purpose.length > 200) {
    details.push({ field: 'purpose', message: 'must be 3 to 200 characters.' })
  }
  const durationDays = body.durationDays ?? null
  if (durationDays !== null && !(Number.isInteger(durationDays) && durationDays >= 1 && durationDays <= 365)) {
    details.push({ field: 'durationDays', message: 'must be a whole number of days from 1 to 365, or null for "until revoked".' })
  }
  if (details.length === 0 && !(await consents.clinicianIsActive(body.clinicianId.toLowerCase()))) {
    details.push({ field: 'clinicianId', message: 'no active clinician has this id.' })
  }
  if (details.length > 0) throw validationError(details)

  const clinicianId = body.clinicianId.toLowerCase()
  const { id, replaced } = await consents.grant({
    patientId,
    clinicianId,
    scope: body.scope,
    purpose,
    durationDays,
    recordedBy: req.user.id,
  })
  const consent = consents.toConsent(await consents.getById(id))

  await recordAuditEvent({
    req,
    user: req.user,
    action: 'CONSENT_GRANT',
    resourceType: 'consent',
    resourceId: id,
    patientId,
    outcome: 'SUCCESS',
    reason: `${body.scope} to ${consent.clinician.name}`,
    metadata: { clinician_id: clinicianId, scope: body.scope, duration_days: durationDays, replaced },
  })

  res.status(201).json({ consent, replaced })
})

// GET /api/consent/:patientId
//   PATIENT: all consents on their own record.
//   CLINICIAN: only consents granted to themselves (same empty answer whether or
//   not the patient exists).
router.get(
  '/:patientId',
  authenticateToken(),
  requireRole('PATIENT', 'CLINICIAN', { resource: 'CONSENT', patientParam: 'patientId' }),
  noStore,
  async (req, res) => {
    const patientId = parseUuid(req.params.patientId, 'patientId')
    let clinicianId = null

    if (req.user.role === 'PATIENT') {
      if ((await consents.findOwnPatientId(req.user.id)) !== patientId) {
        await recordAuditEvent({
          req, user: req.user, action: 'CONSENT_VIEW', resourceType: 'consent', patientId,
          outcome: 'DENIED', reason: 'NOT_OWN_RECORD',
        })
        throw refuse(req, 'NOT_OWN_RECORD')
      }
    } else {
      clinicianId = await consents.findOwnClinicianId(req.user.id)
      if (!clinicianId) throw refuse(req, 'NO_CLINICIAN_PROFILE')
    }

    const rows = await consents.listForPatient(patientId, { clinicianId })
    await recordAuditEvent({
      req,
      user: req.user,
      action: 'CONSENT_VIEW',
      resourceType: 'consent',
      patientId: rows.length > 0 || req.user.role === 'PATIENT' ? patientId : null,
      outcome: 'SUCCESS',
      metadata: { count: rows.length },
    })
    res.json({ patientId, consents: rows.map(consents.toConsent) })
  },
)

// DELETE /api/consent/:consentId: revoke. The patient may revoke any consent on
// their record; a clinician may give up a consent granted to themselves.
// Consents are never deleted: revocation is recorded with a timestamp and reason.
router.delete('/:consentId', authenticateToken(), requireRole('PATIENT', 'CLINICIAN', { resource: 'CONSENT' }), noStore, async (req, res) => {
  const consentId = parseUuid(req.params.consentId, 'consentId')
  const row = await consents.getById(consentId)

  const isOwner =
    row &&
    ((req.user.role === 'PATIENT' && row.patient_user_id === req.user.id) ||
      (req.user.role === 'CLINICIAN' && row.clinician_user_id === req.user.id))

  if (!isOwner) {
    // Same answer for "does not exist" and "not yours".
    await recordAuditEvent({
      req, user: req.user, action: 'CONSENT_REVOKE', resourceType: 'consent', resourceId: consentId,
      patientId: row?.patient_id ?? null, outcome: 'DENIED', reason: row ? 'NOT_OWNER' : 'NOT_FOUND',
    })
    throw new HttpError(404, 'NOT_FOUND', 'Consent not found.')
  }
  if (row.status === 'REVOKED') {
    throw new HttpError(409, 'CONSENT_ALREADY_REVOKED', 'This consent has already been revoked.')
  }
  if (row.status === 'EXPIRED') {
    throw new HttpError(409, 'CONSENT_EXPIRED', 'This consent has already expired.')
  }

  const given = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 200) : ''
  const reason = given || (req.user.role === 'PATIENT' ? 'Revoked by patient' : 'Relinquished by clinician')
  if (!(await consents.revoke(consentId, reason))) {
    throw new HttpError(409, 'CONSENT_ALREADY_REVOKED', 'This consent is no longer active.')
  }
  const consent = consents.toConsent(await consents.getById(consentId))

  await recordAuditEvent({
    req,
    user: req.user,
    action: 'CONSENT_REVOKE',
    resourceType: 'consent',
    resourceId: consentId,
    patientId: row.patient_id,
    outcome: 'SUCCESS',
    reason,
    metadata: { clinician_id: row.clinician_id, scope: row.scope, by: req.user.role },
  })

  res.json({ consent })
})

export default router
