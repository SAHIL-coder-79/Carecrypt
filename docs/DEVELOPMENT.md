# Development guide

For people working on CareCrypt locally. Everything here applies to development
with synthetic data only.

## Test accounts

> **Development only.** These accounts are created by `database/seed.sql` and share one
> password. They exist so the team can exercise each role. Never load `seed.sql` into a
> deployed environment, never reuse this password anywhere, and never put these
> credentials in the frontend, screenshots shared publicly, or other documentation.

Password for every account: `CareCrypt@2026`

| Role | Email | Notes |
| --- | --- | --- |
| ADMIN | `admin.priya@carecrypt.example` | |
| ADMIN | `admin.rahul@carecrypt.example` | The test suite locks and disables this account temporarily |
| SECURITY_ADMIN | `security.officer@carecrypt.example` | |
| CLINICIAN | `dr.aditi.ranade@carecrypt.example` | General Medicine, Pune |
| CLINICIAN | `dr.farhan.qureshi@carecrypt.example` | Internal Medicine, Pune |
| CLINICIAN | `dr.prakash.jadhav@carecrypt.example` | Family Medicine, Nashik |
| CLINICIAN | `dr.shalini.iyer@carecrypt.example` | Family Medicine, Bengaluru |
| CLINICIAN | `dr.ravi.desai@carecrypt.example` | General Medicine, Ahmedabad |
| PATIENT | `ananya.deshmukh@mail.example` | Patient CC-000001 |
| PATIENT | `sneha.gokhale@mail.example` | Patient CC-000005 |
| PATIENT | `divya.hegde@mail.example` | Patient CC-000015 |
| PATIENT | `hetal.parmar@mail.example` | Patient CC-000020 |
| PATIENT | `krupa.trivedi@mail.example` | Patient CC-000022 |

If an account gets locked after repeated wrong passwords, wait 15 minutes or reset it:

```sql
UPDATE identity.users SET failed_login_count = 0, locked_until = NULL WHERE email = '...';
```

## Accounts and registration

There is no public registration endpoint, on purpose. Anyone could otherwise create a
CLINICIAN or ADMIN account, or a patient account with no verified link to a patient
record. Accounts are provisioned: by the seed for now, and later by a SECURITY_ADMIN
(staff) or a verified onboarding flow (patients).

## Authentication

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/api/auth/login` | none | Exchange email and password for a JWT |
| GET | `/api/auth/me` | Bearer token | Return the account behind the token |

```bash
curl -s -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"dr.aditi.ranade@carecrypt.example","password":"CareCrypt@2026"}'

curl -s http://localhost:4000/api/auth/me -H "Authorization: Bearer <token>"
```

Login response:

```json
{
  "token": "eyJ...",
  "tokenType": "Bearer",
  "expiresIn": 3600,
  "expiresAt": "2026-09-26T05:12:20.000Z",
  "user": {
    "id": "5001...",
    "email": "dr.aditi.ranade@carecrypt.example",
    "role": "CLINICIAN",
    "displayName": "Dr. Aditi Ranade",
    "lastLoginAt": "2026-09-26T04:12:20.704Z",
    "clinicianId": "f825...",
    "specialty": "General Medicine",
    "facility": "Kothrud Urban Health Centre (Demo)"
  }
}
```

PATIENT accounts get `patientId` and `mrn` instead of the clinician fields. ADMIN and
SECURITY_ADMIN accounts get neither.

### Status codes

| Status | `error` | When |
| --- | --- | --- |
| 400 | `BAD_REQUEST` | Missing or non-string email/password, invalid JSON |
| 401 | `UNAUTHORIZED` | Wrong email or password (same message for both), missing, malformed, expired or tampered token, or the account was disabled or changed role after the token was issued |
| 403 | `FORBIDDEN` | Valid token, but the role is not allowed on this resource |
| 403 | `ACCOUNT_DISABLED` | Correct password for a disabled account |
| 404 | `NOT_FOUND` | No such route |
| 423 | `ACCOUNT_LOCKED` | Too many failed passwords for this account (`Retry-After` header) |
| 429 | `TOO_MANY_REQUESTS` | Too many login attempts from one IP address |

Error bodies have the shape `{ "error": "<CODE>", "message": "<text>" }`, except role
refusals, which name the caller's role and the refused resource:

```json
{ "error": "FORBIDDEN", "role": "ADMIN", "resource": "CLINICIAN_ONLY", "access": "DENIED" }
```

## RBAC demonstration endpoints

These exist to show that role checks happen on the server. They return nothing beyond
the caller's own role.

| Endpoint | Allowed role | Resource label |
| --- | --- | --- |
| `GET /api/test/clinician-only` | CLINICIAN | `CLINICIAN_ONLY` |
| `GET /api/test/admin-only` | ADMIN | `ADMIN_ONLY` |
| `GET /api/test/security-only` | SECURITY_ADMIN | `SECURITY_ONLY` |

Allowed: `200 { "access": "GRANTED", "role": "...", "resource": "..." }`.
Other roles: `403` FORBIDDEN body above. No token: `401 UNAUTHORIZED`.

They are on by default in development and off when `NODE_ENV=production`. Set
`ENABLE_RBAC_TEST_ENDPOINTS=true` to show them in a deployed demo, or `false` to hide
them locally.

Try it with curl, with no frontend involved:

```bash
TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin.priya@carecrypt.example","password":"CareCrypt@2026"}' | node -pe "JSON.parse(require('fs').readFileSync(0)).token")

curl -s http://localhost:4000/api/test/clinician-only -H "Authorization: Bearer $TOKEN"
# {"error":"FORBIDDEN","role":"ADMIN","resource":"CLINICIAN_ONLY","access":"DENIED"}
```

### Protecting a route

```js
import { authenticateToken } from '../middleware/authenticate.js'
import { requireRole } from '../middleware/requireRole.js'

router.get('/something', authenticateToken(), requireRole('CLINICIAN'), handler)
router.get('/other', authenticateToken(), requireRole('CLINICIAN', 'SECURITY_ADMIN'), handler)
// Optional label used in the 403 body and the audit log (defaults to "GET /path"):
router.get('/records', authenticateToken(), requireRole('CLINICIAN', { resource: 'PATIENT_RECORD' }), handler)
```

- `authenticateToken()` verifies the JWT (HS256 only, issuer and audience checked),
  reloads the account, and sets `req.user = { id, email, role, displayName }`.
- `requireRole(...roles)` allows only the listed roles. Roles do not inherit:
  ADMIN does not get CLINICIAN access. Refusals are written to the audit log as
  `ACCESS_DENIED`. Misspelled role names throw when the route is defined.

### Security properties

- Passwords are stored only as bcrypt hashes (cost 10).
- The JWT holds only the user id (`sub`), `role`, `jti` and standard claims. It never
  contains the password, hash, email or other personal data.
- `JWT_SECRET` comes from the environment. The server refuses to start if it is missing,
  shorter than 32 characters or a known placeholder.
- Unknown emails take the same time as wrong passwords (a dummy bcrypt check runs).
- 5 wrong passwords lock the account for 15 minutes; 20 attempts per IP per 15 minutes.
- Logins (success, failure, lock, disabled) and role refusals go to the append-only audit log.
- Tokens last 1 hour and there is no server-side logout yet: a client logs out by
  discarding its token. Disabling an account cuts off its tokens immediately.

## Patient records

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/api/patients` | Patients the caller may open (clinician: active consents; patient: self) |
| GET | `/api/patients/:patientId` | Full longitudinal record |
| GET | `/api/patients/:patientId/visits?limit=50` | Visit history, newest first (needs VISIT_HISTORY or wider) |
| GET | `/api/patients/:patientId/medications` | `active` courses and prescription `history` |
| GET | `/api/patients/:patientId/conditions` | `chronicConditions` and `diagnosisHistory` |

Record shape (`GET /api/patients/:patientId`):

```
patient
├── id, mrn
├── demographics        name, date of birth, age, sex, blood group, location
│                       (+ contact, address, emergency contact with FULL_RECORD)
├── allergies
├── chronicConditions
├── medications         { active, history }
├── visitHistory[]      date, type, clinician, facility, chiefComplaint, symptoms,
│                       vitals, diagnoses, medications, notes
└── recentActivity[]    visits, allergies, consent changes
                        (+ who viewed or was refused, for the patient only)
access                  { via: CONSENT | SELF, scope, sections }
```

### Who may read a record

| Caller | Result |
| --- | --- |
| CLINICIAN with an active consent | 200, filtered by the consent scope |
| CLINICIAN without one (never granted, revoked, expired, or unknown id) | 403 `NO_ACTIVE_CONSENT`. Unknown ids look the same, so existence is not revealed |
| PATIENT, own record | 200, everything |
| PATIENT, anyone else's record | 403 `NOT_OWN_RECORD` |
| ADMIN, SECURITY_ADMIN | 403 from the role check, before any patient query |

| Consent scope | Contact and address | Visit history, medication and diagnosis history |
| --- | --- | --- |
| FULL_RECORD | yes | yes |
| VISIT_HISTORY | no | yes |
| SUMMARY_ONLY | no | no (`/visits` returns 403 `CONSENT_SCOPE_INSUFFICIENT`) |

Withheld sections are not sent at all (`null` or absent), not hidden in the UI.
Every view and every refusal is written to the audit log with the patient id. Responses
carry `Cache-Control: no-store`.

Demo pairs: Dr. Ranade → CC-000003 (full record), Dr. Qureshi → CC-000001 (visit history),
Dr. Qureshi → CC-000016 (summary only), Dr. Iyer → CC-000001 (no consent),
patient `ananya.deshmukh@mail.example` → own record CC-000001.

## Clinician dashboard APIs

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| GET | `/api/clinicians/me` | CLINICIAN | Profile, facility, workload stats, recently seen (still consented) patients |
| GET | `/api/patients?search=` | CLINICIAN | Name or MRN search over the clinician's **consented** patients only |
| POST | `/api/qr/resolve` | CLINICIAN | Patient QR card → patient id (see below) |
| GET | `/api/reference` | CLINICIAN | Symptom, condition and medication catalogues |
| POST | `/api/patients/:id/visits` | CLINICIAN with VISIT_HISTORY or FULL_RECORD consent | Add a visit (201 with the saved visit) |

## Consent

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| POST | `/api/consent` | PATIENT | Grant a clinician access to your own record |
| GET | `/api/consent/:patientId` | PATIENT (own record), CLINICIAN (only consents granted to them) | List consents with status |
| DELETE | `/api/consent/:consentId` | PATIENT (own record), CLINICIAN (consent granted to them) | Revoke |
| GET | `/api/clinicians` | PATIENT, CLINICIAN | Clinician directory (names, specialties, facilities) for choosing whom to grant |

Grant body:

```json
{
  "clinicianId": "9b62565e-...",
  "scope": "VISIT_HISTORY",
  "purpose": "Second opinion on recurring UTI",
  "durationDays": 30
}
```

`scope` is `FULL_RECORD`, `VISIT_HISTORY` or `SUMMARY_ONLY`. `durationDays` is 1–365, or `null`
for "until revoked". The patient is always the caller: a `patientId` naming anyone else is
refused with 403. Granting again to a clinician who already has access replaces that consent,
so the latest decision is the one in force. Response `201 { consent, replaced }`.

A consent has `id`, `patientId`, `clinician`, `scope`, `purpose`, `channel` (`IN_PERSON` or
`PATIENT_PORTAL`), `status` (`ACTIVE`, `EXPIRED`, `REVOKED`), `grantedAt`, `expiresAt`,
`revokedAt` and `revokedReason`. Status is computed from the timestamps, so expiry needs no job.

Revoking (`DELETE`, optional body `{ "reason": "..." }`) sets `revokedAt` and the reason; consent
records are never deleted. Revoking something already revoked or expired returns `409`. Someone
else's consent returns `404`, the same as one that does not exist. ADMIN and SECURITY_ADMIN get
403 on every consent endpoint.

**Enforcement.** Record views, visit creation and QR resolution check for an active consent on
every request, so a grant or revocation takes effect on the clinician's next request.

**Audit.** `CONSENT_GRANT` and `CONSENT_REVOKE` (success and refusals, with clinician, scope and
duration in the metadata) and `CONSENT_VIEW`. Consent changes also appear in the patient's
recent activity.

**Screen.** Patients open *Access & consent* (`/patient/consent`): each consent is shown as an
access request with clinician, purpose, access level, duration and status, with **REVOKE ACCESS**
(confirmed inline) for active ones. The *New access request* form previews the request and
**GRANT ACCESS** submits it.

Demo: sign in as `hetal.parmar@mail.example`, grant Dr. Shalini Iyer visit-history access, then
sign in as `dr.shalini.iyer@carecrypt.example`: CC-000020 now appears in her patient list and
opens. Revoke it as Hetal and the record is refused again with 403.

## QR patient identification

```
Clinician dashboard → Scan QR → POST /api/qr/resolve (authenticated CLINICIAN)
  → card looked up by token hash → consent check → { patientId }
  → GET /api/patients/:patientId (authenticated and authorised again) → longitudinal record
```

**What a card holds.** The QR encodes only an opaque token: `ccqr_` followed by 192 random
bits (base64url). No patient id, MRN, name, contact details or health information. The database
stores only the token's SHA-256 hash, so a database leak yields no usable cards.

**Resolving a card.**

```http
POST /api/qr/resolve
Authorization: Bearer <clinician JWT>

{ "qrToken": "ccqr_pdL9UaqdRTrBJgNlZkk7yqBGrkyrAHVo" }
```

`200 { "patientId": "8707840a-..." }`. Only the id; the record must then be requested from
`GET /api/patients/:patientId`, which checks authentication and consent again. The id is a
random UUID, not a sequential number, so ids cannot be guessed.

| Status | `error` / `reason` | When |
| --- | --- | --- |
| 400 | `BAD_REQUEST` | `qrToken` missing or not 8–256 characters |
| 401 | `UNAUTHORIZED` | Not signed in |
| 403 | `FORBIDDEN` | Role is not CLINICIAN |
| 403 | reason `NO_ACTIVE_CONSENT` | Valid card, but this patient has not given the clinician consent. No patient id is returned |
| 404 | `QR_NOT_RECOGNISED` | Not a CareCrypt card |
| 410 | `QR_REVOKED` / `QR_EXPIRED` | Card replaced (for example, reported lost) or past its expiry |
| 429 | `TOO_MANY_REQUESTS` | More than 30 scans per minute from one IP |

**Audit.** Every attempt is logged as `QR_PATIENT_ACCESS`: `SUCCESS` (with the patient id),
`FAILURE` (unknown card), or `DENIED` (revoked or expired card, no consent). The raw token is
never logged; entries reference the card record id and the token's last 4 characters. Opening
the record afterwards is a separate `PATIENT_RECORD_VIEW` event.

**Demo cards.** The seed gives every patient a card with a random token that nobody knows, so
seeded cards cannot be scanned. To get printable cards for the synthetic patients:

```bash
cd backend
npm run qr:cards
```

This issues a fresh card for every patient (revoking the previous one), plus a revoked "lost"
card for CC-000003, and writes `backend/demo-qr-cards/index.html` with the QR codes and the
token text for copy-paste. The folder is git-ignored because it holds live tokens. It refuses
to run with `NODE_ENV=production`. Running `seed.sql` again invalidates the sheet; run the
command again afterwards.

New visit body:

```json
{
  "visitType": "OPD",
  "visitAt": "2026-09-26T04:50:00.000Z",
  "chiefComplaint": "Cough and fever for 2 days",
  "vitals": { "temperatureC": 38.4, "pulseBpm": 96, "systolic": 122, "diastolic": 78, "spo2Percent": 97 },
  "symptoms": [{ "code": "cough", "severity": "MODERATE", "durationDays": 2 }],
  "diagnoses": [{ "code": "J06.9", "type": "CONFIRMED", "isPrimary": true }],
  "medications": [{ "code": "paracetamol", "dose": "500 mg", "frequency": "Three times a day", "durationDays": 3 }],
  "notes": "Optional",
  "decisionSupport": { "analysisId": "83d5d34a-...", "reviewed": true },
  "clinicianAttestation": true
}
```

Rules: chief complaint required; at least one diagnosis with exactly one primary, which cannot
be a differential; vitals within physiological ranges; codes must exist in the catalogues;
`visitAt` no later than now and at most 30 days back. `clinicianAttestation` must be `true`: the
clinician explicitly submits the assessment as their own judgement, and the server records who
confirmed it and when. Errors come back as `400 VALIDATION_FAILED` with a `details` list of
`{ field, message }`. A drug whose class matches an active drug allergy is refused with
`409 ALLERGY_CONFLICT` and a `conflicts` list; nothing is saved. The visit and its details are
written in one transaction and audited as `VISIT_CREATE` (with `clinician_attested` and the linked
analysis id).

`decisionSupport` is optional. It links a SmartCare run (the `analysisId` returned by
`POST /api/smartcare/analyze`) to the visit, and only if `reviewed` is `true`, the run was made by
the same clinician for the same patient within 24 hours, and it is not already linked to another
visit. Otherwise the whole save is refused with 400.

## Clinical visit workflow

```
Patient → New visit → Symptoms → Vitals → SmartCare decision support → clinician review
        → Diagnosis / assessment → Medication → Notes → explicit confirmation → Save
```

In the patient workspace, **Add new visit** opens the workflow as six steps; *Next* checks
each step before moving on:

| Step | Required to continue |
| --- | --- |
| 1 Symptoms | Chief complaint |
| 2 Vitals | Nothing (leave blank what was not measured) |
| 3 Decision support | Optional. If SmartCare was run and still matches the symptoms and vitals, tick "I have reviewed this output" |
| 4 Assessment | At least one diagnosis, exactly one primary. SmartCare suggestions can be added only as *provisional*, one click each |
| 5 Medication | Dose and frequency for each drug (allergy clashes are warned and refused by the server) |
| 6 Notes & confirm | A summary of the visit; **Save visit** stays disabled until the clinician confirms the assessment is their own judgement |

SmartCare never creates a diagnosis. Running it stores only a decision-support record
(`clinical.decision_support_runs`: symptom codes, suggested condition codes, risk level). Saved
visits show that record next to the clinician's diagnosis, labelled *Clinical Decision Support
(reviewed, not a diagnosis)*, plus who confirmed the assessment.

After saving: the visit becomes the newest entry of the longitudinal record (timeline, visit
history, active medications, recent activity); the audit log gets `VISIT_CREATE`; and the
aggregate analytics views include it right away, because they are live views over the clinical
tables. The usual protections apply: patients who opted out are excluded, and groups under the
minimum size are suppressed.

## Frontend

The app shell has a sidebar (a drawer on phones) whose sections follow the signed-in role. The
sidebar is a convenience, not a security control: every page below can be opened by URL, and the
server decides what, if anything, comes back. The sidebar's "Access is enforced by the server"
panel links to other roles' pages so the refusals can be shown.

| Role | Sidebar | Route | Page |
| --- | --- | --- | --- |
| CLINICIAN | Dashboard | `/clinician/dashboard` | Stats, quick actions, recently seen patients |
| | Patients | `/clinician/patients` | Patients with an active consent; search |
| | | `/clinician/patients/:patientId` | Patient workspace: timeline, visits, diagnoses, medications, allergies, profile; add visit (`?tab=`, `?newVisit=1`) |
| | QR Scanner | `/clinician/scan` | Camera, photo or typed code |
| | SmartCare | `/clinician/smartcare` | SmartCare Assist workspace: body map, clinical guidance, symptom table, symptom tracker, voice assistant, vitals, clinical monitor, full results; `?patient=` preselects; *Recent runs* tab (see [SMARTCARE_WORKSPACE.md](SMARTCARE_WORKSPACE.md)) |
| | Visits | `/clinician/visits` | Own visits; details follow each patient's current consent |
| ADMIN | Population Dashboard | `/admin/analytics` | KPIs, notifiable clusters, categories, age groups, locations |
| | Disease Trends | `/admin/trends` | Monthly trends, cases by condition, custom questions |
| | Privacy | `/admin/privacy` | Protections in force, inference rules, own custom-question standing |
| SECURITY_ADMIN | Security Dashboard | `/security/dashboard` | Open events, refusals, audit-chain integrity, latest refused requests |
| | Audit Logs | `/security/audit` | Filterable audit trail |
| | Security Events | `/security/events` | Open and resolved events; resolve with a note |
| PATIENT | My Record | `/patients/:patientId` | Own longitudinal record, links to card and access history |
| | Consent | `/patient/consent` | Grant and revoke clinician access |
| | Access History | `/patient/access-history` | Who used the record, including refused attempts |
| | | `/patient/card` | Own QR card: issue a new one (shown once) |
| all | | `/login`, `/`, `/patients` | Sign in; home redirects to the role's first section; `/patients` is the patient list outside the clinician area |

UI building blocks live in `src/components/ui.jsx` (page header, cards, stat tiles, buttons,
alerts, tables, empty and loading states), `src/components/icons.jsx` and `src/components/Dialog.jsx`.
Server refusals render with `src/components/ServerRefusal.jsx`, which shows the response body.

The QR scanner accepts the camera, an uploaded photo of a card (decoded in the browser, not
uploaded to the server), or the token pasted in. For a demo, open
`backend/demo-qr-cards/index.html` on a phone or second screen and point the laptop camera at
it, or copy a token from the sheet into "Enter code". The red card shows the revoked-card error.

Routes are not filtered by role in the browser. Any signed-in user can open any page, and
the page shows the server's answer. An ADMIN who opens a record URL sees the 403 response
body from the API. The session is kept in `sessionStorage` and ends when the tab closes.

## Running the tests

The tests need a database loaded with `schema.sql` and `seed.sql`, reachable through
`DATABASE_URL` in `backend/.env`, and a valid `JWT_SECRET`.

```bash
cd backend
npm test            # all suites
npm run test:rbac   # RBAC only; prints the access matrix at the end

# The analytics checks connect as the restricted analytics login, taken from
# ANALYTICS_DATABASE_URL in backend/.env or the environment:
ANALYTICS_DATABASE_URL=postgres://carecrypt_analytics:change_me_analytics@localhost:5432/carecrypt npm test
```

Without `ANALYTICS_DATABASE_URL` the analytics endpoint checks are skipped, and the suite instead
checks that the API answers 503. Load the base seed only; `seed_analytics_demo.sql` changes the
numbers some tests expect.

| File | Covers |
| --- | --- |
| `test/analytics.test.js` | ADMIN analytics: only ADMIN (401/403, denials audited), no identifiers or row-level data in any response, totals match the clinical data and exclude opted-out patients, no visible cell under the minimum group size, no hidden cell recoverable from published totals, notifiable clusters, filters and validation, `ANALYTICS_VIEW` audit, the analytics login cannot read patient tables. Unit tests for complementary suppression |
| `test/portalApis.test.js` | Clinician visits and SmartCare activity (details follow consent), patient access history (own only, refused attempts shown, admins by role only), admin privacy page |
| `test/e2e.test.js` | The whole workflow, patient card to security review (see [WORKFLOW.md](WORKFLOW.md)) |
| `test/inferenceControl.test.js` | Custom analytics queries, minimum-group and difference checks, inference detection, pausing and resolution |
| `test/security.test.js` | Security console, security events, audit trail without clinical content, patient QR self-service |
| `test/auth.test.js` | Login for every role, JWT contents, input validation, lockout, disabled accounts, forged, expired, unsigned and wrong-audience tokens, password storage |
| `test/visitWorkflow.test.js` | Visit workflow: SmartCare creates no diagnosis, explicit confirmation required, reviewed decision support linked (same patient, same clinician, once), timeline and audit updated, de-identified analytics include the visit (needs `ANALYTICS_DATABASE_URL`, otherwise skipped) and exclude opted-out patients |
| `test/smartcare.test.js` | SmartCare: "Clinical Decision Support" label and disclaimer, no diagnosis wording, use of history and visits, returning presentation and BP trend, allergy cautions, SUMMARY_ONLY context, access, validation, audit. Adds 3 visits to CC-000002 |
| `test/consent.test.js` | Consent: listing with statuses, grant → access → revoke → no access, replacement on re-grant, who may grant/revoke, validation, audit. Uses CC-000020 and Dr. Iyer |
| `test/qr.test.js` | QR cards: token contents, hash-only storage, revocation on reissue, `{ patientId }` only, record still needs its own authorised request, no-consent/revoked/unknown/role refusals, `QR_PATIENT_ACCESS` audit, no raw tokens in the log |
| `test/clinician.test.js` | Clinician profile, consented-only search, reference data, adding visits (validation, allergy conflict, consent scope, roles, audit). Adds visits to CC-000002 |
| `test/patients.test.js` | Patient record access: consent scopes, missing/revoked/expired consent, own vs other patient, ADMIN refusal with no data on every endpoint, audit entries, record structure |
| `test/rbac.test.js` | The required role cases, the exact FORBIDDEN body, the full role × endpoint matrix, bypass attempts (role in headers, query, cookies, body, path tricks, frontend origin), forged tokens, audit entries for denials |

All requests go to the API over real HTTP, the way curl would call it, so the results
show what the backend enforces regardless of any UI. `auth.test.js` temporarily locks and disables
`admin.rahul@carecrypt.example` and restores it afterwards. It adds entries to the audit
log, which cannot be removed; re-run `schema.sql` and `seed.sql` for a clean database.
