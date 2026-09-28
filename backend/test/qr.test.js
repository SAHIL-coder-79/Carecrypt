// QR-based patient identification.
//
// Flow under test:
//   clinician scans card → POST /api/qr/resolve { qrToken } → { patientId }
//   → GET /api/patients/:patientId (separately authenticated, authorised and audited)
//
// Cards are issued here with the same service `npm run qr:cards` uses, so the
// tests never depend on known or predictable tokens.

import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { auditCount, PASSWORD, query, skipReason, startServer, userId, USERS } from './helpers.js'

const IYER = 'dr.shalini.iyer@carecrypt.example'

const skip = await skipReason()
const { generateQrToken, hashQrToken, issueQrToken, TOKEN_PREFIX } = await import('../src/qr/tokens.js')

describe('QR patient identification', { skip }, () => {
  let server
  let api
  const tokens = {}
  const ids = {}
  const cards = {}

  before(async () => {
    server = await startServer()
    api = server.api
    Object.assign(tokens, await api.tokensForAllRoles())
    tokens.iyer = (await (await api.login(IYER, PASSWORD)).json()).token
    const { rows } = await query('SELECT mrn, id FROM clinical.patients')
    for (const r of rows) ids[r.mrn] = r.id

    cards.p1 = await issueQrToken(ids['CC-000001'])
    cards.p2 = await issueQrToken(ids['CC-000002'])
    cards.p3old = await issueQrToken(ids['CC-000003'])
    cards.p3 = await issueQrToken(ids['CC-000003'], { revokeReason: 'Card reported lost (test)' })
  })

  after(async () => {
    await server?.close()
  })

  const resolve = (tok, body) =>
    api
      .raw({
        method: 'POST',
        path: '/api/qr/resolve',
        headers: { ...(tok ? { Authorization: `Bearer ${tok}` } : {}), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      .then((r) => ({ status: r.status, body: r.body ? JSON.parse(r.body) : null, raw: r.body }))

  describe('what a card contains', () => {
    test('a token is a prefix plus 192 random bits, and nothing else', () => {
      const t = generateQrToken()
      assert.match(t, /^ccqr_[A-Za-z0-9_-]{32}$/)
      assert.ok(t.startsWith(TOKEN_PREFIX))
      const many = new Set(Array.from({ length: 1000 }, generateQrToken))
      assert.equal(many.size, 1000, 'tokens do not repeat')
    })

    test('an issued card token carries no identifier, name or health data', async () => {
      const { rows } = await query(
        `SELECT p.mrn, p.first_name, p.last_name, p.phone, p.date_of_birth::text AS dob FROM clinical.patients p WHERE p.id = $1`,
        [ids['CC-000001']],
      )
      const p = rows[0]
      for (const value of [ids['CC-000001'], p.mrn, p.mrn.replace('-', ''), p.first_name, p.last_name, p.phone, p.dob]) {
        assert.ok(!cards.p1.toLowerCase().includes(String(value).toLowerCase()), `token must not contain ${value}`)
      }
    })

    test('the database stores only the SHA-256 hash, never the token', async () => {
      const raw = await query('SELECT count(*)::int n FROM clinical.patient_qr_identities WHERE token_hash = $1', [cards.p1])
      assert.equal(raw.rows[0].n, 0)
      const hashed = await query(
        `SELECT status FROM clinical.patient_qr_identities WHERE token_hash = $1`,
        [hashQrToken(cards.p1)],
      )
      assert.deepEqual(hashed.rows, [{ status: 'ACTIVE' }])
    })

    test('issuing a new card revokes the old one; one active card per patient', async () => {
      const { rows } = await query(
        `SELECT status, count(*)::int n FROM clinical.patient_qr_identities WHERE patient_id = $1 GROUP BY status`,
        [ids['CC-000003']],
      )
      const byStatus = Object.fromEntries(rows.map((r) => [r.status, r.n]))
      assert.equal(byStatus.ACTIVE, 1)
      assert.ok(byStatus.REVOKED >= 1)
    })
  })

  describe('POST /api/qr/resolve', () => {
    test('a valid card with consent returns only { patientId }', async () => {
      const res = await resolve(tokens.CLINICIAN, { qrToken: cards.p1 })
      assert.equal(res.status, 200)
      assert.deepEqual(res.body, { patientId: ids['CC-000001'] })
    })

    test('the record itself still needs its own authenticated, authorised request', async () => {
      const { body } = await resolve(tokens.CLINICIAN, { qrToken: cards.p1 })
      assert.equal((await api.get(`/api/patients/${body.patientId}`)).status, 401, 'no token')
      assert.equal((await api.get(`/api/patients/${body.patientId}`, tokens.ADMIN)).status, 403, 'admin')
      assert.equal((await api.get(`/api/patients/${body.patientId}`, tokens.iyer)).status, 403, 'no consent')
      const ok = await api.get(`/api/patients/${body.patientId}`, tokens.CLINICIAN)
      assert.equal(ok.status, 200)
      assert.equal((await ok.json()).patient.mrn, 'CC-000001')
    })

    test('a valid card without consent → 403 NO_ACTIVE_CONSENT, no patient id', async () => {
      const res = await resolve(tokens.iyer, { qrToken: cards.p1 })
      assert.equal(res.status, 403)
      assert.equal(res.body.reason, 'NO_ACTIVE_CONSENT')
      assert.ok(!res.raw.includes(ids['CC-000001']))
      assert.ok(!res.raw.includes('CC-000001'))
    })

    test('a replaced (lost) card → 410 QR_REVOKED; the new card works', async () => {
      const old = await resolve(tokens.CLINICIAN, { qrToken: cards.p3old })
      assert.equal(old.status, 410)
      assert.equal(old.body.error, 'QR_REVOKED')
      assert.ok(!old.raw.includes(ids['CC-000003']))
      const current = await resolve(tokens.CLINICIAN, { qrToken: cards.p3 })
      assert.deepEqual(current.body, { patientId: ids['CC-000003'] })
    })

    test('an unknown card → 404 QR_NOT_RECOGNISED', async () => {
      for (const qrToken of [generateQrToken(), 'https://example.com/not-a-card', 'CCQR-DEMO-CC000001']) {
        const res = await resolve(tokens.CLINICIAN, { qrToken })
        assert.equal(res.status, 404, qrToken)
        assert.equal(res.body.error, 'QR_NOT_RECOGNISED')
      }
    })

    test('a missing or malformed qrToken → 400', async () => {
      for (const body of [{}, { qrToken: '' }, { qrToken: 'short' }, { qrToken: 42 }, { token: cards.p1 }]) {
        assert.equal((await resolve(tokens.CLINICIAN, body)).status, 400, JSON.stringify(body).slice(0, 40))
      }
    })

    test('no login → 401', async () => {
      assert.equal((await resolve(null, { qrToken: cards.p1 })).status, 401)
    })

    test('ADMIN, SECURITY_ADMIN and PATIENT cannot resolve cards (403, no patient id)', async () => {
      for (const role of ['ADMIN', 'SECURITY_ADMIN', 'PATIENT']) {
        const res = await resolve(tokens[role], { qrToken: cards.p1 })
        assert.equal(res.status, 403, role)
        assert.ok(!res.raw.includes(ids['CC-000001']), role)
      }
    })
  })

  describe('audit: QR_PATIENT_ACCESS', () => {
    const count = (userEmail, outcome, extra = '', params = []) =>
      userId(userEmail).then((uid) =>
        auditCount(`action = 'QR_PATIENT_ACCESS' AND user_id = $1 AND outcome = '${outcome}' ${extra}`, [uid, ...params]),
      )

    test('successful resolution is audited against the patient', async () => {
      const before = await count(USERS.CLINICIAN, 'SUCCESS', 'AND patient_id = $2', [ids['CC-000002']])
      await resolve(tokens.CLINICIAN, { qrToken: cards.p2 })
      assert.equal(await count(USERS.CLINICIAN, 'SUCCESS', 'AND patient_id = $2', [ids['CC-000002']]), before + 1)
    })

    test('unknown cards are audited as FAILURE, revoked cards and missing consent as DENIED', async () => {
      const f0 = await count(USERS.CLINICIAN, 'FAILURE')
      await resolve(tokens.CLINICIAN, { qrToken: generateQrToken() })
      assert.equal(await count(USERS.CLINICIAN, 'FAILURE'), f0 + 1)

      const r0 = await count(USERS.CLINICIAN, 'DENIED', "AND reason = 'Revoked QR card'")
      await resolve(tokens.CLINICIAN, { qrToken: cards.p3old })
      assert.equal(await count(USERS.CLINICIAN, 'DENIED', "AND reason = 'Revoked QR card'"), r0 + 1)

      const c0 = await count(IYER, 'DENIED', "AND reason = 'NO_ACTIVE_CONSENT' AND patient_id = $2", [ids['CC-000001']])
      await resolve(tokens.iyer, { qrToken: cards.p1 })
      assert.equal(await count(IYER, 'DENIED', "AND reason = 'NO_ACTIVE_CONSENT' AND patient_id = $2", [ids['CC-000001']]), c0 + 1)
    })

    test('opening the record afterwards is a separate PATIENT_RECORD_VIEW event', async () => {
      const uid = await userId(USERS.CLINICIAN)
      const views = `action = 'PATIENT_RECORD_VIEW' AND outcome = 'SUCCESS' AND user_id = $1 AND patient_id = $2`
      const before = await auditCount(views, [uid, ids['CC-000002']])
      const { body } = await resolve(tokens.CLINICIAN, { qrToken: cards.p2 })
      assert.equal(await auditCount(views, [uid, ids['CC-000002']]), before, 'resolving alone is not a record view')
      await api.get(`/api/patients/${body.patientId}`, tokens.CLINICIAN)
      assert.equal(await auditCount(views, [uid, ids['CC-000002']]), before + 1)
    })

    test('raw card tokens never appear in the audit log', async () => {
      const { rows } = await query(
        `SELECT count(*)::int n FROM audit.audit_logs
          WHERE coalesce(resource_id, '') || coalesce(reason, '') || metadata::text LIKE ANY ($1)`,
        [Object.values(cards).map((t) => `%${t}%`)],
      )
      assert.equal(rows[0].n, 0)
    })
  })
})
