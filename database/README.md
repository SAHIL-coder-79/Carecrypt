# database

PostgreSQL schema and synthetic seed data for CareCrypt.

> Synthetic data only. `schema.sql` drops and recreates every CareCrypt schema, deleting all data in them.

| File | Run as | Purpose |
| --- | --- | --- |
| `init/001_create_role_and_database.sql` | superuser, once | Create the `carecrypt` owner login and database |
| `init/002_create_app_roles.sql` | superuser, once | Create the restricted runtime logins `carecrypt_app` and `carecrypt_analytics` |
| `schema.sql` | `carecrypt` | Build all schemas, tables, constraints, indexes, triggers, views and grants |
| `seed.sql` | `carecrypt` | Load synthetic demo data |
| `seed_analytics_demo.sql` | `carecrypt`, optional | Add 600 generated synthetic patients for fuller analytics charts (see `docs/ANALYTICS.md`) |
| `migrations/` | | Future incremental changes (empty) |

## Setup

Requires PostgreSQL 14 or newer (tested on 18).

```bash
psql -U postgres -f database/init/001_create_role_and_database.sql
psql -U postgres -d postgres -f database/init/002_create_app_roles.sql
psql -U carecrypt -d carecrypt -f database/schema.sql
psql -U carecrypt -d carecrypt -f database/seed.sql
```

Change the passwords in the two init scripts before running them, and keep `DATABASE_URL`
in `backend/.env` in sync. Then check the connection with `npm run db:check` in `backend/`.
To reset the data at any time, run `schema.sql` and `seed.sql` again.

## Database logins

| Login | Used for | Can read identifiable patient data? |
| --- | --- | --- |
| `carecrypt` | Owner. Runs `schema.sql` and `seed.sql` only | Yes |
| `carecrypt_app` | API: clinical, identity, consent and audit work | Yes. The API's RBAC and consent checks decide who sees what |
| `carecrypt_analytics` | API: ADMIN analytics endpoints (`ANALYTICS_DATABASE_URL`) | **No.** It can read only the suppressed aggregate views |

`carecrypt_app` cannot delete patients or visits, and cannot modify the audit log.

## Schemas

| Schema | Contents |
| --- | --- |
| `identity` | `users` (all roles, bcrypt password hashes) |
| `ref` | Catalogues: `conditions` (ICD-10), `symptoms`, `medications` |
| `clinical` | `facilities`, `clinicians`, `patients`, `patient_qr_identities`, `patient_conditions`, `patient_allergies`, `visits`, `visit_symptoms`, `visit_diagnoses`, `visit_medications`, `consent_records` |
| `audit` | `audit_logs` (append-only, hash-chained), `verify_chain()` |
| `analytics` | `privacy_settings` (minimum group size, default 10), aggregate views and the custom-query function `query_cases` |
| `util` | Shared trigger function |

## Entity relationships

```
identity.users 1 ── 0..1 clinical.clinicians *── 1 clinical.facilities
      │   (account role must be CLINICIAN)
      │
      └── 0..1 clinical.patients
          (account role must be PATIENT)

clinical.patients 1 ──* visits *── 1 clinicians
                  1 ──* patient_qr_identities          (at most 1 ACTIVE)
                  1 ──* patient_conditions *── 1 ref.conditions
                  1 ──* patient_allergies
                  1 ──* consent_records    *── 1 clinicians

clinical.visits   *── 1 facilities
                  1 ──* visit_symptoms    *── 1 ref.symptoms
                  1 ──* visit_diagnoses   *── 1 ref.conditions   (exactly one primary)
                  1 ──* visit_medications *── 1 ref.medications

audit.audit_logs: user_id and patient_id are stored as plain values (no FK),
so the log survives account changes and can never be rewritten.
```

## Analytics views (what ADMIN dashboards read)

| View | Grain |
| --- | --- |
| `analytics.condition_monthly_by_district` | month × state × district × condition |
| `analytics.condition_yearly_by_demographics` | year × condition × age band × gender |
| `analytics.visit_volume_monthly` | month × state |
| `analytics.overview_totals` | one row: patients, cases, visits, notifiable cases, coverage |
| `analytics.cases_by_location` | state × district |
| `analytics.cases_by_category` | condition category |
| `analytics.cases_by_condition` | condition |
| `analytics.cases_monthly` | month |
| `analytics.category_monthly` | month × condition category |
| `analytics.location_category` | state × district × condition category |
| `analytics.cases_by_age_band` | age band at the visit |

Counts are distinct patients. A cell with fewer patients than `privacy_settings.min_group_size`
returns `NULL` counts and `is_suppressed = true`. Patients with `allow_aggregate_analytics = false`
are excluded. Only CONFIRMED and PROVISIONAL diagnoses are counted.

Each view is suppressed independently, at its own grain. Subtracting visible cells from a
published total could recover a hidden one (a differencing attack), so the analytics API adds
complementary suppression before anything leaves the server. See `docs/ANALYTICS.md` for the
rules and the remaining limitations.

## Seed data

- 24 patients across Pune, Nashik (Maharashtra), Bengaluru Urban (Karnataka) and Ahmedabad (Gujarat), born between 1949 and 2019
- 5 clinicians at 5 facilities, 2 admins, 1 security admin, 5 patient-portal accounts
- 75 visits (2 to 5 per patient) from Oct 2025 to Sep 2026, with symptoms, diagnoses, prescriptions and vitals
- 16 conditions, 17 problem-list entries and 6 allergies. No prescription conflicts with a recorded drug allergy.
- 25 QR identities, 29 consent records, 14 audit entries

Demo login accounts and their credentials are listed in [docs/DEVELOPMENT.md](../docs/DEVELOPMENT.md).

QR cards: the seed gives each patient a card with a random token that is never written down (only
its hash is stored), so seeded cards cannot be scanned. Run `npm run qr:cards` in `backend/` to issue
printable demo cards; see [docs/DEVELOPMENT.md](../docs/DEVELOPMENT.md#qr-patient-identification).

Built-in scenarios:

| Scenario | Where |
| --- | --- |
| Dengue cluster | Pune, Sep 2026: 6 patients (suppressed at the default k = 10; visible if k ≤ 6) |
| Dengue, suppressed | Nashik, Sep 2026: 1 counted patient (+1 who opted out of analytics) |
| Gastroenteritis cluster | Ahmedabad, Jul 2026: 5 patients (suppressed at k = 10) |
| Consent denied | Dr. Iyer has no consent for CC-000001 |
| Consent revoked | CC-000022 revoked Dr. Desai on 2026-08-01 |
| Consent expired | CC-000005's summary-only consent for Dr. Qureshi ended 2026-04-10 |
| Consent, visit history only | CC-000001 → Dr. Qureshi, until 2026-12-31 |
| Consent, summary only | CC-000016 → Dr. Qureshi (tele-referral), until 2026-12-31 |
| Admin blocked | Audit entry: ADMIN tried to open CC-000001, DENIED |

## Useful checks

```sql
SELECT clinical.has_active_consent(patient_id, clinician_id);   -- consent in force now?
SELECT audit.verify_chain();                                    -- NULL means the audit log is intact
SELECT * FROM analytics.condition_monthly_by_district WHERE NOT is_suppressed;
```
