// Turns database rows into the longitudinal patient record returned by the API,
// dropping every section the caller's scope does not include.

const num = (v) => (v === null || v === undefined ? null : Number(v))
const iso = (v) => (v ? new Date(v).toISOString() : null)

export function toDemographics(p, { contactDetails }) {
  const demographics = {
    firstName: p.first_name,
    lastName: p.last_name,
    fullName: `${p.first_name} ${p.last_name}`,
    dateOfBirth: p.date_of_birth,
    ageYears: p.age_years,
    gender: p.gender,
    bloodGroup: p.blood_group,
    location: { city: p.city, district: p.district, state: p.state },
  }
  if (contactDetails) {
    demographics.contact = { phone: p.phone, email: p.email }
    demographics.location = { ...demographics.location, addressLine: p.address_line, pincode: p.pincode }
    demographics.emergencyContact = { name: p.emergency_contact_name, phone: p.emergency_contact_phone }
  }
  return demographics
}

export const toAllergy = (a) => ({
  allergen: a.allergen,
  type: a.allergen_type,
  drugClass: a.drug_class,
  reaction: a.reaction,
  severity: a.severity,
  recordedAt: iso(a.recorded_at),
})

export const toChronicCondition = (c) => ({
  code: c.condition_code,
  name: c.name,
  category: c.category,
  status: c.status,
  onsetDate: c.onset_date,
  resolvedDate: c.resolved_date,
  notes: c.notes,
  recordedBy: c.recorded_by ? `Dr. ${c.recorded_by}` : null,
})

export const toVisit = (v) => ({
  id: v.id,
  date: iso(v.visit_at),
  type: v.visit_type,
  status: v.status,
  clinician: { name: `Dr. ${v.clinician_name}`, specialty: v.clinician_specialty },
  facility: { name: v.facility_name, district: v.facility_district },
  chiefComplaint: v.chief_complaint,
  symptoms: v.symptoms,
  vitals: {
    temperatureC: num(v.temperature_c),
    pulseBpm: v.pulse_bpm,
    bloodPressure:
      v.systolic_bp_mmhg === null ? null : { systolic: v.systolic_bp_mmhg, diastolic: v.diastolic_bp_mmhg },
    respiratoryRate: v.respiratory_rate,
    spo2Percent: v.spo2_percent,
    weightKg: num(v.weight_kg),
    heightCm: num(v.height_cm),
  },
  diagnoses: v.diagnoses,
  medications: v.medications,
  notes: v.clinical_notes,
  // Who confirmed the diagnoses above as their clinical assessment.
  assessment: v.assessment_confirmed_at
    ? { confirmedBy: v.assessment_confirmed_by, confirmedAt: iso(v.assessment_confirmed_at) }
    : null,
  // What SmartCare suggested before the clinician decided, if it was used. Never a diagnosis.
  decisionSupport: v.decision_support
    ? { label: 'Clinical Decision Support', ...v.decision_support }
    : null,
})

const toPrescription = (m) => ({
  code: m.medication_code,
  name: m.generic_name,
  drugClass: m.drug_class,
  dose: m.dose,
  frequency: m.frequency,
  route: m.route,
  durationDays: m.duration_days,
  instructions: m.instructions,
  prescribedAt: iso(m.prescribed_at),
  prescribedBy: `Dr. ${m.prescribed_by}`,
  endsAt: iso(m.ends_at),
  visitId: m.visit_id,
})

// Active = most recent prescription of each drug whose course has not ended.
export function toMedications(rows, { medicationHistory }) {
  const seen = new Set()
  const active = []
  for (const row of rows) {
    if (row.is_active && !seen.has(row.medication_code)) {
      seen.add(row.medication_code)
      active.push(toPrescription(row))
    }
  }
  return { active, history: medicationHistory ? rows.map(toPrescription) : null }
}

export const toDiagnosisEntry = (d) => ({
  code: d.condition_code,
  name: d.name,
  category: d.category,
  type: d.diagnosis_type,
  isPrimary: d.is_primary,
  notes: d.notes,
  date: iso(d.visit_at),
  visitId: d.visit_id,
})

const TYPE_LABEL = { OPD: 'Outpatient visit', FOLLOW_UP: 'Follow-up visit', EMERGENCY: 'Emergency visit', TELECONSULT: 'Teleconsultation' }
const SCOPE_LABEL = { FULL_RECORD: 'full record', VISIT_HISTORY: 'visit history', SUMMARY_ONLY: 'summary only' }

// Most recent events across the record, newest first.
export function buildRecentActivity({ visits, allergies, consents, accessEvents, limit = 12 }) {
  const events = []

  for (const v of visits ?? []) {
    const primary = v.diagnoses.find((d) => d.isPrimary)
    events.push({
      type: 'VISIT',
      at: v.date,
      title: `${TYPE_LABEL[v.type] ?? 'Visit'}${primary ? `: ${primary.name}` : ''}`,
      detail: `${v.clinician.name}, ${v.facility.name}`,
      visitId: v.id,
    })
  }
  for (const a of allergies ?? []) {
    events.push({
      type: 'ALLERGY_RECORDED',
      at: a.recordedAt,
      title: `Allergy recorded: ${a.allergen}`,
      detail: `${a.severity.toLowerCase().replace('_', '-')} reaction${a.reaction ? `, ${a.reaction}` : ''}`,
    })
  }
  for (const c of consents ?? []) {
    events.push({
      type: 'CONSENT_GRANTED',
      at: iso(c.granted_at),
      title: `Consent granted to Dr. ${c.clinician_name}`,
      detail: `${SCOPE_LABEL[c.scope]}${c.expires_at ? `, until ${iso(c.expires_at).slice(0, 10)}` : ''}`,
    })
    if (c.revoked_at) {
      events.push({
        type: 'CONSENT_REVOKED',
        at: iso(c.revoked_at),
        title: `Consent revoked for Dr. ${c.clinician_name}`,
        detail: c.revoked_reason,
      })
    }
  }
  for (const e of accessEvents ?? []) {
    const times = e.times > 1 ? ` (${e.times} times that day)` : ''
    events.push(
      e.outcome === 'SUCCESS'
        ? { type: 'RECORD_ACCESSED', at: iso(e.last_at), title: `Record viewed by ${e.actor}`, detail: `Access permitted${times}` }
        : {
            type: 'ACCESS_DENIED',
            at: iso(e.last_at),
            title: `Access attempt blocked: ${e.actor}`,
            detail: `${e.user_role ?? 'Unknown role'} was refused${times}`,
          },
    )
  }

  return events
    .filter((e) => e.at)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit)
}
