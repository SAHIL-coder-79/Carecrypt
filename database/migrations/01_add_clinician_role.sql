ALTER TABLE clinical.consent_records ALTER COLUMN clinician_id DROP NOT NULL;
ALTER TABLE clinical.consent_records ADD COLUMN clinician_role text;
ALTER TABLE clinical.consent_records ADD CONSTRAINT consent_target_check CHECK ((clinician_id IS NOT NULL AND clinician_role IS NULL) OR (clinician_id IS NULL AND clinician_role IS NOT NULL));
