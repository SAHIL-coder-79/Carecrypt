// Patient consent API and its effect on record access.
//
// Uses patient Hetal Parmar (CC-000020, portal login) and Dr. Iyer (Bengaluru),
// who have no relationship in the seed. Dr. Desai holds the seeded FULL_RECORD
// consent for CC-000020. Sneha Gokhale (CC-000005) has an expired consent for Dr. Qureshi.

import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { auditCount, PASSWORD, query, skipReason, startServer, userId, USERS } from './helpers.js'

const HETAL = 'hetal.parmar@mail.example'
const SNEHA = 'sneha.gokhale@mail.example'
const IYER = 'dr.shalini.iyer@carecrypt.example'
const DESAI = 'dr.ravi.desai@carecrypt.example'

const skip = await skipReason()

describe('consent', { skip }, () => {
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
    // Start from a clean slate for Dr. Iyer on this patient.
    await query(
      `UPDATE clinical.consent_records SET revoked_at = now(), revoked_reason = 'Test reset'
        WHERE patient_id = $1 AND clinician_id = $2 AND revoked_at IS NULL`,
      [ids['CC-000020'], clinicians['DEMO-KMC-20001']],
    )
  })

  after(async () => {
    await server?.close()
  })

  const send = (method, path, tok, body) =>
    api
      .raw({
        method,
        path,
        headers: { ...(tok ? { Authorization: `Bearer ${tok}` } : {}), 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      .then((r) => ({ status: r.status, body: r.body ? JSON.parse(r.body) : null }))

  const grant = (tok, body) => send('POST', '/api/consent', tok, body)
  const list = (tok, mrn) => send('GET', `/api/consent/${ids[mrn]}`, tok)
  const revoke = (tok, id, body) => send('DELETE', `/api/consent/${id}`, tok, body)
  const iyerRecord = () => api.get(`/api/patients/${ids['CC-000020']}`, tokens.iyer)
  const grantBody = (extra = {}) => ({
    clinicianId: clinicians['DEMO-KMC-20001'],
    scope: 'VISIT_HISTORY',
    purpose: 'Second opinion on recurring UTI',
    durationDays: 30,
    ...extra,
  })

  describe('GET /api/consent/:patientId', () => {
    test('a patient sees every consent on their record with its status', async () => {
      const res = await list(tokens.hetal, 'CC-000020')
      assert.equal(res.status, 200)
      const desai = res.body.consents.find((c) => c.clinician.id === clinicians['DEMO-GMC-30001'])
      assert.equal(desai.status, 'ACTIVE')
      assert.equal(desai.scope, 'FULL_RECORD')
      assert.equal(desai.clinician.name, 'Dr. Ravi Desai')
      for (const key of ['id', 'patientId', 'purpose', 'status', 'grantedAt', 'expiresAt', 'revokedAt']) {
        assert.ok(key in desai, key)
      }
    })

    test('expired consents are reported as EXPIRED', async () => {
      const res = await list(tokens.sneha, 'CC-000005')
      const expired = res.body.consents.find((c) => c.clinician.id === clinicians['DEMO-MMC-10002'])
      assert.equal(expired.status, 'EXPIRED')
    })

    test("a patient cannot read another patient's consents", async () => {
      const res = await list(tokens.hetal, 'CC-000001')
      assert.equal(res.status, 403)
      assert.equal(res.body.reason, 'NOT_OWN_RECORD')
    })

    test('a clinician sees only consents granted to themselves', async () => {
      const desai = await list(tokens.desai, 'CC-000020')
      assert.ok(desai.body.consents.length >= 1)
      assert.ok(desai.body.consents.every((c) => c.clinician.id === clinicians['DEMO-GMC-30001']))
      const iyer = await list(tokens.iyer, 'CC-000001')
      assert.deepEqual(iyer.body.consents, [])
    })

    test('ADMIN and SECURITY_ADMIN → 403', async () => {
      for (const role of ['ADMIN', 'SECURITY_ADMIN']) {
        const res = await list(tokens[role], 'CC-000020')
        assert.equal(res.status, 403, role)
        assert.equal(res.body.consents, undefined)
      }
    })
  })

  describe('grant → access → revoke → no access', () => {
    let consentId

    test('before consent, Dr. Iyer cannot open the record', async () => {
      assert.equal((await iyerRecord()).status, 403)
    })

    test('the patient grants access (201) with purpose, scope and expiry', async () => {
      const res = await grant(tokens.hetal, grantBody())
      assert.equal(res.status, 201)
      const c = res.body.consent
      consentId = c.id
      assert.equal(c.patientId, ids['CC-000020'])
      assert.equal(c.clinician.id, clinicians['DEMO-KMC-20001'])
      assert.equal(c.purpose, 'Second opinion on recurring UTI')
      assert.equal(c.scope, 'VISIT_HISTORY')
      assert.equal(c.status, 'ACTIVE')
      assert.equal(c.channel, 'PATIENT_PORTAL')
      const days = (new Date(c.expiresAt) - new Date(c.grantedAt)) / 86_400_000
      assert.ok(Math.abs(days - 30) < 0.01)
    })

    test('Dr. Iyer can now open the record, at the granted scope', async () => {
      const res = await iyerRecord()
      assert.equal(res.status, 200)
      const { access, patient } = await res.json()
      assert.equal(access.scope, 'VISIT_HISTORY')
      assert.equal(patient.demographics.contact, undefined)
    })

    test('the patient appears in Dr. Iyer\'s patient list', async () => {
      const { patients } = await (await api.get('/api/patients', tokens.iyer)).json()
      assert.ok(patients.some((p) => p.mrn === 'CC-000020'))
    })

    test('granting again replaces the previous consent (one active per clinician)', async () => {
      const res = await grant(tokens.hetal, grantBody({ scope: 'SUMMARY_ONLY', durationDays: null, purpose: 'Summary for referral' }))
      assert.equal(res.status, 201)
      assert.equal(res.body.replaced, 1)
      assert.equal(res.body.consent.expiresAt, null, 'until revoked')
      const { body } = await list(tokens.hetal, 'CC-000020')
      const iyers = body.consents.filter((c) => c.clinician.id === clinicians['DEMO-KMC-20001'])
      assert.equal(iyers.filter((c) => c.status === 'ACTIVE').length, 1)
      const old = iyers.find((c) => c.id === consentId)
      assert.equal(old.status, 'REVOKED')
      assert.equal(old.revokedReason, 'Replaced by a new consent')
      consentId = res.body.consent.id
      assert.equal((await (await iyerRecord()).json()).access.scope, 'SUMMARY_ONLY')
    })

    test('the patient revokes access (200, REVOKED) and it takes effect immediately', async () => {
      const res = await revoke(tokens.hetal, consentId, { reason: 'Referral complete' })
      assert.equal(res.status, 200)
      assert.equal(res.body.consent.status, 'REVOKED')
      assert.equal(res.body.consent.revokedReason, 'Referral complete')
      assert.ok(res.body.consent.revokedAt)
      const after = await iyerRecord()
      assert.equal(after.status, 403)
      assert.equal((await after.json()).reason, 'NO_ACTIVE_CONSENT')
    })

    test('revoking twice → 409', async () => {
      const res = await revoke(tokens.hetal, consentId)
      assert.equal(res.status, 409)
      assert.equal(res.body.error, 'CONSENT_ALREADY_REVOKED')
    })

    test('the revocation is kept, not deleted', async () => {
      const { rows } = await query('SELECT revoked_at FROM clinical.consent_records WHERE id = $1', [consentId])
      assert.ok(rows[0].revoked_at)
    })
  })

  describe('who may grant and revoke', () => {
    test('a clinician may give up a consent granted to themselves', async () => {
      const { body } = await grant(tokens.hetal, grantBody())
      const res = await revoke(tokens.iyer, body.consent.id)
      assert.equal(res.status, 200)
      assert.equal(res.body.consent.revokedReason, 'Relinquished by clinician')
    })

    test("a clinician cannot revoke another clinician's consent (404)", async () => {
      const { body } = await list(tokens.hetal, 'CC-000020')
      const desaiConsent = body.consents.find((c) => c.clinician.id === clinicians['DEMO-GMC-30001'] && c.status === 'ACTIVE')
      const res = await revoke(tokens.iyer, desaiConsent.id)
      assert.equal(res.status, 404)
      assert.equal((await list(tokens.hetal, 'CC-000020')).body.consents.find((c) => c.id === desaiConsent.id).status, 'ACTIVE')
    })

    test("a patient cannot revoke another patient's consent (404, same as unknown)", async () => {
      const { body } = await list(tokens.hetal, 'CC-000020')
      const res = await revoke(tokens.PATIENT, body.consents[0].id)
      assert.equal(res.status, 404)
      const unknown = await revoke(tokens.PATIENT, '00000000-0000-4000-8000-000000000000')
      assert.deepEqual(res.body, unknown.body)
    })

    test('clinicians cannot grant consent (403)', async () => {
      const res = await grant(tokens.iyer, grantBody())
      assert.equal(res.status, 403)
    })

    test('a patient cannot grant consent on someone else\'s record (403)', async () => {
      const res = await grant(tokens.hetal, grantBody({ patientId: ids['CC-000001'] }))
      assert.equal(res.status, 403)
      assert.equal(res.body.reason, 'NOT_OWN_RECORD')
    })

    test('ADMIN and SECURITY_ADMIN can neither grant nor revoke (403)', async () => {
      const { body } = await list(tokens.hetal, 'CC-000020')
      for (const role of ['ADMIN', 'SECURITY_ADMIN']) {
        assert.equal((await grant(tokens[role], grantBody())).status, 403, role)
        assert.equal((await revoke(tokens[role], body.consents[0].id)).status, 403, role)
      }
    })

    test('no login → 401', async () => {
      assert.equal((await grant(null, grantBody())).status, 401)
      assert.equal((await list(null, 'CC-000020')).status, 401)
    })
  })

  describe('validation', () => {
    const cases = [
      ['missing clinician', { clinicianId: undefined }, 'clinicianId'],
      ['unknown clinician', { clinicianId: '00000000-0000-4000-8000-000000000000' }, 'clinicianId'],
      ['bad scope', { scope: 'EVERYTHING' }, 'scope'],
      ['empty purpose', { purpose: '  ' }, 'purpose'],
      ['zero days', { durationDays: 0 }, 'durationDays'],
      ['too long', { durationDays: 400 }, 'durationDays'],
      ['fractional days', { durationDays: 1.5 }, 'durationDays'],
    ]
    for (const [label, extra, field] of cases) {
      test(`${label} → 400 on ${field}`, async () => {
        const res = await grant(tokens.hetal, grantBody(extra))
        assert.equal(res.status, 400)
        assert.ok(res.body.details.some((d) => d.field === field))
      })
    }
  })

  describe('audit', () => {
    test('grants and revocations are logged against the patient', async () => {
      const hetalId = await userId(HETAL)
      const where = (action) => `action = '${action}' AND outcome = 'SUCCESS' AND user_id = $1 AND patient_id = $2`
      const [g0, r0] = [
        await auditCount(where('CONSENT_GRANT'), [hetalId, ids['CC-000020']]),
        await auditCount(where('CONSENT_REVOKE'), [hetalId, ids['CC-000020']]),
      ]
      const { body } = await grant(tokens.hetal, grantBody())
      await revoke(tokens.hetal, body.consent.id)
      assert.equal(await auditCount(where('CONSENT_GRANT'), [hetalId, ids['CC-000020']]), g0 + 1)
      assert.equal(await auditCount(where('CONSENT_REVOKE'), [hetalId, ids['CC-000020']]), r0 + 1)

      const { rows } = await query(
        `SELECT metadata FROM audit.audit_logs WHERE ${where('CONSENT_GRANT')} ORDER BY chain_seq DESC LIMIT 1`,
        [hetalId, ids['CC-000020']],
      )
      assert.equal(rows[0].metadata.clinician_id, clinicians['DEMO-KMC-20001'])
      assert.equal(rows[0].metadata.scope, 'VISIT_HISTORY')
      assert.equal(rows[0].metadata.duration_days, 30)
    })

    test('refused revocations are logged as DENIED', async () => {
      const uid = await userId(USERS.PATIENT)
      const where = `action = 'CONSENT_REVOKE' AND outcome = 'DENIED' AND user_id = $1`
      const before = await auditCount(where, [uid])
      const { body } = await list(tokens.hetal, 'CC-000020')
      await revoke(tokens.PATIENT, body.consents[0].id)
      assert.equal(await auditCount(where, [uid]), before + 1)
    })
  })

  describe('GET /api/clinicians (directory)', () => {
    test('patients and clinicians get names, specialties and facilities only', async () => {
      const res = await api.get('/api/clinicians', tokens.hetal)
      assert.equal(res.status, 200)
      const { clinicians: list } = await res.json()
      assert.equal(list.length, 5)
      assert.deepEqual(Object.keys(list[0]).sort(), ['district', 'facility', 'id', 'name', 'specialty', 'state'])
    })

    test('ADMIN → 403', async () => {
      assert.equal((await api.get('/api/clinicians', tokens.ADMIN)).status, 403)
    })
  })
})
