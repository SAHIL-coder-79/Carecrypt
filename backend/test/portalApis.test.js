// APIs behind the role-specific navigation: the clinician's visits and SmartCare
// activity, the patient's access history and the admin's privacy page. Each is
// authorised by the server, whatever the interface shows.

import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { PASSWORD, query, skipReason, startServer, USERS } from './helpers.js'

const skip = await skipReason()
const QURESHI = 'dr.farhan.qureshi@carecrypt.example'
const analyticsUrl = process.env.ANALYTICS_DATABASE_URL

describe('role portal APIs', { skip }, () => {
  let server
  let tokens
  const ids = {}

  before(async () => {
    server = await startServer()
    tokens = await server.api.tokensForAllRoles()
    tokens.qureshi = (await (await server.api.login(QURESHI, PASSWORD)).json()).token
    const { rows } = await query('SELECT mrn, id FROM clinical.patients')
    for (const r of rows) ids[r.mrn] = r.id
  })

  after(async () => {
    await server?.close()
  })

  const call = async (method, path, token, body) => {
    const res = await fetch(`${server.baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body !== undefined && { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: res.status, body: await res.json().catch(() => null) }
  }
  const get = (path, token) => call('GET', path, token)

  describe('GET /api/clinicians/me/visits', () => {
    test('lists the clinician\'s own visits, newest first', async () => {
      const r = await get('/api/clinicians/me/visits', tokens.CLINICIAN)
      assert.equal(r.status, 200)
      const { rows } = await query(
        `SELECT count(*)::int AS n FROM clinical.visits v JOIN clinical.clinicians c ON c.id = v.clinician_id
          JOIN identity.users u ON u.id = c.user_id WHERE u.email = $1`,
        [USERS.CLINICIAN],
      )
      assert.equal(r.body.visits.length, Math.min(rows[0].n, 50))
      const dates = r.body.visits.map((v) => v.date)
      assert.deepEqual(dates, [...dates].sort().reverse())
    })

    test('clinical details follow the patient\'s current consent', async () => {
      const { body } = await get('/api/clinicians/me/visits?limit=200', tokens.qureshi)
      for (const v of body.visits) {
        if (!v.consentScope) {
          assert.equal(v.patient, null, 'no name without consent')
          assert.equal(v.primaryDiagnosis, null)
          assert.equal(v.withheld, 'NO_ACTIVE_CONSENT')
        } else if (v.consentScope === 'SUMMARY_ONLY') {
          assert.ok(v.patient.fullName)
          assert.equal(v.primaryDiagnosis, null)
          assert.equal(v.withheld, 'SCOPE')
        } else {
          assert.equal(v.withheld, null)
        }
      }
      // CC-000005's consent to Dr. Qureshi has expired: that visit shows no patient.
      const { rows } = await query(
        `SELECT v.id FROM clinical.visits v JOIN clinical.clinicians c ON c.id = v.clinician_id
          WHERE c.registration_number = 'DEMO-MMC-10002' AND v.patient_id = $1`,
        [ids['CC-000005']],
      )
      for (const r of rows) {
        const v = body.visits.find((x) => x.id === r.id)
        if (v) assert.equal(v.patient, null)
      }
    })

    test('only clinicians', async () => {
      for (const role of ['PATIENT', 'ADMIN', 'SECURITY_ADMIN']) {
        assert.equal((await get('/api/clinicians/me/visits', tokens[role])).status, 403, role)
      }
    })
  })

  describe('GET /api/smartcare/runs', () => {
    test('lists the clinician\'s own decision-support runs with their review status', async () => {
      const run = await call('POST', '/api/smartcare/analyze', tokens.CLINICIAN, {
        patientId: ids['CC-000001'],
        currentSymptoms: ['fever', 'cough'],
      })
      assert.equal(run.status, 200)
      const r = await get('/api/smartcare/runs', tokens.CLINICIAN)
      assert.equal(r.status, 200)
      assert.equal(r.body.label, 'Clinical Decision Support')
      const mine = r.body.runs.find((x) => x.id === run.body.analysisId)
      assert.equal(mine.status, 'NOT_LINKED')
      assert.equal(mine.patient.id, ids['CC-000001'])
      assert.ok(Array.isArray(mine.suggestedConditions))
      // Another clinician does not see it.
      const other = await get('/api/smartcare/runs', tokens.qureshi)
      assert.ok(!other.body.runs.some((x) => x.id === run.body.analysisId))
    })

    test('only clinicians', async () => {
      for (const role of ['PATIENT', 'ADMIN', 'SECURITY_ADMIN']) {
        assert.equal((await get('/api/smartcare/runs', tokens[role])).status, 403, role)
      }
    })
  })

  describe('GET /api/patients/:patientId/access-log', () => {
    test('the patient sees who used their record, including refused attempts', async () => {
      const own = ids['CC-000001']
      assert.equal((await get(`/api/patients/${own}`, tokens.CLINICIAN)).status, 200)
      assert.equal((await get(`/api/patients/${own}`, tokens.ADMIN)).status, 403)

      const r = await get(`/api/patients/${own}/access-log`, tokens.PATIENT)
      assert.equal(r.status, 200)
      const opened = r.body.entries.find((e) => e.actor.name === 'Dr. Aditi Ranade' && e.action === 'PATIENT_RECORD_VIEW')
      assert.equal(opened.outcome, 'ALLOWED')
      assert.equal(opened.description, 'Opened your record')
      const refused = r.body.entries.find((e) => e.actor.kind === 'ADMIN')
      assert.equal(refused.actor.name, 'An administrator')
      assert.equal(refused.outcome, 'REFUSED')
      assert.ok(r.body.summary.refusedAttempts >= 1)
      assert.ok(r.body.summary.clinicians >= 1)
      // No account ids, IP addresses or administrator names.
      const text = JSON.stringify(r.body)
      assert.doesNotMatch(text, /ip_?address|user_?id|Priya/i)
    })

    test('a patient cannot read another patient\'s history; staff cannot read any', async () => {
      assert.equal((await get(`/api/patients/${ids['CC-000002']}/access-log`, tokens.PATIENT)).status, 403)
      for (const role of ['CLINICIAN', 'ADMIN', 'SECURITY_ADMIN']) {
        const r = await get(`/api/patients/${ids['CC-000001']}/access-log`, tokens[role])
        assert.equal(r.status, 403, role)
        assert.equal(r.body.resource, 'ACCESS_HISTORY')
      }
    })
  })

  describe('GET /api/analytics/privacy', { skip: analyticsUrl ? false : 'set ANALYTICS_DATABASE_URL to run' }, () => {
    test('describes the privacy model and the admin\'s own query standing', async () => {
      const r = await get('/api/analytics/privacy', tokens.ADMIN)
      assert.equal(r.status, 200)
      const { rows } = await query('SELECT min_group_size FROM analytics.privacy_settings')
      assert.equal(r.body.minGroupSize, rows[0].min_group_size)
      assert.ok(r.body.protections.length >= 5)
      assert.equal(r.body.inferenceDetection.rules.length, 3)
      assert.equal(typeof r.body.myCustomQueries.paused, 'boolean')
    })

    test('only ADMIN', async () => {
      for (const role of ['PATIENT', 'CLINICIAN', 'SECURITY_ADMIN']) {
        assert.equal((await get('/api/analytics/privacy', tokens[role])).status, 403, role)
      }
    })
  })
})
