-- Migration 03: Add medical documents table and storage metadata
-- CareCrypt Stage 1: Secure medical document ingestion and authorized retrieval

BEGIN;

CREATE TYPE clinical.document_type AS ENUM (
  'LAB_REPORT',
  'PRESCRIPTION',
  'XRAY',
  'ECG',
  'CT_SCAN',
  'MRI',
  'DISCHARGE_SUMMARY',
  'OTHER'
);

CREATE TYPE clinical.document_status AS ENUM (
  'PENDING',
  'PROCESSING',
  'READY',
  'FAILED'
);

CREATE TABLE clinical.medical_documents (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id          uuid NOT NULL REFERENCES clinical.patients (id) ON DELETE CASCADE,
  uploaded_by         uuid NOT NULL REFERENCES identity.users (id),
  visit_id            uuid REFERENCES clinical.visits (id) ON DELETE SET NULL,
  document_type       clinical.document_type NOT NULL,
  original_file_name  text NOT NULL,
  mime_type           text NOT NULL,
  file_size_bytes     bigint NOT NULL,
  storage_key         text NOT NULL UNIQUE,
  sha256_checksum     char(64) NOT NULL,
  status              clinical.document_status NOT NULL DEFAULT 'READY',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz,
  CONSTRAINT medical_documents_size_positive CHECK (file_size_bytes > 0),
  CONSTRAINT medical_documents_sha256_format CHECK (sha256_checksum ~ '^[0-9a-f]{64}$')
);

CREATE INDEX idx_medical_documents_patient ON clinical.medical_documents (patient_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_medical_documents_visit ON clinical.medical_documents (visit_id)
  WHERE visit_id IS NOT NULL AND deleted_at IS NULL;

CREATE TRIGGER medical_documents_set_updated_at BEFORE UPDATE ON clinical.medical_documents
  FOR EACH ROW EXECUTE FUNCTION util.set_updated_at();

-- Grants for carecrypt_app role if it exists
DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'carecrypt_app') THEN
    GRANT SELECT, INSERT, UPDATE ON clinical.medical_documents TO carecrypt_app;
  END IF;
END
$grants$;

COMMIT;
