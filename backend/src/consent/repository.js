import { query, withTransaction } from '../db/pool.js'

// Status is derived from the timestamps, so it is always current.
const STATUS = `CASE
    WHEN cr.revoked_at IS NOT NULL AND cr.revoked_at <= now() THEN 'REVOKED'
    WHEN cr.expires_at IS NOT NULL AND cr.expires_at <= now() THEN 'EXPIRED'
    WHEN cr.granted_at > now() THEN 'PENDING'
    ELSE 'ACTIVE'
  END`

const SELECT = `
  SELECT cr.id, cr.patient_id, cr.clinician_id, cr.scope, cr.purpose, cr.channel,
         cr.granted_at, cr.expires_at, cr.revoked_at, cr.revoked_reason,
         ${STATUS} AS status,
         c.first_name, c.last_name, c.specialty, c.user_id AS clinician_user_id,
         f.name AS facility_name, f.district AS facility_district,
         p.user_id AS patient_user_id
    FROM clinical.consent_records cr
    JOIN clinical.clinicians c ON c.id = cr.clinician_id
    JOIN clinical.facilities f ON f.id = c.facility_id
    JOIN clinical.patients p ON p.id = cr.patient_id`

const ORDER = `ORDER BY (${STATUS} = 'ACTIVE') DESC, cr.granted_at DESC`

export async function listForPatient(patientId, { clinicianId = null } = {}) {
  const { rows } = await query(
    `${SELECT} WHERE cr.patient_id = $1 AND ($2::uuid IS NULL OR cr.clinician_id = $2) ${ORDER}`,
    [patientId, clinicianId],
  )
  return rows
}

export async function getById(consentId) {
  const { rows } = await query(`${SELECT} WHERE cr.id = $1`, [consentId])
  return rows[0] ?? null
}

export async function findOwnPatientId(userId) {
  const { rows } = await query('SELECT id FROM clinical.patients WHERE user_id = $1 AND is_active', [userId])
  return rows[0]?.id ?? null
}

export async function findOwnClinicianId(userId) {
  const { rows } = await query('SELECT id FROM clinical.clinicians WHERE user_id = $1 AND is_active', [userId])
  return rows[0]?.id ?? null
}

export async function clinicianIsActive(clinicianId) {
  const { rows } = await query('SELECT 1 FROM clinical.clinicians WHERE id = $1 AND is_active', [clinicianId])
  return rows.length > 0
}

// Grants a new consent. Any consent still active for the same clinician is
// revoked first, so a patient's latest decision is the one in force.
export function grant({ patientId, clinicianId, scope, purpose, durationDays, recordedBy }) {
  return withTransaction(async (client) => {
    const replaced = await client.query(
      `UPDATE clinical.consent_records
          SET revoked_at = now(), revoked_reason = 'Replaced by a new consent'
        WHERE patient_id = $1 AND clinician_id = $2
          AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())
        RETURNING id`,
      [patientId, clinicianId],
    )
    const { rows } = await client.query(
      `INSERT INTO clinical.consent_records
         (patient_id, clinician_id, scope, purpose, channel, granted_at, expires_at, recorded_by)
       VALUES ($1, $2, $3, $4, 'PATIENT_PORTAL', now(),
               CASE WHEN $5::int IS NULL THEN NULL ELSE now() + make_interval(days => $5::int) END, $6)
       RETURNING id`,
      [patientId, clinicianId, scope, purpose, durationDays, recordedBy],
    )
    return { id: rows[0].id, replaced: replaced.rowCount }
  })
}

// Revokes an active consent. Returns false if it was already revoked or expired
// (guards against two revocations racing).
export async function revoke(consentId, reason) {
  const { rowCount } = await query(
    `UPDATE clinical.consent_records
        SET revoked_at = now(), revoked_reason = $2
      WHERE id = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`,
    [consentId, reason],
  )
  return rowCount === 1
}

export function toConsent(r) {
  const iso = (v) => (v ? new Date(v).toISOString() : null)
  return {
    id: r.id,
    patientId: r.patient_id,
    clinician: {
      id: r.clinician_id,
      name: `Dr. ${r.first_name} ${r.last_name}`,
      specialty: r.specialty,
      facility: r.facility_name,
      district: r.facility_district,
    },
    scope: r.scope,
    purpose: r.purpose,
    channel: r.channel,
    status: r.status,
    grantedAt: iso(r.granted_at),
    expiresAt: iso(r.expires_at),
    revokedAt: iso(r.revoked_at),
    revokedReason: r.revoked_reason,
  }
}
