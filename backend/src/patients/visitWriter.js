import { query, withTransaction } from '../db/pool.js'
import { HttpError } from '../lib/httpError.js'
import { validationError } from './visitInput.js'

// Rejects codes that are not in the reference catalogues.
export async function assertReferenceCodes({ symptoms, diagnoses, medications }) {
  const { rows } = await query(
    `SELECT 'symptoms' AS kind, code FROM ref.symptoms WHERE code = ANY($1)
     UNION ALL SELECT 'diagnoses', code FROM ref.conditions WHERE code = ANY($2)
     UNION ALL SELECT 'medications', code FROM ref.medications WHERE code = ANY($3)`,
    [symptoms.map((s) => s.code), diagnoses.map((d) => d.code), medications.map((m) => m.code)],
  )
  const known = new Set(rows.map((r) => `${r.kind}:${r.code}`))
  const details = []
  for (const [kind, items] of Object.entries({ symptoms, diagnoses, medications })) {
    items.forEach((item, i) => {
      if (!known.has(`${kind}:${item.code}`)) {
        details.push({ field: `${kind}[${i}].code`, message: `${item.code} is not in the catalogue.` })
      }
    })
  }
  if (details.length > 0) throw validationError(details)
}

// Refuses to prescribe a drug whose class matches one of the patient's active drug allergies.
export async function assertNoAllergyConflict(patientId, medications) {
  if (medications.length === 0) return
  const { rows } = await query(
    `SELECT m.code, m.generic_name, m.drug_class, a.allergen, a.severity, a.reaction
       FROM ref.medications m
       JOIN clinical.patient_allergies a
         ON a.drug_class = m.drug_class AND a.patient_id = $1 AND a.is_active
      WHERE m.code = ANY($2)`,
    [patientId, medications.map((m) => m.code)],
  )
  if (rows.length === 0) return
  const conflicts = rows.map((r) => ({
    medication: r.code,
    medicationName: r.generic_name,
    drugClass: r.drug_class,
    allergen: r.allergen,
    severity: r.severity,
    reaction: r.reaction,
  }))
  const message = `Prescription blocked: the patient is allergic to ${conflicts.map((c) => c.allergen).join(', ')}.`
  throw new HttpError(409, 'ALLERGY_CONFLICT', message, {
    body: { error: 'ALLERGY_CONFLICT', message, conflicts },
  })
}

// Writes the visit and all its details atomically. Returns the new visit id.
export function insertVisit({ patientId, clinicianId, input }) {
  return withTransaction(async (client) => {
    const v = input.vitals
    const { rows } = await client.query(
      `INSERT INTO clinical.visits (
         patient_id, clinician_id, facility_id, visit_at, visit_type, status, chief_complaint, clinical_notes,
         temperature_c, pulse_bpm, systolic_bp_mmhg, diastolic_bp_mmhg, respiratory_rate, spo2_percent, weight_kg, height_cm,
         assessment_confirmed_by, assessment_confirmed_at)
       SELECT $1, c.id, c.facility_id, $3, $4, 'COMPLETED', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, c.user_id, now()
         FROM clinical.clinicians c WHERE c.id = $2
       RETURNING id`,
      [
        patientId, clinicianId, input.visitAt, input.visitType, input.chiefComplaint, input.notes,
        v.temperatureC ?? null, v.pulseBpm ?? null, v.systolic ?? null, v.diastolic ?? null,
        v.respiratoryRate ?? null, v.spo2Percent ?? null, v.weightKg ?? null, v.heightCm ?? null,
      ],
    )
    const visitId = rows[0].id

    // Link the reviewed SmartCare run. It must be this clinician's, for this
    // patient, recent, and not already used by another visit.
    if (input.decisionSupport) {
      const linked = await client.query(
        `UPDATE clinical.decision_support_runs
            SET visit_id = $1, reviewed_at = now()
          WHERE id = $2 AND patient_id = $3 AND clinician_id = $4
            AND visit_id IS NULL AND created_at > now() - interval '24 hours'
          RETURNING id`,
        [visitId, input.decisionSupport.analysisId, patientId, clinicianId],
      )
      if (linked.rowCount !== 1) {
        throw validationError([
          {
            field: 'decisionSupport.analysisId',
            message: 'is not a SmartCare analysis you ran for this patient in the last 24 hours, or it is already linked to a visit.',
          },
        ])
      }
    }

    for (const s of input.symptoms) {
      await client.query(
        `INSERT INTO clinical.visit_symptoms (visit_id, symptom_code, severity, duration_days) VALUES ($1, $2, $3, $4)`,
        [visitId, s.code, s.severity, s.durationDays],
      )
    }
    for (const d of input.diagnoses) {
      await client.query(
        `INSERT INTO clinical.visit_diagnoses (visit_id, condition_code, diagnosis_type, is_primary, notes)
         VALUES ($1, $2, $3, $4, $5)`,
        [visitId, d.code, d.type, d.isPrimary, d.notes],
      )
    }
    for (const m of input.medications) {
      await client.query(
        `INSERT INTO clinical.visit_medications (visit_id, medication_code, dose, frequency, route, duration_days, instructions)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [visitId, m.code, m.dose, m.frequency, m.route, m.durationDays, m.instructions],
      )
    }
    return visitId
  })
}
