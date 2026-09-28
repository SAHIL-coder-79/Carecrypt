import jwt from 'jsonwebtoken'
import { verifyAccessToken } from '../auth/tokens.js'
import { findUserById } from '../auth/userRepository.js'
import { unauthorized } from '../lib/httpError.js'

const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/

// Requires a valid "Authorization: Bearer <JWT>" header.
// On success sets req.user = { id, email, role, displayName }.
// The account is re-checked on every request, so disabling a user or changing
// their role takes effect immediately instead of when the token expires.
export function authenticateToken() {
  return async function authenticate(req, res, next) {
    const header = req.get('authorization')
    if (!header) {
      throw unauthorized('Authentication required.', 'invalid_request')
    }
    const match = BEARER.exec(header)
    if (!match) {
      throw unauthorized('Authorization header must be "Bearer <token>".', 'invalid_request')
    }

    let claims
    try {
      claims = verifyAccessToken(match[1])
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) throw unauthorized('Token has expired.')
      throw unauthorized('Token is invalid.')
    }

    const user = await findUserById(claims.sub)
    if (!user || !user.is_active || user.role !== claims.role) {
      throw unauthorized('Token is no longer valid for this account.')
    }

    req.user = { id: user.id, email: user.email, role: user.role, displayName: user.display_name }
    req.auth = { tokenId: claims.jti, expiresAt: new Date(claims.exp * 1000).toISOString() }
    next()
  }
}
