# CareCrypt overview

A plain-language guide to what CareCrypt does and how the pieces fit together.
For setup see the [README](../README.md); for API details, test accounts and tests see
[DEVELOPMENT.md](DEVELOPMENT.md).

> Prototype. Synthetic data only. SmartCare Assist is decision support, not a diagnosis tool.

## The idea in one paragraph

Patients own their health records. A clinician can open a record only after the patient has
granted consent, every access is written to an audit log, and administrators see only
aggregate statistics, never individual patients. The server enforces all of this; the
frontend menus are only a convenience.

## Who uses it (roles)

| Role | Can do | Cannot do |
| --- | --- | --- |
| **PATIENT** | View own record, grant and revoke clinician access, see who accessed the record, issue own QR card | See anyone else's record |
| **CLINICIAN** | Search consented patients, scan QR cards, add visits, use SmartCare Assist | Open a record without active consent |
| **ADMIN** | View aggregate analytics (trends by location, time, condition, age group) | See any individual patient or row-level data |
| **SECURITY_ADMIN** | Review the audit log and security events, resolve events | View clinical content |

Roles do not inherit. An ADMIN does not get clinician access.

## Main features

**Secure login.** Email and password give a short-lived (1 hour) JWT. Accounts lock after
5 wrong passwords. There is no public registration; accounts are provisioned.

**Longitudinal patient record.** One record per patient covering demographics, allergies,
chronic conditions, medications and every visit over time.

**Patient consent.** A patient grants a clinician access with a scope, a purpose and a
duration. Scopes: `FULL_RECORD`, `VISIT_HISTORY`, `SUMMARY_ONLY`. Consent can be revoked at
any time and takes effect on the clinician's next request. Data outside the scope is not sent
at all.

**QR card access.** A patient card holds only a random token, no personal data. A clinician
scans it, the server checks consent, and only then returns the patient id.

**Clinical visit workflow.** Six steps: symptoms, vitals, SmartCare review, assessment,
medication, notes and confirmation. The clinician must confirm the assessment as their own
judgement before saving. Drugs that clash with a recorded allergy are refused.

**SmartCare Assist.** Decision support inside the visit workflow and as a separate workspace
(body map, symptom table, symptom tracker, voice assistant, clinical monitor). It suggests;
the clinician decides.

**Privacy-preserving analytics.** Admins see counts only. Groups smaller than 10 patients
are suppressed, opted-out patients are excluded, and custom queries are checked so that small
groups cannot be recovered by subtracting results.

**Audit log.** Logins, refusals, record views, consent changes, QR scans and visit creation
are logged in an append-only trail. The integrity of the chain is shown on the security
dashboard.

## How the pieces fit

```
Browser (React + Vite, :5173)
   |  /api/*  (Vite dev server proxies to the backend)
   v
Express API (:4000)
   |-- authenticateToken()  who are you?
   |-- requireRole()        is your role allowed here?
   |-- consent check        did the patient allow it?
   |-- audit log            what happened?
   v
PostgreSQL (database/)      smartcare/ engines are called by the API
```

## Where to look in the repo

| Folder | What is inside |
| --- | --- |
| `frontend/` | React app. Pages per role, shared UI in `src/components/` |
| `backend/` | Express API: routes, middleware, tests |
| `smartcare/` | SmartCare Assist decision-support engines |
| `database/` | `init/` role and database scripts, `schema.sql`, `seed.sql`, optional demo seed |
| `docs/` | This documentation |

## Related documents

- [DEVELOPMENT.md](DEVELOPMENT.md): test accounts, API details, RBAC, consent, QR, tests
- [WORKFLOW.md](WORKFLOW.md): end-to-end workflow and demo script
- [ANALYTICS.md](ANALYTICS.md): analytics and small-group suppression
- [SMARTCARE_INTEGRATION.md](SMARTCARE_INTEGRATION.md) and [SMARTCARE_WORKSPACE.md](SMARTCARE_WORKSPACE.md): SmartCare Assist
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md): common setup problems