import { createApp } from './app.js'
import { env, requireJwtSecret } from './config/env.js'
import { closeAnalyticsPool } from './db/analyticsPool.js'
import { checkConnection, closePool } from './db/pool.js'

// Refuse to start without a usable signing secret.
try {
  requireJwtSecret()
} catch (err) {
  console.error(`[carecrypt-backend] ${err.message}`)
  process.exit(1)
}

const app = createApp()

const server = app.listen(env.port, () => {
  console.log(`[carecrypt-backend] listening on http://localhost:${env.port} (${env.nodeEnv})`)
  console.log(`[carecrypt-backend] CORS origins: ${env.corsOrigins.join(', ')}`)
  reportDatabase()
})

// Informational only: the server keeps running when the database is unavailable.
async function reportDatabase() {
  if (!env.databaseUrl) {
    console.warn('[db] DATABASE_URL not set; skipping database connection check.')
    return
  }
  try {
    const info = await checkConnection()
    console.log(`[db] connected to "${info.database}"`)
  } catch (err) {
    console.warn(`[db] connection failed: ${err.message}`)
  }
}

function shutdown(signal) {
  console.log(`[carecrypt-backend] ${signal} received, shutting down`)
  server.close(async () => {
    await Promise.all([closePool(), closeAnalyticsPool()])
    process.exit(0)
  })
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
