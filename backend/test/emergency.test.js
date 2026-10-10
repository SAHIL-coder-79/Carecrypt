import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { PASSWORD, query, skipReason, startServer, USERS } from './helpers.js'

const skip = await skipReason()

describe('emergency break-glass access', { skip }, () => {
  let server
  let api
  const tokens = {}
  const ids = {}
  let qrToken

  before(async () => {
    server = await startServer()
    api = server.api
    Object.assign(tokens, await api.tokensForAllRoles())
    
    const { rows } = await query('SELECT mrn, id FROM clinical.patients')
    for (const r of rows) ids[r.mrn] = r.id

    const res = await api.raw({ method: 'POST', path: '/api/qr/my-card', headers: { Authorization: `Bearer ${tokens.PATIENT}`, 'Content-Type': 'application/json' }, body: '{}' })
    const parsed = JSON.parse(res.body)
    qrToken = parsed.qrToken
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
  
  const del = (path, tok) =>
    api
      .raw({
        method: 'DELETE',
        path,
        headers: { Authorization: `Bearer ${tok}` }
      })
      .then((r) => ({ status: r.status, body: r.body ? JSON.parse(r.body) : null }))

  const get = (path, tok) =>
    api
      .raw({
        method: 'GET',
        path,
        headers: { Authorization: `Bearer ${tok}` }
      })
      .then((r) => ({ status: r.status, body: r.body ? JSON.parse(r.body) : null }))

  test('Missing reason is rejected', async () => {
    const res = await post(`/api/patients/${ids['CC-000001']}/emergency-access`, tokens.CLINICIAN, {
      scope: 'FULL_RECORD',
      durationHours: 12
    })
    assert.strictEqual(res.status, 400)
    assert.strictEqual(res.body.details[0].field, 'reason')
  })

  test('Unauthorized role (Admin) is rejected', async () => {
    const res = await post(`/api/patients/${ids['CC-000001']}/emergency-access`, tokens.ADMIN, {
      reason: 'Heart attack',
      scope: 'FULL_RECORD',
      durationHours: 12
    })
    assert.strictEqual(res.status, 403)
  })

  test('Excessive duration is rejected', async () => {
    const res = await post(`/api/patients/${ids['CC-000001']}/emergency-access`, tokens.CLINICIAN, {
      reason: 'Heart attack',
      scope: 'FULL_RECORD',
      durationHours: 48
    })
    assert.strictEqual(res.status, 400)
    assert.strictEqual(res.body.details[0].field, 'durationHours')
  })

  test('Scope violation (invalid scope) is rejected', async () => {
    const res = await post(`/api/patients/${ids['CC-000001']}/emergency-access`, tokens.CLINICIAN, {
      reason: 'Heart attack',
      scope: 'UNLIMITED',
      durationHours: 12
    })
    assert.strictEqual(res.status, 400)
    assert.strictEqual(res.body.details[0].field, 'scope')
  })

  let accessId
  test('Valid emergency request is granted', async () => {
    const res = await post(`/api/patients/${ids['CC-000015']}/emergency-access`, tokens.CLINICIAN, {
      reason: 'Patient unconscious in ER',
      scope: 'FULL_RECORD',
      durationHours: 1
    })
    assert.strictEqual(res.status, 201)
    assert.ok(res.body.emergencyAccess.id)
    accessId = res.body.emergencyAccess.id
  })

  test('Access is allowed via emergency break-glass', async () => {
    const res = await get(`/api/patients/${ids['CC-000015']}`, tokens.CLINICIAN)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.access.via, 'EMERGENCY')
    assert.strictEqual(res.body.access.scope, 'FULL_RECORD')
  })

  test('Audit entry records the actual clinician and reason', async () => {
    const { rows } = await query(
      `SELECT * FROM audit.audit_logs 
        WHERE patient_id = $1 AND action = 'EMERGENCY_ACCESS_GRANT' 
        ORDER BY occurred_at DESC LIMIT 1`, 
      [ids['CC-000015']]
    )
    assert.strictEqual(rows.length, 1)
    assert.ok(rows[0].reason.includes('Patient unconscious in ER'))
    assert.strictEqual(rows[0].outcome, 'SUCCESS')
  })

  test('Administrator attempts to access an individual record via GET', async () => {
    const res = await get(`/api/patients/${ids['CC-000015']}`, tokens.ADMIN)
    assert.strictEqual(res.status, 403) // Admins can never access individual patient records
  })

  test('Access after revocation is denied', async () => {
    const revokeRes = await del(`/api/patients/${ids['CC-000015']}/emergency-access/${accessId}`, tokens.CLINICIAN)
    assert.strictEqual(revokeRes.status, 200)

    const res = await get(`/api/patients/${ids['CC-000015']}`, tokens.CLINICIAN)
    assert.strictEqual(res.status, 403) // No fallback consent for CC-000015
  })

  test('Access after expiry is denied', async () => {
    // Grant a new one, but backdate expiry and granted_at to satisfy constraint
    const { rows } = await query(
      `INSERT INTO clinical.emergency_access_records 
        (patient_id, clinician_id, scope, reason, granted_at, expires_at, recorded_by)
       VALUES ($1, (SELECT id FROM clinical.clinicians WHERE user_id = (SELECT id FROM identity.users WHERE email = $2)), 'FULL_RECORD', 'Test Expiry', now() - interval '2 hour', now() - interval '1 hour', (SELECT id FROM identity.users WHERE email = $2))
       RETURNING id`,
      [ids['CC-000015'], USERS.CLINICIAN]
    )
    
    const res = await get(`/api/patients/${ids['CC-000015']}`, tokens.CLINICIAN)
    assert.strictEqual(res.status, 403) // Expired
  })
  
  test('QR Emergency Access flow works', async () => {
    const res = await post(`/api/qr/emergency-access`, tokens.CLINICIAN, {
      qrToken,
      reason: 'QR Emergency',
      scope: 'FULL_RECORD',
      durationHours: 1
    })
    assert.strictEqual(res.status, 201)
    assert.strictEqual(res.body.patientId, ids['CC-000001'])
  })
})
