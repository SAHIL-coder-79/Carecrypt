-- =============================================================================
-- CareCrypt OPTIONAL analytics volume data (synthetic)
--
-- Run after schema.sql and seed.sql, once, as the database owner:
--   psql -U carecrypt -d carecrypt -f database/seed_analytics_demo.sql
--
-- seed.sql has 24 patients, so at the minimum group size of 5 most analytics
-- cells are hidden. That is correct behaviour but makes thin charts. This file
-- adds generated population-scale records so the ADMIN dashboard shows trends:
--   * 600 patients across the four seeded districts, named "Synthetic Patient 0001"
--     and so on, with MRNs SYN-000001 onwards and no contact details or address;
--   * 1 to 4 completed visits each between Oct 2025 and Sep 2026, one diagnosis per
--     visit, drawn with seasonal and age weights (dengue and malaria in the monsoon,
--     respiratory infections in winter, gastroenteritis in summer, chronic
--     conditions mostly after 45);
--   * visits are attributed to one inactive "Synthetic data source" clinician per
--     facility, which cannot sign in, so demo clinicians' dashboards do not change;
--   * about 4% of the patients opt out of analytics.
-- No consent is granted to anyone, so no clinician can open these records.
--
-- The automated tests assume the base seed only. Reload schema.sql and seed.sql
-- before running them.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM clinical.patients WHERE mrn = 'CC-000001') THEN
    RAISE EXCEPTION 'Load database/seed.sql first.';
  END IF;
  IF EXISTS (SELECT 1 FROM clinical.patients WHERE mrn LIKE 'SYN-%') THEN
    RAISE EXCEPTION 'Analytics demo data is already loaded. Reload schema.sql and seed.sql to start again.';
  END IF;
END
$$;

-- Seeded for similar results on every run (ids are still random).
DO $$ BEGIN PERFORM setseed(0.2026); END $$;

-- One inactive source clinician per facility. The password is random and unknown,
-- and the account is disabled.
INSERT INTO identity.users (email, password_hash, role, display_name, is_active)
SELECT 'synthetic.source.' || lower(f.code) || '@carecrypt.example',
       crypt(gen_random_uuid()::text, gen_salt('bf', 10)),
       'CLINICIAN', 'Synthetic data source (' || f.code || ')', false
FROM clinical.facilities f;

INSERT INTO clinical.clinicians (user_id, registration_number, first_name, last_name, specialty, facility_id, is_active)
SELECT u.id, 'SYN-' || f.code, 'Synthetic', 'Source ' || f.code, 'Synthetic data', f.id, false
FROM clinical.facilities f
JOIN identity.users u ON u.email = 'synthetic.source.' || lower(f.code) || '@carecrypt.example';

-- Patients: district shares Pune 35%, Bengaluru Urban 25%, Nashik 20%, Ahmedabad 20%.
CREATE TEMP TABLE syn_patients ON COMMIT DROP AS
SELECT n,
       CASE WHEN r < 0.35 THEN 'Pune' WHEN r < 0.60 THEN 'Bengaluru Urban' WHEN r < 0.80 THEN 'Nashik' ELSE 'Ahmedabad' END AS district,
       -- Age on 2026-09-01: a young-skewed population, 0 to 89.
       least(89, floor(power(random(), 1.25) * 90))::int AS age,
       CASE WHEN g < 0.49 THEN 'FEMALE' WHEN g < 0.98 THEN 'MALE' ELSE 'OTHER' END::clinical.gender AS gender,
       random() > 0.04 AS analytics,
       1 + floor(random() * 4)::int AS visits
FROM (SELECT n, random() AS r, random() AS g FROM generate_series(1, 600) n) s;

INSERT INTO clinical.patients (mrn, first_name, last_name, date_of_birth, gender, city, district, state, pincode, allow_aggregate_analytics)
SELECT 'SYN-' || lpad(p.n::text, 6, '0'), 'Synthetic', 'Patient ' || lpad(p.n::text, 4, '0'),
       DATE '2026-09-01' - (p.age * 365 + floor(random() * 365))::int,
       p.gender, f.city, f.district, f.state, f.pincode, p.analytics
FROM syn_patients p
JOIN LATERAL (SELECT * FROM clinical.facilities WHERE district = p.district ORDER BY code LIMIT 1) f ON true;

-- Visits: 1 to 4 per patient, spread over Oct 2025 to Sep 2026, office hours IST.
CREATE TEMP TABLE syn_visits ON COMMIT DROP AS
SELECT gen_random_uuid() AS visit_id, p.id AS patient_id, p.district, p.gender,
       extract(year FROM age(v.visit_at::date, p.date_of_birth))::int AS age,
       v.visit_at, v.kind
FROM syn_patients sp
JOIN clinical.patients p ON p.mrn = 'SYN-' || lpad(sp.n::text, 6, '0')
CROSS JOIN LATERAL (
  SELECT TIMESTAMPTZ '2025-10-01 09:00+05:30'
           + floor(random() * 360) * interval '1 day'
           + floor(random() * 8 * 60) * interval '1 minute' AS visit_at,
         random() AS kind
  FROM generate_series(1, sp.visits)
) v;

INSERT INTO clinical.visits (id, patient_id, clinician_id, facility_id, visit_at, visit_type, status,
                             chief_complaint, assessment_confirmed_by, assessment_confirmed_at, created_at)
SELECT v.visit_id, v.patient_id, c.id, f.id, v.visit_at,
       CASE WHEN v.kind < 0.85 THEN 'OPD' WHEN v.kind < 0.95 THEN 'FOLLOW_UP' ELSE 'EMERGENCY' END::clinical.visit_type,
       'COMPLETED', 'Synthetic analytics record', c.user_id, v.visit_at, v.visit_at
FROM syn_visits v
-- Pune has two facilities; alternate between them.
JOIN LATERAL (
  SELECT * FROM clinical.facilities
  WHERE district = v.district
  ORDER BY hashtext(v.visit_id::text || code), code
  LIMIT 1
) f ON true
JOIN clinical.clinicians c ON c.registration_number = 'SYN-' || f.code;

-- Relative weight of each condition for a visit, by month, district, age and gender.
CREATE TEMP TABLE syn_weights ON COMMIT DROP AS
SELECT v.visit_id, c.code,
       CASE c.code
         WHEN 'A90'   THEN CASE WHEN m IN (8, 9, 10) THEN 5 WHEN m = 7 THEN 2 ELSE 0.15 END
                           * CASE WHEN v.district IN ('Pune', 'Nashik') THEN 1.6 ELSE 1 END
         WHEN 'B54'   THEN CASE WHEN m IN (7, 8, 9) THEN 1.6 ELSE 0.1 END
                           * CASE WHEN v.district = 'Nashik' THEN 1.5 ELSE 1 END
         WHEN 'A01.0' THEN CASE WHEN m BETWEEN 4 AND 7 THEN 1.2 ELSE 0.3 END
         WHEN 'A09'   THEN CASE WHEN m BETWEEN 5 AND 8 THEN 3.2 ELSE 1 END
                           * CASE WHEN v.district = 'Ahmedabad' THEN 1.7 ELSE 1 END
         WHEN 'J06.9' THEN CASE WHEN m IN (11, 12, 1, 2) THEN 7 ELSE 2.5 END
         WHEN 'J18.9' THEN CASE WHEN m IN (12, 1, 2) THEN 1.6 ELSE 0.4 END
                           * CASE WHEN v.age >= 65 OR v.age < 5 THEN 2.5 ELSE 1 END
         WHEN 'J45.9' THEN CASE WHEN m IN (10, 11) THEN 1.5 ELSE 0.8 END
         WHEN 'J44.9' THEN CASE WHEN v.age >= 45 THEN 0.9 ELSE 0.02 END
         WHEN 'I10'   THEN CASE WHEN v.age >= 45 THEN 3.2 WHEN v.age >= 25 THEN 0.7 ELSE 0.02 END
         WHEN 'E11.9' THEN CASE WHEN v.age >= 45 THEN 2.6 WHEN v.age >= 25 THEN 0.6 ELSE 0.02 END
         WHEN 'E78.5' THEN CASE WHEN v.age >= 45 THEN 0.9 ELSE 0.05 END
         WHEN 'E03.9' THEN CASE WHEN v.gender = 'FEMALE' AND v.age >= 15 THEN 0.8 ELSE 0.15 END
         WHEN 'N39.0' THEN CASE WHEN v.gender = 'FEMALE' THEN 1.3 ELSE 0.3 END
         WHEN 'G43.9' THEN CASE WHEN v.age BETWEEN 15 AND 64 THEN 0.9 ELSE 0.1 END
         WHEN 'M54.5' THEN CASE WHEN v.age >= 25 THEN 1.1 ELSE 0.1 END
         WHEN 'D50.9' THEN CASE WHEN v.gender = 'FEMALE' AND v.age BETWEEN 15 AND 44 THEN 1.2 WHEN v.age < 15 THEN 0.6 ELSE 0.2 END
         ELSE 0
       END::float8 AS w
FROM syn_visits v
CROSS JOIN LATERAL (SELECT extract(month FROM v.visit_at AT TIME ZONE 'Asia/Kolkata')::int AS m) mm
CROSS JOIN ref.conditions c;

-- Weighted draw of one diagnosis per visit (exponential race: smallest -ln(u)/w wins).
INSERT INTO clinical.visit_diagnoses (visit_id, condition_code, diagnosis_type, is_primary)
SELECT DISTINCT ON (visit_id) visit_id, code,
       CASE WHEN random() < 0.7 THEN 'CONFIRMED' ELSE 'PROVISIONAL' END::clinical.diagnosis_type,
       true
FROM syn_weights
WHERE w > 0
ORDER BY visit_id, -ln(1 - random()) / w;

COMMIT;

-- Summary
SELECT count(*) AS synthetic_patients,
       count(*) FILTER (WHERE NOT allow_aggregate_analytics) AS opted_out
FROM clinical.patients WHERE mrn LIKE 'SYN-%';
