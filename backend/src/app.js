import cors from 'cors'
import express from 'express'
import { env, rbacTestEndpointsEnabled } from './config/env.js'
import { errorHandler, notFound } from './middleware/errors.js'
import analyticsRouter from './routes/analytics.js'
import authRouter from './routes/auth.js'
import cliniciansRouter from './routes/clinicians.js'
import consentRouter from './routes/consent.js'
import healthRouter from './routes/health.js'
import patientsRouter from './routes/patients.js'
import qrRouter from './routes/qr.js'
import rbacTestRouter from './routes/rbacTest.js'
import securityRouter from './routes/security.js'
import referenceRouter from './routes/reference.js'
import smartcareRouter from './routes/smartcare.js'

// `configure` lets tests mount extra routes before the 404 and error handlers.
export function createApp({ configure } = {}) {
  const app = express()

  app.disable('x-powered-by')
  if (env.trustProxy > 0) app.set('trust proxy', env.trustProxy)

  app.use(
    cors({
      origin(origin, callback) {
        // Requests without an Origin header (curl, server-to-server) are allowed.
        if (!origin || env.corsOrigins.includes(origin)) return callback(null, true)
        return callback(null, false)
      },
    }),
  )
  app.use(express.json({ limit: '100kb' }))

  app.use('/api/health', healthRouter)
  app.use('/api/auth', authRouter)
  app.use('/api/patients', patientsRouter)
  app.use('/api/clinicians', cliniciansRouter)
  app.use('/api/consent', consentRouter)
  app.use('/api/qr', qrRouter)
  app.use('/api/reference', referenceRouter)
  app.use('/api/smartcare', smartcareRouter)
  app.use('/api/analytics', analyticsRouter)
  app.use('/api/security', securityRouter)
  if (rbacTestEndpointsEnabled) app.use('/api/test', rbacTestRouter)

  configure?.(app)

  app.use(notFound)
  app.use(errorHandler)

  return app
}
