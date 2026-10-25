import assert from 'node:assert/strict'
import fs from 'node:fs'
import { after, before, describe, it } from 'node:test'
import {
  PASSWORD,
  USERS,
  query,
  skipReason,
  startServer,
} from './helpers.js'
import { parseStructuredLabReport, calculateExtractionConfidence, normalizeNumericValue, parseReferenceRange, evaluateAbnormality } from '../src/documents/labParser.js'
import { clearLabPngBase64 } from './labFixture.js'

describe('structured laboratory observations & confidence', async () => {
  const reason = await skipReason()
  if (reason) {
    it.skip(`skipped: ${reason}`, () => {})
    return
  }

  let server
  let api
  let tokens
  let patientId
  let otherPatientId
  let clinicianId
  let docTokens = {}
  let patientIds = {}
  let labDocId

  before(async () => {
    server = await startServer()
    api = server.api
    tokens = await api.tokensForAllRoles()

    const docEmails = {
      ranade: USERS.CLINICIAN,
      qureshi: 'dr.farhan.qureshi@carecrypt.example',
    }
    for (const [name, email] of Object.entries(docEmails)) {
      docTokens[name] = (await (await api.login(email, PASSWORD)).json()).token
    }

    const { rows: pRows } = await query(
      'SELECT cp.id FROM clinical.patients cp JOIN identity.users u ON u.id = cp.user_id WHERE u.email = $1',
      [USERS.PATIENT],
    )
    patientId = pRows[0].id

    const { rows: otherRows } = await query(
      'SELECT id FROM clinical.patients WHERE id <> $1 AND is_active LIMIT 1',
      [patientId],
    )
    otherPatientId = otherRows[0].id

    const { rows: allPatients } = await query('SELECT mrn, id FROM clinical.patients')
    for (const r of allPatients) patientIds[r.mrn] = r.id

    // Upload a test lab report document to patientId
    const uploadRes = await fetch(`${server.baseUrl}/api/patients/${patientId}/documents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokens.PATIENT}`,
      },
      body: JSON.stringify({
        documentType: 'LAB_REPORT',
        fileName: 'cbc_panel_clear.png',
        mimeType: 'image/png',
        fileBase64: clearLabPngBase64,
      }),
    })
    const uploadData = await uploadRes.json()
    labDocId = uploadData.document.id
  })

  after(async () => {
    await server?.close()
  })

  // 1. Parser Unit Tests & Robustness
  describe('conservative deterministic lab parser', () => {
    it('accurately parses Complete Blood Count with LOINC codes and reference ranges', () => {
      const cbcText = `
        CareCrypt Diagnostic Labs
        Date: 2026-10-18
        Patient CBC Report
        Hemoglobin: 14.2 g/dL (Ref: 12.0 - 17.5)
        WBC Count: 6800 /uL (Ref: 4000 - 11000)
        Platelet Count: 250000 /uL (Ref: 150000 - 450000)
        Hematocrit (PCV): 42.5 % (Ref: 36.0 - 52.0)
      `
      const parsed = parseStructuredLabReport({ recognizedText: cbcText })
      assert.equal(parsed.panelType, 'CBC')
      assert.equal(parsed.observations.length, 4)

      const hgb = parsed.observations.find((o) => o.testName === 'Hemoglobin')
      assert.ok(hgb)
      assert.equal(hgb.standardCode, '718-7')
      assert.equal(hgb.valueNumeric, 14.2)
      assert.equal(hgb.unit, 'g/dL')
      assert.equal(hgb.referenceLow, 12.0)
      assert.equal(hgb.referenceHigh, 17.5)
      assert.equal(hgb.isAbnormal, false)
      assert.equal(hgb.extractionConfidence, 100)
      assert.equal(hgb.reportDate, '2026-10-18')

      const wbc = parsed.observations.find((o) => o.testName === 'WBC Count')
      assert.ok(wbc)
      assert.equal(wbc.standardCode, '6690-2')
      assert.equal(wbc.valueNumeric, 6800)
      assert.equal(wbc.isAbnormal, false)
    })

    it('accurately parses Lipid Profile and flags abnormal out-of-range values', () => {
      const lipidText = `
        Pathology Laboratory
        Report Date: 2026-10-19
        Lipid Profile Panel
        Total Cholesterol: 245 mg/dL (Desirable: < 200)
        Triglycerides: 185 mg/dL (Normal: < 150)
        HDL Cholesterol: 35 mg/dL (Optimal: > 40)
        LDL Cholesterol: 165 mg/dL (Optimal: 0 - 100)
      `
      const parsed = parseStructuredLabReport({ recognizedText: lipidText })
      assert.equal(parsed.panelType, 'LIPID')
      assert.equal(parsed.observations.length, 4)

      const chol = parsed.observations.find((o) => o.testName === 'Total Cholesterol')
      assert.ok(chol)
      assert.equal(chol.standardCode, '2093-3')
      assert.equal(chol.valueNumeric, 245)
      assert.equal(chol.isAbnormal, true) // 245 > 200

      const hdl = parsed.observations.find((o) => o.testName === 'HDL Cholesterol')
      assert.ok(hdl)
      assert.equal(hdl.valueNumeric, 35)
      assert.equal(hdl.isAbnormal, true) // 35 < 40
    })

    it('handles decimal formats with commas and normalizes numeric values', () => {
      assert.equal(normalizeNumericValue('14,2'), 14.2)
      assert.equal(normalizeNumericValue('14.20'), 14.2)
      assert.equal(normalizeNumericValue('abc'), null)

      const text = `
        CBC Panel
        Hemoglobin: 13,8 g/dL (12.0 - 16.0)
      `
      const parsed = parseStructuredLabReport({ recognizedText: text })
      const hgb = parsed.observations.find((o) => o.testName === 'Hemoglobin')
      assert.ok(hgb)
      assert.equal(hgb.valueNumeric, 13.8)
    })

    it('handles duplicate candidate values conservatively by choosing highest confidence and recording warning', () => {
      const duplicateText = `
        Complete Blood Count
        Hemoglobin: 14.0
        Hemoglobin: 14.2 g/dL (12.0 - 17.5)
      `
      const parsed = parseStructuredLabReport({ recognizedText: duplicateText })
      assert.equal(parsed.observations.length, 1)
      assert.equal(parsed.observations[0].valueNumeric, 14.2)
      assert.ok(parsed.warnings.some((w) => w.includes("Multiple candidate values found for 'Hemoglobin'")))
    })

    it('returns empty observations and explicit warning for unsupported panel documents without fabricating values', () => {
      const unsupportedText = `
        Clinical Endocrinology
        Thyroid Stimulating Hormone (TSH): 2.45 uIU/mL
        Free T4: 1.12 ng/dL
      `
      const parsed = parseStructuredLabReport({ recognizedText: unsupportedText })
      assert.equal(parsed.observations.length, 0)
      assert.ok(parsed.warnings.some((w) => w.includes('limited to CBC and Lipid panels')))
    })
  })

  // 2. End-to-End Extraction & Storage Integration
  describe('end-to-end OCR and structured observation storage', () => {
    it('extracts structured observation during process-ocr and links to ocr run', async () => {
      const res = await fetch(
        `${server.baseUrl}/api/patients/${patientId}/documents/${labDocId}/process-ocr`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${tokens.PATIENT}` },
        },
      )
      assert.equal(res.status, 200)
      const data = await res.json()
      assert.ok(data.ocrRun)
      assert.ok(data.extraction)
      assert.ok(data.extraction.extractionRun.id)
      assert.equal(data.extraction.extractionRun.document_id, labDocId)
      assert.ok(data.extraction.observations.length > 0)

      const hgb = data.extraction.observations[0]
      assert.equal(hgb.test_name, 'Hemoglobin')
      assert.equal(hgb.verification_status, 'UNVERIFIED')
      assert.ok(hgb.extraction_confidence > 0)
    })

    it('retrieves structured observations list via GET /api/patients/:id/lab-observations', async () => {
      const res = await fetch(
        `${server.baseUrl}/api/patients/${patientId}/lab-observations?documentId=${labDocId}`,
        {
          headers: { Authorization: `Bearer ${tokens.PATIENT}` },
        },
      )
      assert.equal(res.status, 200)
      const data = await res.json()
      assert.ok(Array.isArray(data.observations))
      assert.ok(data.observations.length > 0)
      assert.equal(data.observations[0].documentId, labDocId)
      assert.equal(data.observations[0].testName, 'Hemoglobin')
    })
  })

  // 3. Clinical Verification Lifecycle
  describe('clinical verification of extracted observations', () => {
    it('allows authorized clinician with FULL_RECORD consent to verify an observation', async () => {
      // Fetch observation
      const listRes = await fetch(
        `${server.baseUrl}/api/patients/${patientId}/lab-observations?documentId=${labDocId}`,
        {
          headers: { Authorization: `Bearer ${docTokens.ranade}` },
        },
      )
      const listData = await listRes.json()
      const obsId = listData.observations[0].id

      // Verify observation
      const verifyRes = await fetch(
        `${server.baseUrl}/api/patients/${patientId}/lab-observations/${obsId}/verification`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${docTokens.ranade}`,
          },
          body: JSON.stringify({
            status: 'VERIFIED',
            note: 'Confirmed against physical lab slip with matching signature.',
          }),
        },
      )
      assert.equal(verifyRes.status, 200)
      const verifyData = await verifyRes.json()
      assert.equal(verifyData.observation.verificationStatus, 'VERIFIED')
      assert.ok(verifyData.observation.verifiedBy)
      assert.ok(verifyData.observation.verifiedAt)
      assert.equal(verifyData.observation.verificationNote, 'Confirmed against physical lab slip with matching signature.')
    })

    it('denies patient from modifying verification status (only authorized clinicians can verify)', async () => {
      const listRes = await fetch(
        `${server.baseUrl}/api/patients/${patientId}/lab-observations?documentId=${labDocId}`,
        {
          headers: { Authorization: `Bearer ${tokens.PATIENT}` },
        },
      )
      const obsId = (await listRes.json()).observations[0].id

      const patchRes = await fetch(
        `${server.baseUrl}/api/patients/${patientId}/lab-observations/${obsId}/verification`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${tokens.PATIENT}`,
          },
          body: JSON.stringify({ status: 'VERIFIED' }),
        },
      )
      assert.equal(patchRes.status, 403)
    })
  })

  // 4. Privacy, Consent Scope & RBAC Boundaries
  describe('privacy & consent enforcement on structured observations', () => {
    it('denies patient viewing another patient lab observations (403 NOT_OWN_RECORD)', async () => {
      const res = await fetch(
        `${server.baseUrl}/api/patients/${otherPatientId}/lab-observations`,
        {
          headers: { Authorization: `Bearer ${tokens.PATIENT}` },
        },
      )
      assert.equal(res.status, 403)
      const body = await res.json()
      assert.equal(body.reason, 'NOT_OWN_RECORD')
    })

    it('denies clinician under SUMMARY_ONLY consent from viewing lab observations', async () => {
      const cc16Id = patientIds['CC-000016']
      const res = await fetch(
        `${server.baseUrl}/api/patients/${cc16Id}/lab-observations`,
        {
          headers: { Authorization: `Bearer ${docTokens.qureshi}` }, // qureshi has SUMMARY_ONLY on CC-000016
        },
      )
      assert.equal(res.status, 403)
      const body = await res.json()
      assert.equal(body.reason, 'CONSENT_SCOPE_INSUFFICIENT')
    })

    it('denies ADMIN from accessing lab observations', async () => {
      const res = await fetch(
        `${server.baseUrl}/api/patients/${patientId}/lab-observations`,
        {
          headers: { Authorization: `Bearer ${tokens.ADMIN}` },
        },
      )
      assert.equal(res.status, 403)
    })
  })

  // 5. Audit Logging
  describe('audit logging for observations and verification', () => {
    it('records LAB_OBSERVATIONS_VIEW and LAB_OBSERVATION_VERIFY in audit log', async () => {
      const { rows } = await query(
        `SELECT action, patient_id, outcome, reason
           FROM audit.audit_logs
          WHERE patient_id = $1 AND action IN ('LAB_OBSERVATIONS_VIEW', 'LAB_OBSERVATION_VERIFY')
          ORDER BY chain_seq DESC`,
        [patientId],
      )
      assert.ok(rows.length >= 2)
      assert.ok(rows.some((r) => r.action === 'LAB_OBSERVATION_VERIFY' && r.outcome === 'SUCCESS'))
      assert.ok(rows.some((r) => r.action === 'LAB_OBSERVATIONS_VIEW' && r.outcome === 'SUCCESS'))
    })
  })
})
