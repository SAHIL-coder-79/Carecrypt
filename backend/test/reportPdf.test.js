import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { PDFParse } from 'pdf-parse'
import {
  PASSWORD,
  USERS,
  auditCount,
  query,
  skipReason,
  startServer,
  userId,
} from './helpers.js'

describe('consolidated health report export (PDF)', async () => {
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

  before(async () => {
    server = await startServer()
    api = server.api
    tokens = await api.tokensForAllRoles()

    const docEmails = {
      ranade: USERS.CLINICIAN,
      qureshi: 'dr.farhan.qureshi@carecrypt.example',
      desai: 'dr.ravi.desai@carecrypt.example',
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
  })

  after(async () => {
    await server?.close()
  })

  // 1. Patient own record export
  describe('patient self-service report export', () => {
    it('generates a full PDF report for own record', async () => {
      const res = await fetch(`${server.baseUrl}/api/patients/${patientId}/consolidated-report`, {
        headers: { Authorization: `Bearer ${tokens.PATIENT}` },
      })

      assert.equal(res.status, 200)
      assert.equal(res.headers.get('content-type'), 'application/pdf')
      assert.ok(res.headers.get('content-disposition').includes('attachment; filename="carecrypt_report_'))

      const pdfBuffer = Buffer.from(await res.arrayBuffer())
      assert.ok(pdfBuffer.length > 500)

      // Parse text in generated PDF
      const parser = new PDFParse({ data: pdfBuffer })
      await parser.load()
      const parsed = await parser.getText()
      assert.ok(parsed.text.includes('CareCrypt Health Record'))
      assert.ok(parsed.text.includes('CONSOLIDATED LONGITUDINAL HEALTH REPORT'))
      assert.ok(parsed.text.includes('1. ALLERGIES & ADVERSE DRUG REACTIONS'))
      assert.ok(parsed.text.includes('4. CONSULTATIONS & LONGITUDINAL VISITS'))
    })

    it('denies patient exporting another patient report (403 NOT_OWN_RECORD)', async () => {
      const res = await fetch(`${server.baseUrl}/api/patients/${otherPatientId}/consolidated-report`, {
        headers: { Authorization: `Bearer ${tokens.PATIENT}` },
      })
      assert.equal(res.status, 403)
      const data = await res.json()
      assert.equal(data.reason, 'NOT_OWN_RECORD')
    })
  })

  // 2. Clinician export under FULL_RECORD consent
  describe('clinician report export with FULL_RECORD consent', () => {
    it('generates complete report including visit history for consented patient', async () => {
      // CC-000003 consented Dr. Ranade for FULL_RECORD
      const cc3Id = patientIds['CC-000003']
      const res = await fetch(`${server.baseUrl}/api/patients/${cc3Id}/consolidated-report`, {
        headers: { Authorization: `Bearer ${docTokens.ranade}` },
      })
      assert.equal(res.status, 200)
      const pdfBuffer = Buffer.from(await res.arrayBuffer())
      const parser = new PDFParse({ data: pdfBuffer })
      await parser.load()
      const parsed = await parser.getText()

      assert.ok(parsed.text.includes('FULL_RECORD'))
      assert.ok(parsed.text.includes('4. CONSULTATIONS & LONGITUDINAL VISITS'))
      assert.ok(parsed.text.includes('2. ACTIVE & CHRONIC CONDITIONS'))
    })
  })

  // 3. Consent scope enforcement: SUMMARY_ONLY redaction
  describe('consent scope enforcement (SUMMARY_ONLY)', () => {
    it('generates report but withholds consultations and attachments for SUMMARY_ONLY consent', async () => {
      // CC-000016 gave Dr. Qureshi SUMMARY_ONLY consent
      const cc16Id = patientIds['CC-000016']
      const res = await fetch(`${server.baseUrl}/api/patients/${cc16Id}/consolidated-report`, {
        headers: { Authorization: `Bearer ${docTokens.qureshi}` },
      })
      assert.equal(res.status, 200)
      const pdfBuffer = Buffer.from(await res.arrayBuffer())
      const parser = new PDFParse({ data: pdfBuffer })
      await parser.load()
      const parsed = await parser.getText()

      assert.ok(parsed.text.includes('SUMMARY_ONLY'))
      // Must explicitly contain the withholding notice
      assert.ok(parsed.text.includes('outside active consent scope: SUMMARY_ONLY'))
      // Must not leak contact details
      assert.ok(parsed.text.includes('Detailed contact restricted by consent'))
    })
  })

  // 4. Revoked and expired consent enforcement
  describe('revoked and expired consent denial', () => {
    it('denies clinician when consent is revoked (403 NO_ACTIVE_CONSENT)', async () => {
      // CC-000022 revoked Dr. Desai
      const cc22Id = patientIds['CC-000022']
      const res = await fetch(`${server.baseUrl}/api/patients/${cc22Id}/consolidated-report`, {
        headers: { Authorization: `Bearer ${docTokens.desai}` },
      })
      assert.equal(res.status, 403)
      const data = await res.json()
      assert.equal(data.reason, 'NO_ACTIVE_CONSENT')
    })

    it('denies clinician when consent is expired (403 NO_ACTIVE_CONSENT)', async () => {
      // CC-000005 expired for Dr. Qureshi
      const cc5Id = patientIds['CC-000005']
      const res = await fetch(`${server.baseUrl}/api/patients/${cc5Id}/consolidated-report`, {
        headers: { Authorization: `Bearer ${docTokens.qureshi}` },
      })
      assert.equal(res.status, 403)
      const data = await res.json()
      assert.equal(data.reason, 'NO_ACTIVE_CONSENT')
    })
  })

  // 5. RBAC role boundaries
  describe('RBAC boundaries', () => {
    it('denies ADMIN with 403 on consolidated-report', async () => {
      const res = await fetch(`${server.baseUrl}/api/patients/${patientId}/consolidated-report`, {
        headers: { Authorization: `Bearer ${tokens.ADMIN}` },
      })
      assert.equal(res.status, 403)
    })

    it('denies SECURITY_ADMIN with 403', async () => {
      const res = await fetch(`${server.baseUrl}/api/patients/${patientId}/consolidated-report`, {
        headers: { Authorization: `Bearer ${tokens.SECURITY_ADMIN}` },
      })
      assert.equal(res.status, 403)
    })

    it('denies anonymous request with 401', async () => {
      const res = await fetch(`${server.baseUrl}/api/patients/${patientId}/consolidated-report`)
      assert.equal(res.status, 401)
    })
  })

  // 6. Audit event logging
  describe('audit trail', () => {
    it('records PATIENT_REPORT_EXPORT event with patient_id and scope in audit log', async () => {
      const count = await auditCount("action = 'PATIENT_REPORT_EXPORT' AND patient_id = $1", [patientId])
      assert.ok(count > 0, 'Report generation must be logged in audit log')
    })
  })
})
