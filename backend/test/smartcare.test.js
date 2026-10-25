// SmartCare Assist integration: POST /api/smartcare/analyze.
//
// Uses: Dr. Ranade (FULL_RECORD) → CC-000002 (penicillin allergy), CC-000003 (diabetes,
// hypertension), CC-000005; Dr. Qureshi (SUMMARY_ONLY) → CC-000016; Dr. Iyer (no consent) → CC-000001.
// Adds three visits to CC-000002 to create recent history.

import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { auditCount, PASSWORD, query, skipReason, startServer, userId, USERS } from './helpers.js'

const DISCLAIMER = 'Decision support only. Final clinical judgment remains with the clinician.'
const QUR = 'dr.farhan.qureshi@carecrypt.example'
const IYER = 'dr.shalini.iyer@carecrypt.example'

const skip = await skipReason()

describe('SmartCare Assist', { skip }, () => {
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
    api
      .raw({
        method: 'POST',
        path,
        headers: { ...(tok ? { Authorization: `Bearer ${tok}` } : {}), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      .then((r) => ({ status: r.status, body: r.body ? JSON.parse(r.body) : null, raw: r.body }))

  const analyze = (tok, mrn, extra = {}) =>
    post('/api/smartcare/analyze', tok, {
      patientId: ids[mrn],
      currentSymptoms: [
        { code: 'fever', severity: 'MODERATE', durationDays: 2 },
        { code: 'headache', severity: 'MODERATE', durationDays: 2 },
      ],
      ...extra,
    })

  describe('output', () => {
    test('is labelled Clinical Decision Support and carries the disclaimer', async () => {
      const res = await analyze(tokens.CLINICIAN, 'CC-000003')
      assert.equal(res.status, 200)
      assert.equal(res.body.label, 'Clinical Decision Support')
      assert.equal(res.body.disclaimer, DISCLAIMER)
      assert.equal(res.body.engine.name, 'SmartCare Assist')
      assert.equal(res.body.patientId, ids['CC-000003'])
      for (const key of ['possibleConditions', 'riskIndicators', 'recommendations']) {
        assert.ok(Array.isArray(res.body[key]), key)
      }
      assert.ok(res.body.possibleConditions.length > 0)
      assert.ok(['HIGH', 'MODERATE', 'LOW'].includes(res.body.overallRisk.level))
    })

    test('never claims a final diagnosis or guaranteed treatment', async () => {
      const res = await analyze(tokens.CLINICIAN, 'CC-000003')
      assert.doesNotMatch(res.raw, /final diagnosis|guaranteed|definitive|% confidence/i)
      assert.doesNotMatch(res.raw, /undefined/)
      for (const c of res.body.possibleConditions) {
        assert.ok(!('diagnosis' in c))
        assert.ok(['Strong symptom match', 'Partial symptom match', 'Weak symptom match'].includes(c.strength))
      }
      assert.ok(res.body.recommendations.every((r) => ['ACTION', 'INVESTIGATION', 'TREATMENT_OPTION'].includes(r.type)))
    })
  })

  describe('engine detail for the decision-support workspace', () => {
    test('returns the score breakdown, vital findings, maternal pathway and suggested actions', async () => {
      const res = await post('/api/smartcare/analyze', tokens.CLINICIAN, {
        patientId: ids['CC-000005'],
        currentSymptoms: [
          { code: 'headache', severity: 'SEVERE', durationDays: 2 },
          { code: 'swelling', severity: 'SEVERE', durationDays: 2 },
          { code: 'high_bp', severity: 'SEVERE', durationDays: 2 },
        ],
        vitals: { systolic: 162, diastolic: 104, pulseBpm: 96 },
        pregnant: true,
      })
      assert.equal(res.status, 200)
      const a = res.body.assessment
      assert.deepEqual(a.symptomsAnalysed, ['headache', 'swelling', 'high_bp'])
      assert.equal(a.severity, 'High')
      assert.equal(a.durationDays, 2)
      assert.ok(a.baseRiskScore >= 0 && a.baseRiskScore <= 100)
      assert.ok(a.vitalFindings.includes('Elevated blood pressure'))
      assert.ok(a.scoreBreakdown.every((r) => typeof r.factor === 'string' && typeof r.impact === 'number'))
      assert.equal(a.maternal.applicable, true, 'CC-000005 is female and marked pregnant')
      assert.ok(a.maternal.reasons.some((r) => /preeclampsia/i.test(r)))
      assert.ok(a.suggestedActions.length > 0)
      assert.doesNotMatch(JSON.stringify(a), /(maternal|action|escalation)\.[a-z_]+/, 'keys are turned into text')
    })

    test('pregnancy is ignored for a patient recorded as male', async () => {
      const res = await analyze(tokens.CLINICIAN, 'CC-000002', { pregnant: true })
      assert.equal(res.body.assessment.maternal.applicable, false)
    })
  })

  describe('context-aware analysis', () => {
    test('uses recorded chronic conditions and visit history', async () => {
      const { body } = await analyze(tokens.CLINICIAN, 'CC-000003')
      assert.deepEqual(body.contextUsed.chronicConditions.map((c) => c.code).sort(), ['E11.9', 'I10'])
      assert.ok(body.contextUsed.visitsConsidered >= 5)
      assert.ok(body.contextUsed.previousDiagnoses.some((d) => d.code === 'A90'))
      const history = body.riskIndicators.filter((r) => r.source === 'history').map((r) => r.message)
      assert.ok(history.some((m) => m.includes('Type 2 diabetes') && m.includes('factored into the risk score')))
      assert.ok(history.some((m) => m.includes('hypertension') && m.includes('factored into the risk score')))
    })

    test('flags a returning presentation and a persistent blood-pressure elevation', async () => {
      const visit = {
        visitType: 'OPD',
        chiefComplaint: 'Cough and fever',
        vitals: { temperatureC: 38.1, systolic: 150, diastolic: 95 },
        symptoms: [{ code: 'cough' }, { code: 'fever' }],
        diagnoses: [{ code: 'J06.9', type: 'CONFIRMED', isPrimary: true }],
        clinicianAttestation: true,
      }
      for (let i = 0; i < 3; i++) {
        const r = await post(`/api/patients/${ids['CC-000002']}/visits`, tokens.CLINICIAN, visit)
        assert.equal(r.status, 201)
      }
      const { body } = await analyze(tokens.CLINICIAN, 'CC-000002', {
        currentSymptoms: [{ code: 'cough' }, { code: 'fever' }],
        vitals: { systolic: 152, diastolic: 96 },
      })
      const messages = body.riskIndicators.filter((r) => r.source === 'visit_history')
      const returning = messages.find((m) => m.message.startsWith('Similar symptoms'))
      assert.ok(returning, 'returning presentation flagged')
      assert.equal(returning.level, 'HIGH')
      assert.match(returning.message, /Acute upper respiratory infection/)
      assert.ok(messages.some((m) => m.message.startsWith('Blood pressure elevated at this and the last 3')))
      const resp = body.possibleConditions.find((c) => c.code === 'respiratory_infection')
      assert.ok(resp.previouslyRecorded.some((d) => d.code === 'J06.9'), 'links to previous J06.9 diagnoses')
    })

    test('treatment options that clash with a recorded drug allergy carry a caution', async () => {
      const { body } = await analyze(tokens.CLINICIAN, 'CC-000002', {
        currentSymptoms: [{ code: 'fever' }, { code: 'cough' }, { code: 'breathlessness' }],
      })
      const antibiotics = body.recommendations.find((r) => r.type === 'TREATMENT_OPTION' && /antibiotic/i.test(r.text))
      assert.ok(antibiotics, 'antibiotic option suggested')
      assert.match(antibiotics.caution, /Penicillin/)
      assert.ok(body.riskIndicators.some((r) => r.source === 'allergy' && r.level === 'HIGH'))
      assert.deepEqual(body.contextUsed.allergies, ['Penicillin'])
    })

    test('clinician-reported history is used and shown as reported', async () => {
      const mild = { currentSymptoms: [{ code: 'sore_throat', severity: 'MILD' }, { code: 'runny_nose', severity: 'MILD' }] }
      const without = await analyze(tokens.CLINICIAN, 'CC-000005', mild)
      const withHistory = await analyze(tokens.CLINICIAN, 'CC-000005', { ...mild, relevantHistory: ['E11.9'] })
      assert.ok(withHistory.body.overallRisk.score > without.body.overallRisk.score)
      assert.deepEqual(withHistory.body.contextUsed.clinicianReported.history, ['E11.9'])
    })

    test('SUMMARY_ONLY consent: visit history is not used', async () => {
      const res = await analyze(tokens.qureshi, 'CC-000016')
      assert.equal(res.status, 200)
      assert.equal(res.body.contextUsed.consentScope, 'SUMMARY_ONLY')
      assert.equal(res.body.contextUsed.visitsConsidered, 0)
      assert.deepEqual(res.body.contextUsed.previousDiagnoses, [])
      assert.deepEqual(res.body.contextUsed.withheldByConsent, ['visit history', 'previous diagnoses'])
      assert.ok(res.body.contextUsed.chronicConditions.length > 0, 'summary data is still used')
    })

    test('incorporates verified lab observations and distinguishes pending unverified OCR extractions', async () => {
      // Clean previous test observations for isolation
      await query('DELETE FROM clinical.lab_observations WHERE patient_id = $1', [ids['CC-000003']])

      // 1. Upload a test lab report to CC-000003
      const { rows: docRows } = await query(
        `INSERT INTO clinical.medical_documents
           (patient_id, uploaded_by, document_type, original_file_name, mime_type, file_size_bytes, storage_key, sha256_checksum, status)
         VALUES ($1, $2, 'LAB_REPORT', 'lab_cbc.png', 'image/png', 1024, $3, $4, 'READY')
         RETURNING id`,
        [
          ids['CC-000003'],
          await userId(USERS.CLINICIAN),
          `storage_${Date.now()}_lab.png`,
          'a'.repeat(64),
        ],
      )
      const docId = docRows[0].id

      const { rows: ocrRows } = await query(
        `INSERT INTO clinical.document_ocr_runs
           (document_id, patient_id, engine_name, engine_version, status, page_count, recognized_text, confidence_score)
         VALUES ($1, $2, 'Tesseract.js', '7.0.0', 'READY', 1, 'Sample', 92.5)
         RETURNING id`,
        [docId, ids['CC-000003']],
      )
      const ocrId = ocrRows[0].id

      const { rows: extRows } = await query(
        `INSERT INTO clinical.document_extraction_runs
           (document_id, ocr_run_id, patient_id, panel_type, parser_version, status, observations_count)
         VALUES ($1, $2, $3, 'CBC', '1.0.0', 'READY', 2)
         RETURNING id`,
        [docId, ocrId, ids['CC-000003']],
      )
      const extId = extRows[0].id

      // Insert one VERIFIED observation (abnormal hemoglobin)
      await query(
        `INSERT INTO clinical.lab_observations
           (patient_id, document_id, ocr_run_id, extraction_run_id, panel_type, test_name, standard_code,
            value_numeric, value_text, unit, reference_range, reference_low, reference_high, is_abnormal,
            report_date, ocr_confidence, extraction_confidence, verification_status, verified_by, verified_at)
         VALUES ($1, $2, $3, $4, 'CBC', 'Hemoglobin', '718-7', 9.5, '9.5', 'g/dL', '12.0 - 17.5', 12.0, 17.5, true,
                 '2026-10-15', 94.0, 100.0, 'VERIFIED', $5, now())`,
        [ids['CC-000003'], docId, ocrId, extId, await userId(USERS.CLINICIAN)],
      )

      // Insert one UNVERIFIED observation (pending OCR extraction)
      await query(
        `INSERT INTO clinical.lab_observations
           (patient_id, document_id, ocr_run_id, extraction_run_id, panel_type, test_name, standard_code,
            value_numeric, value_text, unit, reference_range, reference_low, reference_high, is_abnormal,
            report_date, ocr_confidence, extraction_confidence, verification_status)
         VALUES ($1, $2, $3, $4, 'CBC', 'Platelet Count', '777-3', 280000, '280000', '/uL', '150000 - 450000', 150000, 450000, false,
                 '2026-10-15', 88.0, 100.0, 'UNVERIFIED')`,
        [ids['CC-000003'], docId, ocrId, extId],
      )

      const res = await analyze(tokens.CLINICIAN, 'CC-000003')
      assert.equal(res.status, 200)

      // 1. Transparent DCI heuristic labeling
      assert.ok(res.body.confidence.meaning)
      assert.ok(res.body.confidence.components)
      assert.ok(res.body.confidence.components.labEvidenceBonus > 0)

      // 2. Risk Indicators clearly differentiate verified lab evidence from pending unverified notices
      const labIndicators = res.body.riskIndicators.filter((r) => r.source === 'laboratory_verified')
      assert.ok(labIndicators.length > 0)
      assert.ok(labIndicators.some((i) => i.level === 'HIGH' && i.message.includes('Verified abnormal Hemoglobin: 9.5 g/dL')))
      assert.ok(labIndicators.some((i) => i.message.includes('Verified by attending clinician')))

      const unverifiedNotice = res.body.riskIndicators.find((r) => r.source === 'laboratory_unverified')
      assert.ok(unverifiedNotice)
      assert.ok(unverifiedNotice.message.includes('pending unverified OCR observation(s) exist on file'))
      assert.ok(unverifiedNotice.message.includes('excluded from clinical decision scoring until verified'))

      // 3. contextUsed summary includes verified labs and pending count
      assert.ok(res.body.contextUsed.verifiedLaboratoryObservations.length > 0)
      assert.equal(res.body.contextUsed.verifiedLaboratoryObservations[0].testName, 'Hemoglobin')
      assert.equal(res.body.contextUsed.pendingUnverifiedLabCount, 1)
    })
  })

  describe('authorization', () => {
    test('a clinician without consent → 403 NO_ACTIVE_CONSENT, no analysis', async () => {
      const res = await analyze(tokens.iyer, 'CC-000001')
      assert.equal(res.status, 403)
      assert.equal(res.body.reason, 'NO_ACTIVE_CONSENT')
      assert.equal(res.body.possibleConditions, undefined)
    })

    test('ADMIN, SECURITY_ADMIN and PATIENT → 403', async () => {
      for (const role of ['ADMIN', 'SECURITY_ADMIN', 'PATIENT']) {
        const res = await analyze(tokens[role], 'CC-000001')
        assert.equal(res.status, 403, role)
        assert.equal(res.body.possibleConditions, undefined, role)
      }
    })

    test('no login → 401', async () => {
      assert.equal((await analyze(null, 'CC-000001')).status, 401)
    })
  })

  describe('validation', () => {
    const cases = [
      ['missing patient', { patientId: undefined }, 'patientId'],
      ['no symptoms', { currentSymptoms: [] }, 'currentSymptoms'],
      ['bad symptom', { currentSymptoms: ['Fever!'] }, 'currentSymptoms[0]'],
      ['bad severity', { currentSymptoms: [{ code: 'fever', severity: 'EXTREME' }] }, 'currentSymptoms[0].severity'],
      ['impossible vital', { vitals: { temperatureC: 60 } }, 'vitals.temperatureC'],
      ['half a blood pressure', { vitals: { systolic: 140 } }, 'vitals'],
      ['bad history entry', { relevantHistory: ['DROP TABLE'] }, 'relevantHistory[0]'],
    ]
    for (const [label, extra, field] of cases) {
      test(`${label} → 400 on ${field}`, async () => {
        const res = await analyze(tokens.CLINICIAN, 'CC-000003', extra)
        assert.equal(res.status, 400)
        assert.ok(res.body.details.some((d) => d.field === field), JSON.stringify(res.body.details))
      })
    }
  })

  describe('audit', () => {
    test('each analysis is logged as SMARTCARE_ANALYZE against the patient, without clinical free text', async () => {
      const uid = await userId(USERS.CLINICIAN)
      const where = `action = 'SMARTCARE_ANALYZE' AND outcome = 'SUCCESS' AND user_id = $1 AND patient_id = $2`
      const before = await auditCount(where, [uid, ids['CC-000003']])
      await analyze(tokens.CLINICIAN, 'CC-000003')
      assert.equal(await auditCount(where, [uid, ids['CC-000003']]), before + 1)
      const { rows } = await query(`SELECT metadata FROM audit.audit_logs WHERE ${where} ORDER BY chain_seq DESC LIMIT 1`, [
        uid,
        ids['CC-000003'],
      ])
      assert.deepEqual(Object.keys(rows[0].metadata).sort(), ['analysis_id', 'context', 'engine', 'risk_level', 'symptoms', 'top_condition'])
    })

    test('refusals are logged as SMARTCARE_ANALYZE DENIED', async () => {
      const uid = await userId(IYER)
      const where = `action = 'SMARTCARE_ANALYZE' AND outcome = 'DENIED' AND user_id = $1`
      const before = await auditCount(where, [uid])
      await analyze(tokens.iyer, 'CC-000001')
      assert.equal(await auditCount(where, [uid]), before + 1)
    })
  })
})
