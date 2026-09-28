// Custom aggregate queries and inference control:
//   highly specific query → minimum-group check → SUPPRESSED
//   repeated narrowing queries → inference detection → SECURITY EVENT → queries paused
//   SECURITY_ADMIN resolves the event → queries allowed again
//
// Uses admin.rahul, so the other suites' admin (admin.priya) is never blocked.
// Expected answers are recomputed from the clinical tables through the app login.
// Needs ANALYTICS_DATABASE_URL; skipped without it.

import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import { detect, isNarrowing } from '../src/security/inference.js'
import { PASSWORD, query, skipReason, startServer, userId, USERS } from './helpers.js'

const RAHUL = 'admin.rahul@carecrypt.example'
const analyticsUrl = process.env.ANALYTICS_DATABASE_URL

describe('inference detection rules (unit)', () => {
  const q = (filters, suppressed = false, extra = {}) => ({ filters, suppressed, suppression: suppressed ? 'SMALL_GROUP' : null, ...extra })

  test('isNarrowing needs the same values and strictly more filters', () => {
    assert.equal(isNarrowing({}, { district: 'Pune' }), true)
    assert.equal(isNarrowing({ district: 'Pune' }, { district: 'Pune', month: '2026-09' }), true)
    assert.equal(isNarrowing({ district: 'Pune' }, { district: 'Nashik', month: '2026-09' }), false)
    assert.equal(isNarrowing({ district: 'Pune' }, { district: 'Pune' }), false)
  })

  test('an ordinary drill-down ending in one suppressed answer is not flagged', () => {
    assert.equal(detect([q({}), q({ state: 'M' }), q({ state: 'M', district: 'P' }, true)]), null)
  })

  test('narrowing past suppressed answers is flagged', () => {
    const f = detect([
      q({}),
      q({ state: 'M' }),
      q({ state: 'M', district: 'P' }, true),
      q({ state: 'M', district: 'P', category: 'I' }, true),
    ])
    assert.equal(f.type, 'INFERENCE_NARROWING')
    assert.equal(f.severity, 'MEDIUM')
    assert.equal(f.details.queries.length, 4)
  })

  test('asking the coarser query of a DIFFERENCE-suppressed answer is flagged as differencing', () => {
    const f = detect([q({}), { filters: { category: 'R' }, suppressed: true, suppression: 'DIFFERENCE', riskFilters: {} }])
    assert.equal(f.type, 'INFERENCE_DIFFERENCING')
    assert.equal(f.severity, 'HIGH')
    assert.equal(detect([{ filters: { category: 'R' }, suppressed: true, suppression: 'DIFFERENCE', riskFilters: {} }]), null)
  })

  test('many unrelated suppressed answers are flagged as probing', () => {
    const history = ['A', 'B', 'C', 'D', 'E'].map((c) => q({ condition: c }, true))
    assert.equal(detect(history.slice(0, 4)), null)
    assert.equal(detect(history).type, 'INFERENCE_PROBING')
  })
})

const skip = (await skipReason()) || (analyticsUrl ? false : 'set ANALYTICS_DATABASE_URL to run')

describe('custom analytics queries and inference control', { skip }, () => {
  let server
  let api
  let tokens
  let rahulId
  let k

  before(async () => {
    server = await startServer()
    api = server.api
    tokens = await api.tokensForAllRoles()
    tokens.rahul = (await (await api.login(RAHUL, PASSWORD)).json()).token
    rahulId = await userId(RAHUL)
    k = (await query('SELECT min_group_size FROM analytics.privacy_settings')).rows[0].min_group_size
  })

  after(async () => {
    await server?.close()
  })

  // Each test starts with no open inference event and no query history that counts.
  beforeEach(async () => {
    await resolveOpenEvents()
  })

  // Resolves Rahul's open events and adds a resolved marker, so detection only
  // counts queries made after this point.
  async function resolveOpenEvents() {
    const officer = await userId(USERS.SECURITY_ADMIN)
    await query(
      `UPDATE audit.security_events
          SET status = 'RESOLVED', resolved_by = $2, resolved_at = now(), resolution_note = 'test reset'
        WHERE user_id = $1 AND status = 'OPEN'`,
      [rahulId, officer],
    )
    await query(
      `INSERT INTO audit.security_events
         (event_type, severity, user_id, user_role, summary, status, resolved_by, resolved_at, resolution_note)
       VALUES ('INFERENCE_PROBING', 'LOW', $1, 'ADMIN', 'Test reset marker', 'RESOLVED', $2, now(), 'test reset')`,
      [rahulId, officer],
    )
  }

  const ask = async (filters, token = tokens.rahul) => {
    const qs = new URLSearchParams(filters).toString()
    const res = await api.get(`/api/analytics/query${qs ? `?${qs}` : ''}`, token)
    return { status: res.status, body: await res.json() }
  }

  // Distinct patients matching the filters, straight from the clinical tables.
  async function truth(f) {
    const { rows } = await query(
      `SELECT count(DISTINCT v.patient_id)::int AS n
         FROM clinical.visit_diagnoses d
         JOIN clinical.visits v ON v.id = d.visit_id
         JOIN clinical.patients p ON p.id = v.patient_id
         JOIN ref.conditions c ON c.code = d.condition_code
        WHERE d.diagnosis_type IN ('CONFIRMED', 'PROVISIONAL') AND v.status = 'COMPLETED' AND p.allow_aggregate_analytics
          AND ($1::text IS NULL OR p.state = $1) AND ($2::text IS NULL OR p.district = $2)
          AND ($3::text IS NULL OR c.category = $3) AND ($4::text IS NULL OR c.code = $4)
          AND ($5::text IS NULL OR to_char(date_trunc('month', v.visit_at), 'YYYY-MM') = $5)
          AND ($6::text IS NULL OR analytics.age_band(p.date_of_birth, v.visit_at) = $6)
          AND ($7::text IS NULL OR p.gender::text = $7)`,
      [f.state, f.district, f.category, f.condition, f.month, f.ageBand, f.gender].map((v) => v ?? null),
    )
    return rows[0].n
  }

  async function expected(filters) {
    const n = await truth(filters)
    if (n > 0 && n < k) return { suppression: 'SMALL_GROUP' }
    const keys = Object.keys(filters)
    for (let mask = 0; mask < (1 << keys.length) - 1; mask++) {
      const coarser = Object.fromEntries(keys.filter((_, i) => mask & (1 << i)).map((key) => [key, filters[key]]))
      const d = (await truth(coarser)) - n
      if (d >= 1 && d < k) return { suppression: 'DIFFERENCE' }
    }
    return { suppression: null, patientCount: n }
  }

  test('only ADMIN may run custom queries', async () => {
    for (const role of ['CLINICIAN', 'PATIENT', 'SECURITY_ADMIN']) {
      const r = await ask({}, tokens[role])
      assert.equal(r.status, 403, role)
      assert.equal(r.body.resource, 'AGGREGATE_ANALYTICS')
    }
    assert.equal((await api.get('/api/analytics/query')).status, 401)
  })

  test('filters are validated', async () => {
    for (const bad of [{ patientId: 'x' }, { month: '2026-13' }, { condition: 'dengue' }, { ageBand: '30-40' }, { gender: 'X' }]) {
      const r = await ask(bad)
      assert.equal(r.status, 400, JSON.stringify(bad))
      assert.equal(r.body.error, 'VALIDATION_FAILED')
    }
    const repeated = await api.get('/api/analytics/query?district=Pune&district=Nashik', tokens.rahul)
    assert.equal(repeated.status, 400)
  })

  test('answers match the data, with the minimum-group and differencing checks applied', async () => {
    const cases = [
      {},
      { state: 'Maharashtra' },
      { district: 'Pune' },
      { district: 'Nashik', condition: 'A90', month: '2026-09' },
      { category: 'RESPIRATORY' },
      { category: 'INFECTIOUS' },
      { ageBand: '25-44' },
      { gender: 'FEMALE' },
      { district: 'Bengaluru Urban', category: 'ENDOCRINE' },
    ]
    for (const filters of cases) {
      await resolveOpenEvents()
      const want = await expected(filters)
      const r = await ask(filters)
      assert.equal(r.status, 200, JSON.stringify(filters))
      assert.equal(r.body.result.suppression, want.suppression, JSON.stringify(filters))
      if (want.suppression) {
        assert.equal(r.body.result.suppressed, true)
        assert.equal(r.body.result.patientCount, null)
        assert.equal(r.body.result.caseCount, null)
      } else {
        assert.equal(r.body.result.patientCount, want.patientCount, JSON.stringify(filters))
        assert.ok(want.patientCount === 0 || want.patientCount >= k)
      }
      assert.equal(r.body.privacy.minGroupSize, k)
    }
  })

  test('a highly specific query is SUPPRESSED and the response carries no identifiers', async () => {
    const r = await ask({ district: 'Nashik', condition: 'A90', month: '2026-09', gender: 'FEMALE' })
    assert.equal(r.status, 200)
    assert.deepEqual(r.body.result, { patientCount: null, caseCount: null, suppressed: true, suppression: 'SMALL_GROUP' })
    assert.doesNotMatch(JSON.stringify(r.body), /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)
  })

  test('repeated narrowing raises a security event, pauses custom queries, and resolution restores them', async (t) => {
    const steps = [
      {},
      { state: 'Maharashtra' },
      { state: 'Maharashtra', district: 'Pune' },
      { state: 'Maharashtra', district: 'Pune', category: 'INFECTIOUS' },
    ]
    // The scenario needs the last two steps to be suppressed (true for the seed at k = 10).
    const last = await Promise.all(steps.slice(2).map(expected))
    if (!last.every((e) => e.suppression)) return t.skip('the drill-down steps are not suppressed in this data')

    let final
    for (const [i, filters] of steps.entries()) {
      final = await ask(filters)
      assert.equal(final.status, 200)
      assert.equal(final.body.inferenceControl.flagged, i === steps.length - 1, `step ${i}`)
    }
    const flagged = final.body.inferenceControl.securityEvent
    assert.equal(flagged.type, 'INFERENCE_NARROWING')
    assert.equal(flagged.severity, 'MEDIUM')

    const { rows } = await query('SELECT * FROM audit.security_events WHERE id = $1', [flagged.id])
    assert.equal(rows[0].user_id, rahulId)
    assert.equal(rows[0].status, 'OPEN')
    // The event records the filters of the query chain, never a count.
    assert.doesNotMatch(JSON.stringify(rows[0].details), /Count"?\s*:\s*\d/)
    assert.equal(rows[0].details.queries.length, 4)
    const { rows: audit } = await query(
      `SELECT count(*)::int AS n FROM audit.audit_logs WHERE action = 'SECURITY_EVENT' AND resource_id = $1`,
      [flagged.id],
    )
    assert.equal(audit[0].n, 1)

    const blocked = await ask({ district: 'Nashik' })
    assert.equal(blocked.status, 403)
    assert.equal(blocked.body.error, 'ANALYTICS_QUERY_BLOCKED')
    assert.equal(blocked.body.securityEventId, flagged.id)
    // The standard dashboard stays available.
    assert.equal((await api.get('/api/analytics/overview', tokens.rahul)).status, 200)

    // The security officer reviews and resolves it through the API.
    const res = await fetch(`${server.baseUrl}/api/security/events/${flagged.id}/resolve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokens.SECURITY_ADMIN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: 'Discussed with the analyst; exploratory drill-down.' }),
    })
    assert.equal(res.status, 200)
    const again = await ask({ district: 'Nashik' })
    assert.equal(again.status, 200)
    assert.equal(again.body.inferenceControl.flagged, false, 'queries before the resolution are not counted again')
  })

  test('asking a query and then a small-difference refinement is flagged as differencing (HIGH)', async (t) => {
    let pair = null
    for (const category of ['RESPIRATORY', 'INFECTIOUS', 'ENDOCRINE', 'CARDIOVASCULAR']) {
      const [coarse, fine] = await Promise.all([expected({}), expected({ category })])
      if (coarse.suppression === null && fine.suppression === 'DIFFERENCE') pair = { category }
      if (pair) break
    }
    if (!pair) return t.skip('no category differs from the total by fewer than k patients in this data')

    assert.equal((await ask({})).body.inferenceControl.flagged, false)
    const r = await ask(pair)
    assert.equal(r.body.result.suppression, 'DIFFERENCE')
    assert.equal(r.body.inferenceControl.securityEvent.type, 'INFERENCE_DIFFERENCING')
    assert.equal(r.body.inferenceControl.securityEvent.severity, 'HIGH')
  })

  test('probing many small groups is flagged', async (t) => {
    const rare = []
    for (const condition of ['B54', 'A01.0', 'D50.9', 'E78.5', 'J44.9', 'E03.9', 'M54.5', 'J18.9', 'J45.9']) {
      if ((await expected({ condition })).suppression === 'SMALL_GROUP') rare.push(condition)
    }
    if (rare.length < 5) return t.skip('fewer than 5 small conditions in this data')
    const results = []
    for (const condition of rare.slice(0, 5)) results.push(await ask({ condition }))
    assert.deepEqual(results.slice(0, 4).map((r) => r.body.inferenceControl.flagged), [false, false, false, false])
    assert.equal(results[4].body.inferenceControl.securityEvent.type, 'INFERENCE_PROBING')
  })

  test('every custom query is audited with its filters and outcome, never a count', async () => {
    await ask({ district: 'Pune', month: '2026-09' })
    const { rows } = await query(
      `SELECT outcome, metadata, patient_id FROM audit.audit_logs
        WHERE action = 'ANALYTICS_QUERY' AND user_id = $1 ORDER BY chain_seq DESC LIMIT 1`,
      [rahulId],
    )
    assert.equal(rows[0].outcome, 'SUCCESS')
    assert.equal(rows[0].patient_id, null)
    assert.deepEqual(rows[0].metadata.filters, { district: 'Pune', month: '2026-09' })
    assert.equal(typeof rows[0].metadata.suppressed, 'boolean')
    assert.ok(!('patientCount' in rows[0].metadata) && !('patient_count' in rows[0].metadata))
  })
})
