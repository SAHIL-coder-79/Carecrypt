# CareCrypt

**Secure Records. Smarter Care. Safer Intelligence.**

CareCrypt is a privacy-preserving healthcare platform being built for the HLTH-01
hackathon problem (Patient Health Records & Disease Trend Monitoring). It will combine
secure patient identity, QR-based clinician access, longitudinal health records,
SmartCare Assist decision support, role-based access control, privacy-preserving
aggregate analytics and audit logging.

> **Prototype. Synthetic data only.** Never load real patient data.
> SmartCare Assist is decision support, not an autonomous diagnosis or treatment system.

## Current status

- Frontend and backend skeleton, connected through a health check
- PostgreSQL schema with synthetic seed data (`database/`)
- Authentication (JWT) and role-based access control middleware
- Longitudinal patient record API with consent-scoped access, and the patient record UI
- Clinician dashboard (`/clinician/dashboard`): patient search, QR card scanning, longitudinal timeline, adding visits
- Patient consent: grant and revoke clinician access (`/patient/consent`), enforced on every record request
- Clinical visit workflow (symptoms → vitals → SmartCare review → assessment → medication → notes → confirm)
- SmartCare Assist clinical decision support, context-aware, inside the visit workflow ([docs/SMARTCARE_INTEGRATION.md](docs/SMARTCARE_INTEGRATION.md)), and the full SmartCare Assist workspace ported from the original project: body map, clinical guidance, symptom → condition table, symptom tracker, multilingual voice assistant, clinical monitor ([docs/SMARTCARE_WORKSPACE.md](docs/SMARTCARE_WORKSPACE.md))
- ADMIN aggregate analytics dashboard (`/admin/analytics`): trends by location, time and condition, with small-group suppression (minimum 10 patients) ([docs/ANALYTICS.md](docs/ANALYTICS.md))
- Custom aggregate queries with inference detection, security events and a SECURITY_ADMIN console (`/security/dashboard`); patient self-service QR cards (`/patient/card`). End-to-end workflow and demo script: [docs/WORKFLOW.md](docs/WORKFLOW.md)
- Role-based app shell: sidebar sections per role (clinician, admin, security, patient), consistent UI kit, responsive down to phone width. Menus are for convenience; the server enforces every permission ([docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#frontend))

Developer notes and test accounts: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Repository layout

| Folder | Contents |
| --- | --- |
| `frontend/` | React + Vite + Tailwind CSS web app |
| `backend/` | Node.js + Express API server |
| `smartcare/` | SmartCare Assist decision-support engines (copied from the original project) |
| `database/` | PostgreSQL setup scripts and migrations |
| `docs/` | Project documentation |

## Prerequisites

- Node.js 20 or newer (developed on Node 24)
- npm 10 or newer
- PostgreSQL 14 or newer (only needed for database work; the health check runs without it)

## Setup

```bash
# 1. Backend
cd backend
npm install
cp .env.example .env        # Windows PowerShell: Copy-Item .env.example .env

# 2. Frontend
cd ../frontend
npm install
cp .env.example .env        # optional; defaults work for local development
```

In `backend/.env`, set `JWT_SECRET` to a random value. The server will not start without it:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### Database

```bash
psql -U postgres -f database/init/001_create_role_and_database.sql
psql -U postgres -d postgres -f database/init/002_create_app_roles.sql
psql -U carecrypt -d carecrypt -f database/schema.sql
psql -U carecrypt -d carecrypt -f database/seed.sql
```

Optional, for a demo with fuller analytics charts (600 generated synthetic patients; the tests expect the base seed only):

```bash
psql -U carecrypt -d carecrypt -f database/seed_analytics_demo.sql
```

Then set `DATABASE_URL` (the API connects as `carecrypt_app`) and `ANALYTICS_DATABASE_URL`
(the restricted `carecrypt_analytics` login used only by the analytics API) in `backend/.env`,
and check the connection:

```bash
cd backend
npm run db:check
```

See [database/README.md](database/README.md) for details.

## Running

Use two terminals.

```bash
# Terminal 1: API on http://localhost:4000
cd backend
npm run dev
```

```bash
# Terminal 2: web app on http://localhost:5173
cd frontend
npm run dev
```

Open http://localhost:5173. The page shows the backend status. The Vite dev server
proxies `/api/*` to the backend, so the browser only talks to one origin.

## API

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/health` | none | `{ "status": "ok", "service": "carecrypt-backend" }` |
| POST | `/api/auth/login` | none | Email and password → JWT and basic user info |
| GET | `/api/auth/me` | Bearer token | The account behind the token |
| GET | `/api/patients` | CLINICIAN, PATIENT | Patients the caller may open |
| GET | `/api/patients/:patientId` | CLINICIAN with consent, PATIENT (own) | Longitudinal record |
| GET | `/api/patients/:patientId/visits` | as above | Visit history |
| GET | `/api/patients/:patientId/medications` | as above | Current and past medications |
| GET | `/api/patients/:patientId/conditions` | as above | Chronic conditions and diagnosis history |
| POST | `/api/patients/:patientId/visits` | CLINICIAN with consent | Save a visit; requires `clinicianAttestation: true` |
| GET | `/api/clinicians/me` | CLINICIAN | Profile and stats |
| GET | `/api/clinicians` | PATIENT, CLINICIAN | Clinician directory |
| POST | `/api/consent` | PATIENT | Grant a clinician access (scope, purpose, duration) |
| GET | `/api/consent/:patientId` | PATIENT (own), CLINICIAN (own consents) | Consents with status |
| DELETE | `/api/consent/:consentId` | PATIENT, CLINICIAN (own consent) | Revoke access |
| POST | `/api/qr/resolve` | CLINICIAN | `{ qrToken }` → `{ patientId }` (consent still required; audited as `QR_PATIENT_ACCESS`) |
| GET | `/api/reference` | CLINICIAN | Symptom, condition and medication catalogues |
| POST | `/api/smartcare/analyze` | CLINICIAN with consent | SmartCare Assist clinical decision support (see docs/SMARTCARE_INTEGRATION.md) |
| GET | `/api/analytics/overview` | ADMIN | Totals, top categories, notifiable-disease clusters (aggregate only) |
| GET | `/api/analytics/by-location` | ADMIN | Cases by district, and district × category (`?category=`) |
| GET | `/api/analytics/by-condition` | ADMIN | Cases by condition category and condition (`?category=`) |
| GET | `/api/analytics/by-time` | ADMIN | Cases per month, and month × category (`?category=&from=&to=`) |
| GET | `/api/analytics/by-age-group` | ADMIN | Cases by age band |
| GET | `/api/analytics/query` | ADMIN | One count for a filter combination; small or subtractable answers suppressed; inference detection |
| GET | `/api/security/summary` | SECURITY_ADMIN | Open events, recent activity, audit-chain integrity |
| GET | `/api/security/events` | SECURITY_ADMIN | Security events (`?status=OPEN\|RESOLVED\|ALL`) |
| POST | `/api/security/events/:id/resolve` | SECURITY_ADMIN | Resolve an event with a note |
| GET | `/api/security/audit` | SECURITY_ADMIN | Audit trail without clinical content |
| GET, POST | `/api/qr/my-card` | PATIENT | Own card status; issue a new card (token shown once) |
| GET | `/api/patients/:patientId/access-log` | PATIENT (own) | Who used the record, including refused attempts |
| GET | `/api/clinicians/me/visits` | CLINICIAN | Own visits; clinical details only under current consent |
| GET | `/api/smartcare/runs` | CLINICIAN | Own decision-support runs and review status |
| GET | `/api/analytics/privacy` | ADMIN | Privacy protections, inference rules, own custom-question standing |
| GET | `/api/test/clinician-only` | CLINICIAN | RBAC demonstration (development only by default) |
| GET | `/api/test/admin-only` | ADMIN | RBAC demonstration (development only by default) |
| GET | `/api/test/security-only` | SECURITY_ADMIN | RBAC demonstration (development only by default) |

```bash
curl http://localhost:4000/api/health
```

Request and response details, status codes and how to protect routes with
`authenticateToken()` and `requireRole()` are in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Scripts

| Location | Command | What it does |
| --- | --- | --- |
| `backend/` | `npm run dev` | Start the API and restart on file changes |
| `backend/` | `npm start` | Start the API |
| `backend/` | `npm run db:check` | Test the PostgreSQL connection in `DATABASE_URL` |
| `backend/` | `npm run qr:cards` | Issue printable demo QR cards for the synthetic patients (development only) |
| `backend/` | `npm test` | Run all backend tests: auth, RBAC, patient records, clinician dashboard, consent, QR, SmartCare (needs the seeded database) |
| `backend/` | `npm run test:rbac` | Run only the RBAC tests and print the access matrix |
| `frontend/` | `npm run dev` | Start the Vite dev server |
| `frontend/` | `npm run build` | Build the production bundle into `frontend/dist` |
| `frontend/` | `npm run preview` | Serve the production build locally |
| `frontend/` | `npm run lint` | Lint with oxlint |

## Environment variables

**backend/.env**

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | Runtime mode |
| `PORT` | `4000` | API port |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated browser origins allowed to call the API |
| `TRUST_PROXY` | `0` | Number of reverse proxies in front of the API (for client IPs) |
| `DATABASE_URL` | none | PostgreSQL connection string (`carecrypt_app` login) |
| `DATABASE_SSL` | `false` | Use SSL for hosted databases |
| `JWT_SECRET` | none, **required** | Token signing secret, at least 32 random characters |
| `JWT_EXPIRES_IN` | `1h` | Token lifetime |
| `LOGIN_MAX_FAILED_ATTEMPTS` | `5` | Wrong passwords before an account is locked |
| `LOGIN_LOCKOUT_MINUTES` | `15` | How long a locked account stays locked |
| `LOGIN_RATE_LIMIT_WINDOW_MINUTES` | `15` | Window for the per-IP login limit |
| `LOGIN_RATE_LIMIT_MAX` | `20` | Login attempts allowed per IP per window |
| `ENABLE_RBAC_TEST_ENDPOINTS` | on outside production | Serve the `/api/test/*` RBAC demonstration endpoints |

**frontend/.env**

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_DEV_PORT` | `5173` | Dev server port |
| `VITE_API_PROXY_TARGET` | `http://localhost:4000` | Where the dev server proxies `/api` |
| `VITE_API_BASE_URL` | empty | API base URL for the browser; empty means same-origin `/api` |
