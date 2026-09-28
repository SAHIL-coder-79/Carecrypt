// Must match the identity.user_role enum in database/schema.sql.
export const ROLES = Object.freeze({
  PATIENT: 'PATIENT',
  CLINICIAN: 'CLINICIAN',
  ADMIN: 'ADMIN',
  SECURITY_ADMIN: 'SECURITY_ADMIN',
})

export const ALL_ROLES = Object.freeze(Object.values(ROLES))

export function isRole(value) {
  return ALL_ROLES.includes(value)
}
