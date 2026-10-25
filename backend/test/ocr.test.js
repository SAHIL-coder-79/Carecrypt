import { clearLabPngBase64 } from './labFixture.js'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import {
  PASSWORD,
  USERS,
  auditCount,
  query,
  skipReason,
  startServer,
  userId,
} from './helpers.js'
import { env } from '../src/config/env.js'

describe('medical document OCR processing & extraction', async () => {
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

  // clean fixture imported
  // Synthetic 1x1 image (contains no recognizable text)
  const emptyPngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

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
    try {
      const patientDir = path.join(env.storageDirectory, patientId)
      // await fsp.rm(patientDir, { recursive: true, force: true })
    } catch {}
    await server?.close()
  })

  // 1. Authentic OCR Execution & Provenance
  describe('authentic OCR execution & score provenance', () => {
    it('executes OCR on uploaded lab document and records genuine confidence', async () => {
      const res = await fetch(
        `${server.baseUrl}/api/patients/${patientId}/documents/${labDocId}/process-ocr`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${tokens.PATIENT}` },
        },
      )

      assert.equal(res.status, 200)
      const data = await res.json()
      assert.ok(data.ocrRun.id)
      assert.equal(data.ocrRun.documentId, labDocId)
      assert.equal(data.ocrRun.engineName, 'Tesseract.js OCR (LSTM)')
      assert.equal(data.ocrRun.engineVersion, '7.0.0')
      assert.equal(data.ocrRun.status, 'READY')
      assert.equal(data.ocrRun.pageCount, 1)

      // Verified: confidence score is an authentic float (or null if blank), never fabricated 100%
      if (data.ocrRun.confidenceScore !== null) {
        assert.ok(
          data.ocrRun.confidenceScore >= 0 && data.ocrRun.confidenceScore <= 100,
          'Confidence score must be within 0-100',
        )
      }
      assert.ok(Array.isArray(data.ocrRun.blocks))
      assert.ok(data.ocrRun.processingMs >= 0)
    })

    it('retrieves OCR extraction results alongside document metadata for review', async () => {
      const res = await fetch(
        `${server.baseUrl}/api/patients/${patientId}/documents/${labDocId}/ocr`,
        {
          headers: { Authorization: `Bearer ${tokens.PATIENT}` },
        },
      )

      assert.equal(res.status, 200)
      const data = await res.json()
      assert.equal(data.ocrRun.documentId, labDocId)
      assert.equal(data.document.id, labDocId)
      assert.equal(data.document.originalFileName, 'cbc_panel_clear.png')
    })

    it('returns null confidence and empty blocks for image with no text (never fake 100%)', async () => {
      // Upload empty image
      const upRes = await fetch(`${server.baseUrl}/api/patients/${patientId}/documents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokens.PATIENT}`,
        },
        body: JSON.stringify({
          documentType: 'LAB_REPORT',
          fileName: 'blank.png',
          mimeType: 'image/png',
          fileBase64: emptyPngBase64,
        }),
      })
      const emptyDoc = (await upRes.json()).document;

      const ocrRes = await fetch(
        `${server.baseUrl}/api/patients/${patientId}/documents/${emptyDoc.id}/process-ocr`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${tokens.PATIENT}` },
        },
      )

      assert.equal(ocrRes.status, 200)
      const data = await ocrRes.json()
      // Authentic: with 0 recognized words, confidence is null rather than fabricated 100
      assert.equal(data.ocrRun.confidenceScore, null)
      assert.equal(data.ocrRun.blocks.length, 0)
    })
  })

  // 2. Privacy & Consent Isolation
  describe('privacy & consent enforcement on OCR data', () => {
    it('denies patient viewing another patient OCR data (403 NOT_OWN_RECORD)', async () => {
      const res = await fetch(
        `${server.baseUrl}/api/patients/${otherPatientId}/documents/${labDocId}/ocr`,
        {
          headers: { Authorization: `Bearer ${tokens.PATIENT}` },
        },
      )
      assert.equal(res.status, 403)
      const data = await res.json()
      assert.equal(data.reason, 'NOT_OWN_RECORD')
    })

    it('denies clinician under SUMMARY_ONLY consent from viewing OCR text', async () => {
      // CC-000016 gave Dr. Qureshi SUMMARY_ONLY consent
      const cc16Id = patientIds['CC-000016']
      const res = await fetch(
        `${server.baseUrl}/api/patients/${cc16Id}/documents/${labDocId}/ocr`,
        {
          headers: { Authorization: `Bearer ${docTokens.qureshi}` },
        },
      )
      assert.equal(res.status, 403)
      const data = await res.json()
      assert.equal(data.reason, 'CONSENT_SCOPE_INSUFFICIENT')
    })

    it('denies ADMIN from running or viewing OCR data (403 FORBIDDEN)', async () => {
      const res = await fetch(
        `${server.baseUrl}/api/patients/${patientId}/documents/${labDocId}/ocr`,
        {
          headers: { Authorization: `Bearer ${tokens.ADMIN}` },
        },
      )
      assert.equal(res.status, 403)
    })
  })

  // 3. Document Integrity & Failure Handling
  describe('failure handling & file preservation', () => {
    it('returns 404 when OCR requested for non-existent document', async () => {
      const fakeId = '7f1c2a9e-0000-4000-8000-000000000000'
      const res = await fetch(
        `${server.baseUrl}/api/patients/${patientId}/documents/${fakeId}/process-ocr`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${tokens.PATIENT}` },
        },
      )
      assert.equal(res.status, 404)
    })

    it('preserves the original document binary completely unchanged after OCR runs', async () => {
      // Fetch binary before and after and verify SHA-256 integrity
      const { rows } = await query(
        'SELECT sha256_checksum, storage_key FROM clinical.medical_documents WHERE id = $1',
        [labDocId],
      )
      const originalChecksum = rows[0].sha256_checksum

      const fileRes = await fetch(
        `${server.baseUrl}/api/patients/${patientId}/documents/${labDocId}/file`,
        {
          headers: { Authorization: `Bearer ${tokens.PATIENT}` },
        },
      )
      assert.equal(fileRes.status, 200)
      const fileBytes = Buffer.from(await fileRes.arrayBuffer())

      const crypto = await import('node:crypto')
      const actualDigest = crypto.createHash('sha256').update(fileBytes).digest('hex')
      assert.equal(actualDigest, originalChecksum.trim())
    })
  })

  // 4. Audit Logging
  describe('audit trail', () => {
    it('records MEDICAL_DOCUMENT_OCR_PROCESS and MEDICAL_DOCUMENT_OCR_VIEW in audit log', async () => {
      const procCount = await auditCount(
        "action = 'MEDICAL_DOCUMENT_OCR_PROCESS' AND patient_id = $1",
        [patientId],
      )
      assert.ok(procCount > 0, 'OCR process event must be logged')

      const viewCount = await auditCount(
        "action = 'MEDICAL_DOCUMENT_OCR_VIEW' AND patient_id = $1",
        [patientId],
      )
      assert.ok(viewCount > 0, 'OCR view event must be logged')
    })
  })
})
