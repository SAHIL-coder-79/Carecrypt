-- COMBINED IDEMPOTENT MIGRATIONS 04, 05, 06 FOR SUPABASE SQL EDITOR
-- Safe to re-run multiple times (uses IF NOT EXISTS)

-- -----------------------------------------------------------------------------
-- 1. Document OCR Runs (Migration 04)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clinical.document_ocr_runs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id         uuid NOT NULL REFERENCES clinical.medical_documents (id) ON DELETE CASCADE,
  patient_id          uuid NOT NULL REFERENCES clinical.patients (id) ON DELETE CASCADE,
  engine_name         text NOT NULL,
  engine_version      text NOT NULL,
  status              clinical.document_status NOT NULL DEFAULT 'READY',
  page_count          smallint NOT NULL DEFAULT 1,
  recognized_text     text,
  confidence_score    numeric(5, 2),
  blocks_json         jsonb NOT NULL DEFAULT '[]'::jsonb,
  error_message       text,
  processing_ms       integer,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_ocr_confidence_range CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 100))
);

CREATE INDEX IF NOT EXISTS idx_document_ocr_doc ON clinical.document_ocr_runs (document_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_document_ocr_patient ON clinical.document_ocr_runs (patient_id, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'document_ocr_set_updated_at'
  ) THEN
    CREATE TRIGGER document_ocr_set_updated_at BEFORE UPDATE ON clinical.document_ocr_runs
      FOR EACH ROW EXECUTE FUNCTION util.set_updated_at();
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2. Structured Laboratory Observations (Migration 05)
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'observation_status' AND typnamespace = 'clinical'::regnamespace) THEN
    CREATE TYPE clinical.observation_status AS ENUM ('UNVERIFIED', 'VERIFIED', 'REJECTED');
  END IF;
END $$;

-- Stores parser / extraction run metadata per document OCR run
CREATE TABLE IF NOT EXISTS clinical.document_extraction_runs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id         uuid NOT NULL REFERENCES clinical.medical_documents (id) ON DELETE CASCADE,
  ocr_run_id          uuid NOT NULL REFERENCES clinical.document_ocr_runs (id) ON DELETE CASCADE,
  patient_id          uuid NOT NULL REFERENCES clinical.patients (id) ON DELETE CASCADE,
  panel_type          text NOT NULL,
  parser_version      text NOT NULL,
  status              clinical.document_status NOT NULL DEFAULT 'READY',
  observations_count  smallint NOT NULL DEFAULT 0,
  raw_findings_json   jsonb NOT NULL DEFAULT '[]'::jsonb,
  error_message       text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_doc_extraction_doc ON clinical.document_extraction_runs (document_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_doc_extraction_patient ON clinical.document_extraction_runs (patient_id, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'doc_extraction_set_updated_at'
  ) THEN
    CREATE TRIGGER doc_extraction_set_updated_at BEFORE UPDATE ON clinical.document_extraction_runs
      FOR EACH ROW EXECUTE FUNCTION util.set_updated_at();
  END IF;
END $$;

-- Stores individual structured lab test observations
CREATE TABLE IF NOT EXISTS clinical.lab_observations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id            uuid NOT NULL REFERENCES clinical.patients (id) ON DELETE CASCADE,
  document_id           uuid NOT NULL REFERENCES clinical.medical_documents (id) ON DELETE CASCADE,
  ocr_run_id            uuid NOT NULL REFERENCES clinical.document_ocr_runs (id) ON DELETE CASCADE,
  extraction_run_id     uuid NOT NULL REFERENCES clinical.document_extraction_runs (id) ON DELETE CASCADE,
  
  panel_type            text NOT NULL,
  test_name             text NOT NULL,
  standard_code         text,
  
  value_numeric         numeric(10, 3),
  value_text            text NOT NULL,
  unit                  text,
  reference_range       text,
  reference_low         numeric(10, 3),
  reference_high        numeric(10, 3),
  is_abnormal           boolean,
  
  report_date           date,
  source_page           smallint NOT NULL DEFAULT 1,
  bounding_box          jsonb,
  source_line_text      text,
  
  ocr_confidence        numeric(5, 2),
  extraction_confidence numeric(5, 2) NOT NULL,
  verification_status   clinical.observation_status NOT NULL DEFAULT 'UNVERIFIED',
  verified_by           uuid REFERENCES identity.users (id),
  verified_at           timestamptz,
  verification_note     text,
  
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  
  CONSTRAINT lab_obs_confidence_range CHECK (
    (ocr_confidence IS NULL OR (ocr_confidence >= 0 AND ocr_confidence <= 100)) AND
    (extraction_confidence >= 0 AND extraction_confidence <= 100)
  )
);

CREATE INDEX IF NOT EXISTS idx_lab_obs_patient ON clinical.lab_observations (patient_id, report_date DESC NULLS LAST, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lab_obs_doc ON clinical.lab_observations (document_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lab_obs_code ON clinical.lab_observations (standard_code) WHERE standard_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lab_obs_status ON clinical.lab_observations (verification_status);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'lab_observations_set_updated_at'
  ) THEN
    CREATE TRIGGER lab_observations_set_updated_at BEFORE UPDATE ON clinical.lab_observations
      FOR EACH ROW EXECUTE FUNCTION util.set_updated_at();
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 3. Attestation, Corrections & Audit (Migration 06)
-- -----------------------------------------------------------------------------
ALTER TYPE clinical.observation_status ADD VALUE IF NOT EXISTS 'CORRECTED';

ALTER TABLE clinical.lab_observations
  ADD COLUMN IF NOT EXISTS original_value_numeric numeric(10, 3),
  ADD COLUMN IF NOT EXISTS original_value_text text,
  ADD COLUMN IF NOT EXISTS original_unit text,
  ADD COLUMN IF NOT EXISTS original_reference_range text,
  ADD COLUMN IF NOT EXISTS is_corrected boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

UPDATE clinical.lab_observations
   SET original_value_numeric = value_numeric,
       original_value_text = value_text,
       original_unit = unit,
       original_reference_range = reference_range
 WHERE original_value_text IS NULL;

ALTER TABLE clinical.lab_observations
  DROP CONSTRAINT IF EXISTS lab_obs_verification_valid;

ALTER TABLE clinical.lab_observations
  ADD CONSTRAINT lab_obs_verification_valid CHECK (
    (verification_status = 'UNVERIFIED' AND verified_by IS NULL AND verified_at IS NULL)
    OR (verification_status IN ('VERIFIED', 'CORRECTED', 'REJECTED') AND verified_by IS NOT NULL AND verified_at IS NOT NULL)
  );

CREATE TABLE IF NOT EXISTS clinical.lab_observation_attestations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  observation_id        uuid NOT NULL REFERENCES clinical.lab_observations (id) ON DELETE CASCADE,
  patient_id            uuid NOT NULL REFERENCES clinical.patients (id) ON DELETE CASCADE,
  attested_by           uuid NOT NULL REFERENCES identity.users (id),
  action                text NOT NULL,
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
    GRANT SELECT, INSERT, UPDATE ON clinical.document_ocr_runs TO carecrypt_app;
    GRANT SELECT, INSERT, UPDATE ON clinical.document_extraction_runs TO carecrypt_app;
    GRANT SELECT, INSERT, UPDATE ON clinical.lab_observations TO carecrypt_app;
    GRANT SELECT, INSERT ON clinical.lab_observation_attestations TO carecrypt_app;
  END IF;
END
$grants$;
