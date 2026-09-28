# SmartCare Assist integration

How the existing SmartCare Assist decision-support engine runs inside CareCrypt.

> SmartCare output is **Clinical Decision Support**, never a final diagnosis or a guaranteed
> treatment. Every response carries: *"Decision support only. Final clinical judgment remains
> with the clinician."*

## What was integrated, and what was not

SmartCare Assist's decision logic is a set of JavaScript rule engines in the original project
(`healthcare-dss/backend/services`). They were **copied, not rewritten**, into `smartcare/engines/`
(checksums and the single one-line change are in `smartcare/SOURCE.md`).

| SmartCare component | In CareCrypt | Reason |
| --- | --- | --- |
| Risk engine (conditions, scoring, vitals, drug interactions, differential) | Yes | Core decision logic |
| Maternal risk engine | Yes | Pregnancy-related risk |
| Escalation engine (Red/Amber/Green, actions) | Yes | Urgency and next steps |
| Confidence engine (Diagnostic Certainty Index) | Yes | Input completeness |
| English labels for engine output | Yes | Readable text |
| Python RandomForest (`predict_api.py`, `model.pkl`) | No | Trained on random labels; no clinical signal |
| Image "neural scan" | No | Colour heuristic with random confidence |
| Outbreak engine | No | Population-level; belongs to de-identified analytics |

Because the real engine is JavaScript, it runs **in-process** in the Node backend. No FastAPI
service was needed; the Python part that existed carried no usable model.

## Architecture

```
Clinician (browser)
  │  Add visit form: current symptoms + vitals ──► "Run SmartCare Assist"
  ▼
POST /api/smartcare/analyze                                  backend/src/routes/smartcare.js
  │ 1. authenticateToken()             valid JWT
  │ 2. requireRole('CLINICIAN')        ADMIN / SECURITY_ADMIN / PATIENT → 403
  │ 3. validate input                  400 VALIDATION_FAILED
  │ 4. authorizePatientAccess()        active consent required → else 403 NO_ACTIVE_CONSENT
  ▼
Patient context (consent-scoped)                             backend/src/smartcare/context.js
  │ chronic conditions, allergies, active medications (all scopes)
  │ visit history + previous diagnoses (VISIT_HISTORY and FULL_RECORD only)
  ▼
Adapter: CareCrypt → SmartCare vocabulary                    backend/src/smartcare/adapter.js
  │ ICD-10 history → SmartCare comorbidity keys (E11 → diabetes, I10 → hypertension, …)
  │ medication codes → SmartCare interaction keys (atorvastatin → statins, …)
  │ per-symptom severity → overall severity; longest duration
  │ vitals → temperature, heart_rate, bp_systolic/bp_diastolic and "bp" string
  ▼
SmartCare Assist (unchanged engines)                          smartcare/index.js
  │ maternal → base risk → escalation → confidence → differential
  ▼
Adapter: context-aware layer + response mapping
  │ possible conditions, linked to ICD-10 codes and to earlier diagnoses of the patient
  │ risk indicators from vitals, history, visit history, medications, allergies
  │ recommendations: actions / investigations / treatment options (allergy cautions)
  ▼
Audit: SMARTCARE_ANALYZE (patient id, counts and codes only)
  ▼
Response: "Clinical Decision Support" + disclaimer
```

## Context-aware decision support

The original SmartCare took symptoms, vitals and a free list of history. CareCrypt feeds it the
patient's longitudinal record and adds checks the engine did not have:

| Context | Used for |
| --- | --- |
| Current symptoms, severity, duration, vitals | Engine input (unchanged SmartCare rules) |
| Chronic conditions + clinician-reported history | Engine comorbidity weighting; "known condition" indicators |
| Previous diagnoses (visit history) | Linked to each possible condition ("Recorded before: …") |
| Visits in the last 90 days | "Similar symptoms N days ago" (HIGH within 14 days) |
| Emergency visits in the last 30 days | Indicator |
| Blood pressure across the last 3 visits | "Elevated at this and the last 3 visits" |
| Active medications | Engine drug-interaction check |
| Recorded drug allergies | Caution on clashing treatment options (e.g. antibiotics with a penicillin allergy) |

What SmartCare may use follows the clinician's consent scope. With **SUMMARY_ONLY** consent, visit
history and previous diagnoses are not loaded, and the response lists them under
`contextUsed.withheldByConsent`.

## API

`POST /api/smartcare/analyze` (CLINICIAN with an active consent for the patient)

```json
{
  "patientId": "8707840a-7b95-4b7d-8304-6192398771c7",
  "currentSymptoms": [
    { "code": "fever", "severity": "MODERATE", "durationDays": 3 },
    "cough"
  ],
  "vitals": { "temperatureC": 38.6, "pulseBpm": 104, "systolic": 118, "diastolic": 76, "spo2Percent": 93 },
  "relevantHistory": ["E11.9"],
  "medications": ["metformin"],
  "pregnant": false
}
```

- `currentSymptoms` (required, 1–30): symptom codes or `{ code, severity, durationDays }`.
- `relevantHistory`, `medications` (optional): **clinician-reported** extras not yet in the record.
  The recorded history and medications are always loaded from the database; the client cannot
  replace them. Reported items are echoed under `contextUsed.clinicianReported`.
- `vitals`, `pregnant` (optional).

Response (abridged):

```json
{
  "label": "Clinical Decision Support",
  "engine": { "name": "SmartCare Assist", "version": "2.0.0", "method": "rule-based" },
  "possibleConditions": [
    {
      "code": "respiratory_infection",
      "name": "Respiratory infection (possible pneumonia/COVID)",
      "symptomMatch": 100,
      "strength": "Strong symptom match",
      "relatedCodes": ["J06.9", "J18.9"],
      "previouslyRecorded": [{ "code": "J06.9", "name": "Acute upper respiratory infection", "date": "2025-12-18" }]
    }
  ],
  "riskIndicators": [
    { "level": "HIGH", "source": "allergy", "message": "Consider antibiotics if bacterial infection is suspected: patient has a recorded Penicillin allergy." }
  ],
  "overallRisk": { "level": "HIGH", "color": "Red", "score": 100, "urgency": "Critical", "escalationSuggested": true },
  "recommendations": [
    { "type": "INVESTIGATION", "text": "Chest X-ray" },
    { "type": "TREATMENT_OPTION", "text": "Consider antibiotics if bacterial infection is suspected",
      "caution": "Recorded allergy: Penicillin (severe). Choose an agent from another class." }
  ],
  "confidence": { "score": 78, "level": "High", "meaning": "How complete and consistent the input is, not the probability of a condition." },
  "reasoning": ["Clinical presentation strongly aligns with … (100% symptom-pattern match)"],
  "contextUsed": { "consentScope": "FULL_RECORD", "chronicConditions": [], "previousDiagnoses": [], "visitsConsidered": 3,
                   "activeMedications": [], "allergies": ["Penicillin"], "clinicianReported": { "history": [], "medications": [] },
                   "withheldByConsent": [] },
  "disclaimer": "Decision support only. Final clinical judgment remains with the clinician.",
  "analysisId": "83d5d34a-d0f2-48ef-9266-cee9a01a6e20"
}
```

The response also has an `assessment` block (score breakdown, vital findings, maternal pathway,
suggested actions) used by the workspace; see [SMARTCARE_WORKSPACE.md](SMARTCARE_WORKSPACE.md).

Each run is stored in `clinical.decision_support_runs` (symptom codes, suggested condition codes,
risk level; no free text) and returned as `analysisId`. It creates no diagnosis. When the
clinician saves the visit, they may link the run with `decisionSupport: { analysisId, reviewed: true }`;
the visit then shows SmartCare's suggestion next to the clinician's own, explicitly confirmed
assessment. See the clinical visit workflow in `DEVELOPMENT.md`.

| Status | When |
| --- | --- |
| 400 `VALIDATION_FAILED` | Missing patient, no symptoms, bad codes or vitals |
| 401 | Not signed in |
| 403 `FORBIDDEN` | Not a CLINICIAN (ADMIN, SECURITY_ADMIN, PATIENT) |
| 403 reason `NO_ACTIVE_CONSENT` | No active consent for this patient; nothing is analysed |

## Safeguards

- **Wording.** Output is labelled "Clinical Decision Support". Conditions are "possible" with a
  symptom-match strength; treatments are "options to consider". SmartCare's own "% confidence"
  wording for rule matches is rewritten as "% symptom-pattern match", and the DCI is described as
  input completeness. Tests fail if the response contains "final diagnosis", "guaranteed" or
  "definitive".
- **Clinician decides.** In the visit form SmartCare never edits the record. A suggestion becomes a
  diagnosis only if the clinician clicks "Add … as provisional diagnosis", which records it as
  PROVISIONAL with the note "Considered after SmartCare Assist decision support". The server's
  allergy check on prescriptions still applies.
- **Access.** Patient-specific and CLINICIAN-only, behind the same consent check as the record.
  There is no SmartCare endpoint for ADMIN, and no analytics endpoint exposes SmartCare input or output.
- **Audit.** `SMARTCARE_ANALYZE` (success and refusals) with the patient id, engine version, symptom
  count, top condition code, risk level and context counts. No symptoms, notes or free text.
- **Staleness.** If symptoms or vitals change after a run, the panel says the analysis is out of date.

## Known limitations

These come from the SmartCare engines and were deliberately not "fixed" by rewriting them:

- **Score saturation.** The additive score reaches 100 quickly, for example an older patient with
  fever plus diabetes and hypertension. At 100 SmartCare escalates to Critical and suggests
  emergency actions. Recalibrating the weights needs clinical input and validation.
- **Coverage.** 14 condition groups. No rules for dengue, malaria or typhoid, which CareCrypt's
  records contain.
- **Not validated.** Hand-set rules, no calibration against outcomes.
- **Visits only.** Longitudinal context is limited to what CareCrypt records: no lab results yet.

## Files

| Path | Role |
| --- | --- |
| `smartcare/` | Engine package (copied SmartCare engines, labels, provenance) |
| `backend/src/smartcare/engine.js` | Loads the package |
| `backend/src/smartcare/context.js` | Consent-scoped patient context |
| `backend/src/smartcare/adapter.js` | Vocabulary mapping, context-aware indicators, response shape |
| `backend/src/routes/smartcare.js` | Endpoint, validation, authorisation, audit |
| `backend/test/smartcare.test.js` | Output labelling, context use, allergy caution, scope, access, validation, audit |
| `frontend/src/components/clinician/SmartCarePanel.jsx` | Decision-support panel in the Add visit form |
