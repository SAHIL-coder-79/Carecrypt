# Admin analytics

Population-level disease trends for ADMIN users, built so that no response can identify a patient.

> ADMIN users never see individual patient records. Every analytics response is an aggregate count
> by location, time or condition category. Groups of fewer than 10 patients are hidden.

## Architecture

```
ADMIN (browser) /admin/analytics  ── Recharts dashboard
  │
  ▼
GET /api/analytics/{overview | by-location | by-condition | by-time | by-age-group}
  │ 1. authenticateToken()                 valid JWT
  │ 2. requireRole('ADMIN')                CLINICIAN / PATIENT / SECURITY_ADMIN → 403, audited
  │ 3. strict query validation             unknown or repeated parameters → 400
  ▼
backend/src/analytics/repository.js
  │ connects as carecrypt_analytics  ─── separate pool (ANALYTICS_DATABASE_URL)
  │                                       this login can SELECT the aggregate views only:
  │                                       no patients, visits, prescriptions, users or audit
  ▼
analytics.* views (database/schema.sql)   primary suppression: cells < k patients → NULL
  │
  ▼
backend/src/analytics/suppression.js      complementary suppression (see below)
  ▼
Audit: ANALYTICS_VIEW (endpoint, filters, number of hidden cells; no patient reference)
```

The row-level view `analytics.diagnosis_events_internal` still contains patient ids and is granted to
nobody. The aggregate views run with their owner's rights, so `carecrypt_analytics` can read their
output without any access to the tables underneath. Even a faulty analytics query cannot return a
patient row: the database refuses it (`42501`). If `ANALYTICS_DATABASE_URL` is missing or points at
another login, the API answers `503 ANALYTICS_UNAVAILABLE`; it never falls back to the clinical login.

## What is counted

- A **case** is a CONFIRMED or PROVISIONAL diagnosis recorded at a completed visit. Differential
  diagnoses and SmartCare suggestions are not cases.
- **Patients** are distinct patients. Suppression is always decided on patients, not cases.
- **Location** is the patient's home district. **Time** is the visit month. **Age** is age at the visit,
  in bands 0–4, 5–14, 15–24, 25–44, 45–64, 65+.
- Patients with `allow_aggregate_analytics = false` are never counted.
- The views are live, so a newly saved visit counts immediately.

## Privacy rules

1. **Small groups (primary).** Each view aggregates at its own grain and nulls every cell with
   fewer than `analytics.privacy_settings.min_group_size` patients (default 10): `SMALL_GROUP`.
   Totals come from their own view, never from adding up hidden finer cells.
2. **Complementary.** If a table's total is published, one hidden cell could be recovered as
   *total − visible cells*. For every group of cells that adds up to a published total (the whole
   table; each row and column of a two-way table), the API hides further cells, smallest first, until
   no group has exactly one hidden cell and the cases an outsider could work out for the hidden cells
   are at least k: `COMPLEMENTARY`. (At k = 5 the base seed shows this: Nashik has 4 patients and is
   hidden, so Ahmedabad is hidden with it. At the default k = 10 every district of the base seed is
   below k.)
3. **Filters never change what is hidden.** Suppression runs on the whole table first, then the
   filter selects rows. Comparing a filtered and an unfiltered response reveals nothing new.
4. **No identifiers, no free text.** Responses contain districts, states, months, ICD-10 condition
   codes and names, categories and counts. Nothing else.

Hidden cells come back as `{ "patientCount": null, "caseCount": null, "suppressed": true, "suppression": "SMALL_GROUP" }`.
A month or category with no cases comes back as `0`, not hidden, so the dashboard can tell the two apart.

## API

All endpoints: `ADMIN` only, `Cache-Control: private, no-store`, audited as `ANALYTICS_VIEW`.
Every response has `label: "Aggregate, de-identified analytics"` and a `privacy` block:

```json
"privacy": { "minGroupSize": 10, "suppressedCells": 7, "rules": ["Counts for groups of fewer than 10 patients are hidden (SMALL_GROUP).", "…"] }
```

| Endpoint | Query | Returns |
| --- | --- | --- |
| `GET /api/analytics/overview` | none | `totals` (patients, cases, visits, notifiableCases, conditions, districts), `period` {from, to}, `topCategories`, `signals` |
| `GET /api/analytics/by-location` | `category` | `locations` (district totals), `byCategory` (district × category), `categories` |
| `GET /api/analytics/by-condition` | `category` | `categories` (category totals), `conditions` (code, name, category, notifiable) |
| `GET /api/analytics/by-time` | `category`, `from`, `to` (YYYY-MM) | `months` (monthly totals), `byCategory` (month × category), `categories` |
| `GET /api/analytics/by-age-group` | none | `ageGroups` (age band totals) |
| `GET /api/analytics/query` | any of state, district, category, condition, month, ageBand, gender | One count, checked in the database; inference detection. See [WORKFLOW.md](WORKFLOW.md) |

`signals` lists notifiable diseases (dengue, malaria, typhoid, gastroenteritis) with at least k patients
in one district in one month, over the last three months. Example `overview` response (base seed with
k lowered to 5 for illustration; at k = 10 the base seed has no visible cluster):

```json
{
  "label": "Aggregate, de-identified analytics",
  "totals": { "patients": 23, "cases": 80, "visits": 73, "notifiableCases": 19, "conditions": 16, "districts": 4 },
  "period": { "from": "2025-10", "to": "2026-09" },
  "topCategories": [{ "category": "RESPIRATORY", "patientCount": 15, "caseCount": 20, "suppressed": false, "suppression": null }],
  "signals": [{ "month": "2026-09", "state": "Maharashtra", "district": "Pune", "code": "A90", "name": "Dengue fever", "patientCount": 6, "visitCount": 7 }],
  "privacy": { "minGroupSize": 5, "suppressedCells": 4, "rules": ["…"] }
}
```

| Status | When |
| --- | --- |
| 400 `VALIDATION_FAILED` | Unknown category, bad month, `from` after `to`, unknown or repeated parameter |
| 401 | Not signed in |
| 403 `FORBIDDEN` (`resource: AGGREGATE_ANALYTICS`) | Not ADMIN |
| 503 `ANALYTICS_UNAVAILABLE` | `ANALYTICS_DATABASE_URL` not set, or that login lacks access |

## Dashboard (`/admin/analytics`, `/admin/trends`, `/admin/privacy`)

ADMIN users land on the Population Dashboard. Disease Trends holds the monthly and per-condition
charts and the custom question tool; Privacy explains the protections and shows the admin's own
custom-question standing.

| Panel | Chart |
| --- | --- |
| KPI cards | Patients counted, diagnosis cases, completed visits, notifiable cases, coverage |
| Notifiable disease clusters | Latest district clusters of notifiable diseases |
| Cases over time | Line chart: all cases, or one line per condition category (toggle chips) |
| Condition categories | Proportional bars; selecting one filters the condition chart |
| Cases by condition | Horizontal bar chart coloured by category; hidden conditions listed without numbers |
| Cases by location | Bar chart per district (optionally one category) and a district × category heat table |
| Cases by age group | Bar chart per age band |

Hidden values are never drawn as zero: lines have gaps, bars are hatched stubs labelled "Hidden",
and table cells are hatched (`<10` for a small group, *hidden* for a complementary cell). On phones
the district × category table becomes a list per district.
The other panels load only after the overview succeeds, so a refused role gets one 403, not five.
The charting library is loaded only for these pages. Category colours use a validated
colour-blind-safe palette in a fixed order (`src/lib/analytics.js`).

## Demo volume data (optional)

`database/seed.sql` has 24 patients, so at k = 10 most finer cells are hidden. That is the privacy
model working, but the charts are thin. For a demo, load generated volume data once:

```bash
psql -U carecrypt -d carecrypt -f database/seed_analytics_demo.sql
```

It adds 600 synthetic patients ("Synthetic Patient 0001", MRN `SYN-…`, no contact details) with
1–4 visits each, seasonal patterns (monsoon dengue and malaria, winter respiratory infections,
summer gastroenteritis) and age-weighted chronic conditions. Visits are attributed to inactive
"Synthetic data source" clinicians, no consent is granted to anyone, and no QR cards are printed
for them, so the clinician and patient features are unchanged. The automated tests expect the
base seed only: reload `schema.sql` and `seed.sql` before running them.

## Limitations

- Suppression protects single tables and their published totals. Combining many different
  tables (for example district × category with month × category and condition totals) still gives
  an attacker linear equations to work with. A production system would add a query budget,
  noise (differential privacy) or a disclosure review of new views.
- The existence of a hidden cell is visible: "some patients in Nashik had a haematological
  condition" is disclosed, without a number.
- Case counts per month are by visit date; a patient seen twice for the same illness counts twice.
- Location is the home district as currently recorded, not the district at the time of the visit.

## Files

| Path | Role |
| --- | --- |
| `database/schema.sql` (analytics section) | Aggregate views with primary suppression, grants |
| `database/seed_analytics_demo.sql` | Optional synthetic volume data |
| `backend/src/db/analyticsPool.js` | Connection pool for the `carecrypt_analytics` login |
| `backend/src/analytics/suppression.js` | Complementary suppression |
| `backend/src/analytics/repository.js` | View queries, protection order, zero-filling |
| `backend/src/routes/analytics.js` | Endpoints, ADMIN check, validation, audit |
| `backend/test/analytics.test.js` | Access, no identifiers, totals, small cells, differencing, filters, audit, login isolation |
| `frontend/src/pages/admin/AnalyticsDashboard.jsx` | Dashboard page |
| `frontend/src/components/analytics/` | KPI cards, charts, location table |
