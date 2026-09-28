import { recordAuditEvent } from '../audit/auditLog.js'
import { query } from '../db/pool.js'

// Security events are findings for the SECURITY_ADMIN: suspected inference on
// analytics, staff attempts to open patient data, locked accounts. Each one is
// stored in audit.security_events (reviewable, resolvable) and also appended to
// the hash-chained audit log as SECURITY_EVENT.
//
// Details must never contain a count below the minimum group size, patient
// names or any record content.

export const EVENT_TYPES = Object.freeze({
  INFERENCE_NARROWING: 'Repeated narrowing analytics queries',
  INFERENCE_DIFFERENCING: 'Analytics query that could isolate a small group by subtraction',
  INFERENCE_PROBING: 'Many analytics queries hitting suppressed small groups',
  PATIENT_DATA_ACCESS_DENIED: 'Attempt to open patient data without the right role',
  ACCOUNT_LOCKED: 'Account locked after repeated failed sign-ins',
})

// Inserts an event unless the same type is already open for this user within
// `dedupeMinutes` (0 = never deduplicate). Returns the event row, or the
// existing open one when deduplicated.
export async function raiseSecurityEvent({ req, user, type, severity, summary, details = {}, dedupeMinutes = 0 }) {
  if (!EVENT_TYPES[type]) throw new Error(`Unknown security event type ${type}`)

  if (dedupeMinutes > 0 && user?.id) {
    const { rows } = await query(
      `SELECT id, event_type, severity, detected_at FROM audit.security_events
        WHERE user_id = $1 AND event_type = $2 AND status = 'OPEN'
          AND detected_at > now() - make_interval(mins => $3)
        ORDER BY detected_at DESC LIMIT 1`,
      [user.id, type, dedupeMinutes],
    )
    if (rows[0]) return { ...rows[0], deduplicated: true }
  }

  const { rows } = await query(
    `INSERT INTO audit.security_events (event_type, severity, user_id, user_role, summary, details)
     VALUES ($1, $2::audit.event_severity, $3, $4::identity.user_role, $5, $6::jsonb)
     RETURNING id, event_type, severity, detected_at`,
    [type, severity, user?.id ?? null, user?.role ?? null, summary, JSON.stringify(details)],
  )
  const event = rows[0]
  await recordAuditEvent({
    req,
    user,
    action: 'SECURITY_EVENT',
    resourceType: 'security_event',
    resourceId: event.id,
    outcome: 'SUCCESS',
    reason: summary,
    metadata: { event_type: type, severity },
  })
  return event
}

// True while the user has an unresolved inference event from the last 24 hours.
// Such users cannot run custom analytics queries until a SECURITY_ADMIN resolves it.
export async function openInferenceEvent(userId) {
  const { rows } = await query(
    `SELECT id, event_type, detected_at FROM audit.security_events
      WHERE user_id = $1 AND status = 'OPEN' AND event_type LIKE 'INFERENCE\\_%'
        AND detected_at > now() - interval '24 hours'
      ORDER BY detected_at DESC LIMIT 1`,
    [userId],
  )
  return rows[0] ?? null
}

// For callers whose own response must not change if raising the event fails
// (a refusal must stay a 403, a failed login a 401).
export async function raiseSecurityEventSafely(event) {
  try {
    return await raiseSecurityEvent(event)
  } catch (err) {
    console.error(`[security] failed to raise ${event.type}: ${err.message}`)
    return null
  }
}
