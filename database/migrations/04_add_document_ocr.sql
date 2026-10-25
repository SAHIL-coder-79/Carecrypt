-- Migration 04: Add document OCR and intelligence runs
-- CareCrypt Stage 3: OCR processing for laboratory reports

BEGIN;

CREATE TABLE clinical.document_ocr_runs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id         uuid NOT NULL REFERENCES clinical.medical_documents (id) ON DELETE CASCADE,
  patient_id          uuid NOT NULL REFERENCES clinical.patients (id) ON DELETE CASCADE,
  engine_name         text NOT NULL,
  engine_version      text NOT NULL,
  status              clinical.document_status NOT NULL DEFAULT 'READY',
  page_count          smallint NOT NULL DEFAULT 1,
  recognized_text     text,
  confidence_score    numeric(5, 2), -- Raw engine average confidence (0.00 to 100.00)
  blocks_json         jsonb NOT NULL DEFAULT '[]'::jsonb, -- Bounding boxes, lines, words with coordinates and confidences
  error_message       text,
  processing_ms       integer,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_ocr_confidence_range CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 100))
);

CREATE INDEX idx_document_ocr_doc ON clinical.document_ocr_runs (document_id, created_at DESC);
CREATE INDEX idx_document_ocr_patient ON clinical.document_ocr_runs (patient_id, created_at DESC);

CREATE TRIGGER document_ocr_set_updated_at BEFORE UPDATE ON clinical.document_ocr_runs
  FOR EACH ROW EXECUTE FUNCTION util.set_updated_at();

-- Grants for carecrypt_app role if it exists
DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'carecrypt_app') THEN
    GRANT SELECT, INSERT, UPDATE ON clinical.document_ocr_runs TO carecrypt_app;
  END IF;
END
$grants$;

COMMIT;
