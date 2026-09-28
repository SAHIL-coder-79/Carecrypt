// ADMIN aggregate analytics: access, de-identification, small-cell suppression,
// complementary suppression and the isolation of the analytics database login.
//
// Expected numbers are recomputed from the clinical tables (through the app login)
// at test time, so the suite passes whatever other suites have added before it.
// The endpoint tests need ANALYTICS_DATABASE_URL (the carecrypt_analytics login);
// without it they check that the API answers 503 instead.

import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import pg from 'pg'
import { protect, toCell } from '../src/analytics/suppression.js'
import { auditCount, query, skipReason, startServer, userId, USERS } from './helpers.js'

const analyticsUrl = process.env.ANALYTICS_DATABASE_URL
const ENDPOINTS = ['overview', 'by-location', 'by-condition', 'by-time', 'by-age-group']
// Unit tests use a fixed k; endpoint tests read the configured one from the database.
const UNIT_K = 5
let K

describe('complementary suppression (unit)', () => {
  const cell = (name, patients, cases) =>
    toCell({ name, patient_count: patients < UNIT_K ? null : patients, case_count: patients < UNIT_K ? null : cases, is_suppressed: patients < UNIT_K })
  const all = (total) => [{ key: () => 'all', total: () => total }]

  test('a single hidden cell forces the smallest visible cell to be hidden too', () => {
    const out = protect([cell('A', 3, 4), cell('B', 9, 20), cell('C', 6, 7)], all(31), UNIT_K)
    assert.deepEqual(
      out.map((c) => [c.name, c.suppression]),
      [
        ['A', 'SMALL_GROUP'],
        ['B', null],
        ['C', 'COMPLEMENTARY'],
      ],
    )
    assert.equal(out[2].caseCount, null)
    assert.equal(out[2].patientCount, null)
  })

  test('several hidden cells whose derivable sum is below k are protected', () => {
    // Hidden A and B hold 31 - 20 - 8 = 3 cases, which anyone could work out.
    const out = protect([cell('A', 1, 1), cell('B', 2, 2), cell('C', 9, 20), cell('D', 6, 8)], all(31), UNIT_K)
    assert.equal(out.find((c) => c.name === 'D').suppression, 'COMPLEMENTARY')
    assert.equal(out.find((c) => c.name === 'C').suppressed, false)
  })

  test('nothing changes when no cell is hidden or the hidden sum is already safe', () => {
    const clean = [cell('A', 5, 5), cell('B', 9, 20)]
    assert.deepEqual(protect(clean, all(25), UNIT_K), clean)
    const safe = [cell('A', 3, 3), cell('B', 4, 4), cell('C', 9, 20)]
    assert.equal(protect(safe, all(27), UNIT_K).filter((c) => c.suppressed).length, 2)
  })

  test('two-way tables are protected along both dimensions', () => {
    const t = (r, c, p, n) => ({ ...cell(`${r}${c}`, p, n), r, c })
    const cells = [t('x', 1, 9, 9), t('x', 2, 2, 2), t('y', 1, 8, 8), t('y', 2, 7, 7)]
    const rowTotals = { x: 11, y: 15 }
    const colTotals = { 1: 17, 2: 9 }
    const out = protect(
      cells,
      [
        { key: (c) => c.r, total: (g) => rowTotals[g] },
        { key: (c) => String(c.c), total: (g) => colTotals[g] },
      ],
      UNIT_K,
    )
    // x2 is hidden; x1 (row) and y2 (column) must follow, and then y1 to protect those.
    assert.deepEqual(out.map((c) => c.suppressed), [true, true, true, true])
  })
})

const skip = await skipReason()

describe('ADMIN aggregate analytics', { skip }, () => {
  let server
  let api
  let tokens

  before(async () => {
    server = await startServer()
    api = server.api
    tokens = await api.tokensForAllRoles()
    K = (await query('SELECT min_group_size FROM analytics.privacy_settings')).rows[0].min_group_size
  })

  after(async () => {
    await server?.close()
  })

  const get = async (path, token) => {
    const res = await api.get(`/api/analytics/${path}`, token)
    return { status: res.status, body: await res.json().catch(() => null) }
  }

  describe('access', () => {
    test('requires a signed-in user', async () => {
      for (const path of ENDPOINTS) {
        assert.equal((await get(path)).status, 401, path)
      }
    })

    test('CLINICIAN, PATIENT and SECURITY_ADMIN are refused, and each refusal is audited', async () => {
      for (const role of ['CLINICIAN', 'PATIENT', 'SECURITY_ADMIN']) {
        const before = await auditCount(
          `action = 'ACCESS_DENIED' AND resource_id = 'AGGREGATE_ANALYTICS' AND user_id = $1`,
          [await userId(USERS[role])],
        )
        for (const path of ENDPOINTS) {
          const r = await get(path, tokens[role])
          assert.equal(r.status, 403, `${role} ${path}`)
          assert.deepEqual(r.body, { error: 'FORBIDDEN', role, resource: 'AGGREGATE_ANALYTICS', access: 'DENIED' })
        }
        const afterCount = await auditCount(
          `action = 'ACCESS_DENIED' AND resource_id = 'AGGREGATE_ANALYTICS' AND user_id = $1`,
          [await userId(USERS[role])],
        )
        assert.equal(afterCount - before, ENDPOINTS.length)
      }
    })

    test('without the analytics login configured, ADMIN gets 503 rather than a fallback', { skip: analyticsUrl ? 'ANALYTICS_DATABASE_URL is set' : false }, async () => {
      const r = await get('overview', tokens.ADMIN)
      assert.equal(r.status, 503)
      assert.equal(r.body.error, 'ANALYTICS_UNAVAILABLE')
    })
  })

  describe('with the analytics login', { skip: analyticsUrl ? false : 'set ANALYTICS_DATABASE_URL to run' }, () => {
    const responses = {}

    before(async () => {
      for (const path of ENDPOINTS) {
        const r = await get(path, tokens.ADMIN)
        assert.equal(r.status, 200, path)
        responses[path] = r.body
      }
    })

    test('responses contain no patient identifiers, contact details or row-level records', async () => {
      const { rows: patients } = await query(
        `SELECT id, mrn, first_name, last_name, phone, email, address_line, emergency_contact_name,
                emergency_contact_phone, date_of_birth
           FROM clinical.patients`,
      )
      const { rows: visits } = await query('SELECT id FROM clinical.visits')
      const needles = new Set()
      for (const p of patients) {
        for (const v of Object.values(p)) if (v) needles.add(String(v))
      }
      for (const v of visits) needles.add(v.id)

      const FORBIDDEN_KEYS = /^(id|patientId|patient_id|visitId|visit_id|mrn|firstName|lastName|fullName|phone|email|address|dateOfBirth|medications|prescriptions|clinician|clinicianId)$/i
      const walk = (value, where) => {
        if (Array.isArray(value)) return value.forEach((v, i) => walk(v, `${where}[${i}]`))
        if (value && typeof value === 'object') {
          for (const [k, v] of Object.entries(value)) {
            assert.doesNotMatch(k, FORBIDDEN_KEYS, `${where}.${k}`)
            walk(v, `${where}.${k}`)
          }
        }
      }

      for (const [path, body] of Object.entries(responses)) {
        walk(body, path)
        const text = JSON.stringify(body)
        assert.doesNotMatch(text, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, `${path} contains a UUID`)
        for (const needle of needles) {
          const pattern = new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
          assert.doesNotMatch(text, pattern, `${path} contains patient data`)
        }
      }
    })

    test('totals match the clinical data, excluding patients who opted out', async () => {
      const truth = async (optedInOnly) => {
        const { rows } = await query(
          `SELECT count(DISTINCT v.patient_id)::int AS patients, count(*)::int AS cases
             FROM clinical.visit_diagnoses d
             JOIN clinical.visits v ON v.id = d.visit_id
             JOIN clinical.patients p ON p.id = v.patient_id
            WHERE d.diagnosis_type IN ('CONFIRMED', 'PROVISIONAL') AND v.status = 'COMPLETED'
              AND ($1 = false OR p.allow_aggregate_analytics)`,
          [optedInOnly],
        )
        return rows[0]
      }
      const counted = await truth(true)
      const everyone = await truth(false)
      const { totals } = responses.overview
      assert.equal(totals.patients, counted.patients)
      assert.equal(totals.cases, counted.cases)
      assert.ok(everyone.cases > counted.cases, 'the seed has an opted-out patient with diagnoses')

      const sum = (list) => list.reduce((s, c) => s + (c.caseCount ?? 0), 0)
      const hiddenFree = (list) => list.every((c) => !c.suppressed)
      for (const [list, name] of [
        [responses['by-location'].locations, 'locations'],
        [responses['by-time'].months, 'months'],
        [responses['by-condition'].categories, 'categories'],
      ]) {
        if (hiddenFree(list)) assert.equal(sum(list), totals.cases, name)
        else assert.ok(sum(list) < totals.cases, name)
      }
    })

    test('every visible count covers at least the minimum group size; hidden cells carry no numbers', () => {
      const cells = [
        ...responses['by-location'].locations,
        ...responses['by-location'].byCategory,
        ...responses['by-condition'].categories,
        ...responses['by-condition'].conditions,
        ...responses['by-time'].months,
        ...responses['by-time'].byCategory,
        ...responses['by-age-group'].ageGroups,
        ...responses.overview.signals,
      ]
      for (const c of cells) {
        if (c.suppressed) {
          assert.equal(c.patientCount, null)
          assert.equal(c.caseCount, null)
          assert.match(c.suppression, /^(SMALL_GROUP|COMPLEMENTARY)$/)
        } else if (c.patientCount !== 0) {
          assert.ok(c.patientCount >= K, JSON.stringify(c))
        }
      }
      assert.equal(responses.overview.privacy.minGroupSize, K)
    })

    test('no hidden cell can be recovered by subtracting visible cells from a published total', () => {
      const { totals } = responses.overview
      const loc = responses['by-location']
      const cond = responses['by-condition']
      const time = responses['by-time']
      const published = (list, key) => new Map(list.map((c) => [key(c), c.suppressed ? null : c.caseCount]))
      const districtTotals = published(loc.locations, (c) => c.district)
      const categoryTotals = published(cond.categories, (c) => c.category)
      const monthTotals = published(time.months, (c) => c.month)

      const checks = [
        ['locations', loc.locations, () => 'all', () => totals.cases],
        ['categories', cond.categories, () => 'all', () => totals.cases],
        ['months', time.months, () => 'all', () => totals.cases],
        ['age groups', responses['by-age-group'].ageGroups, () => 'all', () => totals.cases],
        ['conditions', cond.conditions, () => 'all', () => totals.cases],
        ['conditions by category', cond.conditions, (c) => c.category, (g) => categoryTotals.get(g)],
        ['district x category by district', loc.byCategory, (c) => c.district, (g) => districtTotals.get(g)],
        ['district x category by category', loc.byCategory, (c) => c.category, (g) => categoryTotals.get(g)],
        ['month x category by month', time.byCategory, (c) => c.month, (g) => monthTotals.get(g)],
        ['month x category by category', time.byCategory, (c) => c.category, (g) => categoryTotals.get(g)],
      ]
      for (const [name, list, key, total] of checks) {
        const groups = Map.groupBy(list, key)
        for (const [g, members] of groups) {
          const hidden = members.filter((c) => c.suppressed)
          // A group that is entirely hidden has nothing visible to subtract.
          if (hidden.length === 0 || hidden.length === members.length) continue
          assert.notEqual(hidden.length, 1, `${name} / ${g}: a lone hidden cell`)
          const t = total(g)
          if (t == null) continue
          const remainder = t - members.filter((c) => !c.suppressed).reduce((s, c) => s + c.caseCount, 0)
          assert.ok(remainder >= K, `${name} / ${g}: hidden cells hold a derivable ${remainder} cases`)
        }
      }
    })

    test('every district below the minimum group size is hidden', async () => {
      const { rows } = await query(
        `SELECT p.district, count(DISTINCT p.id)::int AS n
           FROM clinical.visit_diagnoses d
           JOIN clinical.visits v ON v.id = d.visit_id
           JOIN clinical.patients p ON p.id = v.patient_id
          WHERE d.diagnosis_type IN ('CONFIRMED', 'PROVISIONAL') AND v.status = 'COMPLETED' AND p.allow_aggregate_analytics
          GROUP BY 1`,
      )
      const { locations } = responses['by-location']
      for (const r of rows) {
        const cell = locations.find((c) => c.district === r.district)
        if (r.n < K) assert.equal(cell.suppression, 'SMALL_GROUP', r.district)
        else if (!cell.suppressed) assert.equal(cell.patientCount, r.n, r.district)
      }
      assert.ok(rows.some((r) => r.n < K), 'the seed has a district below k')
    })

    test('notifiable-disease signals show only clusters of at least k patients', async () => {
      const { signals } = responses.overview
      for (const s of signals) assert.ok(s.patientCount >= K)
      assert.ok(!signals.some((s) => s.district === 'Nashik'), 'the small Nashik dengue cell stays hidden')
      // The Pune dengue cluster has 6 patients: shown only when k <= 6.
      const { rows } = await query(`SELECT now() < DATE '2026-12-01' AS in_window`)
      const pune = signals.some((s) => s.district === 'Pune' && s.code === 'A90' && s.month === '2026-09')
      if (rows[0].in_window) assert.equal(pune, K <= 6)
    })

    test('filters narrow the rows but never change what is hidden', async () => {
      const full = responses['by-time']
      const r = await get('by-time?category=RESPIRATORY&from=2026-01&to=2026-06', tokens.ADMIN)
      assert.equal(r.status, 200)
      assert.ok(r.body.byCategory.length > 0)
      for (const c of r.body.byCategory) {
        assert.equal(c.category, 'RESPIRATORY')
        assert.ok(c.month >= '2026-01' && c.month <= '2026-06')
        assert.deepEqual(c, full.byCategory.find((f) => f.month === c.month && f.category === c.category))
      }
      assert.deepEqual(r.body.months.map((m) => m.month), ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'])

      const loc = await get('by-location?category=INFECTIOUS', tokens.ADMIN)
      assert.ok(loc.body.byCategory.every((c) => c.category === 'INFECTIOUS'))
      const cond = await get('by-condition?category=INFECTIOUS', tokens.ADMIN)
      assert.ok(cond.body.conditions.length > 0 && cond.body.conditions.every((c) => c.category === 'INFECTIOUS'))
    })

    test('invalid filters are rejected', async () => {
      for (const path of [
        'by-condition?category=NOT_A_CATEGORY',
        'by-time?from=2026-13',
        'by-time?from=2026-06&to=2026-01',
        'by-time?patientId=1',
        'overview?district=Pune',
        'by-location?category=INFECTIOUS&category=RESPIRATORY',
      ]) {
        const r = await get(path, tokens.ADMIN)
        assert.equal(r.status, 400, path)
        assert.equal(r.body.error, 'VALIDATION_FAILED')
      }
    })

    test('each view is audited as ANALYTICS_VIEW without a patient reference', async () => {
      const admin = await userId(USERS.ADMIN)
      const before = await auditCount(`action = 'ANALYTICS_VIEW' AND user_id = $1`, [admin])
      await get('by-location?category=INFECTIOUS', tokens.ADMIN)
      const { rows } = await query(
        `SELECT resource_type, resource_id, patient_id, outcome, metadata
           FROM audit.audit_logs WHERE action = 'ANALYTICS_VIEW' AND user_id = $1
          ORDER BY chain_seq DESC LIMIT 1`,
        [admin],
      )
      assert.equal(await auditCount(`action = 'ANALYTICS_VIEW' AND user_id = $1`, [admin]), before + 1)
      assert.equal(rows[0].resource_type, 'analytics')
      assert.equal(rows[0].resource_id, 'by-location')
      assert.equal(rows[0].patient_id, null)
      assert.equal(rows[0].outcome, 'SUCCESS')
      assert.deepEqual(rows[0].metadata.filters, { category: 'INFECTIOUS' })
      assert.equal(typeof rows[0].metadata.suppressed_cells, 'number')
    })

    describe('analytics database login', () => {
      let client

      before(async () => {
        client = new pg.Client({ connectionString: analyticsUrl })
        await client.connect()
      })

      after(async () => {
        await client?.end()
      })

      test('can read the aggregate views', async () => {
        for (const view of [
          'overview_totals', 'cases_by_location', 'cases_by_category', 'cases_by_condition',
          'cases_monthly', 'category_monthly', 'location_category', 'cases_by_age_band',
        ]) {
          await client.query(`SELECT * FROM analytics.${view} LIMIT 1`)
        }
      })

      test('cannot read patients, visits, prescriptions, accounts, audit or the row-level view', async () => {
        for (const table of [
          'clinical.patients', 'clinical.visits', 'clinical.visit_diagnoses', 'clinical.visit_medications',
          'identity.users', 'audit.audit_logs', 'analytics.diagnosis_events_internal',
        ]) {
          await assert.rejects(client.query(`SELECT 1 FROM ${table} LIMIT 1`), { code: '42501' }, table)
        }
      })
    })
  })
})
