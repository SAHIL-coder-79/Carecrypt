import { query } from '../db/pool.js'

// Appends an entry to audit.audit_logs (append-only and hash-chained in the database).
// A failure to write the audit entry is logged but does not break the request;
// production systems may choose to fail closed instead.
export async function recordAuditEvent({
  req,
  user = null,
  action,
  resourceType,
  resourceId = null,
  patientId = null,
  outcome,
  reason = null,
  metadata = {},
}) {
  try {
    await query(
      `INSERT INTO audit.audit_logs
         (user_id, user_role, action, resource_type, resource_id, patient_id,
          outcome, reason, ip_address, user_agent, metadata)
       VALUES ($1, $2::identity.user_role, $3, $4, $5, $6, $7::audit.outcome, $8, $9::inet, $10, $11::jsonb)`,
      [
        user?.id ?? null,
        user?.role ?? null,
        action,
        resourceType,
        resourceId,
        patientId,
        outcome,
        reason,
        normaliseIp(req?.ip),
        req?.get?.('user-agent')?.slice(0, 500) ?? null,
        JSON.stringify(metadata),
      ],
    )
  } catch (err) {
    console.error(`[audit] failed to record ${action}: ${err.message}`)
  }
}

// Express reports IPv4 clients on dual-stack sockets as "::ffff:1.2.3.4".
function normaliseIp(ip) {
  if (!ip) return null
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip
}
