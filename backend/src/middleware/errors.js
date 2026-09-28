import { isProduction } from '../config/env.js'
import { HttpError } from '../lib/httpError.js'

export function notFound(req, res) {
  res.status(404).json({ error: 'NOT_FOUND', message: `No route for ${req.method} ${req.originalUrl}` })
}

// Express recognises error handlers by their four arguments.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) {
    if (err.headers) res.set(err.headers)
    return res.status(err.status).json(err.body ?? { error: err.code, message: err.message })
  }

  // Errors raised by express.json() for malformed or oversized bodies.
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'BAD_REQUEST', message: 'Request body is not valid JSON.' })
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' })
  }

  // PostgreSQL constraint violations that slipped past input validation.
  // 23502 not null, 23503 foreign key, 23505 unique, 23514 check.
  if (['23502', '23503', '23505', '23514'].includes(err.code)) {
    return res.status(400).json({
      error: 'CONSTRAINT_VIOLATION',
      message: isProduction ? 'The data violates a database rule.' : `${err.message}${err.detail ? ` (${err.detail})` : ''}`,
    })
  }

  const status = err.status || err.statusCode || 500
  if (status >= 500) {
    console.error('[error]', err)
  }
  res.status(status).json({
    error: status >= 500 ? 'INTERNAL_ERROR' : 'ERROR',
    message: status >= 500 && isProduction ? 'Internal server error' : err.message,
  })
}
