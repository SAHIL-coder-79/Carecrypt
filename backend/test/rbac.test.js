// Proves that role-based access control is enforced by the backend.
//
// Every request here goes straight to the API over HTTP with no frontend involved,
// the same way an attacker with curl would call it. The tests also try to get past
// the check with client-controlled input (headers, query, cookies, body, path tricks,
// forged tokens). None of it may produce a 200.

import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import {
  auditCount,
  query,
  signToken,
  skipReason,
  startServer,
  tamperPayload,
  unsignedToken,
  userId,
  USERS,
} from './helpers.js'
import { requireRole } from '../src/middleware/requireRole.js'
import { authenticateToken } from '../src/middleware/authenticate.js'

const ROLES = Object.keys(USERS)
const ENDPOINTS = {
  '/api/test/clinician-only': { resource: 'CLINICIAN_ONLY', allowed: 'CLINICIAN' },
  '/api/test/admin-only': { resource: 'ADMIN_ONLY', allowed: 'ADMIN' },
  '/api/test/security-only': { resource: 'SECURITY_ONLY', allowed: 'SECURITY_ADMIN' },
}

const skip = await skipReason()

describe('backend-enforced RBAC', { skip }, () => {
  let server
  let api
  let tokens
  const matrix = {}

  before(async () => {
    server = await startServer({
      configure(app) {
        // A multi-role route, to test requireRole() with more than one role.
        app.get(
          '/api/test-internal/clinician-or-security',
          authenticateToken(),
          requireRole('CLINICIAN', 'SECURITY_ADMIN'),
          (req, res) => res.json({ access: 'GRANTED' }),
        )
      },
    })
    api = server.api
    tokens = await api.tokensForAllRoles()
  })

  after(async () => {
    await server?.close()
    printMatrix(matrix)
  })

  describe('required cases', () => {
    const cases = [
      ['CLINICIAN', '/api/test/clinician-only', 200],
      ['ADMIN', '/api/test/clinician-only', 403],
      ['ADMIN', '/api/test/admin-only', 200],
      ['CLINICIAN', '/api/test/admin-only', 403],
      ['SECURITY_ADMIN', '/api/test/security-only', 200],
      ['ADMIN', '/api/test/security-only', 403],
    ]
    for (const [role, path, expected] of cases) {
      test(`${role} → ${path} → ${expected}`, async () => {
        const res = await api.get(path, tokens[role])
        assert.equal(res.status, expected)
      })
    }
  })

  describe('response bodies', () => {
    test('ADMIN → clinician-only returns exactly the FORBIDDEN body', async () => {
      const res = await api.get('/api/test/clinician-only', tokens.ADMIN)
      assert.equal(res.status, 403)
      assert.match(res.headers.get('content-type'), /^application\/json/)
      assert.deepEqual(await res.json(), {
        error: 'FORBIDDEN',
        role: 'ADMIN',
        resource: 'CLINICIAN_ONLY',
        access: 'DENIED',
      })
    })

    test('each FORBIDDEN body names the caller role and the refused resource', async () => {
      const checks = [
        ['CLINICIAN', '/api/test/admin-only', 'ADMIN_ONLY'],
        ['ADMIN', '/api/test/security-only', 'SECURITY_ONLY'],
        ['PATIENT', '/api/test/clinician-only', 'CLINICIAN_ONLY'],
        ['SECURITY_ADMIN', '/api/test/clinician-only', 'CLINICIAN_ONLY'],
      ]
      for (const [role, path, resource] of checks) {
        const body = await (await api.get(path, tokens[role])).json()
        assert.deepEqual(body, { error: 'FORBIDDEN', role, resource, access: 'DENIED' })
      }
    })

    test('allowed requests return GRANTED with the role and resource', async () => {
      for (const [path, { resource, allowed }] of Object.entries(ENDPOINTS)) {
        const body = await (await api.get(path, tokens[allowed])).json()
        assert.deepEqual(body, { access: 'GRANTED', role: allowed, resource })
      }
    })

    test('no token → 401 UNAUTHORIZED (not 403) on every endpoint', async () => {
      for (const path of Object.keys(ENDPOINTS)) {
        const res = await api.get(path)
        assert.equal(res.status, 401, path)
        assert.equal((await res.json()).error, 'UNAUTHORIZED')
        assert.match(res.headers.get('www-authenticate'), /^Bearer /)
      }
    })
  })

  describe('full role × endpoint matrix', () => {
    for (const [path, { allowed }] of Object.entries(ENDPOINTS)) {
      for (const role of ROLES) {
        const expected = role === allowed ? 200 : 403
        test(`${role} → ${path} → ${expected}`, async () => {
          const res = await api.get(path, tokens[role])
          ;(matrix[path] ??= {})[role] = res.status
          assert.equal(res.status, expected)
        })
      }
      test(`anonymous → ${path} → 401`, async () => {
        const res = await api.get(path)
        ;(matrix[path] ??= {}).anonymous = res.status
        assert.equal(res.status, 401)
      })
    }
  })

  describe('client-side input cannot change the decision', () => {
    const target = '/api/test/clinician-only'

    test('role hints in request headers are ignored', async () => {
      const headers = [
        { 'X-User-Role': 'CLINICIAN' },
        { 'X-Role': 'CLINICIAN' },
        { Role: 'CLINICIAN' },
        { 'X-Forwarded-User': USERS.CLINICIAN },
        { 'X-Original-URL': '/api/health' },
        { 'X-HTTP-Method-Override': 'OPTIONS' },
      ]
      for (const h of headers) {
        const res = await api.get(target, tokens.ADMIN, h)
        assert.equal(res.status, 403, JSON.stringify(h))
      }
    })

    test('role in the query string or a cookie is ignored', async () => {
      assert.equal((await api.get(`${target}?role=CLINICIAN`, tokens.ADMIN)).status, 403)
      assert.equal((await api.get(`${target}?user[role]=CLINICIAN`, tokens.ADMIN)).status, 403)
      assert.equal((await api.get(target, tokens.ADMIN, { Cookie: 'role=CLINICIAN' })).status, 403)
    })

    test('role in a JSON request body is ignored', async () => {
      const res = await api.raw({
        path: target,
        headers: { Authorization: `Bearer ${tokens.ADMIN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'CLINICIAN', user: { role: 'CLINICIAN' } }),
      })
      assert.equal(res.status, 403)
    })

    test('the frontend origin gets no special treatment', async () => {
      const res = await api.get(target, tokens.ADMIN, { Origin: 'http://localhost:5173', Referer: 'http://localhost:5173/' })
      assert.equal(res.status, 403)
    })

    test('path variations never reach the handler', async () => {
      const variants = [
        '/api/test/CLINICIAN-ONLY',
        '/API/TEST/clinician-only',
        '/api/test/clinician-only/',
        '/api/test//clinician-only',
        '/api/test/./clinician-only',
        '/api/test/x/../clinician-only',
        '/api/test/clinician%2Donly',
        '/api/test/clinician-only%00',
        '/api/test/clinician-only;role=CLINICIAN',
      ]
      for (const path of variants) {
        const res = await api.raw({ path, headers: { Authorization: `Bearer ${tokens.ADMIN}` } })
        assert.ok([403, 404, 400].includes(res.status), `${path} → ${res.status}`)
        assert.ok(!res.body.includes('GRANTED'), `${path} leaked a GRANTED body`)
      }
    })

    test('a CLINICIAN cannot claim ADMIN through headers either', async () => {
      const res = await api.get('/api/test/admin-only', tokens.CLINICIAN, { 'X-User-Role': 'ADMIN' })
      assert.equal(res.status, 403)
    })
  })

  describe('forged or altered tokens are rejected before the role check', () => {
    const target = '/api/test/clinician-only'

    test('ADMIN token with its role claim edited to CLINICIAN → 401', async () => {
      const forged = tamperPayload(tokens.ADMIN, { role: 'CLINICIAN' })
      assert.equal((await api.get(target, forged)).status, 401)
    })

    test('token claiming CLINICIAN signed with a different secret → 401', async () => {
      const sub = await userId(USERS.CLINICIAN)
      const forged = signToken({ role: 'CLINICIAN' }, { subject: sub }, 'attacker-secret-'.repeat(4))
      assert.equal((await api.get(target, forged)).status, 401)
    })

    test('unsigned token (alg "none") claiming CLINICIAN → 401', async () => {
      const sub = await userId(USERS.CLINICIAN)
      const forged = unsignedToken({ sub, role: 'CLINICIAN', exp: Math.floor(Date.now() / 1000) + 300 })
      assert.equal((await api.get(target, forged)).status, 401)
    })

    test('correctly signed token whose role disagrees with the database → 401', async () => {
      // Simulates a leaked signing key or a stale token after a role change:
      // the role is always re-read from the database.
      const forged = signToken({ role: 'CLINICIAN' }, { subject: await userId(USERS.ADMIN) })
      assert.equal((await api.get(target, forged)).status, 401)
    })
  })

  describe('audit trail', () => {
    test('a denial is written to the audit log with role, resource and outcome', async () => {
      const adminId = await userId(USERS.ADMIN)
      const where = `action = 'ACCESS_DENIED' AND user_id = $1 AND resource_id = 'CLINICIAN_ONLY'`
      const before = await auditCount(where, [adminId])

      await api.get('/api/test/clinician-only', tokens.ADMIN)

      assert.equal(await auditCount(where, [adminId]), before + 1)
      const { rows } = await query(
        `SELECT user_role, outcome, reason, metadata FROM audit.audit_logs
          WHERE ${where} ORDER BY chain_seq DESC LIMIT 1`,
        [adminId],
      )
      assert.equal(rows[0].user_role, 'ADMIN')
      assert.equal(rows[0].outcome, 'DENIED')
      assert.equal(rows[0].reason, 'Role ADMIN not permitted')
      assert.deepEqual(rows[0].metadata.required_roles, ['CLINICIAN'])
    })

    test('allowed requests are not logged as denials', async () => {
      const id = await userId(USERS.CLINICIAN)
      const where = `action = 'ACCESS_DENIED' AND user_id = $1`
      const before = await auditCount(where, [id])
      await api.get('/api/test/clinician-only', tokens.CLINICIAN)
      assert.equal(await auditCount(where, [id]), before)
    })

    test('the audit hash chain is intact after all denials', async () => {
      const { rows } = await query('SELECT audit.verify_chain() AS broken_at')
      assert.equal(rows[0].broken_at, null)
    })
  })

  describe('requireRole()', () => {
    test('accepts several roles', async () => {
      const path = '/api/test-internal/clinician-or-security'
      assert.equal((await api.get(path, tokens.CLINICIAN)).status, 200)
      assert.equal((await api.get(path, tokens.SECURITY_ADMIN)).status, 200)
      const denied = await api.get(path, tokens.ADMIN)
      assert.equal(denied.status, 403)
      assert.deepEqual(await denied.json(), {
        error: 'FORBIDDEN',
        role: 'ADMIN',
        resource: `GET ${path}`,
        access: 'DENIED',
      })
    })

    test('refuses unknown role names when a route is defined', () => {
      assert.throws(() => requireRole('DOCTOR'), /invalid roles/)
      assert.throws(() => requireRole('admin'), /invalid roles/)
      assert.throws(() => requireRole(), /invalid roles/)
      assert.throws(() => requireRole({ resource: 'X' }), /invalid roles/)
    })
  })
})

function printMatrix(matrix) {
  const columns = [...ROLES, 'anonymous']
  const rows = Object.entries(matrix)
  if (rows.length === 0) return
  const pad = (s, n) => String(s).padEnd(n)
  const w = 28
  const lines = [
    '',
    'RBAC access matrix (HTTP status returned by the backend)',
    pad('endpoint', w) + columns.map((c) => pad(c, 16)).join(''),
    ...rows.map(([path, byRole]) => pad(path, w) + columns.map((c) => pad(byRole[c] ?? '-', 16)).join('')),
    '',
  ]
  console.log(lines.join('\n'))
}
