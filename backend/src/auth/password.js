import bcrypt from 'bcryptjs'

const BCRYPT_COST = 10

// bcrypt only uses the first 72 bytes of a password.
export const MAX_PASSWORD_BYTES = 72

// Compared against when an email is unknown, so a login attempt takes the same
// time whether or not the account exists (prevents account enumeration by timing).
const DUMMY_HASH = bcrypt.hashSync('carecrypt-timing-equaliser', BCRYPT_COST)

export function hashPassword(plaintext) {
  return bcrypt.hash(plaintext, BCRYPT_COST)
}

export function verifyPassword(plaintext, hash) {
  return bcrypt.compare(plaintext, hash)
}

export function burnPasswordCheck(plaintext) {
  return bcrypt.compare(plaintext, DUMMY_HASH)
}
