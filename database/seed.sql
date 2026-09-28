-- =============================================================================
-- CareCrypt synthetic seed data
--
-- Run after schema.sql, as the database owner:
--   psql -U carecrypt -d carecrypt -f database/seed.sql
--
-- EVERYTHING HERE IS FICTIONAL. Names are invented combinations, phone numbers use
-- the invalid "+91 00000" prefix, emails use the reserved ".example" domain, IP
-- addresses come from documentation ranges (RFC 5737), and street addresses are made up.
-- Cities, districts, states and area pincodes are real so geographic analytics look
-- realistic; they identify nobody.
--
-- Demo login accounts are documented in docs/DEVELOPMENT.md. Never load this file
-- into a deployed environment.
--
-- Built-in scenarios for demos:
--   * Dengue cluster: 6 Pune patients in Sep 2026. 1 Nashik dengue case the same
--     month; a second Nashik case belongs to a patient who opted out of analytics
--     and is excluded entirely.
--   * Gastroenteritis cluster: 5 Ahmedabad patients in Jul 2026.
--     At the default minimum group size of 10 both clusters are suppressed in
--     analytics. For visible trends, also load seed_analytics_demo.sql.
--   * Consent: CC-000022 revoked Dr. Desai's access on 2026-08-01; CC-000005 has an
--     expired consent for Dr. Qureshi; CC-000001 granted Dr. Qureshi time-limited
--     visit-history access; CC-000016 granted Dr. Qureshi summary-only access.
--   * QR: CC-000003 has a revoked (lost) card and a newer active one.
--   * Audit log: successful access, a denied ADMIN attempt to open a patient record,
--     a denied clinician without consent, and a failed login.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- -----------------------------------------------------------------------------
-- Reference catalogues
-- -----------------------------------------------------------------------------

INSERT INTO ref.conditions (code, name, category, is_chronic, is_notifiable) VALUES
  ('A90',   'Dengue fever',                                   'INFECTIOUS',       false, true),
  ('B54',   'Malaria, unspecified',                           'INFECTIOUS',       false, true),
  ('A01.0', 'Typhoid fever',                                  'INFECTIOUS',       false, true),
  ('A09',   'Infectious gastroenteritis and colitis',         'INFECTIOUS',       false, true),
  ('J06.9', 'Acute upper respiratory infection',              'RESPIRATORY',      false, false),
  ('J18.9', 'Pneumonia, unspecified organism',                'RESPIRATORY',      false, false),
  ('N39.0', 'Urinary tract infection, site not specified',    'GENITOURINARY',    false, false),
  ('E11.9', 'Type 2 diabetes mellitus without complications', 'ENDOCRINE',        true,  false),
  ('E03.9', 'Hypothyroidism, unspecified',                    'ENDOCRINE',        true,  false),
  ('E78.5', 'Hyperlipidaemia, unspecified',                   'ENDOCRINE',        true,  false),
  ('I10',   'Essential (primary) hypertension',               'CARDIOVASCULAR',   true,  false),
  ('J45.9', 'Asthma, unspecified',                            'RESPIRATORY',      true,  false),
  ('J44.9', 'Chronic obstructive pulmonary disease',          'RESPIRATORY',      true,  false),
  ('D50.9', 'Iron deficiency anaemia, unspecified',           'HAEMATOLOGICAL',   true,  false),
  ('G43.9', 'Migraine, unspecified',                          'NEUROLOGICAL',     false, false),
  ('M54.5', 'Low back pain',                                  'MUSCULOSKELETAL',  false, false);

INSERT INTO ref.symptoms (code, display_name, category) VALUES
  ('fever',              'Fever',                     'general'),
  ('chills',             'Chills',                    'general'),
  ('fatigue',            'Fatigue',                   'general'),
  ('body_ache',          'Body ache',                 'general'),
  ('loss_of_appetite',   'Loss of appetite',          'general'),
  ('sweating',           'Excessive sweating',        'general'),
  ('swelling',           'Swelling',                  'general'),
  ('cough',              'Cough',                     'respiratory'),
  ('breathlessness',     'Breathlessness',            'respiratory'),
  ('wheezing',           'Wheezing',                  'respiratory'),
  ('sore_throat',        'Sore throat',               'ent'),
  ('runny_nose',         'Runny nose',                'ent'),
  ('chest_pain',         'Chest pain',                'cardiac'),
  ('palpitations',       'Palpitations',              'cardiac'),
  ('headache',           'Headache',                  'neurological'),
  ('dizziness',          'Dizziness',                 'neurological'),
  ('confusion',          'Confusion',                 'neurological'),
  ('photophobia',        'Light sensitivity',         'neurological'),
  ('retro_orbital_pain', 'Pain behind the eyes',      'neurological'),
  ('blurred_vision',     'Blurred vision',            'eyes'),
  ('nausea',             'Nausea',                    'gi'),
  ('vomiting',           'Vomiting',                  'gi'),
  ('diarrhea',           'Diarrhoea',                 'gi'),
  ('abdominal_pain',     'Abdominal pain',            'gi'),
  ('dysuria',            'Painful urination',         'urinary'),
  ('frequency',          'Frequent urination',        'urinary'),
  ('excessive_thirst',   'Excessive thirst',          'endocrine'),
  ('rash',               'Rash',                      'skin'),
  ('joint_pain',         'Joint pain',                'musculoskeletal'),
  ('back_pain',          'Back pain',                 'musculoskeletal'),
  ('high_bp',            'High blood pressure',       'cardiac');

INSERT INTO ref.medications (code, generic_name, drug_class, atc_code) VALUES
  ('paracetamol',           'Paracetamol',                'ANALGESIC',         'N02BE01'),
  ('ibuprofen',             'Ibuprofen',                  'NSAID',             'M01AE01'),
  ('oral_rehydration_salts','Oral rehydration salts',     'REHYDRATION',       'A07CA'),
  ('ondansetron',           'Ondansetron',                'ANTIEMETIC',        'A04AA01'),
  ('zinc_sulfate',          'Zinc sulfate',               'MINERAL',           'A12CB01'),
  ('cetirizine',            'Cetirizine',                 'ANTIHISTAMINE',     'R06AE07'),
  ('amoxicillin',           'Amoxicillin',                'PENICILLIN',        'J01CA04'),
  ('azithromycin',          'Azithromycin',               'MACROLIDE',         'J01FA10'),
  ('nitrofurantoin',        'Nitrofurantoin',             'NITROFURAN',        'J01XE01'),
  ('artemether_lumefantrine','Artemether + lumefantrine', 'ANTIMALARIAL',      'P01BF01'),
  ('metformin',             'Metformin',                  'BIGUANIDE',         'A10BA02'),
  ('amlodipine',            'Amlodipine',                 'CALCIUM_CHANNEL_BLOCKER', 'C08CA01'),
  ('telmisartan',           'Telmisartan',                'ARB',               'C09CA07'),
  ('atorvastatin',          'Atorvastatin',               'STATIN',            'C10AA05'),
  ('salbutamol',            'Salbutamol',                 'BETA2_AGONIST',     'R03AC02'),
  ('budesonide',            'Budesonide',                 'INHALED_CORTICOSTEROID', 'R03BA02'),
  ('tiotropium',            'Tiotropium',                 'ANTIMUSCARINIC',    'R03BB04'),
  ('ferrous_sulfate',       'Ferrous sulfate',            'IRON',              'B03AA07'),
  ('folic_acid',            'Folic acid',                 'VITAMIN',           'B03BB01'),
  ('levothyroxine',         'Levothyroxine',              'THYROID_HORMONE',   'H03AA01');

-- -----------------------------------------------------------------------------
-- Facilities (fictional names, real districts)
-- -----------------------------------------------------------------------------

INSERT INTO clinical.facilities (code, name, facility_type, city, district, state, pincode) VALUES
  ('PUN-KTH-PHC', 'Kothrud Urban Health Centre (Demo)', 'UHC',               'Pune',      'Pune',            'Maharashtra', '411038'),
  ('PUN-DH',      'Pune District Hospital (Demo)',      'DISTRICT_HOSPITAL', 'Pune',      'Pune',            'Maharashtra', '411001'),
  ('NSK-CHC',     'Nashik Road Community Health Centre (Demo)', 'CHC',       'Nashik',    'Nashik',          'Maharashtra', '422101'),
  ('BLR-JYN',     'Jayanagar Family Clinic (Demo)',     'CLINIC',            'Bengaluru', 'Bengaluru Urban', 'Karnataka',   '560041'),
  ('AMD-MNR',     'Maninagar Urban Health Centre (Demo)', 'UHC',             'Ahmedabad', 'Ahmedabad',       'Gujarat',     '380008');

-- -----------------------------------------------------------------------------
-- User accounts (development-only shared password; see docs/DEVELOPMENT.md)
-- -----------------------------------------------------------------------------

INSERT INTO identity.users (email, password_hash, role, display_name, last_login_at) VALUES
  ('admin.priya@carecrypt.example',     crypt('CareCrypt@2026', gen_salt('bf', 10)), 'ADMIN',          'Priya Admin (Demo)',        '2026-09-25 09:05+05:30'),
  ('admin.rahul@carecrypt.example',     crypt('CareCrypt@2026', gen_salt('bf', 10)), 'ADMIN',          'Rahul Admin (Demo)',        '2026-09-24 17:40+05:30'),
  ('security.officer@carecrypt.example',crypt('CareCrypt@2026', gen_salt('bf', 10)), 'SECURITY_ADMIN', 'Security Officer (Demo)',   '2026-09-25 11:20+05:30'),
  ('dr.aditi.ranade@carecrypt.example', crypt('CareCrypt@2026', gen_salt('bf', 10)), 'CLINICIAN',      'Dr. Aditi Ranade',          '2026-09-25 09:58+05:30'),
  ('dr.farhan.qureshi@carecrypt.example',crypt('CareCrypt@2026', gen_salt('bf', 10)),'CLINICIAN',      'Dr. Farhan Qureshi',        '2026-09-24 10:12+05:30'),
  ('dr.prakash.jadhav@carecrypt.example',crypt('CareCrypt@2026', gen_salt('bf', 10)),'CLINICIAN',      'Dr. Prakash Jadhav',        '2026-09-23 09:30+05:30'),
  ('dr.shalini.iyer@carecrypt.example', crypt('CareCrypt@2026', gen_salt('bf', 10)), 'CLINICIAN',      'Dr. Shalini Iyer',          '2026-09-25 10:44+05:30'),
  ('dr.ravi.desai@carecrypt.example',   crypt('CareCrypt@2026', gen_salt('bf', 10)), 'CLINICIAN',      'Dr. Ravi Desai',            '2026-09-22 12:05+05:30'),
  ('ananya.deshmukh@mail.example',      crypt('CareCrypt@2026', gen_salt('bf', 10)), 'PATIENT',        'Ananya Deshmukh',           '2026-09-20 19:10+05:30'),
  ('sneha.gokhale@mail.example',        crypt('CareCrypt@2026', gen_salt('bf', 10)), 'PATIENT',        'Sneha Gokhale',             NULL),
  ('divya.hegde@mail.example',          crypt('CareCrypt@2026', gen_salt('bf', 10)), 'PATIENT',        'Divya Hegde',               NULL),
  ('hetal.parmar@mail.example',         crypt('CareCrypt@2026', gen_salt('bf', 10)), 'PATIENT',        'Hetal Parmar',              NULL),
  ('krupa.trivedi@mail.example',        crypt('CareCrypt@2026', gen_salt('bf', 10)), 'PATIENT',        'Krupa Trivedi',             '2026-08-01 21:02+05:30');

-- -----------------------------------------------------------------------------
-- Clinicians
-- -----------------------------------------------------------------------------

INSERT INTO clinical.clinicians (user_id, registration_number, first_name, last_name, specialty, facility_id, phone)
SELECT u.id, c.reg, c.first_name, c.last_name, c.specialty, f.id, c.phone
FROM (VALUES
  ('dr.aditi.ranade@carecrypt.example',   'DEMO-MMC-10001', 'Aditi',   'Ranade',  'General Medicine',  'PUN-KTH-PHC', '+91 00000 10001'),
  ('dr.farhan.qureshi@carecrypt.example', 'DEMO-MMC-10002', 'Farhan',  'Qureshi', 'Internal Medicine', 'PUN-DH',      '+91 00000 10002'),
  ('dr.prakash.jadhav@carecrypt.example', 'DEMO-MMC-10003', 'Prakash', 'Jadhav',  'Family Medicine',   'NSK-CHC',     '+91 00000 10003'),
  ('dr.shalini.iyer@carecrypt.example',   'DEMO-KMC-20001', 'Shalini', 'Iyer',    'Family Medicine',   'BLR-JYN',     '+91 00000 20001'),
  ('dr.ravi.desai@carecrypt.example',     'DEMO-GMC-30001', 'Ravi',    'Desai',   'General Medicine',  'AMD-MNR',     '+91 00000 30001')
) AS c(email, reg, first_name, last_name, specialty, facility_code, phone)
JOIN identity.users u ON u.email = c.email
JOIN clinical.facilities f ON f.code = c.facility_code;

-- -----------------------------------------------------------------------------
-- Patients (24, across 4 districts in 3 states)
-- -----------------------------------------------------------------------------

INSERT INTO clinical.patients (
  mrn, user_id, first_name, last_name, date_of_birth, gender, blood_group, phone, email,
  address_line, city, district, state, pincode, emergency_contact_name, emergency_contact_phone,
  allow_aggregate_analytics, created_at
)
SELECT p.mrn, u.id, p.first_name, p.last_name, p.dob::date, p.gender::clinical.gender, p.blood, p.phone, p.email,
       p.address, p.city, p.district, p.state, p.pincode, p.ec_name, p.ec_phone, p.analytics,
       TIMESTAMPTZ '2025-09-15 10:00+05:30'
FROM (VALUES
  -- Pune
  ('CC-000001','Ananya','Deshmukh','1991-03-14','FEMALE','B+','+91 00000 00001','ananya.deshmukh@mail.example','Flat 4, Demo Residency, Lane 7','Pune','Pune','Maharashtra','411038','Kiran Deshmukh','+91 00000 90001',true),
  ('CC-000002','Rohan','Patwardhan','1985-07-22','MALE','O+','+91 00000 00002','rohan.patwardhan@mail.example','12 Sample Society, Road 3','Pune','Pune','Maharashtra','411004','Asha Patwardhan','+91 00000 90002',true),
  ('CC-000003','Meera','Joshi','1958-11-02','FEMALE','A+','+91 00000 00003',NULL,'House 21, Placeholder Colony','Pune','Pune','Maharashtra','411030','Anil Joshi','+91 00000 90003',true),
  ('CC-000004','Kabir','Shinde','2019-05-10','MALE','O-','+91 00000 00004',NULL,'B-9, Example Nagar','Pune','Pune','Maharashtra','411041','Pallavi Shinde','+91 00000 90004',true),
  ('CC-000005','Sneha','Gokhale','1997-01-28','FEMALE','AB+','+91 00000 00005','sneha.gokhale@mail.example','Flat 302, Fiction Heights','Pune','Pune','Maharashtra','411016','Mohan Gokhale','+91 00000 90005',true),
  ('CC-000006','Vikram','Pawar','1972-09-09','MALE','B-','+91 00000 00006',NULL,'18 Test Chawl, Main Road','Pune','Pune','Maharashtra','411027','Sunita Pawar','+91 00000 90006',true),
  ('CC-000007','Ishita','Bhosale','2008-12-19','FEMALE','A-','+91 00000 00007',NULL,'C-14, Mock Apartments','Pune','Pune','Maharashtra','411028','Rajesh Bhosale','+91 00000 90007',true),
  ('CC-000008','Arjun','Kale','1966-04-03','MALE','O+','+91 00000 00008','arjun.kale@mail.example','7 Dummy Wada, Old City','Pune','Pune','Maharashtra','411002','Neha Kale','+91 00000 90008',true),
  -- Nashik
  ('CC-000009','Pooja','Wagh','1989-06-11','FEMALE','B+','+91 00000 00009','pooja.wagh@mail.example','Plot 5, Demo Layout','Nashik','Nashik','Maharashtra','422101','Sagar Wagh','+91 00000 90009',true),
  ('CC-000010','Sanjay','Nikam','1954-02-25','MALE','A+','+91 00000 00010',NULL,'22 Sample Galli','Nashik','Nashik','Maharashtra','422003','Vaishali Nikam','+91 00000 90010',true),
  ('CC-000011','Riya','Sonawane','2016-08-30','FEMALE','O+','+91 00000 00011',NULL,'Row House 3, Example Park','Nashik','Nashik','Maharashtra','422005','Deepak Sonawane','+91 00000 90011',true),
  ('CC-000012','Nikhil','Borse','1994-10-17','MALE','AB-','+91 00000 00012','nikhil.borse@mail.example','Flat 9, Placeholder Towers','Nashik','Nashik','Maharashtra','422011','Manisha Borse','+91 00000 90012',false),
  ('CC-000013','Lata','Gaikwad','1963-12-05','FEMALE','B+','+91 00000 00013',NULL,'House 40, Fiction Wadi','Nashik','Nashik','Maharashtra','422002','Prakash Gaikwad','+91 00000 90013',true),
  -- Bengaluru Urban
  ('CC-000014','Karthik','Gowda','1987-03-08','MALE','O+','+91 00000 00014','karthik.gowda@mail.example','No. 11, 4th Cross, Demo Layout','Bengaluru','Bengaluru Urban','Karnataka','560041','Kavya Gowda','+91 00000 90014',true),
  ('CC-000015','Divya','Hegde','1993-05-21','FEMALE','A+','+91 00000 00015','divya.hegde@mail.example','No. 27, Sample Main Road','Bengaluru','Bengaluru Urban','Karnataka','560011','Ramesh Hegde','+91 00000 90015',true),
  ('CC-000016','Suresh','Naik','1949-01-15','MALE','B+','+91 00000 00016',NULL,'No. 3, Example Street','Bengaluru','Bengaluru Urban','Karnataka','560034','Geeta Naik','+91 00000 90016',true),
  ('CC-000017','Lakshmi','Rao','1978-07-04','FEMALE','O-','+91 00000 00017',NULL,'No. 58, Mock Cross','Bengaluru','Bengaluru Urban','Karnataka','560070','Venkat Rao','+91 00000 90017',true),
  ('CC-000018','Aditya','Shetty','2012-11-23','MALE','A+','+91 00000 00018',NULL,'No. 6, Placeholder Block','Bengaluru','Bengaluru Urban','Karnataka','560076','Shobha Shetty','+91 00000 90018',true),
  ('CC-000019','Nandini','Murthy','2001-09-13','FEMALE','B-','+91 00000 00019','nandini.murthy@mail.example','PG Room 12, Fiction Nagar','Bengaluru','Bengaluru Urban','Karnataka','560085','Srinivas Murthy','+91 00000 90019',true),
  -- Ahmedabad
  ('CC-000020','Hetal','Parmar','1983-04-18','FEMALE','B+','+91 00000 00020','hetal.parmar@mail.example','14 Demo Pol, Maninagar','Ahmedabad','Ahmedabad','Gujarat','380008','Nitin Parmar','+91 00000 90020',true),
  ('CC-000021','Jignesh','Solanki','1976-10-29','MALE','O+','+91 00000 00021',NULL,'B-203, Sample Flats','Ahmedabad','Ahmedabad','Gujarat','380015','Rekha Solanki','+91 00000 90021',true),
  ('CC-000022','Krupa','Trivedi','1999-02-07','FEMALE','A+','+91 00000 00022','krupa.trivedi@mail.example','9 Example Society','Ahmedabad','Ahmedabad','Gujarat','380013','Harsh Trivedi','+91 00000 90022',true),
  ('CC-000023','Mehul','Rathod','1961-06-26','MALE','AB+','+91 00000 00023',NULL,'31 Placeholder Park','Ahmedabad','Ahmedabad','Gujarat','380058','Kokila Rathod','+91 00000 90023',true),
  ('CC-000024','Dhruv','Chauhan','2014-03-15','MALE','O+','+91 00000 00024',NULL,'5 Mock Bungalows','Ahmedabad','Ahmedabad','Gujarat','380061','Bhavna Chauhan','+91 00000 90024',true)
) AS p(mrn, first_name, last_name, dob, gender, blood, phone, email, address, city, district, state, pincode, ec_name, ec_phone, analytics)
LEFT JOIN identity.users u ON u.email = p.email AND u.role = 'PATIENT';

-- Explicit MRNs were used above; move the sequence past them.
DO $$ BEGIN PERFORM setval('clinical.patient_mrn_seq', 24); END $$;

-- -----------------------------------------------------------------------------
-- Allergies
-- -----------------------------------------------------------------------------

INSERT INTO clinical.patient_allergies (patient_id, allergen, allergen_type, drug_class, reaction, severity, recorded_by, recorded_at)
SELECT p.id, a.allergen, a.atype::clinical.allergen_type, a.drug_class, a.reaction, a.severity::clinical.allergy_severity,
       c.id, a.recorded_at::timestamptz
FROM (VALUES
  ('CC-000002','Penicillin',   'DRUG',          'PENICILLIN', 'Urticaria and lip swelling', 'SEVERE',           'DEMO-MMC-10001','2025-12-18 11:00+05:30'),
  ('CC-000006','Sulfonamides', 'DRUG',          'SULFONAMIDE','Generalised rash',           'MODERATE',         'DEMO-MMC-10002','2025-10-28 12:00+05:30'),
  ('CC-000010','Ibuprofen',    'DRUG',          'NSAID',      'Bronchospasm',               'SEVERE',           'DEMO-MMC-10003','2025-10-21 10:30+05:30'),
  ('CC-000015','Peanuts',      'FOOD',          NULL,         'Anaphylaxis',                'LIFE_THREATENING', 'DEMO-KMC-20001','2026-01-06 09:45+05:30'),
  ('CC-000018','Dust mites',   'ENVIRONMENTAL', NULL,         'Sneezing, wheeze',           'MILD',             'DEMO-KMC-20001','2026-01-15 16:20+05:30'),
  ('CC-000022','Latex',        'OTHER',         NULL,         'Contact dermatitis',         'MILD',             'DEMO-GMC-30001','2026-02-16 11:10+05:30')
) AS a(mrn, allergen, atype, drug_class, reaction, severity, reg, recorded_at)
JOIN clinical.patients p ON p.mrn = a.mrn
JOIN clinical.clinicians c ON c.registration_number = a.reg;

-- -----------------------------------------------------------------------------
-- Chronic conditions (problem list) known before the first visit in this dataset
-- -----------------------------------------------------------------------------

INSERT INTO clinical.patient_conditions (patient_id, condition_code, status, onset_date, resolved_date, notes, recorded_by)
SELECT p.id, pc.code, pc.status::clinical.condition_status, pc.onset::date, pc.resolved::date, pc.notes, c.id
FROM (VALUES
  ('CC-000003','E11.9','ACTIVE',  '2012-06-01', NULL,         'On metformin',                   'DEMO-MMC-10002'),
  ('CC-000003','I10',  'ACTIVE',  '2015-03-01', NULL,         NULL,                             'DEMO-MMC-10002'),
  ('CC-000005','D50.9','RESOLVED','2024-03-01', '2024-09-15', 'Resolved after 6 months of iron','DEMO-MMC-10001'),
  ('CC-000006','I10',  'ACTIVE',  '2018-08-01', NULL,         NULL,                             'DEMO-MMC-10002'),
  ('CC-000007','J45.9','ACTIVE',  '2014-01-01', NULL,         'Childhood-onset asthma',         'DEMO-MMC-10001'),
  ('CC-000008','E11.9','ACTIVE',  '2019-02-01', NULL,         NULL,                             'DEMO-MMC-10002'),
  ('CC-000008','E78.5','ACTIVE',  '2021-05-01', NULL,         NULL,                             'DEMO-MMC-10002'),
  ('CC-000010','J44.9','ACTIVE',  '2016-11-01', NULL,         'Ex-smoker, 30 pack-years',       'DEMO-MMC-10003'),
  ('CC-000010','I10',  'ACTIVE',  '2010-01-01', NULL,         NULL,                             'DEMO-MMC-10003'),
  ('CC-000013','E03.9','ACTIVE',  '2011-07-01', NULL,         NULL,                             'DEMO-MMC-10003'),
  ('CC-000013','E11.9','ACTIVE',  '2020-09-01', NULL,         NULL,                             'DEMO-MMC-10003'),
  ('CC-000016','I10',  'ACTIVE',  '2005-04-01', NULL,         NULL,                             'DEMO-KMC-20001'),
  ('CC-000016','E78.5','ACTIVE',  '2012-10-01', NULL,         NULL,                             'DEMO-KMC-20001'),
  ('CC-000018','J45.9','ACTIVE',  '2018-06-01', NULL,         'Dust-mite triggered',            'DEMO-KMC-20001'),
  ('CC-000021','E11.9','ACTIVE',  '2017-12-01', NULL,         NULL,                             'DEMO-GMC-30001'),
  ('CC-000023','I10',  'ACTIVE',  '2014-02-01', NULL,         NULL,                             'DEMO-GMC-30001')
) AS pc(mrn, code, status, onset, resolved, notes, reg)
JOIN clinical.patients p ON p.mrn = pc.mrn
JOIN clinical.clinicians c ON c.registration_number = pc.reg;

-- -----------------------------------------------------------------------------
-- Visit templates: keep symptoms, diagnoses, medications and vitals consistent
-- -----------------------------------------------------------------------------

CREATE TEMP TABLE seed_template (
  template text PRIMARY KEY, chief_complaint text, notes text,
  temp numeric, pulse int, sys int, dia int, rr int, spo2 int
) ON COMMIT DROP;

INSERT INTO seed_template VALUES
  ('dengue',        'Fever with body ache for 3 days',      'NS1 antigen positive. Platelets 1.1 lakh. Advised fluids and warning signs.', 39.1, 102, 110, 70, 20, 97),
  ('malaria',       'Intermittent fever with chills',       'Rapid diagnostic test positive for P. vivax.',                               38.9, 108, 112, 72, 20, 97),
  ('gastro',        'Loose stools and vomiting',            'Mild dehydration. Oral rehydration started.',                                 37.8,  98, 104, 68, 18, 98),
  ('uri',           'Sore throat and runny nose',           'Pharynx congested. Chest clear.',                                            37.9,  88, 118, 76, 18, 98),
  ('pneumonia',     'Cough with fever and breathlessness',  'Crackles right base. CXR: right lower zone consolidation.',                   38.8, 110, 116, 74, 26, 92),
  ('typhoid',       'Persistent fever for a week',          'Relative bradycardia. Widal and blood culture sent.',                        38.6,  90, 112, 72, 18, 98),
  ('uti',           'Burning during urination',             'Urine dipstick: nitrite and leucocytes positive.',                           37.6,  86, 118, 78, 16, 99),
  ('dm_review',     'Diabetes follow-up',                   'HbA1c reviewed. Diet counselling repeated.',                                 36.8,  80, 128, 82, 16, 98),
  ('htn_review',    'Blood pressure follow-up',             'Home BP diary reviewed. Salt restriction advised.',                          36.7,  78, 148, 92, 16, 98),
  ('dm_htn_review', 'Diabetes and BP follow-up',            'Fasting sugar 142 mg/dL. Foot exam normal.',                                 36.8,  82, 142, 88, 16, 98),
  ('htn_lipid_review','BP and cholesterol follow-up',       'LDL 118 mg/dL on statin. Continue.',                                         36.7,  74, 146, 90, 16, 98),
  ('asthma',        'Wheezing and breathlessness',          'Bilateral wheeze. Nebulised salbutamol given with good response.',           37.0, 104, 116, 74, 24, 94),
  ('copd',          'Increased breathlessness',             'Prolonged expiration. No fever. Inhaler technique reviewed.',                36.9,  96, 138, 84, 22, 93),
  ('migraine',      'Recurrent throbbing headache',         'No focal neurological deficit.',                                             36.8,  84, 122, 80, 16, 99),
  ('back_pain',     'Lower back pain',                      'No red-flag features. Posture advice given.',                                36.7,  78, 124, 80, 16, 99),
  ('anaemia',       'Tiredness and dizziness',              'Pallor present. Hb 9.2 g/dL.',                                               36.8,  96, 108, 68, 18, 98),
  ('hypothyroid_review','Thyroid follow-up',                'TSH 3.1 mIU/L on current dose.',                                             36.5,  68, 124, 80, 16, 98);

CREATE TEMP TABLE seed_template_symptom (template text, symptom text, severity text, duration int) ON COMMIT DROP;
INSERT INTO seed_template_symptom VALUES
  ('dengue','fever','SEVERE',3), ('dengue','headache','MODERATE',3), ('dengue','body_ache','MODERATE',3),
  ('dengue','retro_orbital_pain','MODERATE',2), ('dengue','rash','MILD',1),
  ('malaria','fever','SEVERE',4), ('malaria','chills','SEVERE',4), ('malaria','headache','MODERATE',3), ('malaria','vomiting','MILD',1),
  ('gastro','diarrhea','SEVERE',2), ('gastro','vomiting','MODERATE',1), ('gastro','abdominal_pain','MODERATE',2), ('gastro','fever','MILD',1),
  ('uri','sore_throat','MODERATE',2), ('uri','runny_nose','MODERATE',2), ('uri','cough','MILD',2), ('uri','fever','MILD',1),
  ('pneumonia','fever','SEVERE',4), ('pneumonia','cough','SEVERE',5), ('pneumonia','breathlessness','MODERATE',2), ('pneumonia','chest_pain','MILD',2),
  ('typhoid','fever','SEVERE',7), ('typhoid','loss_of_appetite','MODERATE',5), ('typhoid','abdominal_pain','MILD',4), ('typhoid','headache','MILD',5),
  ('uti','dysuria','MODERATE',3), ('uti','frequency','MODERATE',3), ('uti','fever','MILD',1),
  ('dm_review','fatigue','MILD',30),
  ('htn_review','headache','MILD',5),
  ('dm_htn_review','fatigue','MILD',30),
  ('asthma','wheezing','MODERATE',2), ('asthma','breathlessness','MODERATE',2), ('asthma','cough','MODERATE',3),
  ('copd','breathlessness','MODERATE',7), ('copd','cough','MODERATE',30), ('copd','wheezing','MILD',7),
  ('migraine','headache','SEVERE',1), ('migraine','nausea','MODERATE',1), ('migraine','photophobia','MODERATE',1),
  ('back_pain','back_pain','MODERATE',10),
  ('anaemia','fatigue','MODERATE',30), ('anaemia','dizziness','MILD',10),
  ('hypothyroid_review','fatigue','MILD',30);

CREATE TEMP TABLE seed_template_dx (template text, code text, dx_type text, is_primary boolean, notes text) ON COMMIT DROP;
INSERT INTO seed_template_dx VALUES
  ('dengue','A90','CONFIRMED',true,'NS1 positive'), ('dengue','B54','DIFFERENTIAL',false,'Malaria RDT negative'),
  ('malaria','B54','CONFIRMED',true,'RDT positive'),
  ('gastro','A09','PROVISIONAL',true,NULL),
  ('uri','J06.9','CONFIRMED',true,NULL),
  ('pneumonia','J18.9','CONFIRMED',true,'Community-acquired'),
  ('typhoid','A01.0','PROVISIONAL',true,'Awaiting blood culture'),
  ('uti','N39.0','CONFIRMED',true,NULL),
  ('dm_review','E11.9','CONFIRMED',true,NULL),
  ('htn_review','I10','CONFIRMED',true,NULL),
  ('dm_htn_review','E11.9','CONFIRMED',true,NULL), ('dm_htn_review','I10','CONFIRMED',false,NULL),
  ('htn_lipid_review','I10','CONFIRMED',true,NULL), ('htn_lipid_review','E78.5','CONFIRMED',false,NULL),
  ('asthma','J45.9','CONFIRMED',true,'Acute exacerbation'),
  ('copd','J44.9','CONFIRMED',true,NULL),
  ('migraine','G43.9','CONFIRMED',true,NULL),
  ('back_pain','M54.5','CONFIRMED',true,'Mechanical'),
  ('anaemia','D50.9','CONFIRMED',true,NULL),
  ('hypothyroid_review','E03.9','CONFIRMED',true,NULL);

-- adult_dose NULL = not given to adults; child_dose NULL = same as adult.
CREATE TEMP TABLE seed_template_med (
  template text, med text, adult_dose text, child_dose text, frequency text, route text, days int, instructions text
) ON COMMIT DROP;
INSERT INTO seed_template_med VALUES
  ('dengue','paracetamol','650 mg','250 mg','Three times a day','ORAL',5,'Avoid NSAIDs and aspirin'),
  ('dengue','oral_rehydration_salts','1 sachet in 1 L water',NULL,'Sip through the day','ORAL',5,NULL),
  ('malaria','artemether_lumefantrine','4 tablets','Weight-band dose','Twice a day','ORAL',3,'Take with food'),
  ('malaria','paracetamol','650 mg','250 mg','Three times a day','ORAL',3,NULL),
  ('gastro','oral_rehydration_salts','1 sachet in 1 L water',NULL,'After each loose stool','ORAL',3,NULL),
  ('gastro','ondansetron','4 mg','2 mg','Three times a day','ORAL',2,NULL),
  ('gastro','zinc_sulfate',NULL,'20 mg','Once a day','ORAL',14,NULL),
  ('uri','paracetamol','500 mg','250 mg','Three times a day as needed','ORAL',3,NULL),
  ('uri','cetirizine','10 mg','5 mg','Once a day at night','ORAL',5,NULL),
  ('pneumonia','amoxicillin','500 mg',NULL,'Three times a day','ORAL',7,NULL),
  ('pneumonia','paracetamol','650 mg',NULL,'Three times a day as needed','ORAL',5,NULL),
  ('typhoid','azithromycin','500 mg',NULL,'Once a day','ORAL',7,NULL),
  ('typhoid','paracetamol','650 mg',NULL,'Three times a day as needed','ORAL',5,NULL),
  ('uti','nitrofurantoin','100 mg',NULL,'Twice a day','ORAL',5,NULL),
  ('dm_review','metformin','500 mg',NULL,'Twice a day after meals','ORAL',90,NULL),
  ('htn_review','amlodipine','5 mg',NULL,'Once a day','ORAL',90,NULL),
  ('dm_htn_review','metformin','500 mg',NULL,'Twice a day after meals','ORAL',90,NULL),
  ('dm_htn_review','telmisartan','40 mg',NULL,'Once a day','ORAL',90,NULL),
  ('htn_lipid_review','telmisartan','40 mg',NULL,'Once a day','ORAL',90,NULL),
  ('htn_lipid_review','atorvastatin','10 mg',NULL,'Once a day at night','ORAL',90,NULL),
  ('asthma','salbutamol','100 mcg, 2 puffs',NULL,'As needed for wheeze','INHALED',30,'Use with spacer'),
  ('asthma','budesonide','200 mcg, 1 puff',NULL,'Twice a day','INHALED',30,'Rinse mouth after use'),
  ('copd','tiotropium','18 mcg',NULL,'Once a day','INHALED',90,NULL),
  ('copd','salbutamol','100 mcg, 2 puffs',NULL,'As needed','INHALED',90,NULL),
  ('migraine','ibuprofen','400 mg',NULL,'Up to three times a day as needed','ORAL',3,'Take after food'),
  ('back_pain','ibuprofen','400 mg',NULL,'Three times a day','ORAL',5,'Take after food'),
  ('anaemia','ferrous_sulfate','200 mg',NULL,'Once a day','ORAL',90,'Take on an empty stomach'),
  ('anaemia','folic_acid','5 mg',NULL,'Once a day','ORAL',90,NULL),
  ('hypothyroid_review','levothyroxine','50 mcg',NULL,'Once a day before breakfast','ORAL',90,NULL);

-- -----------------------------------------------------------------------------
-- Visit plan: 75 visits between Oct 2025 and Sep 2026 (times in IST)
-- -----------------------------------------------------------------------------

CREATE TEMP TABLE seed_visit_plan (
  ord serial PRIMARY KEY, visit_id uuid NOT NULL DEFAULT gen_random_uuid(),
  mrn text, visit_at timestamptz, reg text, template text, visit_type text
) ON COMMIT DROP;

INSERT INTO seed_visit_plan (mrn, visit_at, reg, template, visit_type) VALUES
  -- Pune
  ('CC-000001','2025-11-12 10:20+05:30','DEMO-MMC-10001','uri','OPD'),
  ('CC-000001','2026-03-05 11:05+05:30','DEMO-MMC-10001','migraine','OPD'),
  ('CC-000001','2026-09-03 09:40+05:30','DEMO-MMC-10001','dengue','OPD'),
  ('CC-000001','2026-09-10 10:15+05:30','DEMO-MMC-10001','dengue','FOLLOW_UP'),
  ('CC-000002','2025-12-18 10:50+05:30','DEMO-MMC-10001','uri','OPD'),
  ('CC-000002','2026-05-20 12:10+05:30','DEMO-MMC-10001','back_pain','OPD'),
  ('CC-000002','2026-09-06 22:35+05:30','DEMO-MMC-10002','dengue','EMERGENCY'),
  ('CC-000003','2025-10-15 09:30+05:30','DEMO-MMC-10002','dm_htn_review','FOLLOW_UP'),
  ('CC-000003','2026-01-14 09:45+05:30','DEMO-MMC-10002','dm_htn_review','FOLLOW_UP'),
  ('CC-000003','2026-04-15 10:00+05:30','DEMO-MMC-10002','dm_htn_review','FOLLOW_UP'),
  ('CC-000003','2026-07-15 09:50+05:30','DEMO-MMC-10002','dm_htn_review','FOLLOW_UP'),
  ('CC-000003','2026-09-12 11:25+05:30','DEMO-MMC-10001','dengue','OPD'),
  ('CC-000004','2025-11-20 17:10+05:30','DEMO-MMC-10001','gastro','OPD'),
  ('CC-000004','2026-02-11 16:30+05:30','DEMO-MMC-10001','uri','OPD'),
  ('CC-000004','2026-09-08 18:00+05:30','DEMO-MMC-10001','dengue','OPD'),
  ('CC-000005','2026-02-02 11:40+05:30','DEMO-MMC-10001','uti','OPD'),
  ('CC-000005','2026-06-17 12:30+05:30','DEMO-MMC-10001','migraine','OPD'),
  ('CC-000006','2025-10-28 11:00+05:30','DEMO-MMC-10002','htn_review','FOLLOW_UP'),
  ('CC-000006','2026-02-24 11:15+05:30','DEMO-MMC-10002','htn_review','FOLLOW_UP'),
  ('CC-000006','2026-06-23 10:40+05:30','DEMO-MMC-10002','htn_review','FOLLOW_UP'),
  ('CC-000006','2026-09-15 10:05+05:30','DEMO-MMC-10002','dengue','OPD'),
  ('CC-000007','2025-12-05 19:20+05:30','DEMO-MMC-10001','asthma','EMERGENCY'),
  ('CC-000007','2026-04-09 16:45+05:30','DEMO-MMC-10001','asthma','FOLLOW_UP'),
  ('CC-000007','2026-08-19 17:30+05:30','DEMO-MMC-10001','uri','OPD'),
  ('CC-000008','2025-11-05 10:10+05:30','DEMO-MMC-10002','dm_review','FOLLOW_UP'),
  ('CC-000008','2026-03-04 10:25+05:30','DEMO-MMC-10002','dm_review','FOLLOW_UP'),
  ('CC-000008','2026-07-01 10:35+05:30','DEMO-MMC-10002','dm_review','FOLLOW_UP'),
  ('CC-000008','2026-09-18 09:55+05:30','DEMO-MMC-10002','dengue','OPD'),
  -- Nashik
  ('CC-000009','2025-12-10 11:30+05:30','DEMO-MMC-10003','uri','OPD'),
  ('CC-000009','2026-04-22 12:00+05:30','DEMO-MMC-10003','uti','OPD'),
  ('CC-000009','2026-09-09 10:45+05:30','DEMO-MMC-10003','dengue','OPD'),
  ('CC-000010','2025-10-21 10:30+05:30','DEMO-MMC-10003','copd','FOLLOW_UP'),
  ('CC-000010','2026-01-08 21:10+05:30','DEMO-MMC-10003','pneumonia','EMERGENCY'),
  ('CC-000010','2026-05-12 11:20+05:30','DEMO-MMC-10003','htn_review','FOLLOW_UP'),
  ('CC-000010','2026-08-26 10:50+05:30','DEMO-MMC-10003','copd','FOLLOW_UP'),
  ('CC-000011','2026-01-19 17:40+05:30','DEMO-MMC-10003','gastro','OPD'),
  ('CC-000011','2026-07-08 16:55+05:30','DEMO-MMC-10003','uri','OPD'),
  ('CC-000012','2025-11-26 12:35+05:30','DEMO-MMC-10003','back_pain','OPD'),
  ('CC-000012','2026-09-14 11:10+05:30','DEMO-MMC-10003','dengue','OPD'),
  ('CC-000013','2025-10-09 10:00+05:30','DEMO-MMC-10003','hypothyroid_review','FOLLOW_UP'),
  ('CC-000013','2026-02-17 10:20+05:30','DEMO-MMC-10003','dm_review','FOLLOW_UP'),
  ('CC-000013','2026-06-02 10:15+05:30','DEMO-MMC-10003','hypothyroid_review','FOLLOW_UP'),
  -- Bengaluru Urban
  ('CC-000014','2025-12-22 18:30+05:30','DEMO-KMC-20001','uri','OPD'),
  ('CC-000014','2026-04-27 11:45+05:30','DEMO-KMC-20001','typhoid','OPD'),
  ('CC-000014','2026-08-04 19:05+05:30','DEMO-KMC-20001','back_pain','OPD'),
  ('CC-000015','2026-01-06 09:45+05:30','DEMO-KMC-20001','uri','OPD'),
  ('CC-000015','2026-03-23 18:20+05:30','DEMO-KMC-20001','migraine','OPD'),
  ('CC-000015','2026-07-20 10:30+05:30','DEMO-KMC-20001','uti','OPD'),
  ('CC-000016','2025-10-06 10:10+05:30','DEMO-KMC-20001','htn_lipid_review','FOLLOW_UP'),
  ('CC-000016','2026-01-26 10:40+05:30','DEMO-KMC-20001','htn_lipid_review','FOLLOW_UP'),
  ('CC-000016','2026-05-18 10:20+05:30','DEMO-KMC-20001','htn_lipid_review','FOLLOW_UP'),
  ('CC-000016','2026-09-07 20:15+05:30','DEMO-KMC-20001','pneumonia','EMERGENCY'),
  ('CC-000017','2025-11-17 11:50+05:30','DEMO-KMC-20001','anaemia','OPD'),
  ('CC-000017','2026-02-09 11:30+05:30','DEMO-KMC-20001','anaemia','FOLLOW_UP'),
  ('CC-000017','2026-06-29 12:15+05:30','DEMO-KMC-20001','uri','OPD'),
  ('CC-000018','2026-01-15 16:20+05:30','DEMO-KMC-20001','asthma','OPD'),
  ('CC-000018','2026-06-10 22:40+05:30','DEMO-KMC-20001','asthma','EMERGENCY'),
  ('CC-000019','2026-01-21 18:50+05:30','DEMO-KMC-20001','uri','TELECONSULT'),
  ('CC-000019','2026-05-04 19:30+05:30','DEMO-KMC-20001','gastro','OPD'),
  ('CC-000019','2026-08-24 10:05+05:30','DEMO-KMC-20001','malaria','OPD'),
  -- Ahmedabad
  ('CC-000020','2025-12-03 11:15+05:30','DEMO-GMC-30001','uti','OPD'),
  ('CC-000020','2026-07-06 10:30+05:30','DEMO-GMC-30001','gastro','OPD'),
  ('CC-000020','2026-09-01 12:00+05:30','DEMO-GMC-30001','migraine','OPD'),
  ('CC-000021','2025-10-30 10:05+05:30','DEMO-GMC-30001','dm_review','FOLLOW_UP'),
  ('CC-000021','2026-03-11 10:20+05:30','DEMO-GMC-30001','dm_review','FOLLOW_UP'),
  ('CC-000021','2026-07-09 09:40+05:30','DEMO-GMC-30001','gastro','OPD'),
  ('CC-000021','2026-08-27 10:10+05:30','DEMO-GMC-30001','dm_review','FOLLOW_UP'),
  ('CC-000022','2026-02-16 11:10+05:30','DEMO-GMC-30001','uri','OPD'),
  ('CC-000022','2026-07-11 12:25+05:30','DEMO-GMC-30001','gastro','OPD'),
  ('CC-000023','2025-11-10 10:35+05:30','DEMO-GMC-30001','htn_review','FOLLOW_UP'),
  ('CC-000023','2026-04-06 10:50+05:30','DEMO-GMC-30001','htn_review','FOLLOW_UP'),
  ('CC-000023','2026-07-13 11:05+05:30','DEMO-GMC-30001','gastro','OPD'),
  ('CC-000024','2026-01-28 17:15+05:30','DEMO-GMC-30001','uri','OPD'),
  ('CC-000024','2026-07-14 18:05+05:30','DEMO-GMC-30001','gastro','OPD'),
  ('CC-000024','2026-09-17 17:35+05:30','DEMO-GMC-30001','malaria','OPD');

-- Plan rows joined with patient, clinician and age at visit.
CREATE TEMP VIEW seed_plan_resolved AS
SELECT sp.*, p.id AS patient_id, c.id AS clinician_id, c.facility_id,
       extract(year FROM age(sp.visit_at::date, p.date_of_birth))::int < 12 AS is_child
FROM seed_visit_plan sp
JOIN clinical.patients p ON p.mrn = sp.mrn
JOIN clinical.clinicians c ON c.registration_number = sp.reg;

-- Vitals get a small deterministic variation per visit; children get higher pulse and lower BP.
INSERT INTO clinical.visits (
  id, patient_id, clinician_id, facility_id, visit_at, visit_type, status, chief_complaint, clinical_notes,
  temperature_c, pulse_bpm, systolic_bp_mmhg, diastolic_bp_mmhg, respiratory_rate, spo2_percent, created_at
)
SELECT r.visit_id, r.patient_id, r.clinician_id, r.facility_id, r.visit_at, r.visit_type::clinical.visit_type,
       'COMPLETED', t.chief_complaint, t.notes,
       t.temp + ((r.ord % 3) - 1) * 0.2,
       t.pulse + (r.ord % 5) - 2 + CASE WHEN r.is_child THEN 14 ELSE 0 END,
       t.sys + (r.ord % 7) - 3 - CASE WHEN r.is_child THEN 16 ELSE 0 END,
       t.dia + (r.ord % 5) - 2 - CASE WHEN r.is_child THEN 10 ELSE 0 END,
       t.rr + CASE WHEN r.is_child THEN 4 ELSE 0 END,
       LEAST(100, t.spo2 + (r.ord % 2)),
       r.visit_at
FROM seed_plan_resolved r
JOIN seed_template t ON t.template = r.template;

-- Each seeded assessment was confirmed by the treating clinician at the visit.
UPDATE clinical.visits v
SET assessment_confirmed_by = c.user_id, assessment_confirmed_at = v.visit_at
FROM clinical.clinicians c
WHERE c.id = v.clinician_id;

INSERT INTO clinical.visit_symptoms (visit_id, symptom_code, severity, duration_days)
SELECT r.visit_id, s.symptom, s.severity::clinical.symptom_severity, s.duration
FROM seed_plan_resolved r
JOIN seed_template_symptom s ON s.template = r.template;

INSERT INTO clinical.visit_diagnoses (visit_id, condition_code, diagnosis_type, is_primary, notes, created_at)
SELECT r.visit_id, d.code, d.dx_type::clinical.diagnosis_type, d.is_primary, d.notes, r.visit_at
FROM seed_plan_resolved r
JOIN seed_template_dx d ON d.template = r.template;

INSERT INTO clinical.visit_medications (visit_id, medication_code, dose, frequency, route, duration_days, instructions, created_at)
SELECT r.visit_id, m.med,
       CASE WHEN r.is_child THEN coalesce(m.child_dose, m.adult_dose) ELSE m.adult_dose END,
       m.frequency, m.route::clinical.medication_route, m.days, m.instructions, r.visit_at
FROM seed_plan_resolved r
JOIN seed_template_med m ON m.template = r.template
WHERE r.is_child OR m.adult_dose IS NOT NULL;

-- Anaemia was first diagnosed during a visit in this dataset: add it to the problem list.
INSERT INTO clinical.patient_conditions (patient_id, condition_code, status, onset_date, notes, recorded_by, recorded_in_visit_id, created_at)
SELECT r.patient_id, 'D50.9', 'ACTIVE', r.visit_at::date, 'Diagnosed on screening', r.clinician_id, r.visit_id, r.visit_at
FROM seed_plan_resolved r
WHERE r.mrn = 'CC-000017' AND r.template = 'anaemia'
ORDER BY r.visit_at
LIMIT 1;

-- -----------------------------------------------------------------------------
-- QR identities
-- A card encodes only a random token; the database stores only its SHA-256 hash.
-- The tokens created here are random and never written down, so these cards
-- cannot be scanned. To get printable demo cards, run in backend/:
--   npm run qr:cards
-- which issues fresh random tokens (revoking these) and writes a printable sheet.
-- -----------------------------------------------------------------------------

INSERT INTO clinical.patient_qr_identities (patient_id, token_hash, token_hint, status, issued_at, revoked_at, revoked_reason, issued_by)
SELECT p.id,
       encode(sha256(gen_random_bytes(32)), 'hex'),
       encode(gen_random_bytes(2), 'hex'),
       'REVOKED', TIMESTAMPTZ '2025-09-15 10:05+05:30', TIMESTAMPTZ '2026-04-15 10:02+05:30',
       'Card reported lost by patient', u.id
FROM clinical.patients p
JOIN identity.users u ON u.email = 'dr.farhan.qureshi@carecrypt.example'
WHERE p.mrn = 'CC-000003';

INSERT INTO clinical.patient_qr_identities (patient_id, token_hash, token_hint, status, issued_at, issued_by)
SELECT p.id,
       encode(sha256(gen_random_bytes(32)), 'hex'),
       encode(gen_random_bytes(2), 'hex'),
       'ACTIVE',
       CASE WHEN p.mrn = 'CC-000003' THEN TIMESTAMPTZ '2026-04-15 10:03+05:30' ELSE TIMESTAMPTZ '2025-09-15 10:05+05:30' END,
       cu.user_id
FROM clinical.patients p
-- Issued by the clinician who first saw the patient.
JOIN LATERAL (
  SELECT c.user_id FROM clinical.visits v JOIN clinical.clinicians c ON c.id = v.clinician_id
  WHERE v.patient_id = p.id ORDER BY v.visit_at LIMIT 1
) cu ON true;

-- -----------------------------------------------------------------------------
-- Consent
-- Every clinician who saw a patient received FULL_RECORD consent, recorded in
-- person just before their first visit together. Special cases follow.
-- -----------------------------------------------------------------------------

INSERT INTO clinical.consent_records (patient_id, clinician_id, scope, purpose, channel, granted_at, recorded_by)
SELECT v.patient_id, v.clinician_id, 'FULL_RECORD', 'Ongoing treatment', 'IN_PERSON',
       min(v.visit_at) - interval '5 minutes', c.user_id
FROM clinical.visits v
JOIN clinical.clinicians c ON c.id = v.clinician_id
GROUP BY v.patient_id, v.clinician_id, c.user_id;

-- CC-000022 revoked Dr. Desai's access after moving city.
UPDATE clinical.consent_records cr
SET revoked_at = TIMESTAMPTZ '2026-08-01 21:05+05:30', revoked_reason = 'Patient moved to another city'
FROM clinical.patients p, clinical.clinicians c
WHERE cr.patient_id = p.id AND cr.clinician_id = c.id
  AND p.mrn = 'CC-000022' AND c.registration_number = 'DEMO-GMC-30001';

-- CC-000005: an expired, summary-only consent for a second opinion from Dr. Qureshi.
-- CC-000001: time-limited access to visit history for Dr. Qureshi, granted in the patient portal.
-- CC-000016: summary-only access for Dr. Qureshi (tele-referral), recorded in person by Dr. Iyer.
INSERT INTO clinical.consent_records (patient_id, clinician_id, scope, purpose, channel, granted_at, expires_at, recorded_by)
SELECT p.id, c.id, x.scope::clinical.consent_scope, x.purpose, x.channel::clinical.consent_channel,
       x.granted_at::timestamptz, x.expires_at::timestamptz, u.id
FROM (VALUES
  ('CC-000005','DEMO-MMC-10002','SUMMARY_ONLY', 'Second opinion on recurrent headaches','PATIENT_PORTAL','2026-01-10 20:00+05:30','2026-04-10 20:00+05:30','sneha.gokhale@mail.example'),
  ('CC-000001','DEMO-MMC-10002','VISIT_HISTORY','Dengue follow-up at district hospital', 'PATIENT_PORTAL','2026-09-20 19:12+05:30','2026-12-31 23:59+05:30','ananya.deshmukh@mail.example'),
  ('CC-000016','DEMO-MMC-10002','SUMMARY_ONLY', 'Tele-referral: second opinion on BP control','IN_PERSON','2026-09-08 11:00+05:30','2026-12-31 23:59+05:30','dr.shalini.iyer@carecrypt.example')
) AS x(mrn, reg, scope, purpose, channel, granted_at, expires_at, recorder_email)
JOIN clinical.patients p ON p.mrn = x.mrn
JOIN clinical.clinicians c ON c.registration_number = x.reg
JOIN identity.users u ON u.email = x.recorder_email;

-- -----------------------------------------------------------------------------
-- Audit log samples (inserted in time order; the trigger builds the hash chain)
-- -----------------------------------------------------------------------------

INSERT INTO audit.audit_logs (occurred_at, user_id, user_role, action, resource_type, resource_id, patient_id, outcome, reason, ip_address, user_agent, metadata)
SELECT x.at::timestamptz, u.id, u.role, x.action, x.rtype,
       CASE x.rid_kind WHEN 'patient' THEN p.id::text WHEN 'user' THEN u.id::text ELSE x.rid_kind END,
       p.id, x.outcome::audit.outcome, x.reason, x.ip::inet, 'Mozilla/5.0 (demo)', x.meta::jsonb
FROM (VALUES
  (1,'2026-08-01 21:05+05:30','krupa.trivedi@mail.example',        'CONSENT_REVOKE',       'consent',  NULL,        'CC-000022','SUCCESS',NULL,                                                   '198.51.100.22','{"clinician":"DEMO-GMC-30001"}'),
  (2,'2026-09-20 19:10+05:30','ananya.deshmukh@mail.example',      'LOGIN',                'session',  'user',      NULL,       'SUCCESS',NULL,                                                   '198.51.100.41','{}'),
  (3,'2026-09-20 19:12+05:30','ananya.deshmukh@mail.example',      'CONSENT_GRANT',        'consent',  NULL,        'CC-000001','SUCCESS',NULL,                                                   '198.51.100.41','{"clinician":"DEMO-MMC-10002","scope":"VISIT_HISTORY"}'),
  (4,'2026-09-25 09:05+05:30','admin.priya@carecrypt.example',     'LOGIN',                'session',  'user',      NULL,       'SUCCESS',NULL,                                                   '192.0.2.10',   '{}'),
  (5,'2026-09-25 09:07+05:30','admin.priya@carecrypt.example',     'ANALYTICS_VIEW',       'analytics','condition_monthly_by_district',NULL,'SUCCESS',NULL,                          '192.0.2.10',   '{"filters":{"state":"Maharashtra"}}'),
  (6,'2026-09-25 09:09+05:30','admin.priya@carecrypt.example',     'PATIENT_RECORD_VIEW',  'patient',  'patient',   'CC-000001','DENIED', 'Role ADMIN may not access identifiable patient records','192.0.2.10',   '{}'),
  (7,'2026-09-25 09:30+05:30',NULL,                                'LOGIN',                'session',  NULL,        NULL,       'FAILURE','Invalid credentials',                                  '203.0.113.77', '{"email_attempted":"dr.aditi@carecrypt.example"}'),
  (8,'2026-09-25 09:58+05:30','dr.aditi.ranade@carecrypt.example', 'LOGIN',                'session',  'user',      NULL,       'SUCCESS',NULL,                                                   '192.0.2.21',   '{}'),
  (9,'2026-09-25 10:02+05:30','dr.aditi.ranade@carecrypt.example', 'QR_PATIENT_ACCESS',    'patient_qr',NULL,       'CC-000001','SUCCESS','Consent FULL_RECORD',                                  '192.0.2.21',   '{}'),
  (10,'2026-09-25 10:02+05:30','dr.aditi.ranade@carecrypt.example','PATIENT_RECORD_VIEW',  'patient',  'patient',   'CC-000001','SUCCESS','Consent FULL_RECORD',                                   '192.0.2.21',   '{}'),
  (11,'2026-09-25 10:44+05:30','dr.shalini.iyer@carecrypt.example','LOGIN',                'session',  'user',      NULL,       'SUCCESS',NULL,                                                   '192.0.2.35',   '{}'),
  (12,'2026-09-25 10:47+05:30','dr.shalini.iyer@carecrypt.example','PATIENT_RECORD_VIEW',  'patient',  'patient',   'CC-000001','DENIED', 'No active consent for this clinician',                  '192.0.2.35',   '{}'),
  (13,'2026-09-25 11:20+05:30','security.officer@carecrypt.example','LOGIN',               'session',  'user',      NULL,       'SUCCESS',NULL,                                                   '192.0.2.50',   '{}'),
  (14,'2026-09-25 11:22+05:30','security.officer@carecrypt.example','AUDIT_LOG_VIEW',      'audit_log',NULL,        NULL,       'SUCCESS',NULL,                                                   '192.0.2.50',   '{"filter":"outcome=DENIED"}')
) AS x(n, at, email, action, rtype, rid_kind, mrn, outcome, reason, ip, meta)
LEFT JOIN identity.users u ON u.email = x.email
LEFT JOIN clinical.patients p ON p.mrn = x.mrn
ORDER BY x.n;

COMMIT;
