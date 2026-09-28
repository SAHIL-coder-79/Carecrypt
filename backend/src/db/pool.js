import pg from 'pg'
import { env } from '../config/env.js'

// Return SQL DATE values as 'YYYY-MM-DD' strings. The default turns them into
// JavaScript Dates at local midnight, which can shift a date of birth by a day
// when serialised to JSON.
const DATE_OID = 1082
pg.types.setTypeParser(DATE_OID, (value) => value)

let pool = null

// Created on first use so the API can start (and answer health checks)
// before PostgreSQL is configured.
export function getPool() {
  if (!env.databaseUrl) {
    throw new Error('DATABASE_URL is not set. Copy backend/.env.example to backend/.env and fill it in.')
  }
  if (!pool) {
    pool = new pg.Pool({
      connectionString: env.databaseUrl,
      ssl: env.databaseSsl ? { rejectUnauthorized: false } : undefined,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    })
    pool.on('error', (err) => {
      console.error('[db] Unexpected error on idle client:', err.message)
    })
  }
  return pool
}

export function query(text, params) {
  return getPool().query(text, params)
}

// Runs fn(client) inside BEGIN/COMMIT; rolls back if it throws.
export async function withTransaction(fn) {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

export async function checkConnection() {
  const { rows } = await query('SELECT current_database() AS database, version() AS version')
  return rows[0]
}

export async function closePool() {
  if (pool) {
    await pool.end()
    pool = null
  }
}
