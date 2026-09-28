import { query } from '../db/pool.js'

// Inference detection for custom analytics queries.
//
// The database already refuses to release small or subtractable counts. This
// module looks at a user's recent queries for the *behaviour* of an inference
// attack, and names the pattern so a SECURITY_ADMIN can review it:
//
//   INFERENCE_DIFFERENCING  the current query was suppressed because it could be
//                           subtracted from a coarser query, and the user has
//                           already asked that coarser query            (HIGH)
//   INFERENCE_NARROWING     at least NARROWING_STEPS queries in a row, each adding
//                           filters to the previous one, ending in a suppressed
//                           result after at least one earlier suppressed step:
//                           the user keeps drilling past the privacy limit (MEDIUM)
// One suppressed answer at the end of an ordinary drill-down is not flagged.
//   INFERENCE_PROBING       PROBING_SUPPRESSED or more suppressed results in the
//                           window                                        (MEDIUM)

export const WINDOW_MINUTES = 15
export const NARROWING_STEPS = 4
export const PROBING_SUPPRESSED = 5

// jsonb reorders keys, so compare filter sets key by key.
const same = (a, b) => Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((k) => a[k] === b[k])

// True when `wide` keeps a strict subset of `narrow`'s filters with the same values.
export function isNarrowing(wide, narrow) {
  const wideKeys = Object.keys(wide)
  return wideKeys.length < Object.keys(narrow).length && wideKeys.every((k) => narrow[k] === wide[k])
}

// history: this user's queries in the window, oldest first, the current one last:
//   [{ filters, suppressed, suppression, riskFilters }]
// Returns null or { type, severity, summary, details }.
export function detect(history) {
  const current = history.at(-1)
  if (!current) return null
  const earlier = history.slice(0, -1)

  if (current.suppression === 'DIFFERENCE' && current.riskFilters && earlier.some((q) => same(q.filters, current.riskFilters))) {
    return {
      type: 'INFERENCE_DIFFERENCING',
      severity: 'HIGH',
      summary: 'Analytics queries that differ by a small group: the difference would expose fewer patients than the minimum group size.',
      details: { coarser_query: current.riskFilters, finer_query: current.filters },
    }
  }

  // Longest chain of successive narrowings ending at each query.
  const chain = history.map(() => [])
  history.forEach((q, i) => {
    let best = []
    for (let j = 0; j < i; j++) {
      if (isNarrowing(history[j].filters, q.filters) && chain[j].length > best.length) best = chain[j]
    }
    chain[i] = [...best, q]
  })
  const currentChain = chain.at(-1)
  const suppressedInChain = currentChain.filter((q) => q.suppressed).length
  if (current.suppressed && currentChain.length >= NARROWING_STEPS && suppressedInChain >= 2) {
    return {
      type: 'INFERENCE_NARROWING',
      severity: 'MEDIUM',
      summary: `${currentChain.length} analytics queries in a row, each narrower than the last, still narrowing after reaching suppressed small groups.`,
      details: { queries: currentChain.map((q) => ({ filters: q.filters, suppressed: q.suppressed })) },
    }
  }

  const suppressedCount = history.filter((q) => q.suppressed).length
  if (current.suppressed && suppressedCount >= PROBING_SUPPRESSED) {
    return {
      type: 'INFERENCE_PROBING',
      severity: 'MEDIUM',
      summary: `${suppressedCount} analytics queries in ${WINDOW_MINUTES} minutes returned suppressed small groups.`,
      details: { suppressed_queries: suppressedCount, window_minutes: WINDOW_MINUTES },
    }
  }
  return null
}

// This user's custom queries in the window, oldest first, from the audit log.
// Queries made before a SECURITY_ADMIN resolved an inference event for this user
// are not counted again.
export async function recentQueries(userId) {
  const { rows } = await query(
    `SELECT metadata FROM audit.audit_logs
      WHERE user_id = $1 AND action = 'ANALYTICS_QUERY' AND outcome = 'SUCCESS'
        AND occurred_at > now() - make_interval(mins => $2)
        AND occurred_at > coalesce(
              (SELECT max(resolved_at) FROM audit.security_events
                WHERE user_id = $1 AND event_type LIKE 'INFERENCE\\_%'), '-infinity')
      ORDER BY chain_seq`,
    [userId, WINDOW_MINUTES],
  )
  return rows.map((r) => ({
    filters: r.metadata.filters ?? {},
    suppressed: Boolean(r.metadata.suppressed),
    suppression: r.metadata.suppression ?? null,
    riskFilters: r.metadata.risk_filters ?? null,
  }))
}
