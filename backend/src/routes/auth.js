import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { env } from '../config/env.js'
import { HttpError } from '../lib/httpError.js'
import { authenticateToken } from '../middleware/authenticate.js'
import { login, parseLoginBody } from '../services/authService.js'

const router = Router()

// Per-IP limit on login attempts, on top of the per-account lockout.
const loginLimiter = rateLimit({
  windowMs: env.loginRateLimitWindowMinutes * 60 * 1000,
  limit: env.loginRateLimitMax,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler(req, res, next) {
    next(new HttpError(429, 'TOO_MANY_REQUESTS', 'Too many login attempts. Try again later.'))
  },
})

router.post('/login', loginLimiter, async (req, res) => {
  const credentials = parseLoginBody(req.body)
  const result = await login(credentials, req)
  res.set('Cache-Control', 'no-store')
  res.json(result)
})

// Returns the account behind the presented token.
router.get('/me', authenticateToken(), (req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json({ user: req.user, token: req.auth })
})

export default router
