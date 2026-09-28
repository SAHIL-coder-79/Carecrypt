-- =============================================================================
-- CareCrypt database schema (PostgreSQL 14+)
--
-- Run as the database owner (carecrypt):
--   psql -U carecrypt -d carecrypt -f database/schema.sql
--
-- WARNING: this script rebuilds the schemas from scratch and DELETES ALL DATA in
-- them. It is meant for development with synthetic data only.
--
-- Schemas
--   util       shared trigger functions
--   identity   login accounts and roles
--   ref        reference catalogues (conditions, symptoms, medications)
--   clinical   identifiable patient data: patients, clinicians, facilities, QR
--              identities, visits, problem lists, allergies, consent
--   audit      append-only, hash-chained audit log
--   analytics  de-identified, minimum-group-size-suppressed aggregate views
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL client_min_messages = warning;

DROP SCHEMA IF EXISTS analytics CASCADE;
DROP SCHEMA IF EXISTS audit CASCADE;
DROP SCHEMA IF EXISTS clinical CASCADE;
DROP SCHEMA IF EXISTS ref CASCADE;
DROP SCHEMA IF EXISTS identity CASCADE;
DROP SCHEMA IF EXISTS util CASCADE;

-- gen_random_uuid() is built in (PG13+). pgcrypto supplies crypt()/gen_salt()
-- for bcrypt password hashes in seed.sql. It is a trusted extension, so the
-- database owner can create it.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA util;
CREATE SCHEMA identity;
CREATE SCHEMA ref;
CREATE SCHEMA clinical;
CREATE SCHEMA audit;
CREATE SCHEMA analytics;

-- -----------------------------------------------------------------------------
-- util
-- -----------------------------------------------------------------------------

CREATE FUNCTION util.set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- identity
-- -----------------------------------------------------------------------------

CREATE TYPE identity.user_role AS ENUM ('PATIENT', 'CLINICIAN', 'ADMIN', 'SECURITY_ADMIN');

CREATE TABLE identity.users (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email               text NOT NULL,
  password_hash       text NOT NULL,
  role                identity.user_role NOT NULL,
  display_name        text NOT NULL,
  is_active           boolean NOT NULL DEFAULT true,
  failed_login_count  integer NOT NULL DEFAULT 0,
  locked_until        timestamptz,
  last_login_at       timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_lowercase CHECK (email = lower(email)),
  CONSTRAINT users_email_format CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  CONSTRAINT users_failed_login_count_nonneg CHECK (failed_login_count >= 0),
  CONSTRAINT users_display_name_not_blank CHECK (btrim(display_name) <> ''),
  -- Lets profile tables pin the role of the account they point at (see clinicians, patients).
  CONSTRAINT users_id_role_key UNIQUE (id, role)
);
CREATE UNIQUE INDEX users_email_key ON identity.users (email);
CREATE INDEX users_role_idx ON identity.users (role);
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON identity.users
  FOR EACH ROW EXECUTE FUNCTION util.set_updated_at();

COMMENT ON TABLE identity.users IS 'Login accounts for every role. Passwords are stored only as bcrypt hashes.';

-- -----------------------------------------------------------------------------
-- ref: reference catalogues (not patient data)
-- -----------------------------------------------------------------------------

CREATE TABLE ref.conditions (
  code           text PRIMARY KEY,                  -- ICD-10 code, e.g. A90
  name           text NOT NULL,
  category       text NOT NULL,                     -- INFECTIOUS, CARDIOVASCULAR, ...
  is_chronic     boolean NOT NULL DEFAULT false,
  is_notifiable  boolean NOT NULL DEFAULT false,    -- tracked for disease-trend monitoring
  CONSTRAINT conditions_code_format CHECK (code ~ '^[A-Z][0-9]{2}(\.[0-9A-Z]{1,4})?$')
);

CREATE TABLE ref.symptoms (
  code          text PRIMARY KEY,                   -- snake_case id shared with SmartCare Assist
  display_name  text NOT NULL,
  category      text NOT NULL,
  CONSTRAINT symptoms_code_format CHECK (code ~ '^[a-z][a-z0-9_]*$')
);

CREATE TABLE ref.medications (
  code          text PRIMARY KEY,                   -- snake_case generic-drug id
  generic_name  text NOT NULL,
  drug_class    text NOT NULL,                      -- used for allergy cross-checks, e.g. PENICILLIN, NSAID
  atc_code      text,
  CONSTRAINT medications_code_format CHECK (code ~ '^[a-z][a-z0-9_]*$')
);
CREATE INDEX medications_drug_class_idx ON ref.medications (drug_class);

-- -----------------------------------------------------------------------------
-- clinical: facilities and clinicians
-- -----------------------------------------------------------------------------

CREATE TYPE clinical.facility_type AS ENUM ('PHC', 'CHC', 'UHC', 'DISTRICT_HOSPITAL', 'CLINIC');

CREATE TABLE clinical.facilities (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code           text NOT NULL UNIQUE,
  name           text NOT NULL,
  facility_type  clinical.facility_type NOT NULL,
  city           text NOT NULL,
  district       text NOT NULL,
  state          text NOT NULL,
  pincode        text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT facilities_pincode_format CHECK (pincode ~ '^[1-9][0-9]{5}$')
);
CREATE INDEX facilities_location_idx ON clinical.facilities (state, district);
CREATE TRIGGER facilities_set_updated_at BEFORE UPDATE ON clinical.facilities
  FOR EACH ROW EXECUTE FUNCTION util.set_updated_at();

CREATE TABLE clinical.clinicians (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL UNIQUE,
  user_role            identity.user_role NOT NULL DEFAULT 'CLINICIAN',
  registration_number  text NOT NULL UNIQUE,         -- medical council registration
  first_name           text NOT NULL,
  last_name            text NOT NULL,
  specialty            text NOT NULL,
  facility_id          uuid NOT NULL REFERENCES clinical.facilities (id),
  phone                text,
  is_active            boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  -- A clinician profile can only belong to a CLINICIAN account.
  CONSTRAINT clinicians_user_role_is_clinician CHECK (user_role = 'CLINICIAN'),
  CONSTRAINT clinicians_user_fk FOREIGN KEY (user_id, user_role)
    REFERENCES identity.users (id, role),
  CONSTRAINT clinicians_phone_format CHECK (phone IS NULL OR phone ~ '^\+?[0-9 -]{7,20}$')
);
CREATE INDEX clinicians_facility_idx ON clinical.clinicians (facility_id);
CREATE TRIGGER clinicians_set_updated_at BEFORE UPDATE ON clinical.clinicians
  FOR EACH ROW EXECUTE FUNCTION util.set_updated_at();

-- -----------------------------------------------------------------------------
-- clinical: patients (identifiable data lives only in this schema)
-- -----------------------------------------------------------------------------

CREATE TYPE clinical.gender AS ENUM ('FEMALE', 'MALE', 'OTHER', 'UNDISCLOSED');

CREATE SEQUENCE clinical.patient_mrn_seq;

CREATE TABLE clinical.patients (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mrn                       text NOT NULL UNIQUE
                            DEFAULT 'CC-' || lpad(nextval('clinical.patient_mrn_seq')::text, 6, '0'),
  user_id                   uuid UNIQUE,              -- optional patient-portal account
  user_role                 identity.user_role NOT NULL DEFAULT 'PATIENT',
  first_name                text NOT NULL,
  last_name                 text NOT NULL,
  date_of_birth             date NOT NULL,
  gender                    clinical.gender NOT NULL,
  blood_group               text,
  phone                     text,
  email                     text,
  address_line              text,
  city                      text NOT NULL,
  district                  text NOT NULL,
  state                     text NOT NULL,
  pincode                   text NOT NULL,
  emergency_contact_name    text,
  emergency_contact_phone   text,
  -- Secondary-use preference: false removes this patient from every analytics view.
  allow_aggregate_analytics boolean NOT NULL DEFAULT true,
  is_active                 boolean NOT NULL DEFAULT true,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT patients_user_role_is_patient CHECK (user_role = 'PATIENT'),
  CONSTRAINT patients_user_fk FOREIGN KEY (user_id, user_role)
    REFERENCES identity.users (id, role),
  CONSTRAINT patients_dob_range CHECK (date_of_birth >= DATE '1900-01-01'),
  CONSTRAINT patients_blood_group_valid
    CHECK (blood_group IS NULL OR blood_group IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
  CONSTRAINT patients_phone_format CHECK (phone IS NULL OR phone ~ '^\+?[0-9 -]{7,20}$'),
  CONSTRAINT patients_emergency_phone_format
    CHECK (emergency_contact_phone IS NULL OR emergency_contact_phone ~ '^\+?[0-9 -]{7,20}$'),
  CONSTRAINT patients_email_format CHECK (email IS NULL OR email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  CONSTRAINT patients_pincode_format CHECK (pincode ~ '^[1-9][0-9]{5}$')
);
CREATE INDEX patients_name_idx ON clinical.patients (lower(last_name), lower(first_name));
CREATE INDEX patients_location_idx ON clinical.patients (state, district);
CREATE TRIGGER patients_set_updated_at BEFORE UPDATE ON clinical.patients
  FOR EACH ROW EXECUTE FUNCTION util.set_updated_at();

COMMENT ON TABLE clinical.patients IS 'Identifiable patient demographics. Never readable by the ADMIN role or carecrypt_analytics.';

-- QR identities: the QR code carries an opaque random token. Only its SHA-256 hash
-- is stored, so a database leak does not yield usable QR codes. At most one ACTIVE
-- token per patient; reissuing revokes the old one.
CREATE TYPE clinical.qr_status AS ENUM ('ACTIVE', 'REVOKED');

CREATE TABLE clinical.patient_qr_identities (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id      uuid NOT NULL REFERENCES clinical.patients (id) ON DELETE CASCADE,
  token_hash      text NOT NULL UNIQUE,              -- hex SHA-256 of the token
  token_hint      text NOT NULL,                     -- last 4 characters, for support screens
  status          clinical.qr_status NOT NULL DEFAULT 'ACTIVE',
  issued_at       timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz,
  revoked_at      timestamptz,
  revoked_reason  text,
  issued_by       uuid REFERENCES identity.users (id),
  CONSTRAINT qr_token_hash_format CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT qr_token_hint_length CHECK (char_length(token_hint) = 4),
  CONSTRAINT qr_expiry_after_issue CHECK (expires_at IS NULL OR expires_at > issued_at),
  CONSTRAINT qr_revocation_consistent CHECK (
    (status = 'REVOKED' AND revoked_at IS NOT NULL AND revoked_at >= issued_at)
    OR (status = 'ACTIVE' AND revoked_at IS NULL)
  )
);
CREATE UNIQUE INDEX qr_one_active_per_patient
  ON clinical.patient_qr_identities (patient_id) WHERE status = 'ACTIVE';

-- -----------------------------------------------------------------------------
-- clinical: longitudinal problem list and allergies
-- -----------------------------------------------------------------------------

CREATE TYPE clinical.condition_status AS ENUM ('ACTIVE', 'IN_REMISSION', 'RESOLVED');

-- Chronic / long-term conditions (the patient's problem list).
CREATE TABLE clinical.patient_conditions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id            uuid NOT NULL REFERENCES clinical.patients (id) ON DELETE CASCADE,
  condition_code        text NOT NULL REFERENCES ref.conditions (code),
  status                clinical.condition_status NOT NULL DEFAULT 'ACTIVE',
  onset_date            date,
  resolved_date         date,
  notes                 text,
  recorded_by           uuid REFERENCES clinical.clinicians (id),
  recorded_in_visit_id  uuid,                         -- FK added after clinical.visits exists
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT patient_conditions_resolution CHECK (
    (status = 'RESOLVED' AND resolved_date IS NOT NULL) OR (status <> 'RESOLVED' AND resolved_date IS NULL)
  ),
  CONSTRAINT patient_conditions_dates CHECK (resolved_date IS NULL OR onset_date IS NULL OR resolved_date >= onset_date)
);
CREATE UNIQUE INDEX patient_conditions_one_open_per_code
  ON clinical.patient_conditions (patient_id, condition_code) WHERE status <> 'RESOLVED';
CREATE INDEX patient_conditions_code_idx ON clinical.patient_conditions (condition_code);
CREATE TRIGGER patient_conditions_set_updated_at BEFORE UPDATE ON clinical.patient_conditions
  FOR EACH ROW EXECUTE FUNCTION util.set_updated_at();

CREATE TYPE clinical.allergen_type AS ENUM ('DRUG', 'FOOD', 'ENVIRONMENTAL', 'OTHER');
CREATE TYPE clinical.allergy_severity AS ENUM ('MILD', 'MODERATE', 'SEVERE', 'LIFE_THREATENING');

CREATE TABLE clinical.patient_allergies (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id     uuid NOT NULL REFERENCES clinical.patients (id) ON DELETE CASCADE,
  allergen       text NOT NULL,
  allergen_type  clinical.allergen_type NOT NULL,
  drug_class     text,                               -- matches ref.medications.drug_class for DRUG allergies
  reaction       text,
  severity       clinical.allergy_severity NOT NULL,
  is_active      boolean NOT NULL DEFAULT true,
  recorded_by    uuid REFERENCES clinical.clinicians (id),
  recorded_at    timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT allergies_drug_class_only_for_drugs CHECK (drug_class IS NULL OR allergen_type = 'DRUG')
);
CREATE UNIQUE INDEX patient_allergies_unique_allergen
  ON clinical.patient_allergies (patient_id, lower(allergen));
CREATE TRIGGER patient_allergies_set_updated_at BEFORE UPDATE ON clinical.patient_allergies
  FOR EACH ROW EXECUTE FUNCTION util.set_updated_at();

-- -----------------------------------------------------------------------------
-- clinical: visits (encounters) and their details
-- -----------------------------------------------------------------------------

CREATE TYPE clinical.visit_type AS ENUM ('OPD', 'FOLLOW_UP', 'EMERGENCY', 'TELECONSULT');
CREATE TYPE clinical.visit_status AS ENUM ('OPEN', 'COMPLETED', 'CANCELLED');

CREATE TABLE clinical.visits (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id           uuid NOT NULL REFERENCES clinical.patients (id),
  clinician_id         uuid NOT NULL REFERENCES clinical.clinicians (id),
  facility_id          uuid NOT NULL REFERENCES clinical.facilities (id),
  visit_at             timestamptz NOT NULL,
  visit_type           clinical.visit_type NOT NULL DEFAULT 'OPD',
  status               clinical.visit_status NOT NULL DEFAULT 'COMPLETED',
  chief_complaint      text,
  clinical_notes       text,
  -- Vitals recorded at this visit (all optional).
  temperature_c        numeric(4,1),
  pulse_bpm            smallint,
  systolic_bp_mmhg     smallint,
  diastolic_bp_mmhg    smallint,
  respiratory_rate     smallint,
  spo2_percent         smallint,
  weight_kg            numeric(5,1),
  height_cm            numeric(5,1),
  -- The clinician's explicit confirmation that the assessment is their own judgement.
  assessment_confirmed_by  uuid REFERENCES identity.users (id),
  assessment_confirmed_at  timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT visits_assessment_confirmation CHECK ((assessment_confirmed_by IS NULL) = (assessment_confirmed_at IS NULL)),
  CONSTRAINT visits_visit_at_range CHECK (visit_at >= TIMESTAMPTZ '2000-01-01'),
  CONSTRAINT visits_temperature_range CHECK (temperature_c IS NULL OR temperature_c BETWEEN 30 AND 45),
  CONSTRAINT visits_pulse_range CHECK (pulse_bpm IS NULL OR pulse_bpm BETWEEN 20 AND 250),
  CONSTRAINT visits_systolic_range CHECK (systolic_bp_mmhg IS NULL OR systolic_bp_mmhg BETWEEN 50 AND 300),
  CONSTRAINT visits_diastolic_range CHECK (diastolic_bp_mmhg IS NULL OR diastolic_bp_mmhg BETWEEN 20 AND 200),
  CONSTRAINT visits_bp_pair CHECK (
    (systolic_bp_mmhg IS NULL) = (diastolic_bp_mmhg IS NULL)
    AND (systolic_bp_mmhg IS NULL OR systolic_bp_mmhg > diastolic_bp_mmhg)
  ),
  CONSTRAINT visits_rr_range CHECK (respiratory_rate IS NULL OR respiratory_rate BETWEEN 4 AND 80),
  CONSTRAINT visits_spo2_range CHECK (spo2_percent IS NULL OR spo2_percent BETWEEN 50 AND 100),
  CONSTRAINT visits_weight_range CHECK (weight_kg IS NULL OR weight_kg BETWEEN 0.5 AND 400),
  CONSTRAINT visits_height_range CHECK (height_cm IS NULL OR height_cm BETWEEN 30 AND 250)
);
-- Longitudinal history: a patient's visits, newest first.
CREATE INDEX visits_patient_timeline_idx ON clinical.visits (patient_id, visit_at DESC);
CREATE INDEX visits_clinician_idx ON clinical.visits (clinician_id, visit_at DESC);
CREATE INDEX visits_facility_idx ON clinical.visits (facility_id);
CREATE INDEX visits_visit_at_idx ON clinical.visits (visit_at);
CREATE TRIGGER visits_set_updated_at BEFORE UPDATE ON clinical.visits
  FOR EACH ROW EXECUTE FUNCTION util.set_updated_at();

ALTER TABLE clinical.patient_conditions
  ADD CONSTRAINT patient_conditions_visit_fk
  FOREIGN KEY (recorded_in_visit_id) REFERENCES clinical.visits (id) ON DELETE SET NULL;

CREATE TYPE clinical.symptom_severity AS ENUM ('MILD', 'MODERATE', 'SEVERE');

CREATE TABLE clinical.visit_symptoms (
  visit_id       uuid NOT NULL REFERENCES clinical.visits (id) ON DELETE CASCADE,
  symptom_code   text NOT NULL REFERENCES ref.symptoms (code),
  severity       clinical.symptom_severity NOT NULL DEFAULT 'MODERATE',
  duration_days  smallint,
  PRIMARY KEY (visit_id, symptom_code),
  CONSTRAINT visit_symptoms_duration_range CHECK (duration_days IS NULL OR duration_days BETWEEN 0 AND 3650)
);
CREATE INDEX visit_symptoms_symptom_idx ON clinical.visit_symptoms (symptom_code);

CREATE TYPE clinical.diagnosis_type AS ENUM ('PROVISIONAL', 'CONFIRMED', 'DIFFERENTIAL');

CREATE TABLE clinical.visit_diagnoses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id        uuid NOT NULL REFERENCES clinical.visits (id) ON DELETE CASCADE,
  condition_code  text NOT NULL REFERENCES ref.conditions (code),
  diagnosis_type  clinical.diagnosis_type NOT NULL,
  is_primary      boolean NOT NULL DEFAULT false,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT visit_diagnoses_unique_code UNIQUE (visit_id, condition_code),
  CONSTRAINT visit_diagnoses_primary_not_differential
    CHECK (NOT (is_primary AND diagnosis_type = 'DIFFERENTIAL'))
);
CREATE UNIQUE INDEX visit_diagnoses_one_primary
  ON clinical.visit_diagnoses (visit_id) WHERE is_primary;
CREATE INDEX visit_diagnoses_condition_idx ON clinical.visit_diagnoses (condition_code);

CREATE TYPE clinical.medication_route AS ENUM ('ORAL', 'INHALED', 'TOPICAL', 'IV', 'IM', 'SC', 'OTHER');

-- Medications prescribed at a visit. The patient's medication history is the
-- union of these rows across visits.
CREATE TABLE clinical.visit_medications (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id         uuid NOT NULL REFERENCES clinical.visits (id) ON DELETE CASCADE,
  medication_code  text NOT NULL REFERENCES ref.medications (code),
  dose             text NOT NULL,
  frequency        text NOT NULL,
  route            clinical.medication_route NOT NULL DEFAULT 'ORAL',
  duration_days    smallint,
  instructions     text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT visit_medications_unique_drug UNIQUE (visit_id, medication_code),
  CONSTRAINT visit_medications_duration_range CHECK (duration_days IS NULL OR duration_days BETWEEN 1 AND 365)
);
CREATE INDEX visit_medications_medication_idx ON clinical.visit_medications (medication_code);

-- -----------------------------------------------------------------------------
-- clinical: consent
-- A patient grants a specific clinician access to their record, with a scope and
-- an optional expiry. A consent is in force when it is not revoked and not expired.
-- -----------------------------------------------------------------------------

CREATE TYPE clinical.consent_scope AS ENUM ('FULL_RECORD', 'VISIT_HISTORY', 'SUMMARY_ONLY');
CREATE TYPE clinical.consent_channel AS ENUM ('IN_PERSON', 'PATIENT_PORTAL');

CREATE TABLE clinical.consent_records (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id      uuid NOT NULL REFERENCES clinical.patients (id) ON DELETE CASCADE,
  clinician_id    uuid NOT NULL REFERENCES clinical.clinicians (id),
  scope           clinical.consent_scope NOT NULL,
  purpose         text NOT NULL,
  channel         clinical.consent_channel NOT NULL,
  granted_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz,
  revoked_at      timestamptz,
  revoked_reason  text,
  recorded_by     uuid REFERENCES identity.users (id),
  CONSTRAINT consent_expiry_after_grant CHECK (expires_at IS NULL OR expires_at > granted_at),
  CONSTRAINT consent_revoked_after_grant CHECK (revoked_at IS NULL OR revoked_at >= granted_at),
  CONSTRAINT consent_revoked_reason CHECK (revoked_at IS NOT NULL OR revoked_reason IS NULL)
);
CREATE INDEX consent_lookup_idx
  ON clinical.consent_records (patient_id, clinician_id) WHERE revoked_at IS NULL;
CREATE INDEX consent_clinician_idx ON clinical.consent_records (clinician_id);

CREATE FUNCTION clinical.has_active_consent(
  p_patient_id uuid,
  p_clinician_id uuid,
  p_at timestamptz DEFAULT now()
) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1
    FROM clinical.consent_records c
    WHERE c.patient_id = p_patient_id
      AND c.clinician_id = p_clinician_id
      AND c.granted_at <= p_at
      AND (c.expires_at IS NULL OR c.expires_at > p_at)
      AND (c.revoked_at IS NULL OR c.revoked_at > p_at)
  );
$$;

-- SmartCare Assist runs. Stores what decision support suggested (codes and levels,
-- no free text) so a visit can show it next to the clinician's own assessment.
-- A run is linked to at most one visit, and only once the clinician has reviewed it.
CREATE TABLE clinical.decision_support_runs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id            uuid NOT NULL REFERENCES clinical.patients (id),
  clinician_id          uuid NOT NULL REFERENCES clinical.clinicians (id),
  visit_id              uuid UNIQUE REFERENCES clinical.visits (id) ON DELETE SET NULL,
  engine                text NOT NULL,
  consent_scope         clinical.consent_scope NOT NULL,
  symptom_codes         text[] NOT NULL,
  suggested_conditions  jsonb NOT NULL,            -- [{ code, name, strength }]
  risk_level            text NOT NULL CHECK (risk_level IN ('HIGH', 'MODERATE', 'LOW')),
  risk_score            smallint NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
  created_at            timestamptz NOT NULL DEFAULT now(),
  reviewed_at           timestamptz,
  CONSTRAINT dsr_reviewed_when_linked CHECK ((visit_id IS NULL) = (reviewed_at IS NULL))
);
CREATE INDEX dsr_patient_idx ON clinical.decision_support_runs (patient_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- audit: append-only, hash-chained log
-- Every row stores the hash of the previous row, so editing or deleting history
-- is detectable with audit.verify_chain(). UPDATE, DELETE and TRUNCATE are blocked.
-- -----------------------------------------------------------------------------

CREATE TYPE audit.outcome AS ENUM ('SUCCESS', 'FAILURE', 'DENIED');

CREATE TABLE audit.chain_state (
  singleton  boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  last_seq   bigint NOT NULL DEFAULT 0,
  last_hash  text NOT NULL DEFAULT repeat('0', 64)
);
INSERT INTO audit.chain_state DEFAULT VALUES;

CREATE TABLE audit.audit_logs (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chain_seq      bigint NOT NULL UNIQUE,              -- set by trigger
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  -- No FK to identity.users: the log must survive account deletion unchanged.
  user_id        uuid,
  user_role      identity.user_role,
  action         text NOT NULL,                       -- e.g. PATIENT_RECORD_VIEW
  resource_type  text NOT NULL,                       -- e.g. patient, visit, consent
  resource_id    text,
  patient_id     uuid,                                -- set when the event touches a patient's record
  outcome        audit.outcome NOT NULL,
  reason         text,
  ip_address     inet,
  user_agent     text,
  request_id     text,
  metadata       jsonb NOT NULL DEFAULT '{}'::jsonb,
  prev_hash      text NOT NULL,                       -- set by trigger
  entry_hash     text NOT NULL,                       -- set by trigger
  CONSTRAINT audit_action_format CHECK (action ~ '^[A-Z][A-Z0-9_]*$'),
  CONSTRAINT audit_role_with_user CHECK (user_id IS NOT NULL OR user_role IS NULL)
);
CREATE INDEX audit_occurred_at_idx ON audit.audit_logs (occurred_at DESC);
CREATE INDEX audit_user_idx ON audit.audit_logs (user_id, occurred_at DESC);
CREATE INDEX audit_patient_idx ON audit.audit_logs (patient_id, occurred_at DESC) WHERE patient_id IS NOT NULL;
CREATE INDEX audit_action_idx ON audit.audit_logs (action, occurred_at DESC);
CREATE INDEX audit_not_success_idx ON audit.audit_logs (occurred_at DESC) WHERE outcome <> 'SUCCESS';

CREATE FUNCTION audit.entry_digest(
  p_prev_hash text, p_seq bigint, p_occurred_at timestamptz, p_user_id uuid, p_role identity.user_role,
  p_action text, p_resource_type text, p_resource_id text, p_patient_id uuid, p_outcome audit.outcome,
  p_reason text, p_ip inet, p_metadata jsonb
) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(concat_ws('|',
    p_prev_hash, p_seq, to_char(p_occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
    p_user_id, p_role, p_action, p_resource_type, p_resource_id, p_patient_id, p_outcome,
    p_reason, host(p_ip), p_metadata::text
  ), 'UTF8')), 'hex');
$$;

-- SECURITY DEFINER: runs as the schema owner, so the API role needs INSERT on
-- audit_logs only and can never write to chain_state directly.
CREATE FUNCTION audit.chain_entry() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, audit AS $$
DECLARE
  v_state audit.chain_state%ROWTYPE;
BEGIN
  -- Row lock serialises concurrent inserts so the chain has a single order.
  SELECT * INTO v_state FROM audit.chain_state WHERE singleton FOR UPDATE;
  NEW.chain_seq := v_state.last_seq + 1;
  NEW.prev_hash := v_state.last_hash;
  NEW.entry_hash := audit.entry_digest(
    NEW.prev_hash, NEW.chain_seq, NEW.occurred_at, NEW.user_id, NEW.user_role, NEW.action,
    NEW.resource_type, NEW.resource_id, NEW.patient_id, NEW.outcome, NEW.reason, NEW.ip_address, NEW.metadata
  );
  UPDATE audit.chain_state SET last_seq = NEW.chain_seq, last_hash = NEW.entry_hash WHERE singleton;
  RETURN NEW;
END;
$$;

CREATE FUNCTION audit.reject_modification() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit.audit_logs is append-only (% blocked)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER audit_logs_chain BEFORE INSERT ON audit.audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit.chain_entry();
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON audit.audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit.reject_modification();
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit.audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit.reject_modification();

-- Returns the chain_seq of the first entry whose hash does not match, or NULL if intact.
CREATE FUNCTION audit.verify_chain() RETURNS bigint
LANGUAGE plpgsql STABLE AS $$
DECLARE
  r record;
  v_prev text := repeat('0', 64);
BEGIN
  FOR r IN SELECT * FROM audit.audit_logs ORDER BY chain_seq LOOP
    IF r.prev_hash <> v_prev OR r.entry_hash <> audit.entry_digest(
         r.prev_hash, r.chain_seq, r.occurred_at, r.user_id, r.user_role, r.action, r.resource_type,
         r.resource_id, r.patient_id, r.outcome, r.reason, r.ip_address, r.metadata) THEN
      RETURN r.chain_seq;
    END IF;
    v_prev := r.entry_hash;
  END LOOP;
  RETURN NULL;
END;
$$;

-- Security events: findings for the SECURITY_ADMIN to review, such as suspected
-- inference attacks on analytics or a locked account. Each event is also written
-- to audit_logs (SECURITY_EVENT). Only status fields change after insert.
CREATE TYPE audit.event_severity AS ENUM ('LOW', 'MEDIUM', 'HIGH');
CREATE TYPE audit.event_status AS ENUM ('OPEN', 'RESOLVED');

CREATE TABLE audit.security_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  detected_at     timestamptz NOT NULL DEFAULT now(),
  event_type      text NOT NULL,                        -- e.g. INFERENCE_NARROWING
  severity        audit.event_severity NOT NULL,
  user_id         uuid,                                 -- the account whose behaviour triggered it
  user_role       identity.user_role,
  summary         text NOT NULL,
  details         jsonb NOT NULL DEFAULT '{}'::jsonb,   -- never counts below the minimum group size
  status          audit.event_status NOT NULL DEFAULT 'OPEN',
  resolved_by     uuid REFERENCES identity.users (id),
  resolved_at     timestamptz,
  resolution_note text,
  CONSTRAINT security_events_type_format CHECK (event_type ~ '^[A-Z][A-Z0-9_]*$'),
  CONSTRAINT security_events_resolution CHECK (
    (status = 'OPEN' AND resolved_by IS NULL AND resolved_at IS NULL)
    OR (status = 'RESOLVED' AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL)
  )
);
CREATE INDEX security_events_open_idx ON audit.security_events (status, detected_at DESC);
CREATE INDEX security_events_user_idx ON audit.security_events (user_id, detected_at DESC);

-- -----------------------------------------------------------------------------
-- analytics: privacy layer for administrator dashboards
-- Only the aggregate views below are exposed to carecrypt_analytics (see the
-- grants at the end). Every view suppresses on DISTINCT patients: a cell with
-- fewer patients than min_group_size has its counts nulled and is_suppressed = true.
-- Patients with allow_aggregate_analytics = false are excluded.
-- A "case" is a CONFIRMED or PROVISIONAL diagnosis recorded at a completed visit.
-- Each view is aggregated at its own grain, so a total is never the sum of
-- suppressed finer cells. Complementary suppression (stopping a hidden cell from
-- being recovered by subtracting visible cells from a published total) is applied
-- by the API, see backend/src/analytics/suppression.js.
-- -----------------------------------------------------------------------------

CREATE TABLE analytics.privacy_settings (
  singleton       boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  min_group_size  integer NOT NULL DEFAULT 10 CHECK (min_group_size >= 2),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
INSERT INTO analytics.privacy_settings DEFAULT VALUES;
CREATE TRIGGER privacy_settings_set_updated_at BEFORE UPDATE ON analytics.privacy_settings
  FOR EACH ROW EXECUTE FUNCTION util.set_updated_at();

CREATE FUNCTION analytics.age_band(p_dob date, p_at timestamptz) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN a < 5 THEN '0-4'
    WHEN a < 15 THEN '5-14'
    WHEN a < 25 THEN '15-24'
    WHEN a < 45 THEN '25-44'
    WHEN a < 65 THEN '45-64'
    ELSE '65+'
  END
  FROM (SELECT extract(year FROM age(p_at::date, p_dob))::int AS a) s;
$$;

-- INTERNAL: row-level, still linkable (contains ids). Not granted to anyone.
CREATE VIEW analytics.diagnosis_events_internal AS
SELECT
  v.id AS visit_id,
  v.patient_id,
  date_trunc('month', v.visit_at)::date AS month,
  extract(year FROM v.visit_at)::int AS year,
  p.state,
  p.district,
  p.gender,
  analytics.age_band(p.date_of_birth, v.visit_at) AS age_band,
  d.condition_code,
  c.name AS condition_name,
  c.category AS condition_category,
  c.is_notifiable
FROM clinical.visit_diagnoses d
JOIN clinical.visits v ON v.id = d.visit_id
JOIN clinical.patients p ON p.id = v.patient_id
JOIN ref.conditions c ON c.code = d.condition_code
WHERE d.diagnosis_type IN ('CONFIRMED', 'PROVISIONAL')
  AND v.status = 'COMPLETED'
  AND p.allow_aggregate_analytics;

-- Disease trends by month and district.
CREATE VIEW analytics.condition_monthly_by_district AS
WITH k AS (SELECT min_group_size FROM analytics.privacy_settings),
agg AS (
  SELECT month, state, district, condition_code, condition_name, condition_category, is_notifiable,
         count(DISTINCT patient_id) AS n_patients,
         count(DISTINCT visit_id) AS n_visits
  FROM analytics.diagnosis_events_internal
  GROUP BY month, state, district, condition_code, condition_name, condition_category, is_notifiable
)
SELECT agg.month, agg.state, agg.district, agg.condition_code, agg.condition_name,
       agg.condition_category, agg.is_notifiable,
       CASE WHEN agg.n_patients >= k.min_group_size THEN agg.n_patients END AS patient_count,
       CASE WHEN agg.n_patients >= k.min_group_size THEN agg.n_visits END AS visit_count,
       agg.n_patients < k.min_group_size AS is_suppressed,
       k.min_group_size
FROM agg CROSS JOIN k;

-- Condition burden by year, age band and gender.
CREATE VIEW analytics.condition_yearly_by_demographics AS
WITH k AS (SELECT min_group_size FROM analytics.privacy_settings),
agg AS (
  SELECT year, condition_code, condition_name, condition_category, age_band, gender,
         count(DISTINCT patient_id) AS n_patients
  FROM analytics.diagnosis_events_internal
  GROUP BY year, condition_code, condition_name, condition_category, age_band, gender
)
SELECT agg.year, agg.condition_code, agg.condition_name, agg.condition_category, agg.age_band, agg.gender,
       CASE WHEN agg.n_patients >= k.min_group_size THEN agg.n_patients END AS patient_count,
       agg.n_patients < k.min_group_size AS is_suppressed,
       k.min_group_size
FROM agg CROSS JOIN k;

-- Overall visit volume by month and state.
CREATE VIEW analytics.visit_volume_monthly AS
WITH k AS (SELECT min_group_size FROM analytics.privacy_settings),
agg AS (
  SELECT date_trunc('month', v.visit_at)::date AS month, p.state,
         count(DISTINCT v.patient_id) AS n_patients,
         count(*) AS n_visits
  FROM clinical.visits v
  JOIN clinical.patients p ON p.id = v.patient_id
  WHERE v.status = 'COMPLETED' AND p.allow_aggregate_analytics
  GROUP BY 1, 2
)
SELECT agg.month, agg.state,
       CASE WHEN agg.n_patients >= k.min_group_size THEN agg.n_patients END AS patient_count,
       CASE WHEN agg.n_patients >= k.min_group_size THEN agg.n_visits END AS visit_count,
       agg.n_patients < k.min_group_size AS is_suppressed,
       k.min_group_size
FROM agg CROSS JOIN k;

-- Views for the ADMIN analytics API (/api/analytics). No identifiers, no free text,
-- no dates finer than a month, and no cell below min_group_size.

-- Headline totals. Visits are all completed visits of patients in analytics.
CREATE VIEW analytics.overview_totals AS
WITH k AS (SELECT min_group_size FROM analytics.privacy_settings),
agg AS (
  SELECT count(DISTINCT patient_id) AS n_patients,
         count(*) AS n_cases,
         count(*) FILTER (WHERE is_notifiable) AS n_notifiable_cases,
         count(DISTINCT patient_id) FILTER (WHERE is_notifiable) AS n_notifiable_patients,
         count(DISTINCT condition_code) AS n_conditions,
         count(DISTINCT (state, district)) AS n_districts,
         min(month) AS first_month,
         max(month) AS last_month
  FROM analytics.diagnosis_events_internal
),
visits AS (
  SELECT count(*) AS n_visits
  FROM clinical.visits v
  JOIN clinical.patients p ON p.id = v.patient_id
  WHERE v.status = 'COMPLETED' AND p.allow_aggregate_analytics
)
SELECT CASE WHEN agg.n_patients >= k.min_group_size THEN agg.n_patients END AS patient_count,
       CASE WHEN agg.n_patients >= k.min_group_size THEN agg.n_cases END AS case_count,
       CASE WHEN agg.n_patients >= k.min_group_size THEN visits.n_visits END AS visit_count,
       CASE WHEN agg.n_notifiable_patients >= k.min_group_size THEN agg.n_notifiable_cases END AS notifiable_case_count,
       agg.n_conditions AS condition_count,
       agg.n_districts AS district_count,
       agg.first_month,
       agg.last_month,
       agg.n_patients < k.min_group_size AS is_suppressed,
       k.min_group_size
FROM agg CROSS JOIN visits CROSS JOIN k;

-- Cases by district (all time).
CREATE VIEW analytics.cases_by_location AS
WITH k AS (SELECT min_group_size FROM analytics.privacy_settings),
agg AS (
  SELECT state, district,
         count(DISTINCT patient_id) AS n_patients,
         count(*) AS n_cases
  FROM analytics.diagnosis_events_internal
  GROUP BY state, district
)
SELECT agg.state, agg.district,
       CASE WHEN agg.n_patients >= k.min_group_size THEN agg.n_patients END AS patient_count,
       CASE WHEN agg.n_patients >= k.min_group_size THEN agg.n_cases END AS case_count,
       agg.n_patients < k.min_group_size AS is_suppressed,
       k.min_group_size
FROM agg CROSS JOIN k;

-- Cases by condition category (all time).
CREATE VIEW analytics.cases_by_category AS
WITH k AS (SELECT min_group_size FROM analytics.privacy_settings),
agg AS (
  SELECT condition_category,
         count(DISTINCT patient_id) AS n_patients,
         count(*) AS n_cases
  FROM analytics.diagnosis_events_internal
  GROUP BY condition_category
)
SELECT agg.condition_category,
       CASE WHEN agg.n_patients >= k.min_group_size THEN agg.n_patients END AS patient_count,
       CASE WHEN agg.n_patients >= k.min_group_size THEN agg.n_cases END AS case_count,
       agg.n_patients < k.min_group_size AS is_suppressed,
       k.min_group_size
FROM agg CROSS JOIN k;

-- Cases by condition (all time).
CREATE VIEW analytics.cases_by_condition AS
WITH k AS (SELECT min_group_size FROM analytics.privacy_settings),
agg AS (
  SELECT condition_code, condition_name, condition_category, is_notifiable,
         count(DISTINCT patient_id) AS n_patients,
         count(*) AS n_cases
  FROM analytics.diagnosis_events_internal
  GROUP BY condition_code, condition_name, condition_category, is_notifiable
)
SELECT agg.condition_code, agg.condition_name, agg.condition_category, agg.is_notifiable,
       CASE WHEN agg.n_patients >= k.min_group_size THEN agg.n_patients END AS patient_count,
       CASE WHEN agg.n_patients >= k.min_group_size THEN agg.n_cases END AS case_count,
       agg.n_patients < k.min_group_size AS is_suppressed,
       k.min_group_size
FROM agg CROSS JOIN k;

-- Cases by month.
CREATE VIEW analytics.cases_monthly AS
WITH k AS (SELECT min_group_size FROM analytics.privacy_settings),
agg AS (
  SELECT month,
         count(DISTINCT patient_id) AS n_patients,
         count(*) AS n_cases
  FROM analytics.diagnosis_events_internal
  GROUP BY month
)
SELECT agg.month,
       CASE WHEN agg.n_patients >= k.min_group_size THEN agg.n_patients END AS patient_count,
       CASE WHEN agg.n_patients >= k.min_group_size THEN agg.n_cases END AS case_count,
       agg.n_patients < k.min_group_size AS is_suppressed,
       k.min_group_size
FROM agg CROSS JOIN k;

-- Condition-category trends: month x category.
CREATE VIEW analytics.category_monthly AS
WITH k AS (SELECT min_group_size FROM analytics.privacy_settings),
agg AS (
  SELECT month, condition_category,
         count(DISTINCT patient_id) AS n_patients,
         count(*) AS n_cases
  FROM analytics.diagnosis_events_internal
  GROUP BY month, condition_category
)
SELECT agg.month, agg.condition_category,
       CASE WHEN agg.n_patients >= k.min_group_size THEN agg.n_patients END AS patient_count,
       CASE WHEN agg.n_patients >= k.min_group_size THEN agg.n_cases END AS case_count,
       agg.n_patients < k.min_group_size AS is_suppressed,
       k.min_group_size
FROM agg CROSS JOIN k;

-- Geographic breakdown: district x category (all time).
CREATE VIEW analytics.location_category AS
WITH k AS (SELECT min_group_size FROM analytics.privacy_settings),
agg AS (
  SELECT state, district, condition_category,
         count(DISTINCT patient_id) AS n_patients,
         count(*) AS n_cases
  FROM analytics.diagnosis_events_internal
  GROUP BY state, district, condition_category
)
SELECT agg.state, agg.district, agg.condition_category,
       CASE WHEN agg.n_patients >= k.min_group_size THEN agg.n_patients END AS patient_count,
       CASE WHEN agg.n_patients >= k.min_group_size THEN agg.n_cases END AS case_count,
       agg.n_patients < k.min_group_size AS is_suppressed,
       k.min_group_size
FROM agg CROSS JOIN k;

-- Cases by age band (age at the visit).
CREATE VIEW analytics.cases_by_age_band AS
WITH k AS (SELECT min_group_size FROM analytics.privacy_settings),
agg AS (
  SELECT age_band,
         count(DISTINCT patient_id) AS n_patients,
         count(*) AS n_cases
  FROM analytics.diagnosis_events_internal
  GROUP BY age_band
)
SELECT agg.age_band,
       CASE WHEN agg.n_patients >= k.min_group_size THEN agg.n_patients END AS patient_count,
       CASE WHEN agg.n_patients >= k.min_group_size THEN agg.n_cases END AS case_count,
       agg.n_patients < k.min_group_size AS is_suppressed,
       k.min_group_size
FROM agg CROSS JOIN k;

-- Custom aggregate queries (GET /api/analytics/query).
-- p is a JSON object of equality filters, any of:
--   state, district, category, condition, month ('YYYY-MM'), ageBand, gender
-- Row-level helper: not granted to anyone.
CREATE FUNCTION analytics.filtered_events(p jsonb) RETURNS SETOF analytics.diagnosis_events_internal
LANGUAGE sql STABLE AS $$
  SELECT e.* FROM analytics.diagnosis_events_internal e
  WHERE (p->>'state' IS NULL OR e.state = p->>'state')
    AND (p->>'district' IS NULL OR e.district = p->>'district')
    AND (p->>'category' IS NULL OR e.condition_category = p->>'category')
    AND (p->>'condition' IS NULL OR e.condition_code = p->>'condition')
    AND (p->>'month' IS NULL OR to_char(e.month, 'YYYY-MM') = p->>'month')
    AND (p->>'ageBand' IS NULL OR e.age_band = p->>'ageBand')
    AND (p->>'gender' IS NULL OR e.gender::text = p->>'gender')
$$;

-- Answers one custom query with the minimum-group check applied inside the
-- database, so no small count ever reaches the API:
--   * fewer than min_group_size patients (and not zero)          -> SMALL_GROUP
--   * the answer differs from the answer to any coarser version of
--     the same query (some filters removed) by 1..k-1 patients, so
--     subtracting the two would expose a small group             -> DIFFERENCE
-- For DIFFERENCE, risk_filters names the coarser query (filters only, no counts).
CREATE FUNCTION analytics.query_cases(p jsonb)
RETURNS TABLE (patient_count bigint, case_count bigint, is_suppressed boolean, suppression text,
               risk_filters jsonb, min_group_size integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  k integer;
  n_patients bigint;
  n_cases bigint;
  keys text[];
  mask integer;
  coarser jsonb;
  n_coarser bigint;
  i integer;
BEGIN
  SELECT s.min_group_size INTO k FROM analytics.privacy_settings s;
  SELECT count(DISTINCT e.patient_id), count(*) INTO n_patients, n_cases FROM analytics.filtered_events(p) e;

  IF n_patients > 0 AND n_patients < k THEN
    RETURN QUERY SELECT NULL::bigint, NULL::bigint, true, 'SMALL_GROUP'::text, NULL::jsonb, k;
    RETURN;
  END IF;

  -- Every proper subset of the filters (at most 2^7 - 1 coarser queries).
  keys := ARRAY(SELECT jsonb_object_keys(p) ORDER BY 1);
  FOR mask IN 0 .. (1 << coalesce(array_length(keys, 1), 0)) - 2 LOOP
    coarser := '{}'::jsonb;
    FOR i IN 1 .. coalesce(array_length(keys, 1), 0) LOOP
      IF mask & (1 << (i - 1)) <> 0 THEN
        coarser := coarser || jsonb_build_object(keys[i], p->keys[i]);
      END IF;
    END LOOP;
    SELECT count(DISTINCT e.patient_id) INTO n_coarser FROM analytics.filtered_events(coarser) e;
    IF n_coarser - n_patients BETWEEN 1 AND k - 1 THEN
      RETURN QUERY SELECT NULL::bigint, NULL::bigint, true, 'DIFFERENCE'::text, coarser, k;
      RETURN;
    END IF;
  END LOOP;

  RETURN QUERY SELECT n_patients, n_cases, false, NULL::text, NULL::jsonb, k;
END;
$$;
REVOKE EXECUTE ON FUNCTION analytics.filtered_events(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION analytics.query_cases(jsonb) FROM PUBLIC;

-- -----------------------------------------------------------------------------
-- Grants (only applied if the runtime roles from init/002 exist)
-- -----------------------------------------------------------------------------

DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'carecrypt_app') THEN
    GRANT USAGE ON SCHEMA identity, ref, clinical, audit, analytics, util TO carecrypt_app;

    GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA identity TO carecrypt_app;
    GRANT SELECT ON ALL TABLES IN SCHEMA ref TO carecrypt_app;
    -- No DELETE on patients or visits: health records are corrected, not erased.
    GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA clinical TO carecrypt_app;
    GRANT DELETE ON clinical.visit_symptoms, clinical.visit_diagnoses, clinical.visit_medications
      TO carecrypt_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA clinical TO carecrypt_app;
    GRANT EXECUTE ON FUNCTION clinical.has_active_consent(uuid, uuid, timestamptz) TO carecrypt_app;

    -- Audit: append and read only.
    GRANT SELECT, INSERT ON audit.audit_logs TO carecrypt_app;
    GRANT EXECUTE ON FUNCTION audit.verify_chain() TO carecrypt_app;
    -- Security events: raised by the API, resolved by a SECURITY_ADMIN; never deleted.
    GRANT SELECT, INSERT ON audit.security_events TO carecrypt_app;
    GRANT UPDATE (status, resolved_by, resolved_at, resolution_note) ON audit.security_events TO carecrypt_app;

    GRANT SELECT, UPDATE ON analytics.privacy_settings TO carecrypt_app;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'carecrypt_analytics') THEN
    GRANT USAGE ON SCHEMA analytics TO carecrypt_analytics;
    GRANT SELECT ON analytics.condition_monthly_by_district,
                    analytics.condition_yearly_by_demographics,
                    analytics.visit_volume_monthly,
                    analytics.overview_totals,
                    analytics.cases_by_location,
                    analytics.cases_by_category,
                    analytics.cases_by_condition,
                    analytics.cases_monthly,
                    analytics.category_monthly,
                    analytics.location_category,
                    analytics.cases_by_age_band,
                    analytics.privacy_settings
      TO carecrypt_analytics;
    GRANT EXECUTE ON FUNCTION analytics.query_cases(jsonb) TO carecrypt_analytics;
  END IF;
END
$grants$;

COMMIT;
