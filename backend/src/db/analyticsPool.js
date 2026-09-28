import pg from 'pg'
import { env } from '../config/env.js'
import { HttpError } from '../lib/httpError.js'
import './pool.js' // registers the DATE type parser

let pool = null

// Connection pool for the ADMIN analytics API, logged in as carecrypt_analytics.
// That login can read the suppressed aggregate views and nothing else, so even a
// faulty analytics query cannot return a patient row.
function getAnalyticsPool() {
  if (!env.analyticsDatabaseUrl) {
    throw new HttpError(503, 'ANALYTICS_UNAVAILABLE', 'Analytics is not configured on this server (ANALYTICS_DATABASE_URL).')
  }
  if (!pool) {
    pool = new pg.Pool({
      connectionString: env.analyticsDatabaseUrl,
      ssl: env.databaseSsl ? { rejectUnauthorized: false } : undefined,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    })
    pool.on('error', (err) => {
      console.error('[analytics-db] Unexpected error on idle client:', err.message)
    })
  }
  return pool
}

export async function analyticsQuery(text, params) {
  try {
    return await getAnalyticsPool().query(text, params)
  } catch (err) {
    // 42501: the configured login lacks access, e.g. ANALYTICS_DATABASE_URL points at another role.
    if (err.code === '42501') {
      console.error(`[analytics-db] ${err.message}`)
      throw new HttpError(503, 'ANALYTICS_UNAVAILABLE', 'The analytics database login is not set up correctly.')
    }
    throw err
  }
}

export async function closeAnalyticsPool() {
  if (pool) {
    await pool.end()
    pool = null
  }
}
