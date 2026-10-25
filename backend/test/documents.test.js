import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import {
  PASSWORD,
  USERS,
  auditCount,
  query,
  signToken,
  skipReason,
  startServer,
  userId,
} from './helpers.js'
import { env } from '../src/config/env.js'
import { resolveStoragePath } from '../src/documents/storage.js'

describe('medical documents security & lifecycle', async () => {
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
  let visitId

  // Test artifacts: sample valid PDF and PNG buffers
  const samplePdfBuffer = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n', 'utf8')
  const samplePdfBase64 = samplePdfBuffer.toString('base64')

  const samplePngBuffer = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  ])
  const samplePngBase64 = samplePngBuffer.toString('base64')

  before(async () => {
    server = await startServer()
    api = server.api
    tokens = await api.tokensForAllRoles()

    // Retrieve test patient ID (ananya)
    const { rows: pRows } = await query(
      'SELECT cp.id FROM clinical.patients cp JOIN identity.users u ON u.id = cp.user_id WHERE u.email = $1',
      [USERS.PATIENT],
    )
    patientId = pRows[0].id

    // Retrieve another patient ID (for cross-patient tests)
    const { rows: otherRows } = await query(
      'SELECT id FROM clinical.patients WHERE id <> $1 AND is_active LIMIT 1',
      [patientId],
    )
    otherPatientId = otherRows[0].id

    // Retrieve clinician ID
    const { rows: cRows } = await query(
      'SELECT c.id FROM clinical.clinicians c JOIN identity.users u ON u.id = c.user_id WHERE u.email = $1',
      [USERS.CLINICIAN],
    )
    clinicianId = cRows[0].id

    // Retrieve a visit ID for patientId
    const { rows: vRows } = await query(
      'SELECT id FROM clinical.visits WHERE patient_id = $1 LIMIT 1',
      [patientId],
    )
    visitId = vRows[0]?.id || null

    // Ensure clinician has active FULL_RECORD consent for patientId
    const patientUserId = await userId(USERS.PATIENT)
    await query(
      `INSERT INTO clinical.consent_records (patient_id, clinician_id, scope, purpose, channel, granted_at, expires_at, recorded_by)
       VALUES ($1, $2, 'FULL_RECORD', 'Document testing consent', 'PATIENT_PORTAL', now() - interval '1 hour', now() + interval '30 days', $3)
       ON CONFLICT DO NOTHING`,
      [patientId, clinicianId, patientUserId],
    )
  })

  after(async () => {
    // Clean up test files in patient storage
    try {
      const patientDir = path.join(env.storageDirectory, patientId)
      // await fsp.rm(patientDir, { recursive: true, force: true })
    } catch {}
    await server?.close()
  })

  // 1. Ingestion: Authorized upload
  describe('authorized document upload', () => {
    it('allows patient to upload their own lab report (PDF)', async () => {
      const res = await fetch(`${server.baseUrl}/api/patients/${patientId}/documents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokens.PATIENT}`,
        },
        body: JSON.stringify({
          documentType: 'LAB_REPORT',
          fileName: 'cbc_report_oct2026.pdf',
          mimeType: 'application/pdf',
          fileBase64: samplePdfBase64,
          visitId,
        }),
      })

      assert.equal(res.status, 201)
      const data = await res.json()
      assert.ok(data.document.id)
      assert.equal(data.document.patientId, patientId)
      assert.equal(data.document.documentType, 'LAB_REPORT')
      assert.equal(data.document.originalFileName, 'cbc_report_oct2026.pdf')
      assert.equal(data.document.mimeType, 'application/pdf')
      assert.equal(data.document.fileSizeBytes, samplePdfBuffer.length)
      assert.equal(
        data.document.sha256Checksum,
        crypto.createHash('sha256').update(samplePdfBuffer).digest('hex'),
      )
    })

    it('allows consented clinician (FULL_RECORD) to upload an X-ray (PNG)', async () => {
      const res = await fetch(`${server.baseUrl}/api/patients/${patientId}/documents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokens.CLINICIAN}`,
        },
        body: JSON.stringify({
          documentType: 'XRAY',
          fileName: 'chest_xray.png',
          mimeType: 'image/png',
          fileBase64: samplePngBase64,
        }),
      })

      assert.equal(res.status, 201)
      const data = await res.json()
      assert.equal(data.document.documentType, 'XRAY')
      assert.equal(data.document.mimeType, 'image/png')
    })
  })

  // 2. Retrieval: List, Metadata & Binary
  describe('authorized document retrieval', () => {
    let uploadedDocId

    before(async () => {
      const res = await fetch(`${server.baseUrl}/api/patients/${patientId}/documents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokens.PATIENT}`,
        },
        body: JSON.stringify({
          documentType: 'PRESCRIPTION',
          fileName: 'discharge_rx.pdf',
          mimeType: 'application/pdf',
          fileBase64: samplePdfBase64,
        }),
      })
      const data = await res.json()
      uploadedDocId = data.document.id
    })

    it('lists documents for the patient and clinician', async () => {
      const resPatient = await fetch(`${server.baseUrl}/api/patients/${patientId}/documents`, {
        headers: { Authorization: `Bearer ${tokens.PATIENT}` },
      })
      assert.equal(resPatient.status, 200)
      const dataPatient = await resPatient.json()
      assert.ok(Array.isArray(dataPatient.documents))
      assert.ok(dataPatient.documents.some((d) => d.id === uploadedDocId))

      const resClinician = await fetch(`${server.baseUrl}/api/patients/${patientId}/documents`, {
        headers: { Authorization: `Bearer ${tokens.CLINICIAN}` },
      })
      assert.equal(resClinician.status, 200)
    })

    it('gets document metadata by ID', async () => {
      const res = await fetch(`${server.baseUrl}/api/patients/${patientId}/documents/${uploadedDocId}`, {
        headers: { Authorization: `Bearer ${tokens.PATIENT}` },
      })
      assert.equal(res.status, 200)
      const data = await res.json()
      assert.equal(data.document.id, uploadedDocId)
      assert.equal(data.document.originalFileName, 'discharge_rx.pdf')
    })

    it('downloads document binary and verifies checksum & security headers', async () => {
      const res = await fetch(
        `${server.baseUrl}/api/patients/${patientId}/documents/${uploadedDocId}/file`,
        {
          headers: { Authorization: `Bearer ${tokens.PATIENT}` },
        },
      )
      assert.equal(res.status, 200)
      assert.equal(res.headers.get('content-type'), 'application/pdf')
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
      assert.ok(res.headers.get('content-disposition').includes('attachment; filename='))
      assert.equal(res.headers.get('cache-control'), 'private, no-cache, no-store, must-revalidate')

      const buf = Buffer.from(await res.arrayBuffer())
      assert.equal(buf.toString('utf8'), samplePdfBuffer.toString('utf8'))
    })

    it('supports inline disposition for safe previewable MIME types when requested', async () => {
      const res = await fetch(
        `${server.baseUrl}/api/patients/${patientId}/documents/${uploadedDocId}/file?disposition=inline`,
        {
          headers: { Authorization: `Bearer ${tokens.PATIENT}` },
        },
      )
      assert.equal(res.status, 200)
      assert.ok(res.headers.get('content-disposition').startsWith('inline;'))
    })
  })

  // 3. Role & RBAC boundaries
  describe('RBAC & role isolation', () => {
    it('refuses ADMIN with 403 on document endpoints', async () => {
      const resList = await fetch(`${server.baseUrl}/api/patients/${patientId}/documents`, {
        headers: { Authorization: `Bearer ${tokens.ADMIN}` },
      })
      assert.equal(resList.status, 403)

      const resUpload = await fetch(`${server.baseUrl}/api/patients/${patientId}/documents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokens.ADMIN}`,
        },
        body: JSON.stringify({
          documentType: 'OTHER',
          fileName: 'admin.pdf',
          mimeType: 'application/pdf',
          fileBase64: samplePdfBase64,
        }),
      })
      assert.equal(resUpload.status, 403)
    })

    it('refuses SECURITY_ADMIN with 403', async () => {
      const res = await fetch(`${server.baseUrl}/api/patients/${patientId}/documents`, {
        headers: { Authorization: `Bearer ${tokens.SECURITY_ADMIN}` },
      })
      assert.equal(res.status, 403)
    })

    it('refuses anonymous requests with 401', async () => {
      const res = await fetch(`${server.baseUrl}/api/patients/${patientId}/documents`)
      assert.equal(res.status, 401)
    })
  })

  // 4. Cross-patient denial
  describe('cross-patient access boundaries', () => {
    it('refuses patient accessing another patient document with 403 NOT_OWN_RECORD', async () => {
      const res = await fetch(`${server.baseUrl}/api/patients/${otherPatientId}/documents`, {
        headers: { Authorization: `Bearer ${tokens.PATIENT}` },
      })
      assert.equal(res.status, 403)
      const data = await res.json()
      assert.equal(data.error, 'FORBIDDEN')
      assert.equal(data.reason, 'NOT_OWN_RECORD')
    })
  })

  // 5. Consent boundaries: SUMMARY_ONLY, expired, revoked
  describe('consent scope & lifecycle boundaries', () => {
    let docTokens = {}
    let patientIds = {}

    before(async () => {
      const docEmails = {
        qureshi: 'dr.farhan.qureshi@carecrypt.example',
        desai: 'dr.ravi.desai@carecrypt.example',
      }
      for (const [name, email] of Object.entries(docEmails)) {
        docTokens[name] = (await (await api.login(email, PASSWORD)).json()).token
      }
      const { rows } = await query('SELECT mrn, id FROM clinical.patients')
      for (const r of rows) patientIds[r.mrn] = r.id
    })

    it('denies clinician with SUMMARY_ONLY consent (403 CONSENT_SCOPE_INSUFFICIENT)', async () => {
      // CC-000016 gave Dr. Qureshi SUMMARY_ONLY consent
      const res = await fetch(`${server.baseUrl}/api/patients/${patientIds['CC-000016']}/documents`, {
        headers: { Authorization: `Bearer ${docTokens.qureshi}` },
      })
      assert.equal(res.status, 403)
      const data = await res.json()
      assert.equal(data.reason, 'CONSENT_SCOPE_INSUFFICIENT')
    })

    it('denies clinician when consent is revoked (403 NO_ACTIVE_CONSENT)', async () => {
      // CC-000022 revoked Dr. Desai's access
      const res = await fetch(`${server.baseUrl}/api/patients/${patientIds['CC-000022']}/documents`, {
        headers: { Authorization: `Bearer ${docTokens.desai}` },
      })
      assert.equal(res.status, 403)
      const data = await res.json()
      assert.equal(data.reason, 'NO_ACTIVE_CONSENT')
    })

    it('denies clinician when consent is expired (403 NO_ACTIVE_CONSENT)', async () => {
      // CC-000005: expired consent for Dr. Qureshi
      const res = await fetch(`${server.baseUrl}/api/patients/${patientIds['CC-000005']}/documents`, {
        headers: { Authorization: `Bearer ${docTokens.qureshi}` },
      })
      assert.equal(res.status, 403)
      const data = await res.json()
      assert.equal(data.reason, 'NO_ACTIVE_CONSENT')
    })
  })

  // 6. Emergency break-glass access
  describe('emergency break-glass document access', () => {
    it('allows clinician access via valid emergency record even with no ordinary consent', async () => {
      // CC-000015 has no ordinary consent for Dr. Ranade
      const { rows: p15 } = await query("SELECT id FROM clinical.patients WHERE mrn = 'CC-000015'")
      const p15Id = p15[0].id

      // Request emergency access via API
      const emergRes = await fetch(`${server.baseUrl}/api/patients/${p15Id}/emergency-access`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokens.CLINICIAN}`,
        },
        body: JSON.stringify({
          reason: 'Emergency document review required in ICU',
          scope: 'FULL_RECORD',
          durationHours: 2,
        }),
      })
      assert.equal(emergRes.status, 201)
      const emergData = await emergRes.json()
      const accessId = emergData.emergencyAccess.id

      const res = await fetch(`${server.baseUrl}/api/patients/${p15Id}/documents`, {
        headers: { Authorization: `Bearer ${tokens.CLINICIAN}` },
      })
      assert.equal(res.status, 200)
      const data = await res.json()
      assert.equal(data.access.via, 'EMERGENCY')

      // Clean up emergency access by revoking it
      await fetch(`${server.baseUrl}/api/patients/${p15Id}/emergency-access/${accessId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${tokens.CLINICIAN}` },
      })
    })
  })

  // 7. Security validations: MIME signature, size, traversal, checksum
  describe('upload security validation & integrity enforcement', () => {
    it('rejects spoofed MIME type (text file with .pdf claiming application/pdf)', async () => {
      const spoofedBuffer = Buffer.from('console.log("malicious code")', 'utf8')
      const res = await fetch(`${server.baseUrl}/api/patients/${patientId}/documents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokens.PATIENT}`,
        },
        body: JSON.stringify({
          documentType: 'LAB_REPORT',
          fileName: 'fake.pdf',
          mimeType: 'application/pdf',
          fileBase64: spoofedBuffer.toString('base64'),
        }),
      })

      assert.equal(res.status, 400)
      const data = await res.json()
      assert.ok(data.message.includes('signature does not match'))
    })

    it('rejects unsupported executable or script files', async () => {
      const exeBuffer = Buffer.from('MZ\x90\x00\x03\x00\x00\x00', 'binary')
      const res = await fetch(`${server.baseUrl}/api/patients/${patientId}/documents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokens.PATIENT}`,
        },
        body: JSON.stringify({
          documentType: 'OTHER',
          fileName: 'payload.exe',
          mimeType: 'application/x-msdownload',
          fileBase64: exeBuffer.toString('base64'),
        }),
      })

      assert.equal(res.status, 400)
      const data = await res.json()
      assert.equal(data.error, 'VALIDATION_FAILED')
    })

    it('rejects oversized files with 413 PAYLOAD_TOO_LARGE', async () => {
      // 26 MB buffer exceeds 25 MB default limit
      // We test rejection by payload check without exhausting memory using 26MB zero buffer
      const largeBuffer = Buffer.alloc(26 * 1024 * 1024)
      largeBuffer[0] = 0x25
      largeBuffer[1] = 0x50
      largeBuffer[2] = 0x44
      largeBuffer[3] = 0x46 // %PDF

      const res = await fetch(`${server.baseUrl}/api/patients/${patientId}/documents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokens.PATIENT}`,
        },
        body: JSON.stringify({
          documentType: 'LAB_REPORT',
          fileName: 'large.pdf',
          mimeType: 'application/pdf',
          fileBase64: largeBuffer.toString('base64'),
        }),
      })

      assert.equal(res.status, 413)
    })

    it('detects and prevents path traversal in resolveStoragePath', () => {
      assert.throws(
        () => resolveStoragePath('../../etc/passwd'),
        (err) => err.status === 400 && err.message.includes('traversal'),
      )
      assert.throws(
        () => resolveStoragePath('/etc/passwd'),
        (err) => err.status === 400 && err.message.includes('traversal'),
      )
    })

    it('detects checksum mismatch on file read and throws 500 INTEGRITY_ERROR', async () => {
      // Upload a valid doc first
      const uploadRes = await fetch(`${server.baseUrl}/api/patients/${patientId}/documents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokens.PATIENT}`,
        },
        body: JSON.stringify({
          documentType: 'OTHER',
          fileName: 'integrity_test.pdf',
          mimeType: 'application/pdf',
          fileBase64: samplePdfBase64,
        }),
      })
      const { document: doc } = await uploadRes.json()

      // Tamper with the database checksum to simulate file bit-rot/tampering
      await query(
        `UPDATE clinical.medical_documents
            SET sha256_checksum = '0000000000000000000000000000000000000000000000000000000000000000'
          WHERE id = $1`,
        [doc.id],
      )

      const readRes = await fetch(
        `${server.baseUrl}/api/patients/${patientId}/documents/${doc.id}/file`,
        {
          headers: { Authorization: `Bearer ${tokens.PATIENT}` },
        },
      )
      assert.equal(readRes.status, 500)
      const readData = await readRes.json()
      assert.equal(readData.error, 'INTEGRITY_ERROR')
    })
  })

  // 8. Audit event verification
  describe('audit event logging', () => {
    it('audits document upload, view, download, and integrity failure events', async () => {
      const uploadCount = await auditCount("action = 'MEDICAL_DOCUMENT_UPLOAD' AND patient_id = $1", [
        patientId,
      ])
      assert.ok(uploadCount > 0, 'Upload events must be recorded in audit log')

      const viewCount = await auditCount("action = 'MEDICAL_DOCUMENT_VIEW' AND patient_id = $1", [
        patientId,
      ])
      assert.ok(viewCount > 0, 'View events must be recorded in audit log')

      const downloadCount = await auditCount(
        "action = 'MEDICAL_DOCUMENT_DOWNLOAD' AND patient_id = $1",
        [patientId],
      )
      assert.ok(downloadCount > 0, 'Download events must be recorded in audit log')

      const integrityFailureCount = await auditCount(
        "action = 'MEDICAL_DOCUMENT_INTEGRITY_FAILURE' AND patient_id = $1",
        [patientId],
      )
      assert.ok(integrityFailureCount > 0, 'Integrity failure must be recorded in audit log')
    })
  })
})
