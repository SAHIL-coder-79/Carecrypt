// Clinician dashboard APIs: profile, patient search, reference data
// and adding a visit.
//
// Visits are added to CC-000002 (Dr. Ranade has FULL_RECORD consent; the patient
// has a severe penicillin allergy). Other suites do not count CC-000002's visits.

import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { auditCount, PASSWORD, query, skipReason, startServer, userId, USERS } from './helpers.js'

const QUR = 'dr.farhan.qureshi@carecrypt.example'
const IYER = 'dr.shalini.iyer@carecrypt.example'

const skip = await skipReason()

describe('clinician dashboard APIs', { skip }, () => {
  let server
  let api
  const tokens = {}
  const ids = {}

  before(async () => {
    server = await startServer()
    api = server.api
    Object.assign(tokens, await api.tokensForAllRoles())
    tokens.qureshi = (await (await api.login(QUR, PASSWORD)).json()).token
    tokens.iyer = (await (await api.login(IYER, PASSWORD)).json()).token
    const { rows } = await query('SELECT mrn, id FROM clinical.patients')
    for (const r of rows) ids[r.mrn] = r.id
  })

  after(async () => {
    await server?.close()
  })

  const post = (path, tok, body) =>
    api.raw({
      method: 'POST',
      path,
      headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => ({ status: r.status, body: r.body ? JSON.parse(r.body) : null }))

  describe('GET /api/clinicians/me', () => {
    test('returns profile, facility, stats and recent patients', async () => {
      const res = await api.get('/api/clinicians/me', tokens.CLINICIAN)
      assert.equal(res.status, 200)
      const body = await res.json()
      assert.equal(body.clinician.name, 'Dr. Aditi Ranade')
      assert.equal(body.clinician.registrationNumber, 'DEMO-MMC-10001')
      assert.equal(body.clinician.facility.district, 'Pune')
      const { rows } = await query(
        `SELECT count(*)::int AS n FROM clinical.visits v
           JOIN clinical.clinicians c ON c.id = v.clinician_id WHERE c.registration_number = 'DEMO-MMC-10001'`,
      )
      assert.equal(body.stats.visitsTotal, rows[0].n)
      assert.ok(body.stats.consentedPatients >= 6)
      assert.ok(body.recentPatients.length > 0 && body.recentPatients.length <= 5)
    })

    for (const role of ['ADMIN', 'SECURITY_ADMIN', 'PATIENT']) {
      test(`${role} → 403`, async () => {
        assert.equal((await api.get('/api/clinicians/me', tokens[role])).status, 403)
      })
    }
  })

  describe('patient search', () => {
    test('finds consented patients by name or MRN', async () => {
      const byName = await (await api.get('/api/patients?search=meera', tokens.CLINICIAN)).json()
      assert.deepEqual(byName.patients.map((p) => p.mrn), ['CC-000003'])
      const byMrn = await (await api.get('/api/patients?search=CC-000004', tokens.CLINICIAN)).json()
      assert.deepEqual(byMrn.patients.map((p) => p.mrn), ['CC-000004'])
    })

    test('never finds a patient without consent, even by exact name or MRN', async () => {
      // Pooja Wagh (CC-000009, Nashik) has no consent for Dr. Ranade.
      for (const q of ['Pooja Wagh', 'CC-000009', 'wagh']) {
        const { patients } = await (await api.get(`/api/patients?search=${encodeURIComponent(q)}`, tokens.CLINICIAN)).json()
        assert.equal(patients.length, 0, q)
      }
    })

    test('wildcard characters are treated literally', async () => {
      const { patients } = await (await api.get('/api/patients?search=%25', tokens.CLINICIAN)).json()
      assert.equal(patients.length, 0)
    })
  })

  describe('GET /api/reference', () => {
    test('clinicians get the catalogues', async () => {
      const body = await (await api.get('/api/reference', tokens.CLINICIAN)).json()
      assert.ok(body.symptoms.some((s) => s.code === 'fever'))
      assert.ok(body.conditions.some((c) => c.code === 'A90'))
      assert.ok(body.medications.some((m) => m.code === 'amoxicillin' && m.drugClass === 'PENICILLIN'))
    })

    test('ADMIN → 403', async () => {
      assert.equal((await api.get('/api/reference', tokens.ADMIN)).status, 403)
    })
  })

  describe('POST /api/patients/:id/visits', () => {
    const validVisit = () => ({
      visitType: 'OPD',
      chiefComplaint: 'Cough and fever for 2 days',
      notes: 'Synthetic test visit.',
      vitals: { temperatureC: 38.4, pulseBpm: 96, systolic: 122, diastolic: 78, respiratoryRate: 18, spo2Percent: 97 },
      symptoms: [
        { code: 'cough', severity: 'MODERATE', durationDays: 2 },
        { code: 'fever', severity: 'MODERATE', durationDays: 2 },
      ],
      diagnoses: [{ code: 'J06.9', type: 'CONFIRMED', isPrimary: true }],
      clinicianAttestation: true,
      medications: [{ code: 'paracetamol', dose: '500 mg', frequency: 'Three times a day', durationDays: 3 }],
    })
    const path = () => `/api/patients/${ids['CC-000002']}/visits`

    test('creates the visit and returns it (201)', async () => {
      const res = await post(path(), tokens.CLINICIAN, validVisit())
      assert.equal(res.status, 201)
      const { visit } = res.body
      assert.equal(visit.chiefComplaint, 'Cough and fever for 2 days')
      assert.equal(visit.clinician.name, 'Dr. Aditi Ranade')
      assert.equal(visit.facility.name, 'Kothrud Urban Health Centre (Demo)')
      assert.equal(visit.vitals.temperatureC, 38.4)
      assert.deepEqual(visit.vitals.bloodPressure, { systolic: 122, diastolic: 78 })
      assert.deepEqual(visit.symptoms.map((s) => s.code).sort(), ['cough', 'fever'])
      assert.equal(visit.diagnoses[0].code, 'J06.9')
      assert.equal(visit.medications[0].code, 'paracetamol')

      const record = await (await api.get(`/api/patients/${ids['CC-000002']}`, tokens.CLINICIAN)).json()
      assert.equal(record.patient.visitHistory[0].id, visit.id, 'newest visit is first in the record')
    })

    test('the creation is audited against the patient', async () => {
      const id = await userId(USERS.CLINICIAN)
      const where = `action = 'VISIT_CREATE' AND outcome = 'SUCCESS' AND user_id = $1 AND patient_id = $2`
      const before = await auditCount(where, [id, ids['CC-000002']])
      await post(path(), tokens.CLINICIAN, validVisit())
      assert.equal(await auditCount(where, [id, ids['CC-000002']]), before + 1)
    })

    test('prescribing a drug the patient is allergic to → 409 ALLERGY_CONFLICT, nothing saved', async () => {
      const count = async () => (await query('SELECT count(*)::int n FROM clinical.visits WHERE patient_id = $1', [ids['CC-000002']])).rows[0].n
      const before = await count()
      const body = validVisit()
      body.medications.push({ code: 'amoxicillin', dose: '500 mg', frequency: 'Three times a day', durationDays: 5 })
      const res = await post(path(), tokens.CLINICIAN, body)
      assert.equal(res.status, 409)
      assert.equal(res.body.error, 'ALLERGY_CONFLICT')
      assert.deepEqual(res.body.conflicts.map((c) => [c.medication, c.allergen]), [['amoxicillin', 'Penicillin']])
      assert.equal(await count(), before)
    })

    test('invalid input → 400 VALIDATION_FAILED with field details', async () => {
      const body = validVisit()
      body.chiefComplaint = ''
      body.vitals.systolic = 70
      body.diagnoses = [{ code: 'J06.9', type: 'DIFFERENTIAL', isPrimary: true }]
      const res = await post(path(), tokens.CLINICIAN, body)
      assert.equal(res.status, 400)
      assert.equal(res.body.error, 'VALIDATION_FAILED')
      const fields = res.body.details.map((d) => d.field)
      assert.ok(fields.includes('chiefComplaint'))
      assert.ok(fields.includes('vitals'))
      assert.ok(fields.includes('diagnoses[0].type'))
    })

    test('unknown catalogue codes → 400', async () => {
      const body = validVisit()
      body.symptoms.push({ code: 'made_up_symptom' })
      body.medications = [{ code: 'unobtainium', dose: '1', frequency: 'daily' }]
      const res = await post(path(), tokens.CLINICIAN, body)
      assert.equal(res.status, 400)
      const fields = res.body.details.map((d) => d.field)
      assert.ok(fields.includes('symptoms[2].code') && fields.includes('medications[0].code'))
    })

    test('a visit dated in the future → 400', async () => {
      const body = { ...validVisit(), visitAt: new Date(Date.now() + 86_400_000).toISOString() }
      assert.equal((await post(path(), tokens.CLINICIAN, body)).status, 400)
    })

    test('SUMMARY_ONLY consent cannot add visits (403 CONSENT_SCOPE_INSUFFICIENT)', async () => {
      const res = await post(`/api/patients/${ids['CC-000016']}/visits`, tokens.qureshi, validVisit())
      assert.equal(res.status, 403)
      assert.equal(res.body.reason, 'CONSENT_SCOPE_INSUFFICIENT')
    })

    test('no consent → 403 NO_ACTIVE_CONSENT, audited as VISIT_CREATE', async () => {
      const id = await userId(IYER)
      const where = `action = 'VISIT_CREATE' AND outcome = 'DENIED' AND user_id = $1`
      const before = await auditCount(where, [id])
      const res = await post(path(), tokens.iyer, validVisit())
      assert.equal(res.status, 403)
      assert.equal(res.body.reason, 'NO_ACTIVE_CONSENT')
      assert.equal(await auditCount(where, [id]), before + 1)
    })

    test('PATIENT, ADMIN and SECURITY_ADMIN cannot add visits (403 by role)', async () => {
      for (const role of ['PATIENT', 'ADMIN', 'SECURITY_ADMIN']) {
        const res = await post(`/api/patients/${ids['CC-000001']}/visits`, tokens[role], validVisit())
        assert.equal(res.status, 403, role)
        assert.equal(res.body.resource, 'PATIENT_RECORD_WRITE')
      }
    })
  })
})
