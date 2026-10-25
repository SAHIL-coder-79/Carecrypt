import { query } from '../db/pool.js'

/**
 * Inserts a new medical document record into clinical.medical_documents.
 */
export async function insertDocument({
  patientId,
  uploadedBy,
  visitId = null,
  documentType,
  originalFileName,
  mimeType,
  fileSizeBytes,
  storageKey,
  sha256Checksum,
  status = 'READY',
}) {
  const { rows } = await query(
    `INSERT INTO clinical.medical_documents
       (patient_id, uploaded_by, visit_id, document_type, original_file_name,
        mime_type, file_size_bytes, storage_key, sha256_checksum, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id, patient_id, uploaded_by, visit_id, document_type,
               original_file_name, mime_type, file_size_bytes, storage_key,
               sha256_checksum, status, created_at, updated_at`,
    [
      patientId,
      uploadedBy,
      visitId,
      documentType,
      originalFileName,
      mimeType,
      fileSizeBytes,
      storageKey,
      sha256Checksum,
      status,
    ],
  )
  return rows[0]
}

/**
 * Retrieves a document metadata record by ID and patient ID (excluding soft-deleted).
 */
export async function getDocumentById(patientId, documentId) {
  const { rows } = await query(
    `SELECT id, patient_id, uploaded_by, visit_id, document_type,
            original_file_name, mime_type, file_size_bytes, storage_key,
            sha256_checksum, status, created_at, updated_at
       FROM clinical.medical_documents
      WHERE id = $1 AND patient_id = $2 AND deleted_at IS NULL`,
    [documentId, patientId],
  )
  return rows[0] || null
}

/**
 * Lists all active documents for a patient (newest first).
 */
export async function listDocumentsByPatient(patientId, { visitId = null, limit = 50 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100)
  const params = [patientId, safeLimit]
  let visitFilter = ''

  if (visitId) {
    params.push(visitId)
    visitFilter = `AND visit_id = $${params.length}`
  }

  const { rows } = await query(
    `SELECT id, patient_id, uploaded_by, visit_id, document_type,
            original_file_name, mime_type, file_size_bytes,
            sha256_checksum, status, created_at
       FROM clinical.medical_documents
      WHERE patient_id = $1 AND deleted_at IS NULL ${visitFilter}
      ORDER BY created_at DESC
      LIMIT $2`,
    params,
  )
  return rows
}

/**
 * Soft deletes a medical document.
 */
export async function softDeleteDocument(patientId, documentId) {
  const { rows } = await query(
    `UPDATE clinical.medical_documents
        SET deleted_at = now()
      WHERE id = $1 AND patient_id = $2 AND deleted_at IS NULL
      RETURNING id, storage_key`,
    [documentId, patientId],
  )
  return rows[0] || null
}

/**
 * Inserts an OCR execution record into clinical.document_ocr_runs.
 */
export async function insertOcrRun({
  documentId,
  patientId,
  engineName,
  engineVersion,
  status = 'READY',
  pageCount = 1,
  recognizedText = null,
  confidenceScore = null,
  blocksJson = [],
  errorMessage = null,
  processingMs = null,
}) {
  const { rows } = await query(
    `INSERT INTO clinical.document_ocr_runs
       (document_id, patient_id, engine_name, engine_version, status,
        page_count, recognized_text, confidence_score, blocks_json,
        error_message, processing_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id, document_id, patient_id, engine_name, engine_version,
               status, page_count, recognized_text, confidence_score,
               blocks_json, error_message, processing_ms, created_at`,
    [
      documentId,
      patientId,
      engineName,
      engineVersion,
      status,
      pageCount,
      recognizedText,
      confidenceScore,
      JSON.stringify(blocksJson),
      errorMessage,
      processingMs,
    ],
  )
  return rows[0]
}

/**
 * Retrieves the latest OCR run for a document.
 */
export async function getLatestOcrRun(documentId, patientId) {
  const { rows } = await query(
    `SELECT id, document_id, patient_id, engine_name, engine_version,
            status, page_count, recognized_text, confidence_score,
            blocks_json, error_message, processing_ms, created_at
       FROM clinical.document_ocr_runs
      WHERE document_id = $1 AND patient_id = $2
      ORDER BY created_at DESC
      LIMIT 1`,
    [documentId, patientId],
  )
  return rows[0] || null
}

/**
 * Inserts a document structured extraction run.
 */
export async function insertExtractionRun({
  documentId,
  ocrRunId,
  patientId,
  panelType,
  parserVersion,
  status = 'READY',
  observationsCount = 0,
  rawFindingsJson = [],
  errorMessage = null,
}) {
  const { rows } = await query(
    `INSERT INTO clinical.document_extraction_runs
       (document_id, ocr_run_id, patient_id, panel_type, parser_version,
        status, observations_count, raw_findings_json, error_message)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, document_id, ocr_run_id, patient_id, panel_type, parser_version,
               status, observations_count, raw_findings_json, error_message, created_at`,
    [
      documentId,
      ocrRunId,
      patientId,
      panelType,
      parserVersion,
      status,
      observationsCount,
      JSON.stringify(rawFindingsJson),
      errorMessage,
    ],
  )
  return rows[0]
}

/**
 * Retrieves the latest extraction run for a document.
 */
export async function getLatestExtractionRun(documentId, patientId) {
  const { rows } = await query(
    `SELECT id, document_id, ocr_run_id, patient_id, panel_type, parser_version,
            status, observations_count, raw_findings_json, error_message, created_at
       FROM clinical.document_extraction_runs
      WHERE document_id = $1 AND patient_id = $2
      ORDER BY created_at DESC
      LIMIT 1`,
    [documentId, patientId],
  )
  return rows[0] || null
}

/**
 * Inserts a structured laboratory observation.
 */
export async function insertLabObservation({
  patientId,
  documentId,
  ocrRunId,
  extractionRunId,
  panelType,
  testName,
  standardCode = null,
  valueNumeric = null,
  valueText,
  unit = null,
  referenceRange = null,
  referenceLow = null,
  referenceHigh = null,
  isAbnormal = null,
  reportDate = null,
  sourcePage = 1,
  boundingBox = null,
  sourceLineText = null,
  ocrConfidence = null,
  extractionConfidence,
  verificationStatus = 'UNVERIFIED',
}) {
  const { rows } = await query(
    `INSERT INTO clinical.lab_observations
       (patient_id, document_id, ocr_run_id, extraction_run_id,
        panel_type, test_name, standard_code, value_numeric, value_text,
        unit, reference_range, reference_low, reference_high, is_abnormal,
        report_date, source_page, bounding_box, source_line_text,
        ocr_confidence, extraction_confidence, verification_status,
        original_value_numeric, original_value_text, original_unit, original_reference_range)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $8, $9, $10, $11)
     RETURNING id, patient_id, document_id, ocr_run_id, extraction_run_id,
               panel_type, test_name, standard_code, value_numeric, value_text,
               unit, reference_range, reference_low, reference_high, is_abnormal,
               report_date, source_page, bounding_box, source_line_text,
               ocr_confidence, extraction_confidence, verification_status,
               original_value_numeric, original_value_text, original_unit, original_reference_range,
               is_corrected, version,
               verified_by, verified_at, verification_note, created_at, updated_at`,
    [
      patientId,
      documentId,
      ocrRunId,
      extractionRunId,
      panelType,
      testName,
      standardCode,
      valueNumeric,
      valueText,
      unit,
      referenceRange,
      referenceLow,
      referenceHigh,
      isAbnormal,
      reportDate,
      sourcePage,
      boundingBox ? JSON.stringify(boundingBox) : null,
      sourceLineText,
      ocrConfidence,
      extractionConfidence,
      verificationStatus,
    ],
  )
  return rows[0]
}

/**
 * Lists observations for a patient, optionally filtered by panel, status, or document.
 */
export async function listLabObservationsByPatient(patientId, { panelType = null, status = null, documentId = null } = {}) {
  const conditions = ['patient_id = $1']
  const params = [patientId]
  let idx = 2

  if (panelType) {
    conditions.push(`panel_type = $${idx++}`)
    params.push(panelType)
  }
  if (status) {
    conditions.push(`verification_status = $${idx++}`)
    params.push(status)
  }
  if (documentId) {
    conditions.push(`document_id = $${idx++}`)
    params.push(documentId)
  }

  const { rows } = await query(
    `SELECT id, patient_id, document_id, ocr_run_id, extraction_run_id,
            panel_type, test_name, standard_code, value_numeric, value_text,
            unit, reference_range, reference_low, reference_high, is_abnormal,
            report_date, source_page, bounding_box, source_line_text,
            ocr_confidence, extraction_confidence, verification_status,
            original_value_numeric, original_value_text, original_unit, original_reference_range,
            is_corrected, version,
            verified_by, verified_at, verification_note, created_at, updated_at
       FROM clinical.lab_observations
      WHERE ${conditions.join(' AND ')}
      ORDER BY report_date DESC NULLS LAST, created_at DESC, test_name ASC`,
    params,
  )
  return rows
}

/**
 * Fetches a single observation by ID and patient ID.
 */
export async function getLabObservationById(observationId, patientId) {
  const { rows } = await query(
    `SELECT id, patient_id, document_id, ocr_run_id, extraction_run_id,
            panel_type, test_name, standard_code, value_numeric, value_text,
            unit, reference_range, reference_low, reference_high, is_abnormal,
            report_date, source_page, bounding_box, source_line_text,
            ocr_confidence, extraction_confidence, verification_status,
            original_value_numeric, original_value_text, original_unit, original_reference_range,
            is_corrected, version,
            verified_by, verified_at, verification_note, created_at, updated_at
       FROM clinical.lab_observations
      WHERE id = $1 AND patient_id = $2`,
    [observationId, patientId],
  )
  return rows[0] || null
}

/**
 * Records an entry in clinical.lab_observation_attestations for audit and version tracking.
 */
export async function recordLabAttestation({
  observationId,
  patientId,
  attestedBy,
  action,
  previousStatus,
  newStatus,
  previousValue,
  newValue,
  previousUnit,
  newUnit,
  previousRange,
  newRange,
  clinicalNote,
}) {
  const { rows } = await query(
    `INSERT INTO clinical.lab_observation_attestations
       (observation_id, patient_id, attested_by, action, previous_status, new_status,
        previous_value, new_value, previous_unit, new_unit, previous_range, new_range, clinical_note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING id, observation_id, patient_id, attested_by, action, previous_status, new_status,
               previous_value, new_value, clinical_note, attested_at`,
    [
      observationId,
      patientId,
      attestedBy,
      action,
      previousStatus,
      newStatus,
      previousValue,
      newValue,
      previousUnit,
      newUnit,
      previousRange,
      newRange,
      clinicalNote,
    ],
  )
  return rows[0]
}

/**
 * Updates an observation's clinical verification status and/or corrected values with optimistic locking.
 */
export async function updateLabObservationCorrectionAndVerification({
  observationId,
  patientId,
  expectedVersion,
  verificationStatus,
  verifiedBy,
  verificationNote = null,
  correctedValueNumeric = null,
  correctedValueText = null,
  correctedUnit = null,
  correctedReferenceRange = null,
  correctedLow = null,
  correctedHigh = null,
  isAbnormal = null,
  isCorrected = false,
}) {
  const verifiedAt = verificationStatus === 'UNVERIFIED' ? null : new Date()
  const reviewer = verificationStatus === 'UNVERIFIED' ? null : verifiedBy

  // Concurrency check: If expectedVersion is specified, match version
  const versionClause = expectedVersion != null ? 'AND version = $13' : ''
  const params = [
    verificationStatus,
    reviewer,
    verifiedAt,
    verificationNote,
    correctedValueNumeric,
    correctedValueText,
    correctedUnit,
    correctedReferenceRange,
    correctedLow,
    correctedHigh,
    isAbnormal,
    isCorrected,
    observationId,
    patientId,
  ]
  if (expectedVersion != null) {
    params.push(expectedVersion)
  }

  const { rows } = await query(
    `UPDATE clinical.lab_observations
        SET verification_status = $1,
            verified_by = $2,
            verified_at = $3,
            verification_note = $4,
            value_numeric = COALESCE($5, value_numeric),
            value_text = COALESCE($6, value_text),
            unit = COALESCE($7, unit),
            reference_range = COALESCE($8, reference_range),
            reference_low = COALESCE($9, reference_low),
            reference_high = COALESCE($10, reference_high),
            is_abnormal = COALESCE($11, is_abnormal),
            is_corrected = $12 OR is_corrected,
            version = version + 1,
            updated_at = now()
      WHERE id = $13 AND patient_id = $14 ${expectedVersion != null ? 'AND version = $15' : ''}
      RETURNING id, patient_id, document_id, ocr_run_id, extraction_run_id,
                panel_type, test_name, standard_code, value_numeric, value_text,
                unit, reference_range, reference_low, reference_high, is_abnormal,
                report_date, source_page, bounding_box, source_line_text,
                ocr_confidence, extraction_confidence, verification_status,
                original_value_numeric, original_value_text, original_unit, original_reference_range,
                is_corrected, version,
                verified_by, verified_at, verification_note, created_at, updated_at`,
    params,
  )
  return rows[0] || null
}

/**
 * Updates an observation's clinical verification status.
 */
export async function updateLabObservationVerification({
  observationId,
  patientId,
  verificationStatus,
  verifiedBy,
  verificationNote = null,
}) {
  const verifiedAt = verificationStatus === 'UNVERIFIED' ? null : new Date()
  const reviewer = verificationStatus === 'UNVERIFIED' ? null : verifiedBy

  const { rows } = await query(
    `UPDATE clinical.lab_observations
        SET verification_status = $1,
            verified_by = $2,
            verified_at = $3,
            verification_note = $4,
            version = version + 1,
            updated_at = now()
      WHERE id = $5 AND patient_id = $6
      RETURNING id, patient_id, document_id, ocr_run_id, extraction_run_id,
                panel_type, test_name, standard_code, value_numeric, value_text,
                unit, reference_range, reference_low, reference_high, is_abnormal,
                report_date, source_page, bounding_box, source_line_text,
                ocr_confidence, extraction_confidence, verification_status,
                original_value_numeric, original_value_text, original_unit, original_reference_range,
                is_corrected, version,
                verified_by, verified_at, verification_note, created_at, updated_at`,
    [verificationStatus, reviewer, verifiedAt, verificationNote, observationId, patientId],
  )
  return rows[0] || null
}

