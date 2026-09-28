// SQL expression: the widest consent scope patient `patientCol` currently gives
// clinician `clinicianCol`, or NULL when there is no active consent.
export const activeScopeSql = (patientCol, clinicianCol) => `(
  SELECT cr.scope
    FROM clinical.consent_records cr
    JOIN clinical.patients cp ON cp.id = cr.patient_id AND cp.is_active
   WHERE cr.patient_id = ${patientCol}
     AND cr.clinician_id = ${clinicianCol}
     AND cr.granted_at <= now()
     AND (cr.expires_at IS NULL OR cr.expires_at > now())
     AND (cr.revoked_at IS NULL OR cr.revoked_at > now())
   ORDER BY CASE cr.scope WHEN 'FULL_RECORD' THEN 3 WHEN 'VISIT_HISTORY' THEN 2 ELSE 1 END DESC
   LIMIT 1)`

// Scopes under which a clinician may see visit-level clinical details.
export const VISIT_SCOPES = new Set(['FULL_RECORD', 'VISIT_HISTORY'])
