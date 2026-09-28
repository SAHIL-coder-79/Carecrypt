// End-to-end CareCrypt workflow, through the public API only:
//
//   PATIENT → own QR card → consent to a clinician
//   CLINICIAN → sign in → scan QR (refused before consent, allowed after)
//     → longitudinal record → current symptoms → SmartCare Assist (decision support)
//     → clinician assessment → new visit saved → audit log → aggregate analytics updated
//   ADMIN → population trends → patient record API: 403
//     → highly specific aggregate query: SUPPRESSED
//     → repeated narrowing queries: inference detection → SECURITY EVENT, queries paused
//   SECURITY_ADMIN → security dashboard → events and audit trail → resolves the event
//
// Uses Divya Hegde (CC-000015) and Dr. Qureshi, who have no consent in the seed;
// the consent is revoked again at the end. Needs ANALYTICS_DATABASE_URL.

import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { PASSWORD, query, skipReason, startServer, USERS } from './helpers.js'

const DIVYA = 'divya.hegde@mail.example'
const QURESHI = 'dr.farhan.qureshi@carecrypt.example'
const analyticsUrl = process.env.ANALYTICS_DATABASE_URL
const skip = (await skipReason()) || (analyticsUrl ? false : 'set ANALYTICS_DATABASE_URL to run')

describe('CareCrypt end-to-end workflow', { skip, concurrency: false }, () => {
  let server
  let tok = {}
  const state = {}

  before(async () => {
    server = await startServer()
    for (const [name, email] of Object.entries({ divya: DIVYA, qureshi: QURESHI, admin: USERS.ADMIN, security: USERS.SECURITY_ADMIN })) {
      const res = await server.api.login(email, PASSWORD)
      assert.equal(res.status, 200, `login ${name}`)
      tok[name] = (await res.json()).token
    }
    // A clean start for this admin's custom-query history.
    await query(
      `UPDATE audit.security_events SET status = 'RESOLVED', resolved_by = (SELECT id FROM identity.users WHERE email = $2),
              resolved_at = now(), resolution_note = 'e2e reset'
        WHERE user_id = (SELECT id FROM identity.users WHERE email = $1) AND status = 'OPEN'`,
      [USERS.ADMIN, USERS.SECURITY_ADMIN],
    )
    await query(
      `INSERT INTO audit.security_events (event_type, severity, user_id, user_role, summary, status, resolved_by, resolved_at, resolution_note)
       SELECT 'INFERENCE_PROBING', 'LOW', a.id, 'ADMIN', 'e2e reset marker', 'RESOLVED', s.id, now(), 'e2e reset'
         FROM identity.users a, identity.users s WHERE a.email = $1 AND s.email = $2`,
      [USERS.ADMIN, USERS.SECURITY_ADMIN],
    )
  })

  after(async () => {
    // Leave the seed as it was: withdraw the consent granted here.
    if (state.consentId) await call('DELETE', `/api/consent/${state.consentId}`, tok.divya, { reason: 'End of test' }).catch(() => {})
    await server?.close()
  })

  async function call(method, path, token, body) {
    const res = await fetch(`${server.baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body !== undefined && { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: res.status, body: await res.json().catch(() => null) }
  }
  const get = (path, token) => call('GET', path, token)
  const post = (path, token, body) => call('POST', path, token, body)

  test('1. PATIENT issues their own QR card: a random token, nothing else', async () => {
    const r = await post('/api/qr/my-card', tok.divya, {})
    assert.equal(r.status, 201)
    assert.match(r.body.qrToken, /^ccqr_[A-Za-z0-9_-]{32}$/)
    assert.equal(r.body.mrn, 'CC-000015')
    state.qrToken = r.body.qrToken
    const cards = await get('/api/qr/my-card', tok.divya)
    assert.equal(cards.body.cards[0].status, 'ACTIVE')
    assert.ok(!JSON.stringify(cards.body).includes(state.qrToken), 'the token is never shown again')
  })

  test('2. CLINICIAN without consent scans the card: 403, nothing revealed', async () => {
    const r = await post('/api/qr/resolve', tok.qureshi, { qrToken: state.qrToken })
    assert.equal(r.status, 403)
    assert.equal(r.body.reason, 'NO_ACTIVE_CONSENT')
    assert.equal(r.body.patientId, undefined)
  })

  test('3. PATIENT grants the clinician consent', async () => {
    const { body: dir } = await get('/api/clinicians', tok.divya)
    const qureshi = dir.clinicians.find((c) => c.name === 'Dr. Farhan Qureshi')
    const r = await post('/api/consent', tok.divya, {
      clinicianId: qureshi.id,
      scope: 'FULL_RECORD',
      purpose: 'Tele-consultation for cough and fever',
      durationDays: 7,
    })
    assert.equal(r.status, 201)
    state.consentId = r.body.consent.id
  })

  test('4. CLINICIAN scans the QR card and gets only the patient id', async () => {
    const r = await post('/api/qr/resolve', tok.qureshi, { qrToken: state.qrToken })
    assert.equal(r.status, 200)
    assert.deepEqual(Object.keys(r.body), ['patientId'])
    state.patientId = r.body.patientId
  })

  test('5. CLINICIAN opens the longitudinal record with a separate authorised request', async () => {
    const r = await get(`/api/patients/${state.patientId}`, tok.qureshi)
    assert.equal(r.status, 200)
    assert.equal(r.body.access.scope, 'FULL_RECORD')
    const visits = await get(`/api/patients/${state.patientId}/visits`, tok.qureshi)
    assert.equal(visits.status, 200)
    state.visitsBefore = visits.body.visits.length
    assert.ok(state.visitsBefore > 0, 'the seed gives Divya a history')
  })

  test('6. ADMIN notes the population totals before the visit', async () => {
    const r = await get('/api/analytics/overview', tok.admin)
    assert.equal(r.status, 200)
    state.casesBefore = r.body.totals.cases
    state.k = r.body.privacy.minGroupSize
    assert.equal(state.k, 10)
  })

  test('7. Current symptoms → SmartCare Assist → clinical decision support (no diagnosis created)', async () => {
    const r = await post('/api/smartcare/analyze', tok.qureshi, {
      patientId: state.patientId,
      currentSymptoms: [
        { code: 'cough', severity: 'MODERATE', durationDays: 4 },
        { code: 'fever', severity: 'MILD', durationDays: 2 },
        'sore_throat',
      ],
      vitals: { temperatureC: 38.1, pulseBpm: 92, systolic: 116, diastolic: 74, spo2Percent: 97 },
    })
    assert.equal(r.status, 200)
    assert.equal(r.body.label, 'Clinical Decision Support')
    assert.equal(r.body.disclaimer, 'Decision support only. Final clinical judgment remains with the clinician.')
    assert.ok(r.body.possibleConditions.length > 0)
    state.analysisId = r.body.analysisId
    const visits = await get(`/api/patients/${state.patientId}/visits`, tok.qureshi)
    assert.equal(visits.body.visits.length, state.visitsBefore, 'SmartCare saved nothing to the record')
  })

  test('8. Clinician assessment → new visit saved with the reviewed decision support linked', async () => {
    const r = await post(`/api/patients/${state.patientId}/visits`, tok.qureshi, {
      visitType: 'TELECONSULT',
      chiefComplaint: 'Cough and fever for 4 days',
      symptoms: [
        { code: 'cough', severity: 'MODERATE', durationDays: 4 },
        { code: 'fever', severity: 'MILD', durationDays: 2 },
        { code: 'sore_throat', severity: 'MILD' },
      ],
      vitals: { temperatureC: 38.1, pulseBpm: 92, systolic: 116, diastolic: 74, spo2Percent: 97 },
      diagnoses: [{ code: 'J06.9', type: 'CONFIRMED', isPrimary: true }],
      medications: [{ code: 'paracetamol', dose: '500 mg', frequency: 'Three times a day', durationDays: 3 }],
      notes: 'Viral URTI. Fluids and rest. Review if breathless.',
      decisionSupport: { analysisId: state.analysisId, reviewed: true },
      clinicianAttestation: true,
    })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    state.visitId = r.body.visit.id
    assert.equal(r.body.visit.assessment.confirmedBy, 'Dr. Farhan Qureshi')
    assert.equal(r.body.visit.decisionSupport.analysisId, state.analysisId)

    const visits = await get(`/api/patients/${state.patientId}/visits`, tok.qureshi)
    assert.equal(visits.body.visits.length, state.visitsBefore + 1)
    assert.equal(visits.body.visits[0].id, state.visitId, 'the new visit is the newest entry of the history')
  })

  test('9. The audit log holds the whole clinical trail, and the hash chain is intact', async () => {
    const { rows } = await query(
      `SELECT action, outcome FROM audit.audit_logs WHERE patient_id = $1 AND occurred_at > now() - interval '10 minutes'
        ORDER BY chain_seq`,
      [state.patientId],
    )
    const trail = rows.map((r) => `${r.action}:${r.outcome}`)
    for (const step of ['QR_CARD_ISSUE:SUCCESS', 'QR_PATIENT_ACCESS:DENIED', 'CONSENT_GRANT:SUCCESS', 'QR_PATIENT_ACCESS:SUCCESS',
      'PATIENT_RECORD_VIEW:SUCCESS', 'SMARTCARE_ANALYZE:SUCCESS', 'VISIT_CREATE:SUCCESS']) {
      assert.ok(trail.includes(step), `${step} missing from ${trail.join(', ')}`)
    }
    assert.ok(trail.indexOf('VISIT_CREATE:SUCCESS') > trail.indexOf('SMARTCARE_ANALYZE:SUCCESS'))
    const chain = await query('SELECT audit.verify_chain() AS broken')
    assert.equal(chain.rows[0].broken, null)
  })

  test('10. Aggregate analytics include the new visit at once', async () => {
    const r = await get('/api/analytics/overview', tok.admin)
    assert.equal(r.body.totals.cases, state.casesBefore + 1)
  })

  test('11. ADMIN sees population-level trends, with the minimum-group check applied', async () => {
    const [time, location] = await Promise.all([get('/api/analytics/by-time', tok.admin), get('/api/analytics/by-location', tok.admin)])
    assert.equal(time.status, 200)
    assert.ok(time.body.months.length >= 12)
    for (const c of [...time.body.months, ...time.body.byCategory, ...location.body.locations, ...location.body.byCategory]) {
      if (c.suppressed) assert.equal(c.patientCount, null)
      else if (c.patientCount) assert.ok(c.patientCount >= state.k)
    }
    assert.ok(location.body.locations.some((c) => c.suppressed), 'small districts are hidden at k = 10')
  })

  test('12. ADMIN attempts the patient record API: 403 FORBIDDEN, no data, security event', async () => {
    for (const path of [`/api/patients/${state.patientId}`, `/api/patients/${state.patientId}/visits`, '/api/patients']) {
      const r = await get(path, tok.admin)
      assert.equal(r.status, 403, path)
      assert.deepEqual(r.body, { error: 'FORBIDDEN', role: 'ADMIN', resource: 'PATIENT_RECORD', access: 'DENIED' })
    }
    const { rows } = await query(
      `SELECT e.id FROM audit.security_events e JOIN identity.users u ON u.id = e.user_id
        WHERE u.email = $1 AND e.event_type = 'PATIENT_DATA_ACCESS_DENIED' AND e.status = 'OPEN'`,
      [USERS.ADMIN],
    )
    assert.equal(rows.length, 1, 'one open event, repeated attempts are grouped')
    state.accessEventId = rows[0].id
  })

  test('13. ADMIN highly specific aggregate query: minimum-group check → SUPPRESSED', async () => {
    const r = await get('/api/analytics/query?district=Bengaluru%20Urban&condition=J06.9&month=2026-09&gender=FEMALE', tok.admin)
    assert.equal(r.status, 200)
    assert.deepEqual(r.body.result, { patientCount: null, caseCount: null, suppressed: true, suppression: 'SMALL_GROUP' })
    assert.equal(r.body.inferenceControl.flagged, false)
  })

  test('14. Repeated narrowing queries → inference detection → SECURITY EVENT, custom queries paused', async () => {
    const steps = [
      '',
      '?state=Karnataka',
      '?state=Karnataka&district=Bengaluru%20Urban',
      '?state=Karnataka&district=Bengaluru%20Urban&category=RESPIRATORY',
      '?state=Karnataka&district=Bengaluru%20Urban&category=RESPIRATORY&month=2026-09',
    ]
    let last
    for (const qs of steps) {
      last = await get(`/api/analytics/query${qs}`, tok.admin)
      assert.equal(last.status, 200, qs)
      if (last.body.inferenceControl.flagged) break
    }
    assert.equal(last.body.inferenceControl.flagged, true)
    assert.equal(last.body.inferenceControl.securityEvent.type, 'INFERENCE_NARROWING')
    state.inferenceEventId = last.body.inferenceControl.securityEvent.id

    const blocked = await get('/api/analytics/query?district=Pune', tok.admin)
    assert.equal(blocked.status, 403)
    assert.equal(blocked.body.error, 'ANALYTICS_QUERY_BLOCKED')
  })

  test('15. SECURITY_ADMIN dashboard: open events, audit trail without patient identities', async () => {
    const summary = await get('/api/security/summary', tok.security)
    assert.equal(summary.status, 200)
    assert.ok(summary.body.openEvents.total >= 2)
    assert.equal(summary.body.auditLog.chainIntact, true)
    assert.ok(summary.body.deniedLast7Days.some((d) => d.role === 'ADMIN' && d.resource === 'PATIENT_RECORD'))

    const events = await get('/api/security/events', tok.security)
    const ids = events.body.events.map((e) => e.id)
    assert.ok(ids.includes(state.inferenceEventId))
    assert.ok(ids.includes(state.accessEventId))
    const inference = events.body.events.find((e) => e.id === state.inferenceEventId)
    assert.equal(inference.user.name, 'Priya Admin (Demo)')
    assert.equal(inference.title, 'Repeated narrowing analytics queries')

    const audit = await get('/api/security/audit?limit=200', tok.security)
    const visitEntry = audit.body.entries.find((e) => e.action === 'VISIT_CREATE' && e.resourceId === state.visitId)
    assert.ok(visitEntry, 'the saved visit is in the audit trail')
    assert.equal(visitEntry.patientRecordId, state.patientId)
    const text = JSON.stringify(audit.body)
    assert.ok(!/Divya|Hegde/.test(text), 'no patient names in the security view')
    // Clinical content never appears next to a patient reference (an admin's
    // aggregate query filter may name a condition; that is not patient data).
    const patientEntries = JSON.stringify(audit.body.entries.filter((e) => e.patientRecordId))
    assert.ok(!patientEntries.includes('J06.9') && !patientEntries.includes('paracetamol'), 'no diagnoses or drugs for a patient')
  })

  test('16. SECURITY_ADMIN resolves the inference event; the admin can query again', async () => {
    const r = await post(`/api/security/events/${state.inferenceEventId}/resolve`, tok.security, {
      note: 'Reviewed with the analyst: exploring respiratory trends, no intent to identify.',
    })
    assert.equal(r.status, 200)
    assert.equal((await post(`/api/security/events/${state.inferenceEventId}/resolve`, tok.security, { note: 'again' })).status, 409)
    const again = await get('/api/analytics/query?district=Pune', tok.admin)
    assert.equal(again.status, 200)
    await post(`/api/security/events/${state.accessEventId}/resolve`, tok.security, { note: 'Admin reminded of the access policy.' })
  })

  test('17. Other roles cannot reach the security console', async () => {
    for (const t of [tok.admin, tok.qureshi, tok.divya]) {
      assert.equal((await get('/api/security/summary', t)).status, 403)
    }
  })
})
