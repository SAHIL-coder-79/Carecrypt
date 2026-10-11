import { query, withTransaction } from '../db/pool.js'

const SELECT = `
  SELECT cr.id, cr.patient_id, cr.clinician_id, cr.scope, cr.reason, cr.requested_duration,
         cr.status, cr.created_at, cr.expires_at, cr.resolved_at, cr.resolved_by, cr.consent_record_id,
         c.first_name, c.last_name, c.specialty,
         f.name AS facility_name, f.district AS facility_district,
         p.mrn AS patient_mrn
    FROM clinical.consent_requests cr
    LEFT JOIN clinical.clinicians c ON c.id = cr.clinician_id
    LEFT JOIN clinical.facilities f ON f.id = c.facility_id
    LEFT JOIN clinical.patients p ON p.id = cr.patient_id
`

export async function findByPatientId(patientId) {
  const { rows } = await query(`${SELECT} WHERE cr.patient_id = $1 ORDER BY cr.created_at DESC`, [patientId])
  return rows
}

export async function findByClinicianId(clinicianId) {
  const { rows } = await query(`${SELECT} WHERE cr.clinician_id = $1 ORDER BY cr.created_at DESC`, [clinicianId])
  return rows
}

export async function getById(id) {
  const { rows } = await query(`${SELECT} WHERE cr.id = $1`, [id])
  return rows[0] ?? null
}

export async function createRequest({ patientId, clinicianId, scope, reason, durationDays }) {
  const duration = durationDays ? `${durationDays} days` : null
  const { rows } = await query(`
    INSERT INTO clinical.consent_requests
      (patient_id, clinician_id, scope, reason, requested_duration, expires_at)
    VALUES
      ($1, $2, $3, $4, $5, now() + interval '7 days')
    RETURNING id
  `, [patientId, clinicianId, scope, reason, duration])
  return rows[0].id
}

export async function resolveRequest(id, status, resolvedBy, consentRecordId = null) {
  const { rowCount } = await query(`
    UPDATE clinical.consent_requests
       SET status = $2, resolved_at = now(), resolved_by = $3, consent_record_id = $4
     WHERE id = $1 AND status = 'PENDING'
  `, [id, status, resolvedBy, consentRecordId])
  return rowCount === 1
}

function parseDurationDays(dur) {
  if (!dur) return null
  if (typeof dur === 'number') return dur
  if (typeof dur === 'object') {
    let days = dur.days || 0
    if (dur.months) days += dur.months * 30
    if (dur.years) days += dur.years * 365
    return days > 0 ? days : null
  }
  if (typeof dur === 'string') {
    const match = dur.match(/\d+/)
    return match ? parseInt(match[0], 10) : null
  }
  return null
}

export function toRequest(r) {
  const iso = (v) => (v ? new Date(v).toISOString() : null)
  const clinicianName = `Dr. ${r.first_name || ''} ${r.last_name || ''}`.trim()
  return {
    id: r.id,
    patientId: r.patient_id,
    patientMrn: r.patient_mrn,
    clinician: {
      id: r.clinician_id,
      name: clinicianName,
      specialty: r.specialty,
      facility: r.facility_name,
      district: r.facility_district,
    },
    clinicianName,
    clinicianSpecialty: r.specialty,
    clinicianFacility: r.facility_name,
    clinicianDistrict: r.facility_district,
    scope: r.scope,
    reason: r.reason,
    requestedDurationDays: parseDurationDays(r.requested_duration),
    status: r.status,
    createdAt: iso(r.created_at),
    expiresAt: iso(r.expires_at),
    resolvedAt: iso(r.resolved_at),
    consentRecordId: r.consent_record_id,
  }
}
