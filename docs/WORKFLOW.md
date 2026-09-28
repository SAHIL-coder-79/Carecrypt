# End-to-end workflow and security monitoring

How the CareCrypt modules fit together, how they are tested end to end, and how to demo them.

## Clinical and analytics workflow

```
PATIENT ── My card (/patient/card) ── issues a QR card: a random token, nothing else
   │       Access History (/patient/access-history) ── sees every access and refused attempt
   │       Access & consent (/patient/consent) ── grants a clinician access (scope, purpose, duration)
   ▼
CLINICIAN ── signs in (JWT) ── Scan patient QR
   │   POST /api/qr/resolve        consent checked → { patientId } only       audit QR_PATIENT_ACCESS
   │   GET  /api/patients/:id      separate authorised request                 audit PATIENT_RECORD_VIEW
   │   Add new visit: symptoms → vitals
   │   POST /api/smartcare/analyze Clinical Decision Support (no diagnosis)    audit SMARTCARE_ANALYZE
   │   clinician reviews, sets the assessment, prescribes, confirms
   │   POST /api/patients/:id/visits  clinicianAttestation required            audit VISIT_CREATE
   ▼
Aggregate analytics (live views): the visit counts at once, opted-out patients excluded
   ▼
ADMIN ── /admin/analytics ── population trends by location, time, condition, age
          minimum-group check: fewer than 10 patients → suppressed
```

## Security workflow

```
ADMIN → GET /api/patients/...                       → 403 FORBIDDEN, no data
                                                       audit ACCESS_DENIED + security event PATIENT_DATA_ACCESS_DENIED

ADMIN → GET /api/analytics/query?district=…&condition=…&month=…&gender=…
                                                     → minimum-group check in the database → SUPPRESSED

ADMIN → repeated narrowing queries                  → inference detection → SECURITY EVENT (INFERENCE_NARROWING)
                                                       custom queries paused: 403 ANALYTICS_QUERY_BLOCKED

SECURITY_ADMIN → /security/dashboard                → security events, audit trail, audit-chain integrity
               → resolves the event with a note     → audit SECURITY_EVENT_RESOLVE; the admin can query again
```

### Minimum group size

`analytics.privacy_settings.min_group_size` is **10**. It applies to the dashboard views, the custom
query and notifiable-disease signals. Change it with
`UPDATE analytics.privacy_settings SET min_group_size = …` (at least 2).

### Custom queries: `GET /api/analytics/query` (ADMIN)

Filters (all optional, equality only): `state`, `district`, `category`, `condition` (ICD-10),
`month` (YYYY-MM), `ageBand` (0-4, 5-14, 15-24, 25-44, 45-64, 65+), `gender`.

The answer is computed by `analytics.query_cases()`, a `SECURITY DEFINER` function that the
analytics login may execute but whose row-level inputs it cannot read. The function applies the
checks before any number leaves the database:

| Result | When |
| --- | --- |
| `SMALL_GROUP` | 1 to k−1 patients match |
| `DIFFERENCE` | The answer differs from any coarser version of the same query (some filters removed) by 1 to k−1 patients. Asking both and subtracting would expose a small group |
| Visible | 0 patients, or at least k and no small difference |

```json
{
  "label": "Aggregate, de-identified analytics",
  "filters": { "district": "Bengaluru Urban", "condition": "J06.9", "month": "2026-09", "gender": "FEMALE" },
  "result": { "patientCount": null, "caseCount": null, "suppressed": true, "suppression": "SMALL_GROUP" },
  "inferenceControl": { "flagged": false },
  "privacy": { "minGroupSize": 10, "rules": ["…"] }
}
```

Every query is audited as `ANALYTICS_QUERY` with its filters and whether it was suppressed. Counts
are never written to the audit log.

### Inference detection

After each custom query, `backend/src/security/inference.js` looks at the user's queries from the
last 15 minutes (not counting those before their last resolved inference event):

| Event | Severity | Pattern |
| --- | --- | --- |
| `INFERENCE_DIFFERENCING` | HIGH | The query was suppressed as `DIFFERENCE`, and the user already asked the coarser query it could be subtracted from |
| `INFERENCE_NARROWING` | MEDIUM | At least 4 queries in a row, each adding filters to the previous one, still narrowing after reaching suppressed answers (at least 2 suppressed) |
| `INFERENCE_PROBING` | MEDIUM | 5 or more suppressed answers in the window |

A single suppressed answer at the end of an ordinary drill-down is not flagged. On detection the
response says so, a security event is stored (`audit.security_events`) and appended to the audit log
(`SECURITY_EVENT`), and the user's custom queries are paused (`403 ANALYTICS_QUERY_BLOCKED`) until a
SECURITY_ADMIN resolves the event. The standard dashboard stays available. Event details record the
filters of the queries involved, never a count.

Other security events: `PATIENT_DATA_ACCESS_DENIED` (a role that may not read patient records tried
to, at most one open event per user per 10 minutes; ids in the path are redacted) and
`ACCOUNT_LOCKED` (repeated failed sign-ins).

### Security console API (SECURITY_ADMIN)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/security/summary` | Open events by severity, last-24-hour activity, audit-chain integrity (`audit.verify_chain()`), refusals in the last 7 days |
| GET | `/api/security/events?status=OPEN\|RESOLVED\|ALL` | Security events with the account involved |
| POST | `/api/security/events/:id/resolve` | `{ "note": "…" }` (3–500 characters). 409 if already resolved |
| GET | `/api/security/audit?action=&outcome=&role=&limit=&before=` | Audit trail, newest first, paged by sequence number |

The console never shows clinical content. Patients appear only as record ids, patient accounts as
"Patient account", and audit metadata is limited to a whitelist (for example the diagnosis codes in
`VISIT_CREATE` metadata are dropped). Every console read is itself audited (`SECURITY_AUDIT_VIEW`).

### Patient QR card

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/qr/my-card` | PATIENT: status of their cards (hint and dates only) |
| POST | `/api/qr/my-card` | PATIENT: issue a new card, revoking the previous one. The token is returned once; only its hash is stored. Audited as `QR_CARD_ISSUE` |

## Tests

`backend/test/e2e.test.js` runs the whole chain above through the public API: Divya Hegde issues a
card, Dr. Qureshi is refused before consent, Divya grants consent, the card resolves, the record
opens, SmartCare runs without creating a diagnosis, the visit is saved with the reviewed decision
support linked, the audit trail and hash chain are checked, the admin's totals rise by one case,
the admin is refused the record, a specific query is suppressed, narrowing raises a security event
and pauses queries, and the security officer sees and resolves it. The consent is revoked at the end.

| File | Covers |
| --- | --- |
| `test/e2e.test.js` | The full workflow above (17 steps) |
| `test/inferenceControl.test.js` | Custom query validation, answers checked against the clinical data with the minimum-group and difference rules, each detection rule, pausing and resolution, audit. Unit tests for the rules |
| `test/security.test.js` | Console access, summary, events, resolution (400/404/409), lockout and denied-access events, audit trail without patient names or clinical metadata, filters and paging, self-auditing. Patient QR self-service |

All need `ANALYTICS_DATABASE_URL` except `security.test.js`.

## Demo script

Load the base seed, and for fuller charts also `database/seed_analytics_demo.sql` (see
[ANALYTICS.md](ANALYTICS.md)). All passwords: `CareCrypt@2026`.

1. **Patient** `divya.hegde@mail.example`: *My Record* → *My CareCrypt card* → *Issue a new card*. Copy the code under the QR.
2. **Clinician** `dr.farhan.qureshi@carecrypt.example`: *QR Scanner* → *Enter code* → paste →
   refused: no consent.
3. **Patient**: *Consent* → choose Dr. Farhan Qureshi → *GRANT ACCESS*. *Access History* shows the refused scan.
4. **Clinician**: scan again → Divya's record opens → *Add new visit* → symptoms, vitals →
   *Run SmartCare Assist* → tick reviewed → add a diagnosis → medication → notes → confirm → *Save visit*.
5. **Admin** `admin.priya@carecrypt.example`: the Population Dashboard includes the visit. On *Disease Trends*, in *Ask a specific
   question*, pick Bengaluru Urban, J06.9, September 2026, Female → **Suppressed**. Then narrow step by
   step: Bengaluru Urban → + Respiratory → + September 2026 → **Security event raised**; the next
   question is paused. *Privacy* shows the pause; its *Try to open the patient list* → **403**.
6. **Security officer** `security.officer@carecrypt.example`: the Security Dashboard lists both events;
   *Audit Logs* shows the visit, the refusals and the queries; on *Security Events* resolve the
   narrowing event with a note. The admin can ask questions again.
