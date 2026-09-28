// Longitudinal patient record API: who may read what.
//
// Consent facts from database/seed.sql used below:
//   Dr. Ranade  → CC-000001, CC-000002, CC-000003: FULL_RECORD (she treated them)
//   Dr. Qureshi → CC-000001: VISIT_HISTORY (patient-portal grant)
//   Dr. Qureshi → CC-000016: SUMMARY_ONLY (tele-referral)
//   Dr. Qureshi → CC-000005: SUMMARY_ONLY, expired
//   Dr. Desai   → CC-000022: revoked
//   Dr. Iyer    → CC-000001: never granted

import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { auditCount, PASSWORD, query, skipReason, startServer, userId, USERS } from './helpers.js'

const DOCTORS = {
  ranade: USERS.CLINICIAN,
  qureshi: 'dr.farhan.qureshi@carecrypt.example',
  iyer: 'dr.shalini.iyer@carecrypt.example',
  desai: 'dr.ravi.desai@carecrypt.example',
}
const SECTIONS = ['', '/visits', '/medications', '/conditions']

const skip = await skipReason()

describe('patient record API', { skip }, () => {
  let server
  let api
  const tokens = {}
  const ids = {}

  before(async () => {
    server = await startServer()
    api = server.api
    Object.assign(tokens, await api.tokensForAllRoles())
    for (const [name, email] of Object.entries(DOCTORS)) {
      tokens[name] = (await (await api.login(email, PASSWORD)).json()).token
    }
    const { rows } = await query(`SELECT mrn, id FROM clinical.patients`)
    for (const r of rows) ids[r.mrn] = r.id
  })

  after(async () => {
    await server?.close()
  })

  const record = (mrn, token, section = '') => api.get(`/api/patients/${ids[mrn]}${section}`, token)

  describe('ADMIN and SECURITY_ADMIN never receive patient data', () => {
    for (const role of ['ADMIN', 'SECURITY_ADMIN']) {
      test(`${role} gets 403 on the list and every record endpoint, with no patient fields`, async () => {
        const paths = ['/api/patients', ...SECTIONS.map((s) => `/api/patients/${ids['CC-000001']}${s}`)]
        for (const path of paths) {
          const res = await api.get(path, tokens[role])
          assert.equal(res.status, 403, path)
          const text = await res.text()
          assert.deepEqual(JSON.parse(text), {
            error: 'FORBIDDEN',
            role,
            resource: 'PATIENT_RECORD',
            access: 'DENIED',
          })
          assert.ok(!/Ananya|Deshmukh|CC-0000|dengue|1991/i.test(text), `${path} leaked data`)
        }
      })
    }

    test('ADMIN is refused by role before any patient lookup (even for invalid ids)', async () => {
      assert.equal((await api.get('/api/patients/not-a-uuid', tokens.ADMIN)).status, 403)
      assert.equal((await api.get('/api/patients/00000000-0000-4000-8000-000000000000', tokens.ADMIN)).status, 403)
    })

    test('ADMIN refusals are audited against the targeted patient and never as a record view', async () => {
      const adminId = await userId(USERS.ADMIN)
      const denied = `action = 'ACCESS_DENIED' AND user_id = $1 AND resource_id = 'PATIENT_RECORD' AND patient_id = $2`
      const views = `action = 'PATIENT_RECORD_VIEW' AND user_id = $1 AND outcome = 'SUCCESS'`
      const [d0, v0] = [await auditCount(denied, [adminId, ids['CC-000001']]), await auditCount(views, [adminId])]
      await record('CC-000001', tokens.ADMIN)
      assert.equal(await auditCount(denied, [adminId, ids['CC-000001']]), d0 + 1)
      assert.equal(await auditCount(views, [adminId]), v0)
    })

    test("the patient can see that an ADMIN was blocked from their record", async () => {
      await record('CC-000001', tokens.ADMIN)
      const { patient } = await (await record('CC-000001', tokens.PATIENT)).json()
      const blocked = patient.recentActivity.filter((e) => e.type === 'ACCESS_DENIED')
      assert.ok(blocked.some((e) => e.title.includes('Priya Admin') && e.detail.startsWith('ADMIN')))
    })

    test('no token → 401', async () => {
      for (const s of SECTIONS) assert.equal((await record('CC-000001', null, s)).status, 401)
      assert.equal((await api.get('/api/patients')).status, 401)
    })
  })

  describe('CLINICIAN with FULL_RECORD consent', () => {
    test('gets the full longitudinal structure', async () => {
      const res = await record('CC-000003', tokens.ranade)
      assert.equal(res.status, 200)
      assert.equal(res.headers.get('cache-control'), 'no-store')
      const { patient, access } = await res.json()

      assert.deepEqual(access.via, 'CONSENT')
      assert.equal(access.scope, 'FULL_RECORD')
      assert.deepEqual(Object.keys(patient), [
        'id', 'mrn', 'demographics', 'allergies', 'chronicConditions', 'medications', 'visitHistory', 'recentActivity',
      ])
      assert.equal(patient.mrn, 'CC-000003')
      assert.equal(patient.demographics.fullName, 'Meera Joshi')
      assert.equal(patient.demographics.dateOfBirth, '1958-11-02')
      assert.ok(patient.demographics.contact, 'contact details included')
      assert.ok(patient.demographics.location.addressLine)
      assert.deepEqual(patient.chronicConditions.map((c) => c.code).sort(), ['E11.9', 'I10'])
    })

    test('visit history is newest first with date, symptoms, vitals, diagnosis, medication and notes', async () => {
      const { patient } = await (await record('CC-000003', tokens.ranade)).json()
      const visits = patient.visitHistory
      assert.equal(visits.length, 5)
      const dates = visits.map((v) => v.date)
      assert.deepEqual(dates, [...dates].sort().reverse())
      for (const v of visits) {
        assert.ok(v.date && v.clinician.name && v.facility.name)
        assert.ok(v.symptoms.length > 0)
        assert.equal(typeof v.vitals.temperatureC, 'number')
        assert.ok(v.vitals.bloodPressure.systolic > v.vitals.bloodPressure.diastolic)
        assert.equal(v.diagnoses.filter((d) => d.isPrimary).length, 1)
        assert.ok(v.medications.length > 0)
        assert.equal(typeof v.notes, 'string')
      }
      assert.equal(visits[0].diagnoses[0].code, 'A90') // dengue, Sep 2026
    })

    test('active medications are exactly the prescriptions whose course has not ended', async () => {
      const { patient } = await (await record('CC-000003', tokens.ranade)).json()
      const now = new Date().toISOString()
      const { active, history } = patient.medications
      assert.ok(history.length >= active.length)
      for (const m of active) assert.ok(m.endsAt > now, `${m.code} should still be running`)
      const running = new Set(history.filter((m) => m.endsAt && m.endsAt > now).map((m) => m.code))
      assert.deepEqual(new Set(active.map((m) => m.code)), running)
    })

    test('allergies are included', async () => {
      const { patient } = await (await record('CC-000002', tokens.ranade)).json()
      assert.deepEqual(
        patient.allergies.map((a) => [a.allergen, a.severity]),
        [['Penicillin', 'SEVERE']],
      )
    })

    test('recent activity is newest first and has no access-log entries for clinicians', async () => {
      const { patient } = await (await record('CC-000003', tokens.ranade)).json()
      const events = patient.recentActivity
      assert.ok(events.length > 0 && events.length <= 12)
      assert.deepEqual(events.map((e) => e.at), events.map((e) => e.at).sort().reverse())
      assert.ok(events.some((e) => e.type === 'VISIT'))
      assert.ok(!events.some((e) => e.type === 'RECORD_ACCESSED' || e.type === 'ACCESS_DENIED'))
    })

    test('the sub-resources return the same data on their own', async () => {
      const visits = await (await record('CC-000003', tokens.ranade, '/visits')).json()
      assert.equal(visits.visits.length, 5)
      const limited = await (await api.get(`/api/patients/${ids['CC-000003']}/visits?limit=2`, tokens.ranade)).json()
      assert.equal(limited.visits.length, 2)

      const meds = await (await record('CC-000003', tokens.ranade, '/medications')).json()
      assert.ok(Array.isArray(meds.active) && Array.isArray(meds.history))

      const conditions = await (await record('CC-000003', tokens.ranade, '/conditions')).json()
      assert.deepEqual(conditions.chronicConditions.map((c) => c.code).sort(), ['E11.9', 'I10'])
      assert.ok(conditions.diagnosisHistory.some((d) => d.code === 'A90'))
    })

    test('a successful view is audited with the patient id and consent scope', async () => {
      const id = await userId(DOCTORS.ranade)
      const where = `action = 'PATIENT_RECORD_VIEW' AND outcome = 'SUCCESS' AND user_id = $1 AND patient_id = $2`
      const before = await auditCount(where, [id, ids['CC-000003']])
      await record('CC-000003', tokens.ranade)
      assert.equal(await auditCount(where, [id, ids['CC-000003']]), before + 1)
      const { rows } = await query(
        `SELECT metadata FROM audit.audit_logs WHERE ${where} ORDER BY chain_seq DESC LIMIT 1`,
        [id, ids['CC-000003']],
      )
      assert.deepEqual(rows[0].metadata, { section: 'record', via: 'CONSENT', scope: 'FULL_RECORD' })
    })
  })

  describe('narrower consent scopes', () => {
    test('VISIT_HISTORY: visits included, contact details and address removed', async () => {
      const { patient, access } = await (await record('CC-000001', tokens.qureshi)).json()
      assert.equal(access.scope, 'VISIT_HISTORY')
      assert.equal(patient.demographics.contact, undefined)
      assert.equal(patient.demographics.emergencyContact, undefined)
      assert.equal(patient.demographics.location.addressLine, undefined)
      assert.equal(patient.visitHistory.length, 4)
      assert.ok(Array.isArray(patient.medications.history))
    })

    test('SUMMARY_ONLY: allergies, conditions and active medications, but no visits', async () => {
      const res = await record('CC-000016', tokens.qureshi)
      assert.equal(res.status, 200)
      const { patient, access } = await res.json()
      assert.equal(access.scope, 'SUMMARY_ONLY')
      assert.equal(patient.visitHistory, null)
      assert.equal(patient.medications.history, null)
      assert.ok(Array.isArray(patient.medications.active))
      assert.deepEqual(patient.chronicConditions.map((c) => c.code).sort(), ['E78.5', 'I10'])
      assert.ok(!patient.recentActivity.some((e) => e.type === 'VISIT'))

      const conditions = await (await record('CC-000016', tokens.qureshi, '/conditions')).json()
      assert.equal(conditions.diagnosisHistory, null)
    })

    test('SUMMARY_ONLY cannot open /visits (403 CONSENT_SCOPE_INSUFFICIENT)', async () => {
      const res = await record('CC-000016', tokens.qureshi, '/visits')
      assert.equal(res.status, 403)
      assert.equal((await res.json()).reason, 'CONSENT_SCOPE_INSUFFICIENT')
    })
  })

  describe('CLINICIAN without an active consent', () => {
    const cases = [
      ['never granted', 'iyer', 'CC-000001'],
      ['revoked', 'desai', 'CC-000022'],
      ['expired', 'qureshi', 'CC-000005'],
      ['different city, no relationship', 'ranade', 'CC-000009'],
    ]
    for (const [label, doctor, mrn] of cases) {
      test(`${label}: 403 NO_ACTIVE_CONSENT on every endpoint, no data`, async () => {
        for (const s of SECTIONS) {
          const res = await record(mrn, tokens[doctor], s)
          assert.equal(res.status, 403, `${mrn}${s}`)
          const body = await res.json()
          assert.deepEqual(body, {
            error: 'FORBIDDEN',
            role: 'CLINICIAN',
            resource: 'PATIENT_RECORD',
            access: 'DENIED',
            reason: 'NO_ACTIVE_CONSENT',
          })
        }
      })
    }

    test('an unknown patient id looks the same as a non-consented one (no existence leak)', async () => {
      const res = await api.get('/api/patients/7f1c2a9e-0000-4000-8000-000000000000', tokens.ranade)
      assert.equal(res.status, 403)
      assert.equal((await res.json()).reason, 'NO_ACTIVE_CONSENT')
    })

    test('a malformed id is a 400', async () => {
      assert.equal((await api.get('/api/patients/123', tokens.ranade)).status, 400)
      assert.equal((await api.get("/api/patients/1' OR '1'='1", tokens.ranade)).status, 400)
    })

    test('the refusal is audited against the patient', async () => {
      const id = await userId(DOCTORS.iyer)
      const where = `action = 'PATIENT_RECORD_VIEW' AND outcome = 'DENIED' AND user_id = $1 AND patient_id = $2 AND reason = 'NO_ACTIVE_CONSENT'`
      const before = await auditCount(where, [id, ids['CC-000001']])
      await record('CC-000001', tokens.iyer)
      assert.equal(await auditCount(where, [id, ids['CC-000001']]), before + 1)
    })
  })

  describe('PATIENT', () => {
    test('can read their own full record, including who accessed it', async () => {
      const res = await record('CC-000001', tokens.PATIENT)
      assert.equal(res.status, 200)
      const { patient, access } = await res.json()
      assert.deepEqual([access.via, access.scope], ['SELF', 'FULL_RECORD'])
      assert.equal(patient.demographics.fullName, 'Ananya Deshmukh')
      assert.ok(patient.demographics.contact)
      assert.equal(patient.visitHistory.length, 4)
      const types = new Set(patient.recentActivity.map((e) => e.type))
      assert.ok(types.has('ACCESS_DENIED'), 'shows blocked attempts (seeded ADMIN and Dr. Iyer)')
      assert.ok(types.has('RECORD_ACCESSED'))
    })

    test('can use every own-record endpoint', async () => {
      for (const s of SECTIONS) assert.equal((await record('CC-000001', tokens.PATIENT, s)).status, 200, s)
    })

    test("cannot read another patient's record (403 NOT_OWN_RECORD)", async () => {
      for (const mrn of ['CC-000002', 'CC-000022']) {
        for (const s of SECTIONS) {
          const res = await record(mrn, tokens.PATIENT, s)
          assert.equal(res.status, 403)
          assert.equal((await res.json()).reason, 'NOT_OWN_RECORD')
        }
      }
    })
  })

  describe('GET /api/patients (who can I open?)', () => {
    test('a clinician sees only patients with an active consent to them', async () => {
      const { patients } = await (await api.get('/api/patients', tokens.ranade)).json()
      const mrns = patients.map((p) => p.mrn)
      assert.ok(mrns.includes('CC-000001') && mrns.includes('CC-000003'))
      assert.ok(!mrns.includes('CC-000009'), 'Nashik patient not listed')
      assert.ok(patients.every((p) => p.consentScope === 'FULL_RECORD'))
    })

    test('scope and visit dates follow consent (SUMMARY_ONLY has no last visit)', async () => {
      const { patients } = await (await api.get('/api/patients', tokens.qureshi)).json()
      const byMrn = Object.fromEntries(patients.map((p) => [p.mrn, p]))
      assert.equal(byMrn['CC-000016'].consentScope, 'SUMMARY_ONLY')
      assert.equal(byMrn['CC-000016'].lastVisitAt, null)
      assert.equal(byMrn['CC-000001'].consentScope, 'VISIT_HISTORY')
      assert.equal(byMrn['CC-000005'], undefined, 'expired consent not listed')
    })

    test('a revoked consent removes the patient from the list', async () => {
      const { patients } = await (await api.get('/api/patients', tokens.desai)).json()
      assert.ok(!patients.some((p) => p.mrn === 'CC-000022'))
    })

    test('a patient sees only themselves', async () => {
      const { patients } = await (await api.get('/api/patients', tokens.PATIENT)).json()
      assert.deepEqual(patients.map((p) => p.mrn), ['CC-000001'])
    })
  })
})
