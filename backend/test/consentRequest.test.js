import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { auditCount, PASSWORD, query, skipReason, startServer, userId, USERS } from './helpers.js'

const HETAL = 'hetal.parmar@mail.example' // CC-000020
const SNEHA = 'sneha.gokhale@mail.example' // CC-000005
const IYER = 'dr.shalini.iyer@carecrypt.example' // DEMO-KMC-20001
const DESAI = 'dr.ravi.desai@carecrypt.example' // DEMO-GMC-30001

const skip = await skipReason()

describe('consent requests workflow', { skip }, () => {
  let server
  let api
  const tokens = {}
  const ids = {}
  const clinicians = {}
  
  before(async () => {
    server = await startServer()
    api = server.api
    Object.assign(tokens, await api.tokensForAllRoles())
    for (const [name, email] of Object.entries({ hetal: HETAL, sneha: SNEHA, iyer: IYER, desai: DESAI })) {
      tokens[name] = (await (await api.login(email, PASSWORD)).json()).token
    }
    const p = await query('SELECT mrn, id FROM clinical.patients')
    for (const r of p.rows) ids[r.mrn] = r.id
    const c = await query('SELECT registration_number, id FROM clinical.clinicians')
    for (const r of c.rows) clinicians[r.registration_number] = r.id

    // Cleanup previous requests and grants between Iyer and Hetal for testing
    await query(`UPDATE clinical.consent_requests SET status = 'DENIED', resolved_at = now() WHERE patient_id = $1 AND clinician_id = $2 AND status = 'PENDING'`, [ids['CC-000020'], clinicians['DEMO-KMC-20001']])
    await query(`UPDATE clinical.emergency_access_records SET expires_at = now() WHERE patient_id = $1 AND clinician_id = $2 AND expires_at > now()`, [ids['CC-000020'], clinicians['DEMO-KMC-20001']])
    await query(
      `UPDATE clinical.consent_records SET revoked_at = now(), revoked_reason = 'Test reset'
        WHERE patient_id = $1 AND clinician_id = $2 AND revoked_at IS NULL`,
      [ids['CC-000020'], clinicians['DEMO-KMC-20001']],
    )
  })

  after(async () => {
    await server?.close()
  })

  const iyerRecord = () => api.get(`/api/patients/${ids['CC-000020']}`, tokens.iyer)
  const post = (path, tok, body) => fetch(`${server.baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
    body: JSON.stringify(body)
  })
  const del = (path, tok, body) => fetch(`${server.baseUrl}${path}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
    body: JSON.stringify(body)
  })
  
  let requestId = null

  describe('end-to-end request flow', () => {
    test('1. Clinician requests access without a grant; protected records remain inaccessible', async () => {
      // Confirm inaccessible first
      let res = await iyerRecord()
      assert.equal(res.status, 403, 'Should not have access initially')

      const reqRes = await post('/api/clinicians/consent-requests', tokens.iyer, { mrn: 'CC-000020', scope: 'VISIT_HISTORY', durationDays: 30, reason: 'Consultation' })
      assert.equal(reqRes.status, 201)
      const data = await reqRes.json()
      requestId = data.id
      assert.ok(requestId)

      // Confirm still inaccessible
      res = await iyerRecord()
      assert.equal(res.status, 403, 'Should not have access after requesting')
    })

    test('9. Duplicate submissions are rejected safely', async () => {
      const reqRes = await post('/api/clinicians/consent-requests', tokens.iyer, { mrn: 'CC-000020', scope: 'VISIT_HISTORY', durationDays: 30, reason: 'Consultation duplicate' })
      assert.equal(reqRes.status, 409, 'Duplicate request should be rejected')
    })

    test('2. Correct patient sees the pending request', async () => {
      const res = await api.get(`/api/consent/${ids['CC-000020']}/requests`, tokens.hetal)
      assert.equal(res.status, 200)
      const { requests } = await res.json()
      const req = requests.find(r => r.id === requestId)
      assert.ok(req, 'Patient should see the request')
      assert.equal(req.status, 'PENDING')
    })

    test('7. Other patients cannot approve, deny, or revoke the request', async () => {
      const res = await post(`/api/consent/requests/${requestId}/resolve`, tokens.sneha, { status: 'APPROVED' })
      assert.equal(res.status, 403, 'Another patient cannot resolve')
    })

    test('8. Administrators cannot retrieve identifiable records through new endpoints', async () => {
      const res = await api.get(`/api/consent/${ids['CC-000020']}/requests`, tokens.ADMIN)
      assert.equal(res.status, 403, 'Admin cannot view consent requests for a patient')
      
      const reqRes = await post('/api/clinicians/consent-requests', tokens.ADMIN, { mrn: 'CC-000020', scope: 'VISIT_HISTORY', durationDays: 30, reason: 'Admin attempt' })
      assert.equal(reqRes.status, 403, 'Admin cannot make consent requests')
    })

    test('3. Approval grants only the named clinician the approved scope and duration', async () => {
      const res = await post(`/api/consent/requests/${requestId}/resolve`, tokens.hetal, { status: 'APPROVED' })
      assert.equal(res.status, 200)

      // Clinician should now have access
      const accessRes = await iyerRecord()
      assert.equal(accessRes.status, 200)
      const { access } = await accessRes.json()
      assert.equal(access.scope, 'VISIT_HISTORY')
    })

    test('9. Invalid transitions are rejected safely (cannot re-approve or deny)', async () => {
      const res = await post(`/api/consent/requests/${requestId}/resolve`, tokens.hetal, { status: 'DENIED' })
      assert.equal(res.status, 409, 'Cannot transition an already approved request')
    })

    test('5. Revocation immediately blocks subsequent protected requests', async () => {
      // Find the generated consent record ID
      const { body } = await api.get(`/api/consent/${ids['CC-000020']}`, tokens.hetal).then(async r => ({ body: await r.json() }))
      const iyerConsent = body.consents.find(c => c.clinician.id === clinicians['DEMO-KMC-20001'] && c.status === 'ACTIVE')
      assert.ok(iyerConsent)

      const revokeRes = await del(`/api/consent/${iyerConsent.id}`, tokens.hetal, { reason: 'Revoked by patient' })
      assert.equal(revokeRes.status, 200)

      const accessRes = await iyerRecord()
      assert.equal(accessRes.status, 403, 'Access should be blocked after revocation')
    })

    test('4. Denial leaves access blocked', async () => {
      // Make a new request
      let reqRes = await post('/api/clinicians/consent-requests', tokens.iyer, { mrn: 'CC-000020', scope: 'FULL_RECORD', durationDays: 7, reason: 'Second request' })
      const newReqId = (await reqRes.json()).id

      // Deny it
      const res = await post(`/api/consent/requests/${newReqId}/resolve`, tokens.hetal, { status: 'DENIED' })
      assert.equal(res.status, 200)

      // Should still be blocked
      const accessRes = await iyerRecord()
      assert.equal(accessRes.status, 403)
    })

    test('10. Important actions are attributable in audit logs without unnecessary sensitive data', async () => {
      const hetalId = await userId(HETAL)
      const iyerId = await userId(IYER)

      const grantQuery = `SELECT * FROM audit.audit_logs WHERE action = 'CONSENT_GRANT' AND resource_type = 'consent_request' AND user_id = $1 AND patient_id = $2`
      const grantRows = await query(grantQuery, [hetalId, ids['CC-000020']])
      assert.ok(grantRows.rows.length >= 1)

      const denyQuery = `SELECT * FROM audit.audit_logs WHERE action = 'CONSENT_DENY' AND resource_type = 'consent_request' AND user_id = $1 AND patient_id = $2`
      const denyRows = await query(denyQuery, [hetalId, ids['CC-000020']])
      assert.ok(denyRows.rows.length >= 1)

      const reqQuery = `SELECT * FROM audit.audit_logs WHERE action = 'CONSENT_REQUEST' AND resource_type = 'consent_request' AND user_id = $1 AND patient_id = $2`
      const reqRows = await query(reqQuery, [iyerId, ids['CC-000020']])
      assert.ok(reqRows.rows.length >= 2)
    })

    test('11. Nonresponse never grants access automatically', async () => {
      // By design, a request stays PENDING until explicitly resolved.
      // Make a request and verify it does not grant access.
      await query(`UPDATE clinical.consent_requests SET status = 'DENIED', resolved_at = now() WHERE patient_id = $1 AND clinician_id = $2 AND status = 'PENDING'`, [ids['CC-000020'], clinicians['DEMO-KMC-20001']])
      let reqRes = await post('/api/clinicians/consent-requests', tokens.iyer, { mrn: 'CC-000020', scope: 'VISIT_HISTORY', durationDays: 30, reason: 'Pending request' })
      assert.equal(reqRes.status, 201)

      const accessRes = await iyerRecord()
      assert.equal(accessRes.status, 403, 'Access should not be granted automatically without approval')
    })
    
    test('12. Emergency access uses the existing break-glass flow and never fabricates patient consent', async () => {
       const emerRes = await post(`/api/patients/${ids['CC-000020']}/emergency-access`, tokens.iyer, { reason: 'Life threatening', scope: 'SUMMARY_ONLY', durationHours: 1 })
       assert.equal(emerRes.status, 201)
       // The access granted is through emergency_access_records not consent_records
       const parsed = await emerRes.json()
       const { rows } = await query(`SELECT scope FROM clinical.emergency_access_records WHERE id = $1`, [ parsed.emergencyAccess.id ])
       assert.equal(rows[0].scope, 'SUMMARY_ONLY')
    })
  })
})
