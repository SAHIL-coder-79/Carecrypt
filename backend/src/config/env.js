import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

// Load backend/.env regardless of the directory the process was started from.
// Variables already set in the process environment take precedence.
const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
dotenv.config({ path: path.join(backendRoot, '.env'), quiet: true })

function list(value, fallback) {
  const items = (value ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  return items.length > 0 ? items : fallback
}

function positiveInt(value, fallback) {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : fallback
}

export const env = Object.freeze({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 4000,
  corsOrigins: list(process.env.CORS_ORIGINS, ['http://localhost:5173']),
  // Number of reverse proxies in front of the API (for correct client IPs). 0 = none.
  trustProxy: Number(process.env.TRUST_PROXY) || 0,
  databaseUrl: process.env.DATABASE_URL || '',
  databaseSsl: process.env.DATABASE_SSL === 'true',
  // Separate, restricted login for the ADMIN analytics API. It can read only the
  // suppressed aggregate views, never a patient row (database/init/002_create_app_roles.sql).
  analyticsDatabaseUrl: process.env.ANALYTICS_DATABASE_URL || '',
  jwtSecret: process.env.JWT_SECRET || '',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1h',
  jwtIssuer: 'carecrypt-backend',
  jwtAudience: 'carecrypt-api',
  loginMaxFailedAttempts: positiveInt(process.env.LOGIN_MAX_FAILED_ATTEMPTS, 5),
  loginLockoutMinutes: positiveInt(process.env.LOGIN_LOCKOUT_MINUTES, 15),
  loginRateLimitWindowMinutes: positiveInt(process.env.LOGIN_RATE_LIMIT_WINDOW_MINUTES, 15),
  loginRateLimitMax: positiveInt(process.env.LOGIN_RATE_LIMIT_MAX, 20),
})

export const isProduction = env.nodeEnv === 'production'

// RBAC demonstration endpoints under /api/test. On outside production unless
// explicitly configured; set ENABLE_RBAC_TEST_ENDPOINTS=true to show them in a deployed demo.
export const rbacTestEndpointsEnabled = process.env.ENABLE_RBAC_TEST_ENDPOINTS
  ? process.env.ENABLE_RBAC_TEST_ENDPOINTS === 'true'
  : !isProduction

const PLACEHOLDER_SECRETS = new Set(['replace_with_a_long_random_secret', 'changeme', 'secret'])

// Returns the JWT signing secret, or throws if it is missing or obviously weak.
export function requireJwtSecret() {
  const secret = env.jwtSecret
  if (!secret || secret.length < 32 || PLACEHOLDER_SECRETS.has(secret)) {
    throw new Error(
      'JWT_SECRET must be set to a random value of at least 32 characters. ' +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"',
    )
  }
  return secret
}
