import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import {
  PASSWORD,
  USERS,
  query,
  skipReason,
  startServer,
} from './helpers.js'
import { clearLabPngBase64 } from './labFixture.js'

describe('Intelligent Medical E-Report Analyzer API & Integration', async () => {
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
  let docTokens = {}
  let patientIds = {}
  let labDocId
  let obsId

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

    // Upload lab report
    const uploadRes = await fetch(`${server.baseUrl}/api/patients/${patientId}/documents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokens.PATIENT}`,
      },
      body: JSON.stringify({
        documentType: 'LAB_REPORT',
        fileName: 'analyzer_cbc_panel.png',
        mimeType: 'image/png',
        fileBase64: clearLabPngBase64,
      }),
    })
    const uploadData = await uploadRes.json()
    labDocId = uploadData.document.id

    // Process OCR
    const ocrRes = await fetch(`${server.baseUrl}/api/patients/${patientId}/documents/${labDocId}/process-ocr`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${docTokens.ranade}` },
    })
    const ocrData = await ocrRes.json()
    obsId = ocrData.extraction.observations[0].id
  })

  after(async () => {
    await server?.close()
  })

  describe('GET /api/patients/:patientId/report-analysis', () => {
    it('returns full health profile, individual anomalies and combination rules for clinician with FULL_RECORD consent', async () => {
      // First verify an observation to provide verified clinical data
      await fetch(
        `${server.baseUrl}/api/patients/${patientId}/lab-observations/${obsId}/verification`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${docTokens.ranade}`,
          },
          body: JSON.stringify({ status: 'VERIFIED' }),
        },
      )

      const res = await fetch(`${server.baseUrl}/api/patients/${patientId}/report-analysis`, {
        headers: { Authorization: `Bearer ${docTokens.ranade}` },
      })
      assert.equal(res.status, 200)
      const data = await res.json()

      assert.equal(data.scopeWithheld, false)
      assert.ok(data.patientProfile)
      assert.ok(data.individualAnomalies)
      assert.ok(data.normalObservations)
      assert.ok(data.combinationFindings)
      assert.ok(data.clinicalReviewSummary)
      assert.ok(data.clinicalReviewSummary.clinicalDisclaimer.includes('Decision Support Notice'))
    })

    it('allows patient to view report analysis of their own record with notices', async () => {
      const res = await fetch(`${server.baseUrl}/api/patients/${patientId}/report-analysis`, {
        headers: { Authorization: `Bearer ${tokens.PATIENT}` },
      })
      assert.equal(res.status, 200)
      const data = await res.json()
      assert.equal(data.scopeWithheld, false)
      assert.equal(data.patientProfile.id, patientId)
    })

    it('denies patient from accessing another patient report analysis (403 NOT_OWN_RECORD)', async () => {
      const res = await fetch(`${server.baseUrl}/api/patients/${otherPatientId}/report-analysis`, {
        headers: { Authorization: `Bearer ${tokens.PATIENT}` },
      })
      assert.equal(res.status, 403)
      const err = await res.json()
      assert.equal(err.error, 'FORBIDDEN')
    })

    it('withholds detailed lab analytics under SUMMARY_ONLY consent', async () => {
      const cc16Id = patientIds['CC-000016']
      const res = await fetch(`${server.baseUrl}/api/patients/${cc16Id}/report-analysis`, {
        headers: { Authorization: `Bearer ${docTokens.qureshi}` }, // qureshi has SUMMARY_ONLY on CC-000016
      })
      assert.equal(res.status, 200)
      const data = await res.json()
      assert.equal(data.scopeWithheld, true)
      assert.ok(data.message.includes('SUMMARY_ONLY'))
      assert.equal(data.individualAnomalies, undefined)
      assert.equal(data.combinationFindings, undefined)
    })

    it('records MEDICAL_REPORT_ANALYZE in append-only audit trail', async () => {
      const { rows } = await query(
        `SELECT action, patient_id, outcome, metadata
           FROM audit.audit_logs
          WHERE patient_id = $1 AND action = 'MEDICAL_REPORT_ANALYZE'
          ORDER BY chain_seq DESC LIMIT 1`,
        [patientId],
      )
      assert.ok(rows.length > 0)
      assert.equal(rows[0].action, 'MEDICAL_REPORT_ANALYZE')
      assert.equal(rows[0].outcome, 'SUCCESS')
    })
  })
})
