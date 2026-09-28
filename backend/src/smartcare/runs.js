import { query } from '../db/pool.js'

// Keeps a record of what SmartCare suggested (codes and levels only), so a saved
// visit can show decision support next to the clinician's own assessment.
export async function recordRun({ patientId, clinicianId, scope, request, result }) {
  const { rows } = await query(
    `INSERT INTO clinical.decision_support_runs
       (patient_id, clinician_id, engine, consent_scope, symptom_codes, suggested_conditions, risk_level, risk_score)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
     RETURNING id`,
    [
      patientId,
      clinicianId,
      `${result.engine.name} ${result.engine.version}`,
      scope,
      request.currentSymptoms.map((s) => s.code),
      JSON.stringify(result.possibleConditions.map((c) => ({ code: c.code, name: c.name, strength: c.strength }))),
      result.overallRisk.level,
      result.overallRisk.score,
    ],
  )
  return rows[0].id
}
