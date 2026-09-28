import { randomUUID } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { env, requireJwtSecret } from '../config/env.js'

const ALGORITHM = 'HS256'

// The token carries only the user id, role and standard claims.
// No password, hash, email or other personal data goes into it.
export function signAccessToken(user) {
  const token = jwt.sign({ role: user.role }, requireJwtSecret(), {
    algorithm: ALGORITHM,
    subject: user.id,
    issuer: env.jwtIssuer,
    audience: env.jwtAudience,
    expiresIn: env.jwtExpiresIn,
    jwtid: randomUUID(),
  })
  const { iat, exp } = jwt.decode(token)
  return { token, expiresIn: exp - iat, expiresAt: new Date(exp * 1000).toISOString() }
}

// Throws jsonwebtoken errors (TokenExpiredError, JsonWebTokenError, NotBeforeError).
export function verifyAccessToken(token) {
  return jwt.verify(token, requireJwtSecret(), {
    algorithms: [ALGORITHM], // never accept "none" or a different algorithm
    issuer: env.jwtIssuer,
    audience: env.jwtAudience,
  })
}
