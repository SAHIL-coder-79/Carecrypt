import { env } from '../config/env.js'
import { query } from '../db/pool.js'

const USER_COLUMNS = `
  id, email, password_hash, role, display_name, is_active,
  failed_login_count, locked_until, last_login_at`

export async function findUserByEmail(email) {
  const { rows } = await query(`SELECT ${USER_COLUMNS} FROM identity.users WHERE email = $1`, [email])
  return rows[0] ?? null
}

export async function findUserById(id) {
  const { rows } = await query(`SELECT ${USER_COLUMNS} FROM identity.users WHERE id = $1`, [id])
  return rows[0] ?? null
}

// Counts a failed password. Reaching the limit locks the account for a while.
// The count restarts after a lock has expired.
export async function recordFailedLogin(userId) {
  const { rows } = await query(
    `UPDATE identity.users u
        SET failed_login_count = n.count,
            locked_until = CASE WHEN n.count >= $2 THEN now() + make_interval(mins => $3) END
       FROM (
         SELECT id,
                CASE WHEN locked_until IS NOT NULL AND locked_until <= now() THEN 1
                     ELSE failed_login_count + 1 END AS count
           FROM identity.users WHERE id = $1
       ) n
      WHERE u.id = n.id
      RETURNING u.failed_login_count, u.locked_until`,
    [userId, env.loginMaxFailedAttempts, env.loginLockoutMinutes],
  )
  return rows[0] ?? null
}

export async function recordSuccessfulLogin(userId) {
  const { rows } = await query(
    `UPDATE identity.users
        SET failed_login_count = 0, locked_until = NULL, last_login_at = now()
      WHERE id = $1
      RETURNING last_login_at`,
    [userId],
  )
  return rows[0]?.last_login_at ?? null
}

// Links a CLINICIAN or PATIENT account to its profile id. ADMIN and
// SECURITY_ADMIN accounts have no profile. Returns only ids and non-clinical labels.
export async function findProfileLink(user) {
  if (user.role === 'CLINICIAN') {
    const { rows } = await query(
      `SELECT c.id AS clinician_id, c.specialty, f.name AS facility_name
         FROM clinical.clinicians c
         JOIN clinical.facilities f ON f.id = c.facility_id
        WHERE c.user_id = $1`,
      [user.id],
    )
    const r = rows[0]
    return r ? { clinicianId: r.clinician_id, specialty: r.specialty, facility: r.facility_name } : null
  }
  if (user.role === 'PATIENT') {
    const { rows } = await query(`SELECT id, mrn FROM clinical.patients WHERE user_id = $1`, [user.id])
    const r = rows[0]
    return r ? { patientId: r.id, mrn: r.mrn } : null
  }
  return null
}
