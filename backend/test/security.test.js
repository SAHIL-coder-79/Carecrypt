// SECURITY_ADMIN console: access, summary, events, resolution, audit trail
// (no patient names or clinical content), and the events raised by denied
// patient-data access and account lockout.

import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { auditCount, query, skipReason, startServer, userId, USERS } from './helpers.js'

const skip = await skipReason()
const LOCK_TARGET = 'sneha.gokhale@mail.example'

describe('security console', { skip }, () => {
  let server
  let api
  let tokens

  before(async () => {
    server = await startServer()
    api = server.api
    tokens = await api.tokensForAllRoles()
  })

  after(async () => {
    await query(`UPDATE identity.users SET failed_login_count = 0, locked_until = NULL WHERE email = $1`, [LOCK_TARGET])
    await server?.close()
  })

  const call = async (method, path, token, body) => {
    const res = await fetch(`${server.baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body !== undefined && { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: res.status, body: await res.json().catch(() => null) }
  }

  test('only SECURITY_ADMIN may use it', async () => {
    for (const path of ['/api/security/summary', '/api/security/events', '/api/security/audit']) {
      assert.equal((await api.get(path)).status, 401)
      for (const role of ['PATIENT', 'CLINICIAN', 'ADMIN']) {
        const r = await call('GET', path, tokens[role])
        assert.equal(r.status, 403, `${role} ${path}`)
        assert.equal(r.body.resource, 'SECURITY_CONSOLE')
      }
      assert.equal((await call('GET', path, tokens.SECURITY_ADMIN)).status, 200, path)
    }
  })

  test('summary reports open events, recent activity and audit-chain integrity', async () => {
    const r = await call('GET', '/api/security/summary', tokens.SECURITY_ADMIN)
    assert.equal(r.body.auditLog.chainIntact, true)
    assert.ok(r.body.auditLog.entries > 0)
    for (const key of ['HIGH', 'MEDIUM', 'LOW', 'total']) assert.equal(typeof r.body.openEvents[key], 'number')
    for (const key of ['deniedRequests', 'failedLogins', 'analyticsQueries', 'securityEvents']) {
      assert.equal(typeof r.body.last24Hours[key], 'number')
    }
  })

  test('an ADMIN opening a patient record raises one grouped PATIENT_DATA_ACCESS_DENIED event', async () => {
    const admin = await userId(USERS.ADMIN)
    const officer = await userId(USERS.SECURITY_ADMIN)
    await query(
      `UPDATE audit.security_events SET status = 'RESOLVED', resolved_by = $2, resolved_at = now(), resolution_note = 'test reset'
        WHERE user_id = $1 AND status = 'OPEN'`,
      [admin, officer],
    )
    const { rows: p } = await query(`SELECT id FROM clinical.patients WHERE mrn = 'CC-000001'`)
    for (let i = 0; i < 3; i++) assert.equal((await call('GET', `/api/patients/${p[0].id}`, tokens.ADMIN)).status, 403)
    const { rows } = await query(
      `SELECT * FROM audit.security_events WHERE user_id = $1 AND event_type = 'PATIENT_DATA_ACCESS_DENIED' AND status = 'OPEN'`,
      [admin],
    )
    assert.equal(rows.length, 1)
    assert.equal(rows[0].severity, 'MEDIUM')
    assert.equal(rows[0].details.targeted_patient, true)
    assert.ok(!JSON.stringify(rows[0].details).includes(p[0].id), 'the event does not copy the patient id')

    const list = await call('GET', '/api/security/events', tokens.SECURITY_ADMIN)
    const e = list.body.events.find((x) => x.id === rows[0].id)
    assert.equal(e.user.name, 'Priya Admin (Demo)')
    assert.equal(e.status, 'OPEN')
  })

  test('events can be resolved once, with a note; resolution is audited', async () => {
    const { body } = await call('GET', '/api/security/events', tokens.SECURITY_ADMIN)
    const target = body.events.find((e) => e.status === 'OPEN')
    assert.ok(target, 'an open event exists')
    assert.equal((await call('POST', `/api/security/events/${target.id}/resolve`, tokens.SECURITY_ADMIN, { note: 'x' })).status, 400)
    assert.equal((await call('POST', `/api/security/events/not-a-uuid/resolve`, tokens.SECURITY_ADMIN, { note: 'fine note' })).status, 400)
    assert.equal(
      (await call('POST', '/api/security/events/00000000-0000-4000-8000-000000000000/resolve', tokens.SECURITY_ADMIN, { note: 'fine note' })).status,
      404,
    )
    assert.equal((await call('POST', `/api/security/events/${target.id}/resolve`, tokens.ADMIN, { note: 'self-clearing' })).status, 403)

    const ok = await call('POST', `/api/security/events/${target.id}/resolve`, tokens.SECURITY_ADMIN, { note: 'Reviewed; policy reminder sent.' })
    assert.equal(ok.status, 200)
    assert.equal((await call('POST', `/api/security/events/${target.id}/resolve`, tokens.SECURITY_ADMIN, { note: 'again please' })).status, 409)
    assert.equal(await auditCount(`action = 'SECURITY_EVENT_RESOLVE' AND resource_id = $1`, [target.id]), 1)

    const resolved = await call('GET', '/api/security/events?status=RESOLVED', tokens.SECURITY_ADMIN)
    const r = resolved.body.events.find((e) => e.id === target.id)
    assert.equal(r.resolvedBy, 'Security Officer (Demo)')
    assert.equal(r.resolutionNote, 'Reviewed; policy reminder sent.')
  })

  test('an account lockout raises ACCOUNT_LOCKED', async () => {
    const id = await userId(LOCK_TARGET)
    for (let i = 0; i < 5; i++) assert.equal((await api.login(LOCK_TARGET, 'wrong-password')).status, 401)
    const { rows } = await query(
      `SELECT severity, details FROM audit.security_events WHERE user_id = $1 AND event_type = 'ACCOUNT_LOCKED' ORDER BY detected_at DESC LIMIT 1`,
      [id],
    )
    assert.equal(rows[0].severity, 'MEDIUM')
    assert.equal(rows[0].details.failed_login_count, 5)
    // Patient accounts are named only as "Patient account" in the console.
    const { body } = await call('GET', '/api/security/events?status=ALL', tokens.SECURITY_ADMIN)
    const e = body.events.find((x) => x.type === 'ACCOUNT_LOCKED' && x.user?.id === id)
    assert.equal(e.user.name, 'Patient account')
    assert.equal(e.user.email, null)
  })

  test('the audit trail shows patient record ids but no patient names or clinical details', async () => {
    const r = await call('GET', '/api/security/audit?limit=200', tokens.SECURITY_ADMIN)
    assert.equal(r.status, 200)
    const { rows: names } = await query('SELECT first_name, last_name FROM clinical.patients')
    const text = JSON.stringify(r.body)
    for (const n of names) {
      assert.ok(!new RegExp(`\\b${n.first_name} ${n.last_name}\\b`).test(text), `${n.first_name} ${n.last_name}`)
    }
    for (const e of r.body.entries) {
      if (e.actor?.role === 'PATIENT') assert.equal(e.actor.name, 'Patient account')
      for (const key of Object.keys(e.metadata)) {
        assert.ok(!['diagnoses', 'medications', 'top_condition', 'symptoms'].includes(key), `${e.action} exposes ${key}`)
      }
    }
  })

  test('audit filters and paging work and are validated', async () => {
    const denied = await call('GET', '/api/security/audit?outcome=DENIED&limit=5', tokens.SECURITY_ADMIN)
    assert.ok(denied.body.entries.length > 0 && denied.body.entries.every((e) => e.outcome === 'DENIED'))
    const logins = await call('GET', '/api/security/audit?action=LOGIN&role=ADMIN', tokens.SECURITY_ADMIN)
    assert.ok(logins.body.entries.every((e) => e.action === 'LOGIN' && e.actor?.role === 'ADMIN'))
    const page1 = await call('GET', '/api/security/audit?limit=3', tokens.SECURITY_ADMIN)
    const page2 = await call('GET', `/api/security/audit?limit=3&before=${page1.body.nextBefore}`, tokens.SECURITY_ADMIN)
    assert.ok(page2.body.entries[0].sequence < page1.body.entries.at(-1).sequence)
    for (const bad of ['outcome=MAYBE', 'role=ROOT', 'limit=1000', 'action=drop table', 'patientId=1']) {
      assert.equal((await call('GET', `/api/security/audit?${bad}`, tokens.SECURITY_ADMIN)).status, 400, bad)
    }
  })

  test('the console audits its own use', async () => {
    const officer = await userId(USERS.SECURITY_ADMIN)
    const before = await auditCount(`action = 'SECURITY_AUDIT_VIEW' AND user_id = $1`, [officer])
    await call('GET', '/api/security/summary', tokens.SECURITY_ADMIN)
    await call('GET', '/api/security/audit', tokens.SECURITY_ADMIN)
    assert.equal(await auditCount(`action = 'SECURITY_AUDIT_VIEW' AND user_id = $1`, [officer]), before + 2)
  })
})

describe('patient QR card (self-service)', { skip }, () => {
  let server
  let api
  let tokens

  before(async () => {
    server = await startServer()
    api = server.api
    tokens = await api.tokensForAllRoles()
  })

  after(async () => {
    await server?.close()
  })

  const post = (path, token, body) =>
    fetch(`${server.baseUrl}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(async (r) => ({ status: r.status, body: await r.json() }))

  test('a patient issues a new card; the clinician with consent can scan it; the old card stops working', async () => {
    const first = await post('/api/qr/my-card', tokens.PATIENT, {})
    const second = await post('/api/qr/my-card', tokens.PATIENT, {})
    assert.equal(second.status, 201)
    assert.notEqual(first.body.qrToken, second.body.qrToken)

    // Ananya (CC-000001) has consented to Dr. Ranade.
    const scan = await post('/api/qr/resolve', tokens.CLINICIAN, { qrToken: second.body.qrToken })
    assert.equal(scan.status, 200)
    const { rows } = await query(`SELECT id FROM clinical.patients WHERE mrn = 'CC-000001'`)
    assert.equal(scan.body.patientId, rows[0].id)
    assert.equal((await post('/api/qr/resolve', tokens.CLINICIAN, { qrToken: first.body.qrToken })).status, 410)

    const { rows: stored } = await query(
      `SELECT count(*)::int AS n FROM clinical.patient_qr_identities WHERE token_hash = $1 OR token_hint = $1`,
      [second.body.qrToken],
    )
    assert.equal(stored[0].n, 0, 'the raw token is not stored')
  })

  test('only patients can issue their own card', async () => {
    for (const role of ['CLINICIAN', 'ADMIN', 'SECURITY_ADMIN']) {
      assert.equal((await post('/api/qr/my-card', tokens[role], {})).status, 403, role)
    }
  })
})
