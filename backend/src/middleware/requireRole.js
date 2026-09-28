import { recordAuditEvent } from '../audit/auditLog.js'
import { isRole } from '../auth/roles.js'
import { forbidden, unauthorized } from '../lib/httpError.js'
import { raiseSecurityEventSafely } from '../security/events.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Allows the request only if req.user.role is one of the given roles.
// Must run after authenticateToken(). Roles are exact matches with no hierarchy,
// so ADMIN does NOT inherit CLINICIAN access.
//
//   requireRole('CLINICIAN')
//   requireRole('CLINICIAN', 'SECURITY_ADMIN')
//   requireRole('CLINICIAN', { resource: 'CLINICIAN_ONLY' })   // label used in 403s and audit
//   requireRole('CLINICIAN', { patientParam: 'patientId' })    // also audit which patient was targeted
//   requireRole('CLINICIAN', { securityEvent: true })          // a refusal also raises a security event
//                                                              // (PATIENT_DATA_ACCESS_DENIED, at most one
//                                                              // open event per user per 10 minutes)
//
// A refusal returns 403 { error: 'FORBIDDEN', role, resource, access: 'DENIED' }
// and is written to the audit log.
export function requireRole(...args) {
  const options = typeof args.at(-1) === 'object' && args.at(-1) !== null ? args.pop() : {}
  const roles = args
  if (roles.length === 0 || !roles.every(isRole)) {
    throw new Error(`requireRole() called with invalid roles: ${JSON.stringify(roles)}`)
  }
  const allowed = new Set(roles)

  return async function checkRole(req, res, next) {
    if (!req.user) {
      throw unauthorized('Authentication required.', 'invalid_request')
    }
    if (allowed.has(req.user.role)) {
      return next()
    }

    const path = req.originalUrl.split('?')[0]
    const resource = options.resource ?? `${req.method} ${path}`
    const targetPatient = options.patientParam ? req.params[options.patientParam] : undefined
    await recordAuditEvent({
      req,
      user: req.user,
      action: 'ACCESS_DENIED',
      resourceType: 'endpoint',
      resourceId: resource,
      patientId: UUID.test(targetPatient ?? '') ? targetPatient.toLowerCase() : null,
      outcome: 'DENIED',
      reason: `Role ${req.user.role} not permitted`,
      metadata: { required_roles: roles, method: req.method, path },
    })
    if (options.securityEvent) {
      await raiseSecurityEventSafely({
        req,
        user: req.user,
        type: 'PATIENT_DATA_ACCESS_DENIED',
        severity: 'MEDIUM',
        // Ids are redacted here; the audit entry above keeps the patient reference.
        summary: `${req.user.role} account tried to use ${resource} (${req.method} ${redactIds(path)}) and was refused.`,
        details: { resource, method: req.method, path: redactIds(path), targeted_patient: UUID.test(targetPatient ?? '') },
        dedupeMinutes: 10,
      })
    }
    throw forbidden({ role: req.user.role, resource })
  }
}

function redactIds(path) {
  return path.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
}
