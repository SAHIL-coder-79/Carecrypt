import { recordAuditEvent } from '../audit/auditLog.js'
import { burnPasswordCheck, MAX_PASSWORD_BYTES, verifyPassword } from '../auth/password.js'
import { signAccessToken } from '../auth/tokens.js'
import {
  findProfileLink,
  findUserByEmail,
  recordFailedLogin,
  recordSuccessfulLogin,
} from '../auth/userRepository.js'
import { badRequest, HttpError, unauthorized } from '../lib/httpError.js'
import { raiseSecurityEventSafely } from '../security/events.js'

// Same message for an unknown email and a wrong password, so responses don't
// reveal which accounts exist.
const INVALID_CREDENTIALS = 'Invalid email or password.'

export function parseLoginBody(body) {
  const { email, password } = body ?? {}
  if (typeof email !== 'string' || typeof password !== 'string') {
    throw badRequest('Both "email" and "password" are required as strings.')
  }
  const normalisedEmail = email.trim().toLowerCase()
  if (normalisedEmail.length === 0 || normalisedEmail.length > 254 || password.length === 0) {
    throw badRequest('Email and password must not be empty.')
  }
  // bcrypt ignores bytes beyond 72, so longer inputs only add hashing cost.
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
    throw unauthorized(INVALID_CREDENTIALS)
  }
  return { email: normalisedEmail, password }
}

export async function login({ email, password }, req) {
  const user = await findUserByEmail(email)

  if (!user) {
    await burnPasswordCheck(password)
    await recordAuditEvent({
      req,
      action: 'LOGIN',
      resourceType: 'session',
      outcome: 'FAILURE',
      reason: 'Unknown email',
      metadata: { email_attempted: email },
    })
    throw unauthorized(INVALID_CREDENTIALS)
  }

  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    await recordAuditEvent({
      req,
      user,
      action: 'LOGIN',
      resourceType: 'session',
      resourceId: user.id,
      outcome: 'DENIED',
      reason: 'Account temporarily locked',
    })
    const retryAfter = Math.ceil((new Date(user.locked_until) - Date.now()) / 1000)
    throw new HttpError(423, 'ACCOUNT_LOCKED', 'Too many failed attempts. Try again later.', {
      headers: { 'Retry-After': String(retryAfter) },
    })
  }

  if (!(await verifyPassword(password, user.password_hash))) {
    const state = await recordFailedLogin(user.id)
    await recordAuditEvent({
      req,
      user,
      action: 'LOGIN',
      resourceType: 'session',
      resourceId: user.id,
      outcome: 'FAILURE',
      reason: 'Wrong password',
      metadata: { failed_login_count: state?.failed_login_count, locked: Boolean(state?.locked_until) },
    })
    if (state?.locked_until) {
      await raiseSecurityEventSafely({
        req,
        user,
        type: 'ACCOUNT_LOCKED',
        severity: 'MEDIUM',
        summary: `Account locked after ${state.failed_login_count} failed sign-in attempts.`,
        details: { failed_login_count: state.failed_login_count, locked_until: state.locked_until },
        dedupeMinutes: 60,
      })
    }
    throw unauthorized(INVALID_CREDENTIALS)
  }

  // Reported only after a correct password, so it cannot be used to probe accounts.
  if (!user.is_active) {
    await recordAuditEvent({
      req,
      user,
      action: 'LOGIN',
      resourceType: 'session',
      resourceId: user.id,
      outcome: 'DENIED',
      reason: 'Account disabled',
    })
    throw new HttpError(403, 'ACCOUNT_DISABLED', 'This account has been disabled.')
  }

  const lastLoginAt = await recordSuccessfulLogin(user.id)
  const profile = await findProfileLink(user)
  const { token, expiresIn, expiresAt } = signAccessToken(user)

  await recordAuditEvent({
    req,
    user,
    action: 'LOGIN',
    resourceType: 'session',
    resourceId: user.id,
    outcome: 'SUCCESS',
  })

  return {
    token,
    tokenType: 'Bearer',
    expiresIn,
    expiresAt,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      displayName: user.display_name,
      lastLoginAt,
      ...(profile ?? {}),
    },
  }
}

export async function register(body, req) {
  const { email, password, role, firstName, lastName } = body
  if (!email || !password || !role || !firstName || !lastName) {
    throw badRequest('All fields are required.')
  }
  
  const normalisedEmail = email.trim().toLowerCase()
  if (await findUserByEmail(normalisedEmail)) {
    throw badRequest('Email already in use.')
  }

  const { hashPassword } = await import('../auth/password.js')
  const passwordHash = await hashPassword(password)
  const displayName = `${firstName} ${lastName}`.trim()

  const { withTransaction, query } = await import('../db/pool.js')
  
  const user = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO identity.users (email, password_hash, role, display_name)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [normalisedEmail, passwordHash, role, displayName]
    )
    const newUser = rows[0]

    if (role === 'PATIENT') {
      await client.query(
        `INSERT INTO clinical.patients (user_id, first_name, last_name, date_of_birth, gender, city, district, state, pincode)
         VALUES ($1, $2, $3, '1990-01-01', 'UNDISCLOSED', 'City', 'District', 'State', '100000')`,
        [newUser.id, firstName, lastName]
      )
    } else if (role === 'CLINICIAN') {
      // Pick a random facility
      const fRows = await client.query('SELECT id FROM clinical.facilities LIMIT 1')
      const facilityId = fRows.rows[0]?.id
      
      const regNo = 'REG-' + Date.now()
      
      await client.query(
        `INSERT INTO clinical.clinicians (user_id, registration_number, first_name, last_name, specialty, facility_id)
         VALUES ($1, $2, $3, $4, 'General Practice', $5)`,
        [newUser.id, regNo, firstName, lastName, facilityId]
      )
    }

    return newUser
  })

  await recordAuditEvent({
    req,
    action: 'REGISTER',
    resourceType: 'session',
    outcome: 'SUCCESS',
    metadata: { email_registered: normalisedEmail, role },
  })

  return login({ email: normalisedEmail, password }, req)
}
