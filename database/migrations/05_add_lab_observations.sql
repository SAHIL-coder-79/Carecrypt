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
