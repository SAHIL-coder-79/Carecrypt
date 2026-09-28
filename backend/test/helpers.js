// Shared setup for the backend test suites.
// Tests need PostgreSQL loaded with database/schema.sql and database/seed.sql,
// reachable through DATABASE_URL, and a valid JWT_SECRET.

import http from 'node:http'

// Must be set before the app and its config are imported.
process.env.LOGIN_RATE_LIMIT_MAX = '1000'
process.env.ENABLE_RBAC_TEST_ENDPOINTS = 'true'

const { default: jwt } = await import('jsonwebtoken')
const { createApp } = await import('../src/app.js')
const { env, requireJwtSecret } = await import('../src/config/env.js')
const { checkConnection, closePool, query } = await import('../src/db/pool.js')
const { closeAnalyticsPool } = await import('../src/db/analyticsPool.js')

export { env, jwt, query, requireJwtSecret }

export const PASSWORD = 'CareCrypt@2026'
export const USERS = Object.freeze({
  PATIENT: 'ananya.deshmukh@mail.example',
  CLINICIAN: 'dr.aditi.ranade@carecrypt.example',
  ADMIN: 'admin.priya@carecrypt.example',
  SECURITY_ADMIN: 'security.officer@carecrypt.example',
})

// Returns a reason string when the suite cannot run, otherwise false.
export async function skipReason() {
  try {
    requireJwtSecret()
    await checkConnection()
    return false
  } catch (err) {
    return `database or JWT secret unavailable: ${err.message}`
  }
}

// Starts the real app on a random local port.
export async function startServer({ configure } = {}) {
  const app = createApp({ configure })
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  return {
    baseUrl,
    api: client(baseUrl),
    async close() {
      await new Promise((resolve) => server.close(resolve))
      await Promise.all([closePool(), closeAnalyticsPool()])
    },
  }
}

function client(baseUrl) {
  return {
    login(email, password) {
      return fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
    },
    get(path, token, headers = {}) {
      return fetch(`${baseUrl}${path}`, {
        headers: token ? { Authorization: `Bearer ${token}`, ...headers } : headers,
      })
    },
    // Low-level request that fetch() cannot make, such as a GET with a body
    // or a path that must not be normalised. Resolves to { status, body }.
    raw({ method = 'GET', path, headers = {}, body }) {
      const url = new URL(baseUrl)
      if (body !== undefined) headers = { 'Content-Length': Buffer.byteLength(body), ...headers }
      return new Promise((resolve, reject) => {
        const req = http.request(
          { host: url.hostname, port: url.port, method, path, headers },
          (res) => {
            let data = ''
            res.on('data', (chunk) => (data += chunk))
            res.on('end', () => resolve({ status: res.statusCode, body: data }))
          },
        )
        req.on('error', reject)
        if (body !== undefined) req.write(body)
        req.end()
      })
    },
    async tokensForAllRoles() {
      const tokens = {}
      for (const [role, email] of Object.entries(USERS)) {
        const res = await this.login(email, PASSWORD)
        if (res.status !== 200) throw new Error(`login failed for ${role}: HTTP ${res.status}`)
        tokens[role] = (await res.json()).token
      }
      return tokens
    },
  }
}

// Signs a token the way the server does. Pass { expiresIn: undefined } to omit an option.
export function signToken(payload, options = {}, secret = requireJwtSecret()) {
  const merged = { algorithm: 'HS256', issuer: env.jwtIssuer, audience: env.jwtAudience, expiresIn: '5m', ...options }
  const defined = Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== undefined))
  return jwt.sign(payload, secret, defined)
}

// Re-encodes a token's payload with changes but keeps the original signature.
export function tamperPayload(token, changes) {
  const [header, payload, signature] = token.split('.')
  const claims = { ...JSON.parse(Buffer.from(payload, 'base64url').toString()), ...changes }
  return `${header}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${signature}`
}

// An unsigned token ("alg": "none").
export function unsignedToken(claims) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${enc({ alg: 'none', typ: 'JWT' })}.${enc(claims)}.x`
}

export async function userId(email) {
  const { rows } = await query('SELECT id FROM identity.users WHERE email = $1', [email])
  return rows[0].id
}

export async function auditCount(where, params = []) {
  const { rows } = await query(`SELECT count(*)::int AS n FROM audit.audit_logs WHERE ${where}`, params)
  return rows[0].n
}
