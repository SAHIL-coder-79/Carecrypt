import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { recordAuditEvent } from '../audit/auditLog.js'
import { query } from '../db/pool.js'
import { badRequest, HttpError } from '../lib/httpError.js'
import { authenticateToken } from '../middleware/authenticate.js'
import { requireRole } from '../middleware/requireRole.js'
import { authorizePatientAccess } from '../patients/access.js'
import { hashQrToken, issueQrToken } from '../qr/tokens.js'

const router = Router()
const AUDIT_ACTION = 'QR_PATIENT_ACCESS'

// Limits guessing of QR tokens.
const scanLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler(req, res, next) {
    next(new HttpError(429, 'TOO_MANY_REQUESTS', 'Too many QR scans. Wait a minute and try again.'))
  },
})

// POST /api/qr/resolve  { "qrToken": "<text encoded in the card>" }  →  { "patientId": "<uuid>" }
//
// Flow: authenticated clinician → card lookup by token hash → consent check →
// patient id only. The record itself must then be fetched with
// GET /api/patients/:patientId, which authorises and audits again.
// Every outcome is audited as QR_PATIENT_ACCESS.
router.post(
  '/resolve',
  authenticateToken(),
  requireRole('CLINICIAN', { resource: 'PATIENT_QR' }),
  scanLimiter,
  async (req, res) => {
    const raw = req.body?.qrToken
    if (typeof raw !== 'string' || raw.trim().length < 8 || raw.trim().length > 256) {
      throw badRequest('"qrToken" must be the text encoded in the patient QR card.')
    }
    const qrToken = raw.trim()

    const { rows } = await query(
      `SELECT q.id, q.patient_id, q.status, q.expires_at, q.token_hint
         FROM clinical.patient_qr_identities q
         JOIN clinical.patients p ON p.id = q.patient_id AND p.is_active
        WHERE q.token_hash = $1`,
      [hashQrToken(qrToken)],
    )
    const card = rows[0]
    const audit = (outcome, reason, patientId = null) =>
      recordAuditEvent({
        req,
        user: req.user,
        action: AUDIT_ACTION,
        resourceType: 'patient_qr',
        resourceId: card?.id ?? null,
        patientId,
        outcome,
        reason,
        metadata: card ? { token_hint: card.token_hint } : {},
      })

    if (!card) {
      await audit('FAILURE', 'Unknown QR token')
      throw new HttpError(404, 'QR_NOT_RECOGNISED', 'This QR code is not a CareCrypt patient card.')
    }
    if (card.status === 'REVOKED') {
      await audit('DENIED', 'Revoked QR card', card.patient_id)
      throw new HttpError(410, 'QR_REVOKED', 'This card has been revoked. Ask the patient for their current card.')
    }
    if (card.expires_at && new Date(card.expires_at) <= new Date()) {
      await audit('DENIED', 'Expired QR card', card.patient_id)
      throw new HttpError(410, 'QR_EXPIRED', 'This card has expired. Ask the patient for their current card.')
    }

    // A valid card is not enough: without an active consent this throws
    // 403 NO_ACTIVE_CONSENT (audited as QR_PATIENT_ACCESS / DENIED) and reveals nothing.
    const grant = await authorizePatientAccess(req, card.patient_id, { section: 'qr_resolve', action: AUDIT_ACTION })

    await audit('SUCCESS', `Consent ${grant.scope}`, card.patient_id)
    res.set('Cache-Control', 'no-store')
    res.json({ patientId: card.patient_id })
  },
)

// GET /api/qr/my-card  (PATIENT) → the state of the patient's own card, without the token.
router.get('/my-card', authenticateToken(), requireRole('PATIENT', { resource: 'OWN_QR_CARD' }), async (req, res) => {
  const { rows } = await query(
    `SELECT q.status, q.token_hint, q.issued_at, q.revoked_at
       FROM clinical.patient_qr_identities q
       JOIN clinical.patients p ON p.id = q.patient_id
      WHERE p.user_id = $1
      ORDER BY q.issued_at DESC
      LIMIT 5`,
    [req.user.id],
  )
  res.set('Cache-Control', 'no-store')
  res.json({
    cards: rows.map((c) => ({ status: c.status, tokenHint: c.token_hint, issuedAt: c.issued_at, revokedAt: c.revoked_at })),
  })
})

// POST /api/qr/my-card  (PATIENT) → issues a new card for the patient's own record
// and revokes the previous one. The token is returned once, to be shown as a QR
// code; only its hash is stored, so it cannot be shown again. Audited as QR_CARD_ISSUE.
router.post('/my-card', authenticateToken(), requireRole('PATIENT', { resource: 'OWN_QR_CARD' }), async (req, res) => {
  const { rows } = await query('SELECT id, mrn FROM clinical.patients WHERE user_id = $1 AND is_active', [req.user.id])
  const patient = rows[0]
  if (!patient) throw new HttpError(404, 'NO_PATIENT_RECORD', 'This account is not linked to an active patient record.')

  const qrToken = await issueQrToken(patient.id, { issuedBy: req.user.id, revokeReason: 'Replaced by the patient' })
  await recordAuditEvent({
    req,
    user: req.user,
    action: 'QR_CARD_ISSUE',
    resourceType: 'patient_qr',
    patientId: patient.id,
    outcome: 'SUCCESS',
    metadata: { token_hint: qrToken.slice(-4) },
  })
  res.set('Cache-Control', 'no-store')
  res.status(201).json({
    qrToken,
    tokenHint: qrToken.slice(-4),
    mrn: patient.mrn,
    note: 'The card holds only this random code. Any earlier card no longer works.',
  })
})

export default router
