-- COMBINED MIGRATIONS 04, 05, 06 FOR SUPABASE SQL EDITOR

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


-- Migration 05: Add structured laboratory observations and extraction runs
-- CareCrypt Stage 4: Structured laboratory observations and transparent extraction confidence

BEGIN;

CREATE TYPE clinical.observation_status AS ENUM ('UNVERIFIED', 'VERIFIED', 'REJECTED');

-- Stores parser / extraction run metadata per document OCR run
CREATE TABLE clinical.document_extraction_runs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id         uuid NOT NULL REFERENCES clinical.medical_documents (id) ON DELETE CASCADE,
  ocr_run_id          uuid NOT NULL REFERENCES clinical.document_ocr_runs (id) ON DELETE CASCADE,
  patient_id          uuid NOT NULL REFERENCES clinical.patients (id) ON DELETE CASCADE,
  panel_type          text NOT NULL, -- e.g. 'CBC', 'LIPID', 'UNKNOWN'
  parser_version      text NOT NULL, -- e.g. '1.0.0'
  status              clinical.document_status NOT NULL DEFAULT 'READY',
  observations_count  smallint NOT NULL DEFAULT 0,
  raw_findings_json   jsonb NOT NULL DEFAULT '[]'::jsonb,
  error_message       text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_doc_extraction_doc ON clinical.document_extraction_runs (document_id, created_at DESC);
CREATE INDEX idx_doc_extraction_patient ON clinical.document_extraction_runs (patient_id, created_at DESC);

CREATE TRIGGER doc_extraction_set_updated_at BEFORE UPDATE ON clinical.document_extraction_runs
  FOR EACH ROW EXECUTE FUNCTION util.set_updated_at();

-- Stores individual structured lab test observations with provenance and confidence
CREATE TABLE clinical.lab_observations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id            uuid NOT NULL REFERENCES clinical.patients (id) ON DELETE CASCADE,
  document_id           uuid NOT NULL REFERENCES clinical.medical_documents (id) ON DELETE CASCADE,
  ocr_run_id            uuid NOT NULL REFERENCES clinical.document_ocr_runs (id) ON DELETE CASCADE,
  extraction_run_id     uuid NOT NULL REFERENCES clinical.document_extraction_runs (id) ON DELETE CASCADE,
  
  -- Test Identification
  panel_type            text NOT NULL, -- 'CBC', 'LIPID', etc.
  test_name             text NOT NULL, -- e.g. 'Hemoglobin', 'Total Cholesterol'
  standard_code         text,          -- LOINC code when standardized, e.g. '718-7', '2093-3'
  
  -- Measurement Values & Units
  value_numeric         numeric(10, 3), -- Parsed numeric value if measurable
  value_text            text NOT NULL,  -- Raw textual observation value (e.g. '14.2' or 'Negative')
  unit                  text,           -- Measurement unit (e.g. 'g/dL', 'mg/dL', '10^3/uL')
  reference_range       text,           -- Standard or reported reference range (e.g. '13.5 - 17.5')
  reference_low         numeric(10, 3), -- Lower limit if numeric range parsed
  reference_high        numeric(10, 3), -- Upper limit if numeric range parsed
  is_abnormal           boolean,        -- Evaluated against parsed range if both exist
  
  -- Provenance & Context
  report_date           date,           -- Report date extracted from document if present
  source_page           smallint NOT NULL DEFAULT 1,
  bounding_box          jsonb,          -- Location coordinates from OCR block { x, y, width, height }
  source_line_text      text,           -- Exact source line text matched by parser
  
  -- Confidence Metrics (Never Fabricated)
  ocr_confidence        numeric(5, 2),  -- Raw OCR engine recognition score for this field (0-100) or NULL
  extraction_confidence numeric(5, 2) NOT NULL, -- Deterministic parser pattern match quality (0-100)
  
  -- Clinical Verification Lifecycle
  verification_status   clinical.observation_status NOT NULL DEFAULT 'UNVERIFIED',
  verified_by           uuid REFERENCES identity.users (id),
  verified_at           timestamptz,
  verification_note     text,
  
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  
  CONSTRAINT lab_obs_ocr_conf_check CHECK (ocr_confidence IS NULL OR (ocr_confidence >= 0 AND ocr_confidence <= 100)),
  CONSTRAINT lab_obs_ext_conf_check CHECK (extraction_confidence >= 0 AND extraction_confidence <= 100),
  CONSTRAINT lab_obs_verification_valid CHECK (
    (verification_status = 'UNVERIFIED' AND verified_by IS NULL AND verified_at IS NULL)
    OR (verification_status IN ('VERIFIED', 'REJECTED') AND verified_by IS NOT NULL AND verified_at IS NOT NULL)
  )
);

CREATE INDEX idx_lab_obs_patient ON clinical.lab_observations (patient_id, test_name, created_at DESC);
CREATE INDEX idx_lab_obs_doc ON clinical.lab_observations (document_id);
CREATE INDEX idx_lab_obs_status ON clinical.lab_observations (patient_id, verification_status);

CREATE TRIGGER lab_obs_set_updated_at BEFORE UPDATE ON clinical.lab_observations
  FOR EACH ROW EXECUTE FUNCTION util.set_updated_at();

-- Permissions for carecrypt_app
DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'carecrypt_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON clinical.document_extraction_runs TO carecrypt_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON clinical.lab_observations TO carecrypt_app;
  END IF;
END
$grants$;

COMMIT;


-- Migration 06: Support clinician corrections and audit history for lab observations
-- CareCrypt Stage 6: Clinician review, correction and attestation of laboratory values

-- Note: 'CORRECTED' enum value committed prior to table alterations
ALTER TYPE clinical.observation_status ADD VALUE IF NOT EXISTS 'CORRECTED';

BEGIN;

-- 2. Add original OCR value fields and version tracking to clinical.lab_observations
ALTER TABLE clinical.lab_observations
  ADD COLUMN IF NOT EXISTS original_value_numeric numeric(10, 3),
  ADD COLUMN IF NOT EXISTS original_value_text text,
  ADD COLUMN IF NOT EXISTS original_unit text,
  ADD COLUMN IF NOT EXISTS original_reference_range text,
  ADD COLUMN IF NOT EXISTS is_corrected boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

-- Populate original_* fields with existing value_* data if currently null
UPDATE clinical.lab_observations
   SET original_value_numeric = value_numeric,
       original_value_text = value_text,
       original_unit = unit,
       original_reference_range = reference_range
 WHERE original_value_text IS NULL;

-- Update constraint to allow CORRECTED status with verified_by and verified_at
ALTER TABLE clinical.lab_observations
  DROP CONSTRAINT IF EXISTS lab_obs_verification_valid;

ALTER TABLE clinical.lab_observations
  ADD CONSTRAINT lab_obs_verification_valid CHECK (
    (verification_status = 'UNVERIFIED' AND verified_by IS NULL AND verified_at IS NULL)
    OR (verification_status IN ('VERIFIED', 'CORRECTED', 'REJECTED') AND verified_by IS NOT NULL AND verified_at IS NOT NULL)
  );

-- 3. Attestation and audit correction history table
CREATE TABLE IF NOT EXISTS clinical.lab_observation_attestations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  observation_id        uuid NOT NULL REFERENCES clinical.lab_observations (id) ON DELETE CASCADE,
  patient_id            uuid NOT NULL REFERENCES clinical.patients (id) ON DELETE CASCADE,
  attested_by           uuid NOT NULL REFERENCES identity.users (id),
  action                text NOT NULL, -- 'VERIFY', 'CORRECT', 'REJECT', 'RESET'
  previous_status       clinical.observation_status NOT NULL,
  new_status            clinical.observation_status NOT NULL,
  previous_value        text,
  new_value             text,
  previous_unit         text,
  new_unit              text,
  previous_range        text,
  new_range             text,
  clinical_note         text,
  attested_at           timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lab_attestation_obs ON clinical.lab_observation_attestations (observation_id, attested_at DESC);
CREATE INDEX IF NOT EXISTS idx_lab_attestation_patient ON clinical.lab_observation_attestations (patient_id, attested_at DESC);

-- Grants
DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'carecrypt_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON clinical.lab_observation_attestations TO carecrypt_app;
  END IF;
END
$grants$;

COMMIT;
