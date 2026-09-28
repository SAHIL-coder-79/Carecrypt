# Provenance of the SmartCare Assist engines

The files in `engines/` and `labels.en.json` come from the SmartCare Assist project
(`healthcare-dss`), copied on 26 Sep 2026. They were not rewritten.

| CareCrypt file | Source file | SHA-256 of the source | Changes |
| --- | --- | --- | --- |
| `engines/riskEngine.js` | `backend/services/riskEngine.js` | `09b34c6b3f61164ddc1d7bd7f3ac60da5c28c643cdf3c19283446960d5323e30` | One line, see below |
| `engines/maternalRiskEngine.js` | `backend/services/maternalRiskEngine.js` | `5cc29886b66342ce7f764bd497787be04a1cbc1c68a943b7e2e148eecdac79ea` | None |
| `engines/escalationEngine.js` | `backend/services/escalationEngine.js` | `43ee6270825df5210f14951bc6025a9413aed60d7bd79e4aad18b1c9dfbb24bc` | None |
| `engines/confidenceEngine.js` | `backend/services/confidenceEngine.js` | `d30ec815dd44a73859bbf0862f25087d709697f2e79409936b175c95f3c7a9d4` | None |
| `labels.en.json` | `frontend/i18n/en.json` | `5c916581831be6eecd5648ffec98fa2c01c9aba03d494fd8d1668b1bc605b2c4` | Only the `condition.*`, `treatment.*`, `lab.*`, `action.*`, `escalation.*`, `maternal.reason*` and `urgency.*` keys (130) |

## The one engine change

`riskEngine.js` line 457, comorbidity weights: the key `'hop'` (a typo) became `'hypertension'`.
Without it, a recorded hypertension never added risk. No other logic was changed.

## Deliberately not included

| SmartCare component | Why |
| --- | --- |
| `imageTriageEngine.js` and the browser "neural visual scan" | Counts red pixels and reports a random 88–97% confidence; presenting it as AI would be misleading |
| `predict_api.py`, `model.pkl` (RandomForest) | Trained on random labels (`generate_model.py`); its predictions carry no clinical signal |
| `outbreakEngine.js` | Population-level; belongs to the (future) de-identified analytics layer, not to patient care |
| `summaryEngine.js` | Formats SOAP text for the old UI; CareCrypt renders its own view |

## Known limits of the engines (unchanged)

- Rule-based with hand-set weights; not clinically validated or calibrated.
- 14 condition groups. No rules for dengue, malaria or typhoid, although CareCrypt records them.
- The risk score saturates at 100 easily.
- The "persistent moderate symptoms" rule in `escalationEngine.js` reads fields the base engine
  never returns, so it never fires.

Mismatches between CareCrypt data and the engines' expected inputs (symptom and history
vocabulary, BP format, labels) are handled in the backend adapter
(`backend/src/smartcare/adapter.js`), not by editing the engines.
