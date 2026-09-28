import { recordAuditEvent } from '../audit/auditLog.js'
import { query } from '../db/pool.js'
import { badRequest, HttpError } from '../lib/httpError.js'

// Consent scopes, from narrowest to widest. A patient viewing their own record
// is treated as FULL_RECORD.
export const SCOPE_RANK = Object.freeze({ SUMMARY_ONLY: 1, VISIT_HISTORY: 2, FULL_RECORD: 3 })

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function parsePatientId(value) {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw badRequest('patientId must be a UUID.')
  }
  return value.toLowerCase()
}

// Which parts of a record each scope may see.
export function sectionsFor(scope) {
  const rank = SCOPE_RANK[scope]
  return {
    demographics: true,
    contactDetails: rank >= SCOPE_RANK.FULL_RECORD,
    allergies: true,
    chronicConditions: true,
    activeMedications: true,
    medicationHistory: rank >= SCOPE_RANK.VISIT_HISTORY,
    visitHistory: rank >= SCOPE_RANK.VISIT_HISTORY,
    diagnosisHistory: rank >= SCOPE_RANK.VISIT_HISTORY,
    recentActivity: true,
  }
}

// Decides whether req.user may see patientId's record, at least at minimumScope.
// Returns { via: 'CONSENT' | 'SELF', scope, clinicianId? }.
// Otherwise audits the refusal and throws 403 without revealing whether the
// patient exists.
export async function authorizePatientAccess(
  req,
  patientId,
  { section, minimumScope = 'SUMMARY_ONLY', action = 'PATIENT_RECORD_VIEW' },
) {
  const { id: userId, role } = req.user
  let grant

  if (role === 'PATIENT') {
    const { rows } = await query(
      'SELECT id FROM clinical.patients WHERE user_id = $1 AND is_active',
      [userId],
    )
    if (rows[0]?.id !== patientId) {
      await deny(req, patientId, section, 'NOT_OWN_RECORD', action)
    }
    grant = { via: 'SELF', scope: 'FULL_RECORD' }
  } else if (role === 'CLINICIAN') {
    const { rows } = await query(
      `SELECT c.id AS clinician_id,
              (SELECT cr.scope
                 FROM clinical.consent_records cr
                 JOIN clinical.patients p ON p.id = cr.patient_id AND p.is_active
                WHERE cr.patient_id = $2
                  AND cr.clinician_id = c.id
                  AND cr.granted_at <= now()
                  AND (cr.expires_at IS NULL OR cr.expires_at > now())
                  AND (cr.revoked_at IS NULL OR cr.revoked_at > now())
                ORDER BY CASE cr.scope WHEN 'FULL_RECORD' THEN 3 WHEN 'VISIT_HISTORY' THEN 2 ELSE 1 END DESC
                LIMIT 1) AS scope
         FROM clinical.clinicians c
        WHERE c.user_id = $1 AND c.is_active`,
      [userId, patientId],
    )
    if (!rows[0]) await deny(req, patientId, section, 'NO_CLINICIAN_PROFILE', action)
    if (!rows[0].scope) await deny(req, patientId, section, 'NO_ACTIVE_CONSENT', action)
    grant = { via: 'CONSENT', scope: rows[0].scope, clinicianId: rows[0].clinician_id }
  } else {
    // requireRole() already stops other roles; this is a second line of defence.
    await deny(req, patientId, section, 'ROLE_NOT_PERMITTED', action)
  }

  if (SCOPE_RANK[grant.scope] < SCOPE_RANK[minimumScope]) {
    await deny(req, patientId, section, 'CONSENT_SCOPE_INSUFFICIENT', action)
  }
  return grant
}

export async function auditPatientAccess(req, patientId, section, grant) {
  await recordAuditEvent({
    req,
    user: req.user,
    action: 'PATIENT_RECORD_VIEW',
    resourceType: 'patient',
    resourceId: patientId,
    patientId,
    outcome: 'SUCCESS',
    reason: grant.via === 'SELF' ? 'Own record' : `Consent ${grant.scope}`,
    metadata: { section, via: grant.via, scope: grant.scope },
  })
}

async function deny(req, patientId, section, reason, action) {
  await recordAuditEvent({
    req,
    user: req.user,
    action,
    resourceType: 'patient',
    resourceId: patientId,
    patientId,
    outcome: 'DENIED',
    reason,
    metadata: { section },
  })
  throw new HttpError(403, 'FORBIDDEN', 'Access to this patient record is not permitted.', {
    body: { error: 'FORBIDDEN', role: req.user.role, resource: 'PATIENT_RECORD', access: 'DENIED', reason },
  })
}
