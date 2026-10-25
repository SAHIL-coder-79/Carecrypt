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

describe('Stage 6: clinician review, verification and attestation of laboratory values', async () => {
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

    // Upload lab report
    const uploadRes = await fetch(`${server.baseUrl}/api/patients/${patientId}/documents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokens.PATIENT}`,
      },
      body: JSON.stringify({
        documentType: 'LAB_REPORT',
        fileName: 'cbc_attestation_test.png',
        mimeType: 'image/png',
        fileBase64: clearLabPngBase64,
      }),
    })
    const uploadData = await uploadRes.json()
    labDocId = uploadData.document.id

    // Run OCR and structured extraction to generate observation records
    const ocrRes = await fetch(`${server.baseUrl}/api/patients/${patientId}/documents/${labDocId}/process-ocr`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${docTokens.ranade}`,
      },
    })
    const ocrData = await ocrRes.json()
    assert.ok(ocrData.extraction && ocrData.extraction.observations.length > 0)
    obsId = ocrData.extraction.observations[0].id
  })

  after(async () => {
    await server?.close()
  })

  describe('authorized clinician verification without change (VERIFIED)', () => {
    it('allows clinician under FULL_RECORD consent to verify an observation as-is', async () => {
      const res = await fetch(
        `${server.baseUrl}/api/patients/${patientId}/lab-observations/${obsId}/verification`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${docTokens.ranade}`,
          },
          body: JSON.stringify({
            status: 'VERIFIED',
            note: 'Values verified against lab letterhead.',
          }),
        },
      )
      assert.equal(res.status, 200)
      const data = await res.json()
      assert.equal(data.observation.id, obsId)
      assert.equal(data.observation.verificationStatus, 'VERIFIED')
      assert.equal(data.observation.isCorrected, false)
      assert.equal(data.observation.version, 2)
      assert.equal(data.observation.verificationNote, 'Values verified against lab letterhead.')
    })
  })

  describe('authorized clinician correction (CORRECTED) with validation & provenance', () => {
    it('validates corrected values and recalculates abnormality while preserving original extraction', async () => {
      // First get current state to observe original provenance
      const getRes = await fetch(
        `${server.baseUrl}/api/patients/${patientId}/lab-observations`,
        {
          headers: { Authorization: `Bearer ${docTokens.ranade}` },
        },
      )
      const getData = await getRes.json()
      const currentObs = getData.observations.find((o) => o.id === obsId)
      assert.ok(currentObs)
      const origValNum = currentObs.originalValueNumeric
      const origUnit = currentObs.originalUnit
      const currentVersion = currentObs.version

      // Clinician corrects value to 8.5 (low / abnormal), unit to g/dL, range to 12.0 - 16.0
      const patchRes = await fetch(
        `${server.baseUrl}/api/patients/${patientId}/lab-observations/${obsId}/verification`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${docTokens.ranade}`,
          },
          body: JSON.stringify({
            status: 'CORRECTED',
            correctedValue: '8.5',
            correctedUnit: 'g/dL',
            correctedReferenceRange: '12.0 - 16.0',
            note: 'OCR missed smudge in digit; manual correction to 8.5 g/dL.',
            expectedVersion: currentVersion,
          }),
        },
      )

      assert.equal(patchRes.status, 200)
      const patchData = await patchRes.json()
      const obs = patchData.observation

      // Verified updated state
      assert.equal(obs.verificationStatus, 'CORRECTED')
      assert.equal(obs.isCorrected, true)
      assert.equal(obs.valueNumeric, 8.5)
      assert.equal(obs.unit, 'g/dL')
      assert.equal(obs.referenceRange, '12.0 - 16.0')
      assert.equal(obs.referenceLow, 12.0)
      assert.equal(obs.referenceHigh, 16.0)
      assert.equal(obs.isAbnormal, true) // 8.5 < 12.0 => abnormal!
      assert.equal(obs.version, currentVersion + 1)

      // Verified provenance: original_* fields were NOT overwritten!
      assert.equal(obs.originalValueNumeric, origValNum)
      assert.equal(obs.originalUnit, origUnit)

      // Verify attestation history entry was stored in clinical.lab_observation_attestations
      const { rows: history } = await query(
        `SELECT * FROM clinical.lab_observation_attestations WHERE observation_id = $1 ORDER BY attested_at DESC`,
        [obsId],
      )
      assert.ok(history.length >= 2) // 1 for VERIFIED, 1 for CORRECT
      const latest = history[0]
      assert.equal(latest.action, 'CORRECT')
      assert.equal(latest.new_status, 'CORRECTED')
      assert.equal(latest.new_value, '8.5')
      assert.equal(latest.new_unit, 'g/dL')
      assert.equal(latest.clinical_note, 'OCR missed smudge in digit; manual correction to 8.5 g/dL.')
    })

    it('rejects empty corrected value with 400 BAD_REQUEST', async () => {
      const res = await fetch(
        `${server.baseUrl}/api/patients/${patientId}/lab-observations/${obsId}/verification`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${docTokens.ranade}`,
          },
          body: JSON.stringify({
            status: 'CORRECTED',
            correctedValue: '   ',
          }),
        },
      )
      assert.equal(res.status, 400)
    })
  })

  describe('concurrency and optimistic locking (stale data & double submission)', () => {
    it('detects concurrent edits and rejects stale expectedVersion with 409 CONFLICT', async () => {
      // Current version is 3. Sending expectedVersion: 1 should fail.
      const res = await fetch(
        `${server.baseUrl}/api/patients/${patientId}/lab-observations/${obsId}/verification`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${docTokens.ranade}`,
          },
          body: JSON.stringify({
            status: 'VERIFIED',
            expectedVersion: 1, // Stale version!
            note: 'Concurrent edit attempt with stale view',
          }),
        },
      )
      assert.equal(res.status, 409)
      const err = await res.json()
      assert.equal(err.error, 'CONFLICT')
    })
  })

  describe('audit logging & event verification', () => {
    it('records LAB_OBSERVATION_ATTEST in append-only audit trail', async () => {
      const { rows: auditRows } = await query(
        `SELECT action, outcome, metadata FROM audit.audit_logs
          WHERE patient_id = $1 AND action = 'LAB_OBSERVATION_ATTEST'
          ORDER BY chain_seq DESC LIMIT 1`,
        [patientId],
      )
      assert.ok(auditRows.length > 0)
      const ev = auditRows[0]
      assert.equal(ev.action, 'LAB_OBSERVATION_ATTEST')
      assert.equal(ev.outcome, 'SUCCESS')
      const meta = typeof ev.metadata === 'string' ? JSON.parse(ev.metadata) : ev.metadata
      assert.equal(meta.action, 'CORRECT')
      assert.equal(meta.isCorrected, true)
    })
  })

  describe('access control & permission boundaries', () => {
    it('prevents patients from attesting or correcting lab observations (403 FORBIDDEN)', async () => {
      const res = await fetch(
        `${server.baseUrl}/api/patients/${patientId}/lab-observations/${obsId}/verification`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${tokens.PATIENT}`,
          },
          body: JSON.stringify({
            status: 'VERIFIED',
          }),
        },
      )
      assert.equal(res.status, 403)
      const err = await res.json()
      assert.equal(err.error, 'FORBIDDEN')
    })

    it('prevents clinicians without active consent from attesting (403 NO_ACTIVE_CONSENT)', async () => {
      const res = await fetch(
        `${server.baseUrl}/api/patients/${patientId}/lab-observations/${obsId}/verification`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${docTokens.qureshi}`,
          },
          body: JSON.stringify({
            status: 'VERIFIED',
          }),
        },
      )
      assert.equal(res.status, 403)
      const err = await res.json()
      assert.ok(err.reason === 'NO_ACTIVE_CONSENT' || err.error === 'FORBIDDEN' || err.error === 'NO_ACTIVE_CONSENT')
    })

    it('rejects cross-patient observation update attempts (404 NOT_FOUND)', async () => {
      // Trying to update obsId under otherPatientId
      const res = await fetch(
        `${server.baseUrl}/api/patients/${otherPatientId}/lab-observations/${obsId}/verification`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${docTokens.ranade}`,
          },
          body: JSON.stringify({
            status: 'VERIFIED',
          }),
        },
      )
      // Either 403 (no consent on other patient) or 404 (not found in other patient scope)
      assert.ok(res.status === 403 || res.status === 404)
    })
  })
})
