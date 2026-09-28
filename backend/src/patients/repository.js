import { query } from '../db/pool.js'

// Every query here is scoped to a single patient id that has already passed
// authorizePatientAccess(). None of them may be reused for listing or aggregation.

export async function getPatient(patientId) {
  const { rows } = await query(
    `SELECT id, mrn, first_name, last_name, date_of_birth,
            extract(year FROM age(date_of_birth))::int AS age_years,
            gender, blood_group, phone, email, address_line, city, district, state, pincode,
            emergency_contact_name, emergency_contact_phone, created_at, updated_at
       FROM clinical.patients
      WHERE id = $1 AND is_active`,
    [patientId],
  )
  return rows[0] ?? null
}

export async function getAllergies(patientId) {
  const { rows } = await query(
    `SELECT allergen, allergen_type, drug_class, reaction, severity, recorded_at
       FROM clinical.patient_allergies
      WHERE patient_id = $1 AND is_active
      ORDER BY severity DESC, allergen`,
    [patientId],
  )
  return rows
}

export async function getChronicConditions(patientId) {
  const { rows } = await query(
    `SELECT pc.condition_code, c.name, c.category, pc.status, pc.onset_date, pc.resolved_date,
            pc.notes, pc.created_at, pc.recorded_in_visit_id,
            cl.first_name || ' ' || cl.last_name AS recorded_by
       FROM clinical.patient_conditions pc
       JOIN ref.conditions c ON c.code = pc.condition_code
       LEFT JOIN clinical.clinicians cl ON cl.id = pc.recorded_by
      WHERE pc.patient_id = $1
      ORDER BY (pc.status = 'RESOLVED'), pc.onset_date NULLS LAST, c.name`,
    [patientId],
  )
  return rows
}

// Visits newest first, each with its symptoms, diagnoses and prescriptions.
// Pass visitId to fetch a single visit.
export async function getVisits(patientId, { limit = 100, visitId = null } = {}) {
  const { rows } = await query(
    `SELECT v.id, v.visit_at, v.visit_type, v.status, v.chief_complaint, v.clinical_notes,
            v.temperature_c, v.pulse_bpm, v.systolic_bp_mmhg, v.diastolic_bp_mmhg,
            v.respiratory_rate, v.spo2_percent, v.weight_kg, v.height_cm,
            cl.first_name || ' ' || cl.last_name AS clinician_name, cl.specialty AS clinician_specialty,
            f.name AS facility_name, f.district AS facility_district,
            COALESCE((
              SELECT json_agg(json_build_object(
                       'code', s.symptom_code, 'name', rs.display_name,
                       'severity', s.severity, 'durationDays', s.duration_days)
                     ORDER BY s.severity DESC, rs.display_name)
                FROM clinical.visit_symptoms s
                JOIN ref.symptoms rs ON rs.code = s.symptom_code
               WHERE s.visit_id = v.id), '[]'::json) AS symptoms,
            COALESCE((
              SELECT json_agg(json_build_object(
                       'code', d.condition_code, 'name', rc.name, 'type', d.diagnosis_type,
                       'isPrimary', d.is_primary, 'notes', d.notes)
                     ORDER BY d.is_primary DESC, d.diagnosis_type, rc.name)
                FROM clinical.visit_diagnoses d
                JOIN ref.conditions rc ON rc.code = d.condition_code
               WHERE d.visit_id = v.id), '[]'::json) AS diagnoses,
            COALESCE((
              SELECT json_agg(json_build_object(
                       'code', m.medication_code, 'name', rm.generic_name, 'dose', m.dose,
                       'frequency', m.frequency, 'route', m.route,
                       'durationDays', m.duration_days, 'instructions', m.instructions)
                     ORDER BY rm.generic_name)
                FROM clinical.visit_medications m
                JOIN ref.medications rm ON rm.code = m.medication_code
               WHERE m.visit_id = v.id), '[]'::json) AS medications,
            v.assessment_confirmed_at, cu.display_name AS assessment_confirmed_by,
            (SELECT json_build_object(
                      'analysisId', d.id, 'engine', d.engine, 'riskLevel', d.risk_level, 'riskScore', d.risk_score,
                      'suggestedConditions', d.suggested_conditions, 'analysedAt', d.created_at, 'reviewedAt', d.reviewed_at)
               FROM clinical.decision_support_runs d
              WHERE d.visit_id = v.id) AS decision_support
       FROM clinical.visits v
       JOIN clinical.clinicians cl ON cl.id = v.clinician_id
       JOIN clinical.facilities f ON f.id = v.facility_id
       LEFT JOIN identity.users cu ON cu.id = v.assessment_confirmed_by
      WHERE v.patient_id = $1 AND ($3::uuid IS NULL OR v.id = $3)
      ORDER BY v.visit_at DESC
      LIMIT $2`,
    [patientId, limit, visitId],
  )
  return rows
}

// Every prescription, newest first. A prescription is active until its course ends.
export async function getMedicationHistory(patientId) {
  const { rows } = await query(
    `SELECT m.medication_code, rm.generic_name, rm.drug_class, m.dose, m.frequency, m.route,
            m.duration_days, m.instructions,
            v.id AS visit_id, v.visit_at AS prescribed_at,
            cl.first_name || ' ' || cl.last_name AS prescribed_by,
            v.visit_at + make_interval(days => m.duration_days) AS ends_at,
            (m.duration_days IS NOT NULL
               AND v.visit_at + make_interval(days => m.duration_days) >= now()) AS is_active
       FROM clinical.visit_medications m
       JOIN clinical.visits v ON v.id = m.visit_id
       JOIN ref.medications rm ON rm.code = m.medication_code
       JOIN clinical.clinicians cl ON cl.id = v.clinician_id
      WHERE v.patient_id = $1 AND v.status = 'COMPLETED'
      ORDER BY v.visit_at DESC, rm.generic_name`,
    [patientId],
  )
  return rows
}

export async function getDiagnosisHistory(patientId) {
  const { rows } = await query(
    `SELECT d.condition_code, rc.name, rc.category, d.diagnosis_type, d.is_primary, d.notes,
            v.id AS visit_id, v.visit_at
       FROM clinical.visit_diagnoses d
       JOIN clinical.visits v ON v.id = d.visit_id
       JOIN ref.conditions rc ON rc.code = d.condition_code
      WHERE v.patient_id = $1 AND v.status = 'COMPLETED'
      ORDER BY v.visit_at DESC, d.is_primary DESC`,
    [patientId],
  )
  return rows
}

export async function getConsentEvents(patientId) {
  const { rows } = await query(
    `SELECT cr.scope, cr.purpose, cr.granted_at, cr.expires_at, cr.revoked_at, cr.revoked_reason,
            cl.first_name || ' ' || cl.last_name AS clinician_name
       FROM clinical.consent_records cr
       JOIN clinical.clinicians cl ON cl.id = cr.clinician_id
      WHERE cr.patient_id = $1
      ORDER BY cr.granted_at DESC
      LIMIT 20`,
    [patientId],
  )
  return rows
}

// Who looked at (or was refused) this record, grouped per person per day.
// Shown only to the patient themselves.
export async function getAccessEvents(patientId) {
  const { rows } = await query(
    `SELECT max(a.occurred_at) AS last_at, count(*)::int AS times, a.outcome, a.user_role,
            coalesce(u.display_name, 'Unknown user') AS actor
       FROM audit.audit_logs a
       LEFT JOIN identity.users u ON u.id = a.user_id
      WHERE a.patient_id = $1
        AND a.action IN ('PATIENT_RECORD_VIEW', 'ACCESS_DENIED')
        AND a.user_role IS DISTINCT FROM 'PATIENT'
      GROUP BY a.user_id, u.display_name, a.user_role, a.outcome, date_trunc('day', a.occurred_at)
      ORDER BY last_at DESC
      LIMIT 20`,
    [patientId],
  )
  return rows
}

// Patients the caller may open. Clinicians: patients with an active consent to them.
// `search` matches name or MRN, but only within those consented patients.
export async function listConsentedPatients(clinicianUserId, { search = null } = {}) {
  const pattern = search ? `%${search.replace(/[\\%_]/g, '\\$&')}%` : null
  const { rows } = await query(
    `SELECT DISTINCT ON (p.id)
            p.id, p.mrn, p.first_name, p.last_name, p.gender, p.city, p.district,
            extract(year FROM age(p.date_of_birth))::int AS age_years,
            cr.scope, cr.expires_at,
            CASE WHEN cr.scope <> 'SUMMARY_ONLY'
                 THEN (SELECT max(v.visit_at) FROM clinical.visits v WHERE v.patient_id = p.id) END
              AS last_visit_at
       FROM clinical.consent_records cr
       JOIN clinical.clinicians c ON c.id = cr.clinician_id AND c.user_id = $1 AND c.is_active
       JOIN clinical.patients p ON p.id = cr.patient_id AND p.is_active
      WHERE cr.granted_at <= now()
        AND (cr.expires_at IS NULL OR cr.expires_at > now())
        AND (cr.revoked_at IS NULL OR cr.revoked_at > now())
        AND ($2::text IS NULL
             OR p.first_name || ' ' || p.last_name ILIKE $2
             OR p.mrn ILIKE $2)
      ORDER BY p.id, CASE cr.scope WHEN 'FULL_RECORD' THEN 3 WHEN 'VISIT_HISTORY' THEN 2 ELSE 1 END DESC`,
    [clinicianUserId, pattern],
  )
  return rows.sort((a, b) => a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name))
}

export async function getOwnPatientSummary(patientUserId) {
  const { rows } = await query(
    `SELECT p.id, p.mrn, p.first_name, p.last_name, p.gender, p.city, p.district,
            extract(year FROM age(p.date_of_birth))::int AS age_years,
            (SELECT max(v.visit_at) FROM clinical.visits v WHERE v.patient_id = p.id) AS last_visit_at
       FROM clinical.patients p
      WHERE p.user_id = $1 AND p.is_active`,
    [patientUserId],
  )
  return rows
}
