// Clinical visit workflow:
//   symptoms → vitals → SmartCare decision support → clinician review →
//   assessment → medication → notes → explicit confirmation → save
//
// Uses Dr. Ranade with CC-000005 (Pune) and CC-000003, Dr. Qureshi with CC-000001,
// Dr. Jadhav with CC-000012 (opted out of analytics).
// The aggregate-analytics test needs ANALYTICS_DATABASE_URL (the carecrypt_analytics
// login) and is skipped without it.

import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import pg from 'pg'
import { auditCount, PASSWORD, query, skipReason, startServer, userId, USERS } from './helpers.js'

const QUR = 'dr.farhan.qureshi@carecrypt.example'
const JADHAV = 'dr.prakash.jadhav@carecrypt.example'
const analyticsUrl = process.env.ANALYTICS_DATABASE_URL

const skip = await skipReason()

describe('clinical visit workflow', { skip }, () => {
  let server
  let api
  const tokens = {}
  const ids = {}

  before(async () => {
    server = await startServer()
    api = server.api
    Object.assign(tokens, await api.tokensForAllRoles())
    tokens.qureshi = (await (await api.login(QUR, PASSWORD)).json()).token
    tokens.jadhav = (await (await api.login(JADHAV, PASSWORD)).json()).token
    const { rows } = await query('SELECT mrn, id FROM clinical.patients')
    for (const r of rows) ids[r.mrn] = r.id
  })

  after(async () => {
    await server?.close()
  })

  const post = (path, tok, body) =>
    api
      .raw({
        method: 'POST',
        path,
        headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      .then((r) => ({ status: r.status, body: r.body ? JSON.parse(r.body) : null }))

  const symptoms = [
    { code: 'dysuria', severity: 'MODERATE', durationDays: 2 },
    { code: 'frequency', severity: 'MODERATE', durationDays: 2 },
    { code: 'fever', severity: 'MILD', durationDays: 1 },
  ]
  const runSmartCare = (tok, mrn) =>
    post('/api/smartcare/analyze', tok, { patientId: ids[mrn], currentSymptoms: symptoms, vitals: { temperatureC: 37.9 } })
  const visitBody = (extra = {}) => ({
    visitType: 'OPD',
    chiefComplaint: 'Burning urination for 2 days',
    symptoms,
    vitals: { temperatureC: 37.9, pulseBpm: 88, systolic: 118, diastolic: 76 },
    diagnoses: [{ code: 'N39.0', type: 'CONFIRMED', isPrimary: true }],
    medications: [{ code: 'nitrofurantoin', dose: '100 mg', frequency: 'Twice a day', durationDays: 5 }],
    notes: 'Dipstick nitrite positive. Fluids advised.',
    clinicianAttestation: true,
    ...extra,
  })
  const visitCount = async (mrn) =>
    (await query('SELECT count(*)::int n FROM clinical.visits WHERE patient_id = $1', [ids[mrn]])).rows[0].n
  const diagnosisCount = async (mrn) =>
    (
      await query(
        `SELECT count(*)::int n FROM clinical.visit_diagnoses d JOIN clinical.visits v ON v.id = d.visit_id WHERE v.patient_id = $1`,
        [ids[mrn]],
      )
    ).rows[0].n

  describe('SmartCare never creates a diagnosis', () => {
    test('running SmartCare adds no visit and no diagnosis', async () => {
      const [v0, d0] = [await visitCount('CC-000005'), await diagnosisCount('CC-000005')]
      const res = await runSmartCare(tokens.CLINICIAN, 'CC-000005')
      assert.equal(res.status, 200)
      assert.match(res.body.analysisId, /^[0-9a-f-]{36}$/)
      assert.equal(await visitCount('CC-000005'), v0)
      assert.equal(await diagnosisCount('CC-000005'), d0)
    })

    test('a stored SmartCare run holds codes and levels only, and is unlinked until reviewed', async () => {
      const { body } = await runSmartCare(tokens.CLINICIAN, 'CC-000005')
      const { rows } = await query('SELECT * FROM clinical.decision_support_runs WHERE id = $1', [body.analysisId])
      assert.equal(rows[0].visit_id, null)
      assert.equal(rows[0].reviewed_at, null)
      assert.deepEqual(rows[0].symptom_codes, ['dysuria', 'frequency', 'fever'])
      assert.ok(rows[0].suggested_conditions.every((c) => Object.keys(c).sort().join() === 'code,name,strength'))
    })
  })

  describe('explicit clinical assessment', () => {
    test('a visit without the clinician confirmation is refused (400) and nothing is saved', async () => {
      const before = await visitCount('CC-000005')
      for (const attestation of [undefined, false, 'yes']) {
        const res = await post(`/api/patients/${ids['CC-000005']}/visits`, tokens.CLINICIAN, visitBody({ clinicianAttestation: attestation }))
        assert.equal(res.status, 400, String(attestation))
        assert.ok(res.body.details.some((d) => d.field === 'clinicianAttestation'))
      }
      assert.equal(await visitCount('CC-000005'), before)
    })

    test('a visit without any diagnosis is refused: the assessment is required', async () => {
      const res = await post(`/api/patients/${ids['CC-000005']}/visits`, tokens.CLINICIAN, visitBody({ diagnoses: [] }))
      assert.equal(res.status, 400)
      assert.ok(res.body.details.some((d) => d.field === 'diagnoses'))
    })
  })

  describe('full workflow with reviewed decision support', () => {
    let saved
    let analysisId

    test('symptoms + vitals → SmartCare → review → clinician assessment → save (201)', async () => {
      const analysis = await runSmartCare(tokens.CLINICIAN, 'CC-000005')
      analysisId = analysis.body.analysisId
      assert.equal(analysis.body.label, 'Clinical Decision Support')

      // The clinician records their own assessment; here it differs from SmartCare's list.
      const res = await post(
        `/api/patients/${ids['CC-000005']}/visits`,
        tokens.CLINICIAN,
        visitBody({ decisionSupport: { analysisId, reviewed: true } }),
      )
      assert.equal(res.status, 201)
      saved = res.body.visit
      assert.deepEqual(saved.diagnoses.map((d) => [d.code, d.type]), [['N39.0', 'CONFIRMED']])
      assert.equal(saved.assessment.confirmedBy, 'Dr. Aditi Ranade')
      assert.ok(saved.assessment.confirmedAt)
      assert.equal(saved.decisionSupport.label, 'Clinical Decision Support')
      assert.equal(saved.decisionSupport.analysisId, analysisId)
      assert.ok(saved.decisionSupport.reviewedAt)
      assert.ok(saved.decisionSupport.suggestedConditions.length > 0)
    })

    test('the visit becomes part of the longitudinal record, newest first', async () => {
      const { patient } = await (await api.get(`/api/patients/${ids['CC-000005']}`, tokens.CLINICIAN)).json()
      assert.equal(patient.visitHistory[0].id, saved.id)
      assert.equal(patient.visitHistory[0].decisionSupport.analysisId, analysisId)
      assert.ok(patient.medications.active.some((m) => m.code === 'nitrofurantoin'))
      assert.ok(patient.recentActivity.some((e) => e.type === 'VISIT' && e.visitId === saved.id))
    })

    test('the same SmartCare run cannot be linked to a second visit', async () => {
      const res = await post(
        `/api/patients/${ids['CC-000005']}/visits`,
        tokens.CLINICIAN,
        visitBody({ decisionSupport: { analysisId, reviewed: true } }),
      )
      assert.equal(res.status, 400)
      assert.ok(res.body.details.some((d) => d.field === 'decisionSupport.analysisId'))
    })

    test('the save is audited with the confirmation and the linked analysis', async () => {
      const { rows } = await query(
        `SELECT metadata FROM audit.audit_logs WHERE action = 'VISIT_CREATE' AND resource_id = $1`,
        [saved.id],
      )
      assert.equal(rows.length, 1)
      assert.equal(rows[0].metadata.clinician_attested, true)
      assert.equal(rows[0].metadata.decision_support_analysis_id, analysisId)
      assert.deepEqual(rows[0].metadata.diagnoses, ['N39.0'])
    })
  })

  describe('decision-support links are checked', () => {
    test('decision support must be marked reviewed', async () => {
      const { body } = await runSmartCare(tokens.CLINICIAN, 'CC-000005')
      const res = await post(
        `/api/patients/${ids['CC-000005']}/visits`,
        tokens.CLINICIAN,
        visitBody({ decisionSupport: { analysisId: body.analysisId, reviewed: false } }),
      )
      assert.equal(res.status, 400)
      assert.ok(res.body.details.some((d) => d.field === 'decisionSupport.reviewed'))
    })

    test("an analysis of another patient is refused and the visit is rolled back", async () => {
      const { body } = await runSmartCare(tokens.CLINICIAN, 'CC-000003')
      const before = await visitCount('CC-000005')
      const res = await post(
        `/api/patients/${ids['CC-000005']}/visits`,
        tokens.CLINICIAN,
        visitBody({ decisionSupport: { analysisId: body.analysisId, reviewed: true } }),
      )
      assert.equal(res.status, 400)
      assert.equal(await visitCount('CC-000005'), before, 'transaction rolled back')
    })

    test("another clinician's analysis is refused", async () => {
      const { body } = await runSmartCare(tokens.qureshi, 'CC-000001')
      const res = await post(
        `/api/patients/${ids['CC-000001']}/visits`,
        tokens.CLINICIAN,
        visitBody({ decisionSupport: { analysisId: body.analysisId, reviewed: true } }),
      )
      assert.equal(res.status, 400)
    })

    test('an unknown analysis id is refused', async () => {
      const res = await post(
        `/api/patients/${ids['CC-000005']}/visits`,
        tokens.CLINICIAN,
        visitBody({ decisionSupport: { analysisId: '00000000-0000-4000-8000-000000000000', reviewed: true } }),
      )
      assert.equal(res.status, 400)
    })
  })

  describe('aggregate analytics', { skip: analyticsUrl ? false : 'set ANALYTICS_DATABASE_URL to run' }, () => {
    let analytics

    before(async () => {
      analytics = new pg.Client({ connectionString: analyticsUrl })
      await analytics.connect()
    })
    after(async () => {
      await analytics?.end()
    })

    const cell = async (district, code) => {
      const { rows } = await analytics.query(
        `SELECT patient_count, is_suppressed FROM analytics.condition_monthly_by_district
          WHERE month = date_trunc('month', now())::date AND district = $1 AND condition_code = $2`,
        [district, code],
      )
      return rows[0] ?? null
    }

    test('a saved visit appears in the de-identified aggregates at once (suppressed below the minimum group)', async () => {
      const row = await cell('Pune', 'N39.0')
      assert.ok(row, 'the new UTI visit in Pune is counted this month')
      assert.equal(row.is_suppressed, true)
      assert.equal(row.patient_count, null, 'below the minimum group size: the count is hidden')
    })

    test('a patient who opted out is not counted', async () => {
      const before = await cell('Nashik', 'M54.5')
      const res = await post(`/api/patients/${ids['CC-000012']}/visits`, tokens.jadhav, {
        chiefComplaint: 'Low back pain after lifting',
        symptoms: [{ code: 'back_pain', severity: 'MODERATE', durationDays: 3 }],
        diagnoses: [{ code: 'M54.5', type: 'CONFIRMED', isPrimary: true }],
        clinicianAttestation: true,
      })
      assert.equal(res.status, 201)
      assert.deepEqual(await cell('Nashik', 'M54.5'), before)
    })

    test('the analytics login still cannot read visits directly', async () => {
      await assert.rejects(analytics.query('SELECT count(*) FROM clinical.visits'), /permission denied/)
    })
  })

  test('PATIENT, ADMIN and SECURITY_ADMIN cannot save visits (403)', async () => {
    for (const role of ['PATIENT', 'ADMIN', 'SECURITY_ADMIN']) {
      const res = await post(`/api/patients/${ids['CC-000001']}/visits`, tokens[role], visitBody())
      assert.equal(res.status, 403, role)
    }
    const uid = await userId(USERS.ADMIN)
    assert.ok((await auditCount(`action = 'ACCESS_DENIED' AND user_id = $1`, [uid])) > 0)
  })
})
