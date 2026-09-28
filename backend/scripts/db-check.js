import { checkConnection, closePool } from '../src/db/pool.js'

try {
  const info = await checkConnection()
  console.log(`Connected to database "${info.database}"`)
  console.log(info.version)
  process.exitCode = 0
} catch (err) {
  console.error(`Database connection failed: ${err.message}`)
  process.exitCode = 1
} finally {
  await closePool()
}
