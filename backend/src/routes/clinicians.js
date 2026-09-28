import { Router } from 'express'
import { recordAuditEvent } from '../audit/auditLog.js'
import { activeScopeSql, VISIT_SCOPES } from '../clinicians/consentScope.js'
import { query } from '../db/pool.js'
import { HttpError } from '../lib/httpError.js'
import { authenticateToken } from '../middleware/authenticate.js'
import { requireRole } from '../middleware/requireRole.js'

const router = Router()

// Staff directory for choosing whom to grant consent to. Contains no patient data.
router.get('/', authenticateToken(), requireRole('PATIENT', 'CLINICIAN', { resource: 'CLINICIAN_DIRECTORY' }), async (req, res) => {
  const { rows } = await query(
    `SELECT c.id, c.first_name, c.last_name, c.specialty, f.name AS facility, f.district, f.state
       FROM clinical.clinicians c
       JOIN clinical.facilities f ON f.id = c.facility_id
      WHERE c.is_active
      ORDER BY f.state, f.district, c.last_name`,
  )
  res.set('Cache-Control', 'private, max-age=300')
  res.json({
    clinicians: rows.map((c) => ({
      id: c.id,
      name: `Dr. ${c.first_name} ${c.last_name}`,
      specialty: c.specialty,
      facility: c.facility,
      district: c.district,
      state: c.state,
    })),
  })
})

// The signed-in clinician's profile, workload and recently seen patients.
// Recent patients are limited to those who still have an active consent.
router.get('/me', authenticateToken(), requireRole('CLINICIAN', { resource: 'CLINICIAN_PROFILE' }), async (req, res) => {
  const { rows } = await query(
    `SELECT c.id, c.registration_number, c.first_name, c.last_name, c.specialty,
            f.name AS facility_name, f.facility_type, f.city, f.district, f.state,
            u.email, u.last_login_at,
            (SELECT count(DISTINCT cr.patient_id)::int
               FROM clinical.consent_records cr
               JOIN clinical.patients p ON p.id = cr.patient_id AND p.is_active
              WHERE cr.clinician_id = c.id
                AND cr.granted_at <= now()
                AND (cr.expires_at IS NULL OR cr.expires_at > now())
                AND (cr.revoked_at IS NULL OR cr.revoked_at > now())) AS consented_patients,
            (SELECT count(*)::int FROM clinical.visits v
              WHERE v.clinician_id = c.id AND v.visit_at >= now() - interval '30 days') AS visits_last_30_days,
            (SELECT count(*)::int FROM clinical.visits v WHERE v.clinician_id = c.id) AS visits_total
       FROM clinical.clinicians c
       JOIN clinical.facilities f ON f.id = c.facility_id
       JOIN identity.users u ON u.id = c.user_id
      WHERE c.user_id = $1 AND c.is_active`,
    [req.user.id],
  )
  const c = rows[0]
  if (!c) throw new HttpError(404, 'NOT_FOUND', 'No active clinician profile for this account.')

  const recent = await query(
    `SELECT p.id, p.mrn, p.first_name, p.last_name, max(v.visit_at) AS last_seen_at
       FROM clinical.visits v
       JOIN clinical.patients p ON p.id = v.patient_id AND p.is_active
      WHERE v.clinician_id = $1
        AND clinical.has_active_consent(p.id, $1)
      GROUP BY p.id
      ORDER BY last_seen_at DESC
      LIMIT 5`,
    [c.id],
  )

  res.set('Cache-Control', 'no-store')
  res.json({
    clinician: {
      id: c.id,
      name: `Dr. ${c.first_name} ${c.last_name}`,
      registrationNumber: c.registration_number,
      specialty: c.specialty,
      email: c.email,
      lastLoginAt: c.last_login_at,
      facility: { name: c.facility_name, type: c.facility_type, city: c.city, district: c.district, state: c.state },
    },
    stats: {
      consentedPatients: c.consented_patients,
      visitsLast30Days: c.visits_last_30_days,
      visitsTotal: c.visits_total,
    },
    recentPatients: recent.rows.map((p) => ({
      id: p.id,
      mrn: p.mrn,
      fullName: `${p.first_name} ${p.last_name}`,
      lastSeenAt: p.last_seen_at,
    })),
  })
})

// The signed-in clinician's own visits, newest first. What is shown follows the
// patient's consent *now*: diagnoses and decision-support status only under a
// consent that covers visit history; the patient's name only while any consent
// is active. Visits of patients who withdrew consent show date and type only.
router.get('/me/visits', authenticateToken(), requireRole('CLINICIAN', { resource: 'CLINICIAN_VISITS' }), async (req, res) => {
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit ?? '50', 10) || 50, 1), 200)
  const { rows } = await query(
    `SELECT v.id, v.visit_at, v.visit_type, v.status, v.patient_id, f.name AS facility,
            ${activeScopeSql('v.patient_id', 'c.id')} AS scope,
            p.first_name, p.last_name, p.mrn,
            (SELECT json_build_object('code', d.condition_code, 'name', rc.name, 'type', d.diagnosis_type)
               FROM clinical.visit_diagnoses d JOIN ref.conditions rc ON rc.code = d.condition_code
              WHERE d.visit_id = v.id AND d.is_primary) AS primary_diagnosis,
            EXISTS (SELECT 1 FROM clinical.decision_support_runs r WHERE r.visit_id = v.id) AS decision_support
       FROM clinical.visits v
       JOIN clinical.clinicians c ON c.id = v.clinician_id AND c.user_id = $1 AND c.is_active
       JOIN clinical.patients p ON p.id = v.patient_id
       JOIN clinical.facilities f ON f.id = v.facility_id
      ORDER BY v.visit_at DESC
      LIMIT $2`,
    [req.user.id, limit],
  )
  await recordAuditEvent({
    req,
    user: req.user,
    action: 'VISIT_LIST_VIEW',
    resourceType: 'visit',
    outcome: 'SUCCESS',
    metadata: { returned: rows.length, withheld: rows.filter((r) => !r.scope).length },
  })
  res.set('Cache-Control', 'no-store')
  res.json({
    visits: rows.map((r) => {
      const detailed = VISIT_SCOPES.has(r.scope)
      return {
        id: r.id,
        date: r.visit_at,
        visitType: r.visit_type,
        status: r.status,
        facility: r.facility,
        consentScope: r.scope,
        patient: r.scope ? { id: r.patient_id, fullName: `${r.first_name} ${r.last_name}`, mrn: r.mrn } : null,
        primaryDiagnosis: detailed ? r.primary_diagnosis : null,
        decisionSupportReviewed: detailed ? r.decision_support : null,
        withheld: r.scope ? (detailed ? null : 'SCOPE') : 'NO_ACTIVE_CONSENT',
      }
    }),
  })
})

export default router
