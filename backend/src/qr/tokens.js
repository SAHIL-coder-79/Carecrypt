import { createHash, randomBytes } from 'node:crypto'
import { withTransaction } from '../db/pool.js'

// A patient QR card encodes only an opaque random token, for example
//   ccqr_Q2v7X...   (prefix + 192 random bits, base64url)
// It contains no identifier, name or health information. The database stores
// only the token's SHA-256 hash, so a database leak does not yield usable cards.
export const TOKEN_PREFIX = 'ccqr_'

export function generateQrToken() {
  return TOKEN_PREFIX + randomBytes(24).toString('base64url')
}

export function hashQrToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

// Issues a new active card for a patient and revokes any previous active card,
// atomically. Returns the raw token: it is shown once, for printing, and never stored.
export function issueQrToken(patientId, { issuedBy = null, revokeReason = 'Replaced by a new card' } = {}) {
  const token = generateQrToken()
  return withTransaction(async (client) => {
    await client.query(
      `UPDATE clinical.patient_qr_identities
          SET status = 'REVOKED', revoked_at = now(), revoked_reason = $2
        WHERE patient_id = $1 AND status = 'ACTIVE'`,
      [patientId, revokeReason],
    )
    await client.query(
      `INSERT INTO clinical.patient_qr_identities (patient_id, token_hash, token_hint, status, issued_by)
       VALUES ($1, $2, $3, 'ACTIVE', $4)`,
      [patientId, hashQrToken(token), token.slice(-4), issuedBy],
    )
    return token
  })
}
