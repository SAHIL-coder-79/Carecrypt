# SmartCare Assist workspace

`/clinician/smartcare` brings the decision-support screen of the original SmartCare Assist
project (`healthcare-dss/frontend/index.html`, `voice-handler.js`, `i18n/*.json`) into CareCrypt.
It runs against a real patient record, behind the same consent check, audit log and
"decision support only" rules as the rest of CareCrypt.

> Decision support only. Final clinical judgment remains with the clinician. Nothing on this page
> writes to the patient's record; a visit is saved only through the visit workflow, where the
> clinician reviews the analysis and confirms the assessment.

## Feature map: original → CareCrypt

| SmartCare Assist (healthcare-dss) | In CareCrypt | Notes |
| --- | --- | --- |
| Language selector EN / हिन्दी / मराठी | Workspace language selector | Original translations; remembered per browser |
| Anatomical body map (SVG) | `components/smartcare/Anatomy.jsx` `BodyMap` | Same geometry. Regions with a selected symptom are red; keyboard accessible |
| Anatomy popup (region → symptoms) | Region dialog | Same region → symptom lists (`REGION_SYMPTOMS`) |
| Clinical Guidance Bridge | `GuidancePanel` | All region texts and red-flag tips in the three languages |
| Symptom → Condition quick-reference table | `SymptomRefTable` | 19 rows, body part, "can cause" (critical in red); clicking ticks the symptom |
| 19 symptom checkboxes with icons | `SymptomTracker` | Codes are CareCrypt `ref.symptoms` codes (`high_bp` added) |
| Voice Clinical Assistant | `VoiceAssistant` | Web Speech API (en-IN / hi-IN / mr-IN), level meter, live and final transcript, symptom and duration detection in three languages, Suggested Form Updates with Apply / Discard. Negated English phrases ("no fever") are ignored. The transcript can also be typed |
| Patient information (age, gender) | From the CareCrypt record | Name, age, gender, district, allergies and chronic conditions are not re-typed |
| Duration, severity | Same fields | Applied to every selected symptom |
| Vital signs with guardrails | Same six vitals and limits | Out-of-range values are refused before analysis |
| Medical history, pregnancy | Chronic-condition ticks, other medications, pregnancy (female patients only) | Recorded history, allergies and medications are loaded from the record automatically |
| Clinical Reasoning Monitor | `ClinicalMonitor` | Status, symptoms logged, consent scope, live event log (hypertensive pattern, maternal protocol, severity), escalation watch |
| Results: emergency banner, assessment, triage directive | `Results.jsx` | Labelled "Possible …", never a diagnosis |
| Physiological trend monitoring | Vitals visualiser | Each vital against normal and critical bands |
| Risk stratification heatmap (4 tiles) | Same | General risk, maternal, DCI, triage |
| SOAP clinical summary | Same | Built from the analysis and the record |
| Explain AI decision / reasoning trail | "Explain the decision support" | Triggered symptoms and vitals, score breakdown, context-aware risk indicators, pattern logic, DCI components |
| Treatments, lab tests, warnings, actions | Recommendations | Allergy cautions from the record |
| Differential diagnosis | Same | Symptom-pattern match, with earlier diagnoses of the patient |
| Export JSON, Print | Same | Export holds the MRN, inputs and analysis (no name) |
| Case storage | `clinical.decision_support_runs` + "Recent runs" tab | Every run is stored and audited |
| — | **Start a visit with this analysis** | Opens the visit workflow pre-filled; the clinician reviews, sets the diagnosis and confirms |

## Not carried over, and why

| Original feature | Reason |
| --- | --- |
| Image upload "triage" | Its confidence was a colour heuristic with a random number. Showing it to clinicians would be unsafe |
| RandomForest model | Trained on random labels; no clinical signal |
| Nearby Doctors map and SOS button | Used a made-up doctor directory and live location |
| Specialist Hub / second opinion | A specialist is another clinician: under CareCrypt's rules the patient must first consent to them. Needs a consented referral flow (possible next step) |
| Offline mode / service worker | Records must not be cached on shared devices without encryption at rest |
| Analytics and admin pages | Replaced by CareCrypt's privacy-preserving analytics, security console and audit |

## API

The workspace calls `POST /api/smartcare/analyze` (see [SMARTCARE_INTEGRATION.md](SMARTCARE_INTEGRATION.md)).
Its response now also carries an `assessment` block with the engine detail the results use:

```json
"assessment": {
  "severity": "High", "durationDays": 2, "symptomsAnalysed": ["headache", "swelling", "high_bp"],
  "baseRiskScore": 100, "urgency": "Critical",
  "vitalFindings": ["Elevated blood pressure"],
  "scoreBreakdown": [{ "factor": "Vital Interaction", "impact": 10, "reason": "High BP + headache — hypertensive warning" }],
  "maternal": { "applicable": true, "scoreModifier": 30, "reasons": ["Possible Preeclampsia (High BP in pregnancy)"] },
  "suggestedActions": ["Emergency department evaluation required immediately"]
}
```

## Files

| Path | Role |
| --- | --- |
| `frontend/src/pages/clinician/SmartCarePage.jsx` | Workspace page, patient picker, runs tab |
| `frontend/src/components/smartcare/Anatomy.jsx` | Body map, guidance panel, reference table |
| `frontend/src/components/smartcare/Intake.jsx` | Symptom tracker, voice assistant, clinical monitor |
| `frontend/src/components/smartcare/Results.jsx` | Results screen |
| `frontend/src/components/smartcare/Activity.jsx` | Recent runs |
| `frontend/src/lib/smartcareWorkspace.js` | Symptoms, regions, vitals, history options, voice keywords, translation helper |
| `frontend/src/lib/smartcareStrings.js` | Generated from the original `i18n/{en,hi,mr}.json` and the guidance data in `index.html` |
| `backend/src/smartcare/adapter.js` | Adds the `assessment` block |

`smartcareStrings.js` was generated by reading the original files with Node (flattening the three
JSON files to the keys the workspace uses, and evaluating the `GUIDANCE_DATA` object). Regenerate
it the same way if the original translations change.

## Limitations

- Engine output text (reasons, recommendations) is English; page labels, symptoms, the reference
  table and the guidance are translated.
- Speech recognition depends on the browser (Chrome or Edge); Hindi and Marathi accuracy varies.
- The known SmartCare score saturation applies (see SMARTCARE_INTEGRATION.md).
