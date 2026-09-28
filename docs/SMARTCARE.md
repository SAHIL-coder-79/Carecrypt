# SmartCare Assist – Module Documentation

## 1. Overview

SmartCare Assist is a rule-based clinical decision support module within CareCrypt. It evaluates patient-provided information, identifies potential health risks, assesses maternal risk, determines escalation requirements and generates a confidence score.

The module is designed to support preliminary risk assessment and assist healthcare personnel. It does not provide a confirmed medical diagnosis.

## 2. Risk Assessment Flow

SmartCare follows a sequential assessment process:

1. **Maternal Risk Assessment:** Identifies pregnancy-related risk factors and calculates a maternal risk score modifier.
2. **Base Risk Assessment:** Evaluates symptoms, severity, patient age, medical history, vital signs and other risk factors.
3. **Escalation Assessment:** Determines the risk category, urgency and suggested actions using general and maternal risk information.
4. **Confidence Assessment:** Calculates the Diagnostic Certainty Index (DCI) based on available data, symptom coherence, vital alignment and detected conflicts.
5. **Differential Assessment:** Retrieves potential condition matches based on the reported symptoms.

The main pipeline is implemented in `smartcare/index.js`.

## 3. Risk Assessment Engine

The Risk Engine evaluates patient information using predefined rules and condition-matching logic.

### Key factors

* Symptoms and their associated weights
* Patient age and reported severity
* Vital signs, including blood pressure, heart rate, temperature, oxygen saturation and respiratory rate
* Medical history and comorbidities
* Duration of symptoms
* Red-flag symptoms and symptom clusters
* Potential medication interactions

The engine calculates a base risk score, identifies possible condition matches, records risk-related reasons and warnings, and provides relevant suggested treatments and laboratory tests from its rule definitions.

The risk score is capped at 100. The engine also provides a separate weighted risk-scoring function, which is distinct from the main base-risk assessment.

## 4. Confidence Handling – Diagnostic Certainty Index (DCI)

The Confidence Engine estimates the certainty of the assessment based on the quality and consistency of the provided information.

### DCI components

| Component         |              Weight | Description                                                                |
| ----------------- | ------------------: | -------------------------------------------------------------------------- |
| Data Completeness |                 40% | Checks the availability of age, blood pressure, heart rate and temperature |
| Symptom Coherence |                 30% | Evaluates the number of reported symptoms and recognized symptom clusters  |
| Vital Alignment   |                 20% | Checks consistency between the risk category and critical vital findings   |
| Conflict Penalty  | Up to 10% deduction | Deducts points for selected conflicting information                        |

The final DCI score is restricted to a range of 0–100.

### Confidence levels

* **Low:** 0–40
* **Moderate:** 41–70
* **High:** 71–100

The engine also returns reasoning messages and the individual DCI component scores to help explain the calculated confidence.

The DCI is a software-generated confidence estimate and should not be interpreted as a probability that a diagnosis is correct.

## 5. Escalation Logic

The Escalation Engine evaluates the base risk and maternal risk results to determine the final escalation category and urgency.

### Risk categories

* **Low (Green):** Routine care or monitoring may be suggested.
* **Medium (Amber):** Further clinical evaluation or timely follow-up may be suggested.
* **High (Red):** Urgent or emergency clinical evaluation may be suggested.

The engine uses risk-score thresholds, maternal risk modifiers, symptoms, patient age and selected critical triggers to determine escalation.

It includes additional logic for specific severe symptoms, pediatric fever-related concerns, persistent symptoms and maternal risk factors. A stability guard can downgrade certain Red classifications to Amber when its specified critical triggers are absent and the score does not exceed its threshold.

The engine returns the final risk category, urgency, reasons, suggested actions and a separate escalation confidence value.

These categories and actions reflect implemented software rules and are not a substitute for clinical triage.

## 6. Maternal-Risk Module

The Maternal Risk Engine contains two functions:

### `evaluateMaternalRisk()`

This function is used by the main SmartCare pipeline. It identifies pregnancy through the medical-history values `pregnancy` or `pregnant`.

For identified pregnancies, it:

* Adds a risk modifier for age below 18 or above 35.
* Adds a risk modifier when systolic blood pressure is at least 140 or diastolic blood pressure is at least 90.
* Returns the maternal status, risk score modifier and reasons.

### `calculateMaternalRiskScore()`

This is a separate function that calculates a maternal risk score based on:

* Age
* Systolic blood pressure
* Haemoglobin level
* Previous pregnancy complications
* Selected maternal risk symptoms, such as swelling, severe headache and blurred vision

The score is capped at 100 and classified as Normal (0–30), Moderate (31–60) or High (61–100).

This separate scoring function is exported by the module but is not called by the main `smartcare/index.js` pipeline.

## 7. Input → Processing → Output

### Input

The main `assess()` function accepts patient information, including:

* Age
* Symptoms
* Severity
* Symptom duration
* Vital signs
* Medical history
* Current medications
* Allergies

### Processing

The input is processed through the maternal risk, base risk, escalation and confidence engines. A differential assessment is also generated using the reported symptoms.

### Output

The `assess()` function returns an object containing:

* `engine`: Engine name, version and method
* `base`: Base risk assessment details
* `maternal`: Maternal risk assessment
* `escalation`: Risk category, urgency, reasons and suggested actions
* `confidence`: Confidence score, level, DCI components and reasoning
* `differential`: Potential condition matches

The module provides structured decision-support information for use by the application.

## 8. Safety and Medical Disclaimer

SmartCare Assist is a rule-based clinical decision support tool intended to support preliminary risk assessment. It is not a replacement for qualified healthcare professionals, clinical examination, laboratory investigations or emergency medical services.

Its outputs depend on the accuracy, completeness and consistency of the information entered. Risk categories, confidence scores, potential conditions and suggested actions must not be treated as confirmed diagnoses or definitive treatment instructions.

Users experiencing severe or urgent symptoms should seek appropriate medical attention without relying solely on the application's assessment.

## 9. Relevant Folders and Files

| File / Folder                             | Purpose                                                                   |
| ----------------------------------------- | ------------------------------------------------------------------------- |
| `smartcare/index.js`                      | Main assessment pipeline and engine integration                           |
| `smartcare/engines/riskEngine.js`         | Base risk scoring, vital analysis and condition matching                  |
| `smartcare/engines/escalationEngine.js`   | Risk categorization, escalation and suggested actions                     |
| `smartcare/engines/confidenceEngine.js`   | Confidence score and DCI calculation                                      |
| `smartcare/engines/maternalRiskEngine.js` | Maternal risk evaluation and separate maternal scoring                    |
| `smartcare/labels.en.json`                | English labels used by the module                                         |
| `smartcare/README.md`                     | Module-level documentation                                                |
| `smartcare/SOURCE.md`                     | Source information for the module                                         |
| `smartcare/package.json`                  | Module metadata and package configuration                                 |
| `backend/src/smartcare/adapter.js`        | Adapts CareCrypt input formats to the SmartCare engine's expected formats |

The adapter handles differences in symptom vocabulary, blood pressure formats and labels. Input compatibility should be addressed in the adapter rather than by modifying the assessment engines.
