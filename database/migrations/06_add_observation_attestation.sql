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
