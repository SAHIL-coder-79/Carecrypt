import { Router } from 'express'

const router = Router()

router.get('/', async (req, res) => {
  let dbStatus = 'not_checked'
  let dbError = null
  try {
    const { query } = await import('../db/pool.js')
    await query('SELECT 1')
    dbStatus = 'connected'
  } catch (err) {
    dbStatus = 'error'
    dbError = err.message
  }

  res.json({
    status: dbStatus === 'connected' ? 'ok' : 'degraded',
    service: 'carecrypt-backend',
    database: {
      status: dbStatus,
      error: dbError,
    },
  })
})

export default router
