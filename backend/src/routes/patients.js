import { Router } from 'express'
import { recordAuditEvent } from '../audit/auditLog.js'
import { query } from '../db/pool.js'
import { HttpError } from '../lib/httpError.js'
import { authenticateToken } from '../middleware/authenticate.js'
import { requireRole } from '../middleware/requireRole.js'
import {
  auditPatientAccess,
  authorizePatientAccess,
  parsePatientId,
  sectionsFor,
} from '../patients/access.js'
import {
  buildRecentActivity,
  toAllergy,
  toChronicCondition,
  toDemographics,
  toDiagnosisEntry,
  toMedications,
  toVisit,
} from '../patients/record.js'
import * as repo from '../patients/repository.js'
import { parseNewVisit } from '../patients/visitInput.js'
import { isUuid } from '../lib/validate.js'
import {
  ALLOWED_DOCUMENT_TYPES,
  SUPPORTED_MIME_TYPES,
  deleteDocumentFile,
  detectMimeType,
  readDocumentFile,
  writeDocumentFile,
} from '../documents/storage.js'
import * as docRepo from '../documents/repository.js'
import { generateConsolidatedReportPdf } from '../documents/reportPdf.js'
import { processDocumentOcr } from '../documents/ocrService.js'
import {
  parseStructuredLabReport,
  SUPPORTED_PANELS,
  parseReferenceRange,
  evaluateAbnormality,
  normalizeNumericValue,
} from '../documents/labParser.js'
import { generateMedicalReportAnalysis } from '../documents/reportAnalyzer.js'
import { env } from '../config/env.js'
import { assertNoAllergyConflict, assertReferenceCodes, insertVisit } from '../patients/visitWriter.js'

// Identifiable patient records. Only CLINICIAN (with an active consent) and
// PATIENT (own record) get past requireRole; ADMIN and SECURITY_ADMIN are
// refused before any patient data is read.
const router = Router()

// Applied per route (not router.use) so a refusal can record which patient was targeted.
const guard = [
  authenticateToken(),
  requireRole('CLINICIAN', 'PATIENT', { resource: 'PATIENT_RECORD', patientParam: 'patientId', securityEvent: true }),
  (req, res, next) => {
    res.set('Cache-Control', 'no-store')
    next()
  },
]

// Writing a visit is for clinicians only.
const writeGuard = [
  authenticateToken(),
  requireRole('CLINICIAN', { resource: 'PATIENT_RECORD_WRITE', patientParam: 'patientId', securityEvent: true }),
  (req, res, next) => {
    res.set('Cache-Control', 'no-store')
    next()
  },
]

// Patients the caller may open. ?search= filters clinicians' consented patients
// by name or MRN; it never searches beyond them.
router.get('/', guard, async (req, res) => {
  const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : ''
  const rows =
    req.user.role === 'CLINICIAN'
      ? await repo.listConsentedPatients(req.user.id, { search: search || null })
      : await repo.getOwnPatientSummary(req.user.id)

  await recordAuditEvent({
    req,
    user: req.user,
    action: search ? 'PATIENT_SEARCH' : 'PATIENT_LIST_VIEW',
    resourceType: 'patient',
    outcome: 'SUCCESS',
    metadata: { count: rows.length, ...(search ? { query_length: search.length } : {}) },
  })

  res.json({
    patients: rows.map((p) => ({
      id: p.id,
      mrn: p.mrn,
      fullName: `${p.first_name} ${p.last_name}`,
      ageYears: p.age_years,
      gender: p.gender,
      location: { city: p.city, district: p.district },
      consentScope: p.scope ?? 'FULL_RECORD',
      consentExpiresAt: p.expires_at ? new Date(p.expires_at).toISOString() : null,
      lastVisitAt: p.last_visit_at ? new Date(p.last_visit_at).toISOString() : null,
    })),
  })
})

// Loads the patient row; with a valid grant a missing row can only mean the
// record was deactivated, so 404 reveals nothing new.
async function loadPatient(patientId) {
  const patient = await repo.getPatient(patientId)
  if (!patient) throw new HttpError(404, 'NOT_FOUND', 'Patient record not found.')
  return patient
}

function accessInfo(grant, sections) {
  return { via: grant.via, scope: grant.scope, sections }
}

// Full longitudinal record.
router.get('/:patientId', guard, async (req, res) => {
  const patientId = parsePatientId(req.params.patientId)
  const grant = await authorizePatientAccess(req, patientId, { section: 'record' })
  const sections = sectionsFor(grant.scope)
  const patient = await loadPatient(patientId)

  const [allergyRows, conditionRows, medicationRows, visitRows, consentRows, accessRows] = await Promise.all([
    repo.getAllergies(patientId),
    repo.getChronicConditions(patientId),
    repo.getMedicationHistory(patientId),
    sections.visitHistory ? repo.getVisits(patientId) : null,
    repo.getConsentEvents(patientId),
    grant.via === 'SELF' ? repo.getAccessEvents(patientId) : null,
  ])

  const allergies = allergyRows.map(toAllergy)
  const visitHistory = visitRows ? visitRows.map(toVisit) : null

  await auditPatientAccess(req, patientId, 'record', grant)

  res.json({
    patient: {
      id: patient.id,
      mrn: patient.mrn,
      demographics: toDemographics(patient, sections),
      allergies,
      chronicConditions: conditionRows.map(toChronicCondition),
      medications: toMedications(medicationRows, sections),
      visitHistory,
      recentActivity: buildRecentActivity({
        visits: visitHistory,
        allergies,
        consents: consentRows,
        accessEvents: accessRows,
      }),
    },
    access: accessInfo(grant, sections),
  })
})

router.get('/:patientId/visits', guard, async (req, res) => {
  const patientId = parsePatientId(req.params.patientId)
  const grant = await authorizePatientAccess(req, patientId, { section: 'visits', minimumScope: 'VISIT_HISTORY' })
  await loadPatient(patientId)
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 100)
  const visits = (await repo.getVisits(patientId, { limit })).map(toVisit)
  await auditPatientAccess(req, patientId, 'visits', grant)
  res.json({ patientId, visits, access: accessInfo(grant, sectionsFor(grant.scope)) })
})

router.get('/:patientId/medications', guard, async (req, res) => {
  const patientId = parsePatientId(req.params.patientId)
  const grant = await authorizePatientAccess(req, patientId, { section: 'medications' })
  const sections = sectionsFor(grant.scope)
  await loadPatient(patientId)
  const medications = toMedications(await repo.getMedicationHistory(patientId), sections)
  await auditPatientAccess(req, patientId, 'medications', grant)
  res.json({ patientId, ...medications, access: accessInfo(grant, sections) })
})

router.get('/:patientId/conditions', guard, async (req, res) => {
  const patientId = parsePatientId(req.params.patientId)
  const grant = await authorizePatientAccess(req, patientId, { section: 'conditions' })
  const sections = sectionsFor(grant.scope)
  await loadPatient(patientId)
  const [chronic, diagnoses] = await Promise.all([
    repo.getChronicConditions(patientId),
    sections.diagnosisHistory ? repo.getDiagnosisHistory(patientId) : null,
  ])
  await auditPatientAccess(req, patientId, 'conditions', grant)
  res.json({
    patientId,
    chronicConditions: chronic.map(toChronicCondition),
    diagnosisHistory: diagnoses ? diagnoses.map(toDiagnosisEntry) : null,
    access: accessInfo(grant, sections),
  })
})

// Add a visit. Needs an active consent covering at least the visit history, a
// valid body, known reference codes and no conflict with a recorded drug allergy.
router.post('/:patientId/visits', writeGuard, async (req, res) => {
  const patientId = parsePatientId(req.params.patientId)
  const grant = await authorizePatientAccess(req, patientId, {
    section: 'visit_create',
    minimumScope: 'VISIT_HISTORY',
    action: 'VISIT_CREATE',
  })
  const input = parseNewVisit(req.body)
  await loadPatient(patientId)
  await assertReferenceCodes(input)
  await assertNoAllergyConflict(patientId, input.medications)

  const visitId = await insertVisit({ patientId, clinicianId: grant.clinicianId, input })
  const [row] = await repo.getVisits(patientId, { visitId })

  await recordAuditEvent({
    req,
    user: req.user,
    action: 'VISIT_CREATE',
    resourceType: 'visit',
    resourceId: visitId,
    patientId,
    outcome: 'SUCCESS',
    reason: `Consent ${grant.scope}`,
    metadata: {
      symptoms: input.symptoms.length,
      diagnoses: input.diagnoses.map((d) => d.code),
      clinician_attested: true,
      decision_support_analysis_id: input.decisionSupport?.analysisId ?? null,
      medications: input.medications.map((m) => m.code),
    },
  })

  res.status(201).json({ visit: toVisit(row) })
})

// Emergency access: break-glass
router.post('/:patientId/emergency-access', authenticateToken(), requireRole('CLINICIAN', { resource: 'EMERGENCY_ACCESS', patientParam: 'patientId', securityEvent: true }), async (req, res) => {
  const patientId = parsePatientId(req.params.patientId)
  const body = req.body ?? {}
  
  const details = []
  if (!body.reason || typeof body.reason !== 'string' || body.reason.trim().length < 5) {
    details.push({ field: 'reason', message: 'must provide a valid emergency reason (at least 5 characters).' })
  }
  const SCOPES = ['FULL_RECORD', 'VISIT_HISTORY', 'SUMMARY_ONLY']
  if (!SCOPES.includes(body.scope)) {
    details.push({ field: 'scope', message: `must be one of ${SCOPES.join(', ')}.` })
  }
  if (!Number.isInteger(body.durationHours) || body.durationHours < 1 || body.durationHours > 24) {
    details.push({ field: 'durationHours', message: 'must be between 1 and 24 hours.' })
  }
  if (details.length > 0) {
    throw new HttpError(400, 'BAD_REQUEST', 'Validation failed.', { body: { error: 'VALIDATION_FAILED', details } })
  }

  // Load patient to ensure it exists and is active
  await repo.getPatient(patientId).then(p => { if (!p) throw new HttpError(404, 'NOT_FOUND', 'Patient record not found.') })

  const { rows: clinRows } = await query('SELECT id FROM clinical.clinicians WHERE user_id = $1 AND is_active', [req.user.id])
  if (!clinRows[0]) {
    throw new HttpError(403, 'FORBIDDEN', 'No active clinician profile.')
  }
  const clinicianId = clinRows[0].id

  const { rows } = await query(
    `INSERT INTO clinical.emergency_access_records 
      (patient_id, clinician_id, scope, reason, expires_at, recorded_by)
     VALUES ($1, $2, $3, $4, now() + interval '1 hour' * $5, $6)
     RETURNING id, scope, expires_at`,
    [patientId, clinicianId, body.scope, body.reason.trim(), body.durationHours, req.user.id]
  )
  const record = rows[0]

  await recordAuditEvent({
    req,
    user: req.user,
    action: 'EMERGENCY_ACCESS_GRANT',
    resourceType: 'emergency_access',
    resourceId: record.id,
    patientId,
    outcome: 'SUCCESS',
    reason: `Break-glass emergency access for ${body.reason}`,
    metadata: { scope: body.scope, duration_hours: body.durationHours, clinician_id: clinicianId }
  })

  res.status(201).json({ emergencyAccess: record })
})

router.delete('/:patientId/emergency-access/:id', authenticateToken(), requireRole('CLINICIAN', { resource: 'EMERGENCY_ACCESS_REVOKE', patientParam: 'patientId', securityEvent: true }), async (req, res) => {
  const patientId = parsePatientId(req.params.patientId)
  const id = req.params.id

  const { rows } = await query(
    `UPDATE clinical.emergency_access_records
        SET revoked_at = now(), revoked_reason = $1
      WHERE id = $2 AND patient_id = $3 AND revoked_at IS NULL
      RETURNING id, scope, clinician_id`,
    ['Revoked manually', id, patientId]
  )
  if (!rows[0]) throw new HttpError(404, 'NOT_FOUND', 'Emergency access record not found or already revoked.')

  await recordAuditEvent({
    req,
    user: req.user,
    action: 'EMERGENCY_ACCESS_REVOKE',
    resourceType: 'emergency_access',
    resourceId: id,
    patientId,
    outcome: 'SUCCESS',
    reason: 'Manual revocation',
    metadata: { scope: rows[0].scope, clinician_id: rows[0].clinician_id }
  })

  res.json({ success: true })
})

// Who has used this patient's record: for the patient only (their own record).
// Built from the audit log. Clinicians are named; administrators appear by role
// only. The patient's own record views are left out as noise.
const historyGuard = [
  authenticateToken(),
  requireRole('PATIENT', { resource: 'ACCESS_HISTORY', patientParam: 'patientId', securityEvent: true }),
  (req, res, next) => {
    res.set('Cache-Control', 'no-store')
    next()
  },
]

const ACCESS_ACTIONS = {
  PATIENT_RECORD_VIEW: ['Opened your record', 'Tried to open your record'],
  QR_PATIENT_ACCESS: ['Scanned your CareCrypt card', 'Scanned your CareCrypt card'],
  SMARTCARE_ANALYZE: ['Ran SmartCare decision support on your record', 'Tried to run SmartCare on your record'],
  VISIT_CREATE: ['Recorded a visit', 'Tried to record a visit'],
  ACCESS_DENIED: ['Tried to open your record', 'Tried to open your record'],
  CONSENT_GRANT: ['Granted access', 'Tried to grant access'],
  CONSENT_REVOKE: ['Withdrew access', 'Tried to withdraw access'],
  QR_CARD_ISSUE: ['Issued a new CareCrypt card', 'Tried to issue a card'],
}
const ROLE_ACTOR = { ADMIN: 'An administrator', SECURITY_ADMIN: 'A security administrator' }

router.get('/:patientId/access-log', historyGuard, async (req, res) => {
  const patientId = parsePatientId(req.params.patientId)
  await authorizePatientAccess(req, patientId, { section: 'access_history', action: 'ACCESS_HISTORY_VIEW' })

  const { rows } = await query(
    `SELECT a.chain_seq, a.occurred_at, a.action, a.outcome, a.user_id, a.user_role,
            u.display_name, f.name AS facility
       FROM audit.audit_logs a
       LEFT JOIN identity.users u ON u.id = a.user_id
       LEFT JOIN clinical.clinicians c ON c.user_id = a.user_id
       LEFT JOIN clinical.facilities f ON f.id = c.facility_id
      WHERE a.patient_id = $1
        AND a.action = ANY($2::text[])
        AND NOT (a.user_id = $3 AND a.action = 'PATIENT_RECORD_VIEW')
      ORDER BY a.chain_seq DESC
      LIMIT 200`,
    [patientId, Object.keys(ACCESS_ACTIONS), req.user.id],
  )
  await recordAuditEvent({
    req,
    user: req.user,
    action: 'ACCESS_HISTORY_VIEW',
    resourceType: 'patient',
    resourceId: patientId,
    patientId,
    outcome: 'SUCCESS',
    metadata: { returned: rows.length },
  })

  const entries = rows.map((r) => {
    const self = r.user_id === req.user.id
    const refused = r.outcome !== 'SUCCESS'
    return {
      id: String(r.chain_seq),
      occurredAt: r.occurred_at,
      actor: self
        ? { kind: 'SELF', name: 'You' }
        : r.user_role === 'CLINICIAN'
          ? { kind: 'CLINICIAN', name: r.display_name, facility: r.facility }
          : { kind: r.user_role ?? 'UNKNOWN', name: ROLE_ACTOR[r.user_role] ?? 'Unknown account' },
      action: r.action,
      description: ACCESS_ACTIONS[r.action][refused ? 1 : 0],
      outcome: refused ? 'REFUSED' : 'ALLOWED',
    }
  })
  const others = entries.filter((e) => e.actor.kind !== 'SELF')
  res.json({
    patientId,
    summary: {
      clinicians: new Set(others.filter((e) => e.actor.kind === 'CLINICIAN' && e.outcome === 'ALLOWED').map((e) => e.actor.name)).size,
      allowedAccesses: others.filter((e) => e.outcome === 'ALLOWED').length,
      refusedAttempts: others.filter((e) => e.outcome === 'REFUSED').length,
      lastAccessAt: others.find((e) => e.outcome === 'ALLOWED')?.occurredAt ?? null,
    },
    entries,
  })
})

// -----------------------------------------------------------------------------
// Medical Documents (Stage 1 Slice)
// POST   /api/patients/:patientId/documents
// GET    /api/patients/:patientId/documents
// GET    /api/patients/:patientId/documents/:documentId
// GET    /api/patients/:patientId/documents/:documentId/file
// -----------------------------------------------------------------------------

// POST /api/patients/:patientId/documents
// Ingests a new medical document with magic-byte signature validation,
// SHA-256 digest computation, and private binary storage.
router.post('/:patientId/documents', guard, async (req, res) => {
  const patientId = parsePatientId(req.params.patientId)
  const grant = await authorizePatientAccess(req, patientId, {
    section: 'documents_write',
    minimumScope: 'VISIT_HISTORY',
    action: 'MEDICAL_DOCUMENT_UPLOAD',
  })
  await loadPatient(patientId)

  const body = req.body || {}
  const { documentType, fileName, mimeType, fileBase64, visitId = null } = body

  const details = []
  if (!documentType || !ALLOWED_DOCUMENT_TYPES.has(documentType)) {
    details.push({
      field: 'documentType',
      message: `must be one of: ${[...ALLOWED_DOCUMENT_TYPES].join(', ')}.`,
    })
  }

  if (typeof fileName !== 'string' || fileName.trim().length === 0 || fileName.length > 255) {
    details.push({ field: 'fileName', message: 'must be a non-empty string under 255 characters.' })
  }

  if (!mimeType || !SUPPORTED_MIME_TYPES[mimeType]) {
    details.push({
      field: 'mimeType',
      message: `must be a supported MIME type (${Object.keys(SUPPORTED_MIME_TYPES).join(', ')}).`,
    })
  }

  if (typeof fileBase64 !== 'string' || fileBase64.trim().length === 0) {
    details.push({ field: 'fileBase64', message: 'must provide base64-encoded file payload.' })
  }

  if (visitId !== null && !isUuid(visitId)) {
    details.push({ field: 'visitId', message: 'must be a valid UUID if provided.' })
  }

  if (details.length > 0) {
    throw new HttpError(400, 'BAD_REQUEST', 'Validation failed.', {
      body: { error: 'VALIDATION_FAILED', details },
    })
  }

  // Decode file buffer
  let buffer
  try {
    buffer = Buffer.from(fileBase64, 'base64')
  } catch (err) {
    throw new HttpError(400, 'BAD_REQUEST', 'Malformed base64 file data.')
  }

  if (buffer.length === 0) {
    throw new HttpError(400, 'BAD_REQUEST', 'Uploaded file cannot be empty.')
  }

  if (buffer.length > env.uploadMaxFileSizeBytes) {
    throw new HttpError(
      413,
      'PAYLOAD_TOO_LARGE',
      `File exceeds maximum permitted size of ${Math.round(env.uploadMaxFileSizeBytes / (1024 * 1024))}MB.`,
    )
  }

  // Inspect file signature (magic bytes) to defeat spoofed MIME types
  const detected = detectMimeType(buffer)
  if (!detected || detected !== mimeType) {
    await recordAuditEvent({
      req,
      user: req.user,
      action: 'MEDICAL_DOCUMENT_UPLOAD',
      resourceType: 'medical_document',
      patientId,
      outcome: 'DENIED',
      reason: 'MIME_SIGNATURE_MISMATCH',
      metadata: { claimedMime: mimeType, detectedMime: detected },
    })
    throw new HttpError(
      400,
      'BAD_REQUEST',
      `File signature does not match claimed MIME type ${mimeType}.`,
    )
  }

  // Check optional visit exists and belongs to this patient
  if (visitId) {
    const { rows: visitRows } = await query(
      'SELECT id FROM clinical.visits WHERE id = $1 AND patient_id = $2',
      [visitId, patientId],
    )
    if (!visitRows[0]) {
      throw new HttpError(400, 'BAD_REQUEST', 'Referenced visitId does not belong to this patient.')
    }
  }

  // Write file to private storage
  let stored
  try {
    stored = await writeDocumentFile({ patientId, buffer, mimeType })
  } catch (storageErr) {
    console.error('Storage write error:', storageErr)
    throw new HttpError(500, 'STORAGE_ERROR', 'Failed to persist document to secure storage.')
  }

  // Insert metadata into database
  let doc
  try {
    doc = await docRepo.insertDocument({
      patientId,
      uploadedBy: req.user.id,
      visitId,
      documentType,
      originalFileName: fileName.trim(),
      mimeType,
      fileSizeBytes: stored.sizeBytes,
      storageKey: stored.storageKey,
      sha256Checksum: stored.sha256Checksum,
      status: 'READY',
    })
  } catch (dbErr) {
    // Cleanup orphaned file on database insert failure
    await deleteDocumentFile(stored.storageKey)
    console.error('Database document insert error:', dbErr)
    throw new HttpError(500, 'DATABASE_ERROR', 'Failed to register document in health record.')
  }

  await recordAuditEvent({
    req,
    user: req.user,
    action: 'MEDICAL_DOCUMENT_UPLOAD',
    resourceType: 'medical_document',
    resourceId: doc.id,
    patientId,
    outcome: 'SUCCESS',
    reason: grant.via === 'SELF' ? 'Patient upload' : `Consent ${grant.scope}`,
    metadata: {
      documentType,
      fileSizeBytes: stored.sizeBytes,
      mimeType,
      sha256: stored.sha256Checksum,
      visitId,
    },
  })

  res.status(201).json({
    document: {
      id: doc.id,
      patientId: doc.patient_id,
      visitId: doc.visit_id,
      documentType: doc.document_type,
      originalFileName: doc.original_file_name,
      mimeType: doc.mime_type,
      fileSizeBytes: Number(doc.file_size_bytes),
      sha256Checksum: doc.sha256_checksum,
      status: doc.status,
      createdAt: doc.created_at,
    },
  })
})

// GET /api/patients/:patientId/documents
// Lists all active documents under the active consent scope.
// Requires at least VISIT_HISTORY scope (SUMMARY_ONLY cannot list or view documents).
router.get('/:patientId/documents', guard, async (req, res) => {
  const patientId = parsePatientId(req.params.patientId)
  const grant = await authorizePatientAccess(req, patientId, {
    section: 'documents_list',
    minimumScope: 'VISIT_HISTORY',
    action: 'MEDICAL_DOCUMENT_LIST',
  })
  await loadPatient(patientId)

  const visitId = req.query.visitId
  if (visitId && !isUuid(visitId)) {
    throw new HttpError(400, 'BAD_REQUEST', 'visitId query parameter must be a valid UUID.')
  }

  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 100)
  const docs = await docRepo.listDocumentsByPatient(patientId, { visitId, limit })

  await recordAuditEvent({
    req,
    user: req.user,
    action: 'MEDICAL_DOCUMENT_LIST',
    resourceType: 'medical_document',
    patientId,
    outcome: 'SUCCESS',
    reason: grant.via === 'SELF' ? 'Own record' : `Consent ${grant.scope}`,
    metadata: { count: docs.length, visitId: visitId || null },
  })

  res.json({
    patientId,
    documents: docs.map((d) => ({
      id: d.id,
      patientId: d.patient_id,
      uploadedBy: d.uploaded_by,
      visitId: d.visit_id,
      documentType: d.document_type,
      originalFileName: d.original_file_name,
      mimeType: d.mime_type,
      fileSizeBytes: Number(d.file_size_bytes),
      sha256Checksum: d.sha256_checksum,
      status: d.status,
      createdAt: d.created_at,
    })),
    access: accessInfo(grant, sectionsFor(grant.scope)),
  })
})

// GET /api/patients/:patientId/documents/:documentId
// Retrieves document metadata.
router.get('/:patientId/documents/:documentId', guard, async (req, res) => {
  const patientId = parsePatientId(req.params.patientId)
  const documentId = req.params.documentId
  if (!isUuid(documentId)) {
    throw new HttpError(400, 'BAD_REQUEST', 'documentId must be a valid UUID.')
  }

  const grant = await authorizePatientAccess(req, patientId, {
    section: 'document_metadata',
    minimumScope: 'VISIT_HISTORY',
    action: 'MEDICAL_DOCUMENT_VIEW',
  })
  await loadPatient(patientId)

  const doc = await docRepo.getDocumentById(patientId, documentId)
  if (!doc) {
    throw new HttpError(404, 'NOT_FOUND', 'Medical document not found.')
  }

  await recordAuditEvent({
    req,
    user: req.user,
    action: 'MEDICAL_DOCUMENT_VIEW',
    resourceType: 'medical_document',
    resourceId: doc.id,
    patientId,
    outcome: 'SUCCESS',
    reason: grant.via === 'SELF' ? 'Own record' : `Consent ${grant.scope}`,
    metadata: { documentType: doc.document_type, mimeType: doc.mime_type },
  })

  res.json({
    document: {
      id: doc.id,
      patientId: doc.patient_id,
      uploadedBy: doc.uploaded_by,
      visitId: doc.visit_id,
      documentType: doc.document_type,
      originalFileName: doc.original_file_name,
      mimeType: doc.mime_type,
      fileSizeBytes: Number(doc.file_size_bytes),
      sha256Checksum: doc.sha256_checksum,
      status: doc.status,
      createdAt: doc.created_at,
      updatedAt: doc.updated_at,
    },
    access: accessInfo(grant, sectionsFor(grant.scope)),
  })
})

// GET /api/patients/:patientId/documents/:documentId/file
// Streams private document binary payload with SHA-256 integrity verification,
// safe Content-Disposition, and restrictive security headers.
router.get('/:patientId/documents/:documentId/file', guard, async (req, res) => {
  const patientId = parsePatientId(req.params.patientId)
  const documentId = req.params.documentId
  if (!isUuid(documentId)) {
    throw new HttpError(400, 'BAD_REQUEST', 'documentId must be a valid UUID.')
  }

  const grant = await authorizePatientAccess(req, patientId, {
    section: 'document_binary',
    minimumScope: 'VISIT_HISTORY',
    action: 'MEDICAL_DOCUMENT_DOWNLOAD',
  })
  await loadPatient(patientId)

  const doc = await docRepo.getDocumentById(patientId, documentId)
  if (!doc) {
    throw new HttpError(404, 'NOT_FOUND', 'Medical document not found.')
  }

  let fileBuffer
  try {
    fileBuffer = await readDocumentFile(doc.storage_key, doc.sha256_checksum)
  } catch (err) {
    if (err.code === 'INTEGRITY_ERROR') {
      await recordAuditEvent({
        req,
        user: req.user,
        action: 'MEDICAL_DOCUMENT_INTEGRITY_FAILURE',
        resourceType: 'medical_document',
        resourceId: doc.id,
        patientId,
        outcome: 'FAILURE',
        reason: 'Checksum mismatch upon read',
        metadata: { expectedSha256: doc.sha256_checksum },
      })
    }
    throw err
  }

  await recordAuditEvent({
    req,
    user: req.user,
    action: 'MEDICAL_DOCUMENT_DOWNLOAD',
    resourceType: 'medical_document',
    resourceId: doc.id,
    patientId,
    outcome: 'SUCCESS',
    reason: grant.via === 'SELF' ? 'Own record' : `Consent ${grant.scope}`,
    metadata: {
      documentType: doc.document_type,
      fileSizeBytes: Number(doc.file_size_bytes),
      sha256: doc.sha256_checksum,
    },
  })

  // Security Headers: prevent MIME sniffing, caching of PHI, and cross-origin embedding
  res.set('Cache-Control', 'private, no-cache, no-store, must-revalidate')
  res.set('Pragma', 'no-cache')
  res.set('Expires', '0')
  res.set('X-Content-Type-Options', 'nosniff')
  res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'")

  // Sanitize filename for Content-Disposition header
  const sanitizedName = doc.original_file_name.replace(/["\r\n\\]/g, '_')
  const mimeConfig = SUPPORTED_MIME_TYPES[doc.mime_type]
  const inlineRequested = req.query.disposition === 'inline'
  const isInline = inlineRequested && mimeConfig?.safeInline

  const dispositionType = isInline ? 'inline' : 'attachment'
  res.set('Content-Disposition', `${dispositionType}; filename="${sanitizedName}"`)
  res.set('Content-Type', doc.mime_type)
  res.set('Content-Length', fileBuffer.length)

  res.send(fileBuffer)
})

// GET /api/patients/:patientId/consolidated-report
// Generates and streams a consolidated longitudinal health report PDF
// dynamically assembled from authorized records according to the caller's scope.
router.get('/:patientId/consolidated-report', guard, async (req, res) => {
  const patientId = parsePatientId(req.params.patientId)
  const grant = await authorizePatientAccess(req, patientId, {
    section: 'consolidated_report',
    minimumScope: 'SUMMARY_ONLY',
    action: 'PATIENT_REPORT_EXPORT',
  })
  const sections = sectionsFor(grant.scope)
  const patient = await loadPatient(patientId)

  // Fetch authorized data according to sections
  const [allergyRows, conditionRows, medicationRows, visitRows, documents] = await Promise.all([
    repo.getAllergies(patientId),
    repo.getChronicConditions(patientId),
    repo.getMedicationHistory(patientId),
    sections.visitHistory ? repo.getVisits(patientId) : null,
    sections.visitHistory ? docRepo.listDocumentsByPatient(patientId, { limit: 100 }) : [],
  ])

  const allergies = allergyRows.map(toAllergy)
  const chronicConditions = conditionRows.map(toChronicCondition)
  const medications = toMedications(medicationRows, sections)
  const visitHistory = visitRows ? visitRows.map(toVisit) : null

  const patientRecord = {
    id: patient.id,
    mrn: patient.mrn,
    demographics: toDemographics(patient, sections),
    allergies,
    chronicConditions,
    medications,
    visitHistory,
  }

  const pdfBuffer = await generateConsolidatedReportPdf({
    patient: patientRecord,
    sections,
    grant,
    documents: documents.map((d) => ({
      id: d.id,
      documentType: d.document_type,
      originalFileName: d.original_file_name,
      fileSizeBytes: Number(d.file_size_bytes),
      sha256Checksum: d.sha256_checksum,
      createdAt: d.created_at ? new Date(d.created_at).toISOString() : null,
    })),
    caller: {
      id: req.user.id,
      role: req.user.role,
      email: req.user.email,
    },
  })

  await recordAuditEvent({
    req,
    user: req.user,
    action: 'PATIENT_REPORT_EXPORT',
    resourceType: 'patient',
    resourceId: patientId,
    patientId,
    outcome: 'SUCCESS',
    reason: grant.via === 'SELF' ? 'Own record export' : `Consent ${grant.scope}`,
    metadata: {
      scope: grant.scope,
      via: grant.via,
      pdfSizeBytes: pdfBuffer.length,
    },
  })

  const sanitizedMrn = (patient.mrn || 'CC').replace(/[^a-zA-Z0-9_-]/g, '_')
  const filename = `carecrypt_report_${sanitizedMrn}_${new Date().toISOString().slice(0, 10)}.pdf`
  const inlineRequested = req.query.disposition === 'inline'

  res.set('Cache-Control', 'private, no-cache, no-store, must-revalidate')
  res.set('Pragma', 'no-cache')
  res.set('Expires', '0')
  res.set('X-Content-Type-Options', 'nosniff')
  res.set('Content-Disposition', `${inlineRequested ? 'inline' : 'attachment'}; filename="${filename}"`)
  res.set('Content-Type', 'application/pdf')
  res.set('Content-Length', pdfBuffer.length)

  res.send(pdfBuffer)
})

// -----------------------------------------------------------------------------
// Medical Document OCR Processing & Extraction
// POST /api/patients/:patientId/documents/:documentId/process-ocr
// GET  /api/patients/:patientId/documents/:documentId/ocr
// -----------------------------------------------------------------------------

// POST /api/patients/:patientId/documents/:documentId/process-ocr
// Initiates isolated OCR recognition, preserves original files, captures genuine
// confidence scores and word-level bounding boxes.
router.post('/:patientId/documents/:documentId/process-ocr', guard, async (req, res) => {
  const patientId = parsePatientId(req.params.patientId)
  const documentId = req.params.documentId
  if (!isUuid(documentId)) {
    throw new HttpError(400, 'BAD_REQUEST', 'documentId must be a valid UUID.')
  }

  const grant = await authorizePatientAccess(req, patientId, {
    section: 'documents_ocr_process',
    minimumScope: 'VISIT_HISTORY',
    action: 'MEDICAL_DOCUMENT_OCR_PROCESS',
  })
  await loadPatient(patientId)

  const doc = await docRepo.getDocumentById(patientId, documentId)
  if (!doc) {
    throw new HttpError(404, 'NOT_FOUND', 'Medical document not found.')
  }

  // Load and verify document binary integrity
  const fileBuffer = await readDocumentFile(doc.storage_key, doc.sha256_checksum)

  // Run isolated OCR pipeline
  let ocrResult
  try {
    ocrResult = await processDocumentOcr({
      fileBuffer,
      mimeType: doc.mime_type,
    })
  } catch (ocrErr) {
    console.error('OCR pipeline error:', ocrErr)
    // Record failed run in database for transparency and tracking
    const failedRun = await docRepo.insertOcrRun({
      documentId: doc.id,
      patientId,
      engineName: 'Tesseract.js OCR (LSTM)',
      engineVersion: '7.0.0',
      status: 'FAILED',
      errorMessage: ocrErr.message,
    })

    await recordAuditEvent({
      req,
      user: req.user,
      action: 'MEDICAL_DOCUMENT_OCR_PROCESS',
      resourceType: 'medical_document',
      resourceId: doc.id,
      patientId,
      outcome: 'FAILURE',
      reason: ocrErr.message,
      metadata: { runId: failedRun.id },
    })

    throw ocrErr
  }

  // Store successful OCR run
  const run = await docRepo.insertOcrRun({
    documentId: doc.id,
    patientId,
    engineName: ocrResult.engineName,
    engineVersion: ocrResult.engineVersion,
    status: ocrResult.status,
    pageCount: ocrResult.pageCount,
    recognizedText: ocrResult.recognizedText,
    confidenceScore: ocrResult.confidenceScore,
    blocksJson: ocrResult.blocks,
    processingMs: ocrResult.processingMs,
  })

  // Automatically execute structured extraction for laboratory reports
  let extractionResult = null
  if (ocrResult.recognizedText && ocrResult.recognizedText.trim().length > 0) {
    try {
      const parsed = parseStructuredLabReport({
        recognizedText: ocrResult.recognizedText,
        blocks: ocrResult.blocks,
      })

      const extRun = await docRepo.insertExtractionRun({
        documentId: doc.id,
        ocrRunId: run.id,
        patientId,
        panelType: parsed.panelType,
        parserVersion: parsed.parserVersion || '1.0.0',
        status: 'READY',
        observationsCount: parsed.observations.length,
        rawFindingsJson: parsed.rawFindings,
      })

      const savedObservations = []
      for (const obs of parsed.observations) {
        const saved = await docRepo.insertLabObservation({
          patientId,
          documentId: doc.id,
          ocrRunId: run.id,
          extractionRunId: extRun.id,
          panelType: parsed.panelType,
          testName: obs.testName,
          standardCode: obs.standardCode,
          valueNumeric: obs.valueNumeric,
          valueText: obs.valueText,
          unit: obs.unit,
          referenceRange: obs.referenceRange,
          referenceLow: obs.referenceLow,
          referenceHigh: obs.referenceHigh,
          isAbnormal: obs.isAbnormal,
          reportDate: obs.reportDate,
          sourcePage: obs.sourcePage,
          boundingBox: obs.boundingBox,
          sourceLineText: obs.sourceLineText,
          ocrConfidence: obs.ocrConfidence,
          extractionConfidence: obs.extractionConfidence,
          verificationStatus: 'UNVERIFIED',
        })
        savedObservations.push(saved)
      }

      extractionResult = {
        extractionRun: extRun,
        observations: savedObservations,
        warnings: parsed.warnings,
      }
    } catch (parseErr) {
      // Extraction failures are logged but do not invalidate base OCR
      await docRepo.insertExtractionRun({
        documentId: doc.id,
        ocrRunId: run.id,
        patientId,
        panelType: 'UNKNOWN',
        parserVersion: '1.0.0',
        status: 'FAILED',
        observationsCount: 0,
        errorMessage: parseErr.message,
      })
    }
  }

  await recordAuditEvent({
    req,
    user: req.user,
    action: 'MEDICAL_DOCUMENT_OCR_PROCESS',
    resourceType: 'medical_document',
    resourceId: doc.id,
    patientId,
    outcome: 'SUCCESS',
    reason: grant.via === 'SELF' ? 'Patient OCR request' : `Consent ${grant.scope}`,
    metadata: {
      runId: run.id,
      pageCount: run.page_count,
      confidenceScore: run.confidence_score,
      processingMs: run.processing_ms,
      wordCount: ocrResult.blocks.length,
      extractedObservationsCount: extractionResult ? extractionResult.observations.length : 0,
    },
  })

  res.status(200).json({
    ocrRun: {
      id: run.id,
      documentId: run.document_id,
      patientId: run.patient_id,
      engineName: run.engine_name,
      engineVersion: run.engine_version,
      status: run.status,
      pageCount: run.page_count,
      recognizedText: run.recognized_text,
      confidenceScore: run.confidence_score !== null ? Number(run.confidence_score) : null,
      blocks: run.blocks_json,
      processingMs: run.processing_ms,
      createdAt: run.created_at,
    },
    extraction: extractionResult,
  })
})

// GET /api/patients/:patientId/documents/:documentId/ocr
// Retrieves the latest authentic OCR results and bounding boxes for review.
router.get('/:patientId/documents/:documentId/ocr', guard, async (req, res) => {
  const patientId = parsePatientId(req.params.patientId)
  const documentId = req.params.documentId
  if (!isUuid(documentId)) {
    throw new HttpError(400, 'BAD_REQUEST', 'documentId must be a valid UUID.')
  }

  const grant = await authorizePatientAccess(req, patientId, {
    section: 'documents_ocr_view',
    minimumScope: 'VISIT_HISTORY',
    action: 'MEDICAL_DOCUMENT_OCR_VIEW',
  })
  await loadPatient(patientId)

  const doc = await docRepo.getDocumentById(patientId, documentId)
  if (!doc) {
    throw new HttpError(404, 'NOT_FOUND', 'Medical document not found.')
  }

  const run = await docRepo.getLatestOcrRun(documentId, patientId)
  if (!run) {
    throw new HttpError(404, 'NOT_FOUND', 'No OCR run found for this document.')
  }

  await recordAuditEvent({
    req,
    user: req.user,
    action: 'MEDICAL_DOCUMENT_OCR_VIEW',
    resourceType: 'medical_document',
    resourceId: doc.id,
    patientId,
    outcome: 'SUCCESS',
    reason: grant.via === 'SELF' ? 'Own record OCR view' : `Consent ${grant.scope}`,
    metadata: {
      runId: run.id,
      engineName: run.engine_name,
      confidenceScore: run.confidence_score,
    },
  })

  res.json({
    ocrRun: {
      id: run.id,
      documentId: run.document_id,
      patientId: run.patient_id,
      engineName: run.engine_name,
      engineVersion: run.engine_version,
      status: run.status,
      pageCount: run.page_count,
      recognizedText: run.recognized_text,
      confidenceScore: run.confidence_score !== null ? Number(run.confidence_score) : null,
      blocks: run.blocks_json,
      errorMessage: run.error_message,
      processingMs: run.processing_ms,
      createdAt: run.created_at,
    },
    document: {
      id: doc.id,
      originalFileName: doc.original_file_name,
      mimeType: doc.mime_type,
      documentType: doc.document_type,
    },
    access: accessInfo(grant, sectionsFor(grant.scope)),
  })
})

// -----------------------------------------------------------------------------
// Structured Laboratory Observations & Verification
// GET   /api/patients/:patientId/lab-observations
// PATCH /api/patients/:patientId/lab-observations/:observationId/verification
// -----------------------------------------------------------------------------

// GET /api/patients/:patientId/lab-observations
// Returns structured extracted observations with provenance, field confidence,
// and verification state under active consent.
router.get('/:patientId/lab-observations', guard, async (req, res) => {
  const patientId = parsePatientId(req.params.patientId)
  const grant = await authorizePatientAccess(req, patientId, {
    section: 'lab_observations_list',
    minimumScope: 'VISIT_HISTORY',
    action: 'LAB_OBSERVATIONS_VIEW',
  })
  await loadPatient(patientId)

  const { panelType, status, documentId } = req.query
  if (documentId && !isUuid(documentId)) {
    throw new HttpError(400, 'BAD_REQUEST', 'documentId must be a valid UUID.')
  }

  const observations = await docRepo.listLabObservationsByPatient(patientId, {
    panelType: panelType || null,
    status: status || null,
    documentId: documentId || null,
  })

  await recordAuditEvent({
    req,
    user: req.user,
    action: 'LAB_OBSERVATIONS_VIEW',
    resourceType: 'lab_observations',
    patientId,
    outcome: 'SUCCESS',
    reason: grant.via === 'SELF' ? 'Own record lab observations' : `Consent ${grant.scope}`,
    metadata: {
      count: observations.length,
      panelType: panelType || 'ALL',
      status: status || 'ALL',
    },
  })

  res.json({
    patientId,
    observations: observations.map((obs) => ({
      id: obs.id,
      patientId: obs.patient_id,
      documentId: obs.document_id,
      ocrRunId: obs.ocr_run_id,
      extractionRunId: obs.extraction_run_id,
      panelType: obs.panel_type,
      testName: obs.test_name,
      standardCode: obs.standard_code,
      valueNumeric: obs.value_numeric !== null ? Number(obs.value_numeric) : null,
      valueText: obs.value_text,
      unit: obs.unit,
      referenceRange: obs.reference_range,
      referenceLow: obs.reference_low !== null ? Number(obs.reference_low) : null,
      referenceHigh: obs.reference_high !== null ? Number(obs.reference_high) : null,
      isAbnormal: obs.is_abnormal,
      reportDate: obs.report_date,
      sourcePage: obs.source_page,
      boundingBox: obs.bounding_box,
      sourceLineText: obs.source_line_text,
      ocrConfidence: obs.ocr_confidence !== null ? Number(obs.ocr_confidence) : null,
      extractionConfidence: Number(obs.extraction_confidence),
      verificationStatus: obs.verification_status,
      originalValueNumeric: obs.original_value_numeric !== null ? Number(obs.original_value_numeric) : null,
      originalValueText: obs.original_value_text,
      originalUnit: obs.original_unit,
      originalReferenceRange: obs.original_reference_range,
      isCorrected: Boolean(obs.is_corrected),
      version: Number(obs.version || 1),
      verifiedBy: obs.verified_by,
      verifiedAt: obs.verified_at,
      verificationNote: obs.verification_note,
      createdAt: obs.created_at,
      updatedAt: obs.updated_at,
    })),
    access: accessInfo(grant, sectionsFor(grant.scope)),
  })
})

// PATCH /api/patients/:patientId/lab-observations/:observationId/verification
// Allows an authorized clinician to verify, correct, or reject an extracted observation,
// confirming clinical validity before treatment or diagnosis reliance.
// Preserves original OCR output and records attestation history.
router.patch('/:patientId/lab-observations/:observationId/verification', guard, async (req, res) => {
  const patientId = parsePatientId(req.params.patientId)
  const observationId = req.params.observationId
  if (!isUuid(observationId)) {
    throw new HttpError(400, 'BAD_REQUEST', 'observationId must be a valid UUID.')
  }

  // Verification requires CLINICIAN role with FULL_RECORD or active consultation
  if (req.user.role !== 'CLINICIAN') {
    throw new HttpError(403, 'FORBIDDEN', 'Only authorized clinicians can verify or correct laboratory observations.')
  }

  const grant = await authorizePatientAccess(req, patientId, {
    section: 'lab_observation_verify',
    minimumScope: 'FULL_RECORD',
    action: 'LAB_OBSERVATION_VERIFY',
  })
  await loadPatient(patientId)

  const existing = await docRepo.getLabObservationById(observationId, patientId)
  if (!existing) {
    throw new HttpError(404, 'NOT_FOUND', 'Observation not found.')
  }

  const {
    status,
    note,
    correctedValue,
    correctedUnit,
    correctedReferenceRange,
    expectedVersion,
  } = req.body || {}

  // Check optimistic locking / concurrency if caller provided expectedVersion
  if (expectedVersion !== undefined && expectedVersion !== null) {
    const expectedVerNum = Number.parseInt(expectedVersion, 10)
    if (Number.isNaN(expectedVerNum)) {
      throw new HttpError(400, 'BAD_REQUEST', 'expectedVersion must be a valid integer.')
    }
    if (existing.version !== expectedVerNum) {
      throw new HttpError(409, 'CONFLICT', `Observation has been modified by another session (expected version ${expectedVerNum}, current version ${existing.version}). Please refresh and review latest state.`)
    }
  }

  // Validate status
  const allowedStatuses = ['VERIFIED', 'CORRECTED', 'REJECTED', 'UNVERIFIED']
  let targetStatus = status
  if (!targetStatus) {
    // If not explicitly provided, determine by whether correction parameters were sent
    if (correctedValue !== undefined || correctedUnit !== undefined || correctedReferenceRange !== undefined) {
      targetStatus = 'CORRECTED'
    } else {
      throw new HttpError(400, 'BAD_REQUEST', `status is required (${allowedStatuses.join(', ')}).`)
    }
  }

  if (!allowedStatuses.includes(targetStatus)) {
    throw new HttpError(400, 'BAD_REQUEST', `status must be one of: ${allowedStatuses.join(', ')}.`)
  }

  // Handle corrections
  let isCorrection = targetStatus === 'CORRECTED' || correctedValue !== undefined || correctedUnit !== undefined || correctedReferenceRange !== undefined
  let parsedNumeric = null
  let valueText = null
  let finalUnit = null
  let finalRange = null
  let refLow = null
  let refHigh = null
  let isAbnormal = null

  if (isCorrection) {
    // Validate correctedValue
    if (correctedValue !== undefined && correctedValue !== null) {
      const valStr = String(correctedValue).trim()
      if (valStr.length === 0) {
        throw new HttpError(400, 'BAD_REQUEST', 'correctedValue cannot be empty.')
      }
      parsedNumeric = normalizeNumericValue(valStr)
      if (parsedNumeric === null && !Number.isNaN(Number(valStr))) {
        parsedNumeric = Number(valStr)
      }
      valueText = valStr
    } else {
      parsedNumeric = existing.value_numeric !== null ? Number(existing.value_numeric) : null
      valueText = existing.value_text
    }

    // Validate correctedUnit
    if (correctedUnit !== undefined && correctedUnit !== null) {
      finalUnit = String(correctedUnit).trim()
      if (finalUnit.length === 0) {
        throw new HttpError(400, 'BAD_REQUEST', 'correctedUnit cannot be empty if specified.')
      }
    } else {
      finalUnit = existing.unit
    }

    // Validate correctedReferenceRange
    if (correctedReferenceRange !== undefined && correctedReferenceRange !== null) {
      finalRange = String(correctedReferenceRange).trim()
      if (finalRange.length === 0) {
        throw new HttpError(400, 'BAD_REQUEST', 'correctedReferenceRange cannot be empty if specified.')
      }
      const parsed = parseReferenceRange(finalRange)
      refLow = parsed.low
      refHigh = parsed.high
    } else {
      finalRange = existing.reference_range
      refLow = existing.reference_low !== null ? Number(existing.reference_low) : null
      refHigh = existing.reference_high !== null ? Number(existing.reference_high) : null
    }

    // Recalculate abnormality
    isAbnormal = evaluateAbnormality(parsedNumeric, refLow, refHigh)
    targetStatus = 'CORRECTED'
  }

  // Update observation with optimistic version increment
  const updated = await docRepo.updateLabObservationCorrectionAndVerification({
    observationId,
    patientId,
    expectedVersion: expectedVersion !== undefined && expectedVersion !== null ? Number.parseInt(expectedVersion, 10) : null,
    verificationStatus: targetStatus,
    verifiedBy: req.user.id,
    verificationNote: typeof note === 'string' ? note.trim() : null,
    correctedValueNumeric: isCorrection ? parsedNumeric : null,
    correctedValueText: isCorrection ? valueText : null,
    correctedUnit: isCorrection ? finalUnit : null,
    correctedReferenceRange: isCorrection ? finalRange : null,
    correctedLow: isCorrection ? refLow : null,
    correctedHigh: isCorrection ? refHigh : null,
    isAbnormal: isCorrection ? isAbnormal : null,
    isCorrected: isCorrection,
  })

  if (!updated) {
    // If not found or version conflict
    throw new HttpError(409, 'CONFLICT', 'Observation update failed. The record may have been concurrently updated or deleted.')
  }

  // Record historical attestation entry in clinical.lab_observation_attestations
  const attestationAction = isCorrection ? 'CORRECT' : targetStatus === 'VERIFIED' ? 'VERIFY' : targetStatus === 'REJECTED' ? 'REJECT' : 'UNVERIFY'
  await docRepo.recordLabAttestation({
    observationId: updated.id,
    patientId,
    attestedBy: req.user.id,
    action: attestationAction,
    previousStatus: existing.verification_status,
    newStatus: targetStatus,
    previousValue: existing.value_text || (existing.value_numeric !== null ? String(existing.value_numeric) : null),
    newValue: updated.value_text || (updated.value_numeric !== null ? String(updated.value_numeric) : null),
    previousUnit: existing.unit,
    newUnit: updated.unit,
    previousRange: existing.reference_range,
    newRange: updated.reference_range,
    clinicalNote: typeof note === 'string' ? note.trim() : null,
  })

  // Record audit events: LAB_OBSERVATION_ATTEST and LAB_OBSERVATION_VERIFY
  await recordAuditEvent({
    req,
    user: req.user,
    action: 'LAB_OBSERVATION_ATTEST',
    resourceType: 'lab_observation',
    resourceId: updated.id,
    patientId,
    outcome: 'SUCCESS',
    reason: `Clinician attested observation (${attestationAction})`,
    metadata: {
      observationId: updated.id,
      testName: updated.test_name,
      action: attestationAction,
      newStatus: targetStatus,
      isCorrected: updated.is_corrected,
      previousStatus: existing.verification_status,
      previousVersion: existing.version,
      newVersion: updated.version,
      hasNote: Boolean(note),
    },
  })

  // Maintain compatibility with LAB_OBSERVATION_VERIFY audit monitors
  await recordAuditEvent({
    req,
    user: req.user,
    action: 'LAB_OBSERVATION_VERIFY',
    resourceType: 'lab_observation',
    resourceId: updated.id,
    patientId,
    outcome: 'SUCCESS',
    reason: `Clinician verification changed to ${targetStatus}`,
    metadata: {
      observationId: updated.id,
      testName: updated.test_name,
      newStatus: targetStatus,
      isCorrected: updated.is_corrected,
    },
  })

  res.json({
    observation: {
      id: updated.id,
      patientId: updated.patient_id,
      documentId: updated.document_id,
      panelType: updated.panel_type,
      testName: updated.test_name,
      standardCode: updated.standard_code,
      valueNumeric: updated.value_numeric !== null ? Number(updated.value_numeric) : null,
      valueText: updated.value_text,
      unit: updated.unit,
      referenceRange: updated.reference_range,
      referenceLow: updated.reference_low !== null ? Number(updated.reference_low) : null,
      referenceHigh: updated.reference_high !== null ? Number(updated.reference_high) : null,
      isAbnormal: updated.is_abnormal,
      verificationStatus: updated.verification_status,
      originalValueNumeric: updated.original_value_numeric !== null ? Number(updated.original_value_numeric) : null,
      originalValueText: updated.original_value_text,
      originalUnit: updated.original_unit,
      originalReferenceRange: updated.original_reference_range,
      isCorrected: Boolean(updated.is_corrected),
      version: Number(updated.version),
      verifiedBy: updated.verified_by,
      verifiedAt: updated.verified_at,
      verificationNote: updated.verification_note,
      updatedAt: updated.updated_at,
    },
  })
})

// -----------------------------------------------------------------------------
// Intelligent Medical E-Report Analyzer & Patient Health Profile
// GET /api/patients/:patientId/report-analysis
// -----------------------------------------------------------------------------
router.get('/:patientId/report-analysis', guard, async (req, res) => {
  const patientId = parsePatientId(req.params.patientId)

  // Requires at least VISIT_HISTORY consent scope. SUMMARY_ONLY will return withheld notice.
  const grant = await authorizePatientAccess(req, patientId, {
    section: 'report_analysis',
    minimumScope: 'SUMMARY_ONLY',
    action: 'MEDICAL_REPORT_ANALYZE',
  })
  const patient = await loadPatient(patientId)

  const isSummaryOnly = grant.scope === 'SUMMARY_ONLY'

  // Load authorized components
  const [chronic, allergies, observations] = await Promise.all([
    repo.getChronicConditions(patientId),
    repo.getAllergies(patientId),
    isSummaryOnly ? Promise.resolve([]) : docRepo.listLabObservationsByPatient(patientId),
  ])

  const analysis = generateMedicalReportAnalysis({
    patient,
    access: grant,
    observations,
    chronicConditions: chronic.filter((c) => c.status !== 'RESOLVED'),
    allergies,
  })

  await recordAuditEvent({
    req,
    user: req.user,
    action: 'MEDICAL_REPORT_ANALYZE',
    resourceType: 'patient_health_profile',
    patientId,
    outcome: 'SUCCESS',
    reason: grant.via === 'SELF' ? 'Patient report analysis' : `Consent ${grant.scope}`,
    metadata: {
      scope: grant.scope,
      totalObservations: observations.length,
      anomaliesCount: analysis.individualAnomalies?.count || 0,
      combinationsCount: analysis.combinationFindings?.triggeredCount || 0,
      urgentSafetyAlert: analysis.clinicalReviewSummary?.urgentSafetyAlert || false,
    },
  })

  res.json({
    ...analysis,
    access: accessInfo(grant, sectionsFor(grant.scope)),
  })
})

export default router
