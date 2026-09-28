import { badRequest } from './httpError.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value) {
  return typeof value === 'string' && UUID.test(value)
}

// Returns the lower-cased UUID, or throws 400 naming the field.
export function parseUuid(value, field) {
  if (!isUuid(value)) throw badRequest(`${field} must be a UUID.`)
  return value.toLowerCase()
}
