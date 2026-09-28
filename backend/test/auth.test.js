// Authentication tests: login, tokens, lockout and password storage.
// Role checks are covered in rbac.test.js.
//
// These tests temporarily lock and disable one seeded ADMIN account and restore it
// afterwards. They add entries to the (append-only) audit log.

import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import {
  auditCount,
  env,
  jwt,
  PASSWORD,
  query,
  signToken,
  skipReason,
  startServer,
  tamperPayload,
  unsignedToken,
  userId,
  USERS,
} from './helpers.js'

const SPARE_ADMIN = 'admin.rahul@carecrypt.example' // locked and disabled during tests

const skip = await skipReason()

describe('authentication', { skip }, () => {
  let server
  let api
  let tokens

  before(async () => {
    server = await startServer()
    api = server.api
    await resetAccount(SPARE_ADMIN)
    tokens = await api.tokensForAllRoles()
  })

  after(async () => {
    try {
      await resetAccount(SPARE_ADMIN)
    } finally {
      await server?.close() // always release the server and pool, or the test process never exits
    }
  })

  async function resetAccount(email) {
    await query(
      `UPDATE identity.users SET failed_login_count = 0, locked_until = NULL, is_active = true WHERE email = $1`,
      [email],
    )
  }

  describe('POST /api/auth/login', () => {
    test('returns a JWT, user id, role and basic user info for every role', async () => {
      for (const [role, email] of Object.entries(USERS)) {
        const res = await api.login(email, PASSWORD)
        assert.equal(res.status, 200)
        assert.equal(res.headers.get('cache-control'), 'no-store')
        const body = await res.json()
        assert.equal(body.tokenType, 'Bearer')
        assert.match(body.token, /^[\w-]+\.[\w-]+\.[\w-]+$/)
        assert.equal(body.expiresIn, 3600)
        assert.equal(body.user.role, role)
        assert.equal(body.user.email, email)
        assert.equal(body.user.id, await userId(email))
        assert.ok(body.user.displayName)
      }
    })

    test('includes the profile link for clinicians and patients only', async () => {
      const clinician = await (await api.login(USERS.CLINICIAN, PASSWORD)).json()
      assert.ok(clinician.user.clinicianId)
      assert.equal(clinician.user.specialty, 'General Medicine')

      const patient = await (await api.login(USERS.PATIENT, PASSWORD)).json()
      assert.equal(patient.user.mrn, 'CC-000001')
      assert.ok(patient.user.patientId)

      const admin = await (await api.login(USERS.ADMIN, PASSWORD)).json()
      assert.equal(admin.user.patientId, undefined)
      assert.equal(admin.user.clinicianId, undefined)
    })

    test('never returns the password or its hash', async () => {
      const text = await (await api.login(USERS.ADMIN, PASSWORD)).text()
      assert.ok(!text.includes(PASSWORD))
      assert.ok(!/password/i.test(text))
      assert.ok(!text.includes('$2'))
    })

    test('the JWT carries only id, role and standard claims', async () => {
      const claims = jwt.decode(tokens.CLINICIAN)
      assert.deepEqual(Object.keys(claims).sort(), ['aud', 'exp', 'iat', 'iss', 'jti', 'role', 'sub'])
      assert.equal(claims.role, 'CLINICIAN')
      assert.equal(claims.sub, await userId(USERS.CLINICIAN))
      assert.equal(jwt.decode(tokens.CLINICIAN, { complete: true }).header.alg, 'HS256')
    })

    test('email is case-insensitive and trimmed', async () => {
      assert.equal((await api.login('  Admin.Priya@CareCrypt.Example ', PASSWORD)).status, 200)
    })

    test('wrong password and unknown email get the same 401', async () => {
      const wrong = await api.login(USERS.CLINICIAN, 'not-the-password')
      const unknown = await api.login('nobody@carecrypt.example', PASSWORD)
      assert.equal(wrong.status, 401)
      assert.equal(unknown.status, 401)
      const a = await wrong.json()
      assert.deepEqual(a, await unknown.json())
      assert.deepEqual(a, { error: 'UNAUTHORIZED', message: 'Invalid email or password.' })
      await resetAccount(USERS.CLINICIAN)
    })

    test('rejects malformed input with 400 BAD_REQUEST', async () => {
      for (const body of [{}, { email: USERS.ADMIN }, { email: 42, password: PASSWORD }, { email: '', password: '' }]) {
        const res = await api.raw({
          method: 'POST',
          path: '/api/auth/login',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        assert.equal(res.status, 400, JSON.stringify(body))
        assert.equal(JSON.parse(res.body).error, 'BAD_REQUEST')
      }
      const bad = await api.raw({
        method: 'POST',
        path: '/api/auth/login',
        headers: { 'Content-Type': 'application/json' },
        body: '{not json',
      })
      assert.equal(bad.status, 400)
    })

    test('locks the account after 5 failed attempts (423), then unlocks on reset', async () => {
      try {
        for (let i = 1; i <= 5; i++) {
          assert.equal((await api.login(SPARE_ADMIN, `wrong-${i}`)).status, 401)
        }
        const locked = await api.login(SPARE_ADMIN, PASSWORD) // correct password, still refused
        assert.equal(locked.status, 423)
        assert.equal((await locked.json()).error, 'ACCOUNT_LOCKED')
        assert.ok(Number(locked.headers.get('retry-after')) > 0)
      } finally {
        await resetAccount(SPARE_ADMIN)
      }
      assert.equal((await api.login(SPARE_ADMIN, PASSWORD)).status, 200)
    })

    test('a disabled account gets 403 with the right password and 401 with a wrong one', async () => {
      try {
        await query('UPDATE identity.users SET is_active = false WHERE email = $1', [SPARE_ADMIN])
        const res = await api.login(SPARE_ADMIN, PASSWORD)
        assert.equal(res.status, 403)
        assert.equal((await res.json()).error, 'ACCOUNT_DISABLED')
        assert.equal((await api.login(SPARE_ADMIN, 'wrong')).status, 401)
      } finally {
        await resetAccount(SPARE_ADMIN)
      }
    })

    test('failed and successful logins are written to the audit log', async () => {
      const failures = `action = 'LOGIN' AND outcome = 'FAILURE'`
      const before = await auditCount(failures)
      await api.login('ghost@carecrypt.example', 'whatever')
      assert.equal(await auditCount(failures), before + 1)

      const successes = `action = 'LOGIN' AND outcome = 'SUCCESS' AND user_id = $1`
      const id = await userId(USERS.SECURITY_ADMIN)
      const okBefore = await auditCount(successes, [id])
      await api.login(USERS.SECURITY_ADMIN, PASSWORD)
      assert.equal(await auditCount(successes, [id]), okBefore + 1)
    })
  })

  describe('authenticateToken()', () => {
    test('GET /api/auth/me returns the caller for a valid token', async () => {
      const res = await api.get('/api/auth/me', tokens.PATIENT)
      assert.equal(res.status, 200)
      const body = await res.json()
      assert.equal(body.user.role, 'PATIENT')
      assert.equal(body.user.email, USERS.PATIENT)
    })

    test('401 UNAUTHORIZED with a WWW-Authenticate challenge when no token is sent', async () => {
      const res = await api.get('/api/auth/me')
      assert.equal(res.status, 401)
      assert.match(res.headers.get('www-authenticate'), /^Bearer /)
      assert.equal((await res.json()).error, 'UNAUTHORIZED')
    })

    test('401 for malformed Authorization headers', async () => {
      for (const header of ['Bearer', 'Bearer not-a-jwt', `Basic ${tokens.ADMIN}`, tokens.ADMIN]) {
        const res = await api.get('/api/auth/me', null, { Authorization: header })
        assert.equal(res.status, 401, header.slice(0, 20))
      }
    })

    test('401 for a token whose payload was edited', async () => {
      const forged = tamperPayload(tokens.PATIENT, { sub: await userId(USERS.ADMIN) })
      assert.equal((await api.get('/api/auth/me', forged)).status, 401)
    })

    test('401 for alg "none", a wrong secret, a wrong audience and an expired token', async () => {
      const sub = await userId(USERS.CLINICIAN)
      const cases = {
        unsigned: unsignedToken({ sub, role: 'CLINICIAN', iss: env.jwtIssuer, aud: env.jwtAudience }),
        wrongSecret: signToken({ role: 'CLINICIAN' }, { subject: sub }, 'a'.repeat(64)),
        wrongAudience: signToken({ role: 'CLINICIAN' }, { subject: sub, audience: 'someone-else' }),
        expired: signToken(
          { role: 'CLINICIAN', exp: Math.floor(Date.now() / 1000) - 60 },
          { subject: sub, expiresIn: undefined },
        ),
      }
      for (const [name, token] of Object.entries(cases)) {
        assert.equal((await api.get('/api/auth/me', token)).status, 401, name)
      }
      assert.equal((await (await api.get('/api/auth/me', cases.expired)).json()).message, 'Token has expired.')
    })

    test('401 immediately after an account is disabled, even with an unexpired token', async () => {
      const token = (await (await api.login(SPARE_ADMIN, PASSWORD)).json()).token
      assert.equal((await api.get('/api/auth/me', token)).status, 200)
      try {
        await query('UPDATE identity.users SET is_active = false WHERE email = $1', [SPARE_ADMIN])
        assert.equal((await api.get('/api/auth/me', token)).status, 401)
      } finally {
        await resetAccount(SPARE_ADMIN)
      }
    })
  })

  describe('password storage', () => {
    test('every account stores a bcrypt hash, never plaintext', async () => {
      const { rows } = await query('SELECT email, password_hash FROM identity.users')
      assert.ok(rows.length >= 13)
      for (const r of rows) {
        assert.match(r.password_hash, /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/, r.email)
      }
    })
  })
})
