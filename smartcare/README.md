# smartcare

SmartCare Assist, the clinical decision-support engine inside CareCrypt.

SmartCare Assist is **decision support**: it suggests possible condition groups, risk indicators
and options to consider for a clinician to review. It does not diagnose or treat. Every output
carries the notice *"Decision support only. Final clinical judgment remains with the clinician."*

| File | What it is |
| --- | --- |
| `index.js` | Runs the engine pipeline: `assess(input)`, `label(key)` |
| `engines/` | The SmartCare Assist rule engines, copied from `healthcare-dss` (see `SOURCE.md`) |
| `labels.en.json` | SmartCare's English text for its output keys |
| `SOURCE.md` | Provenance, checksums, the one-line change, and what was left out |

This is a CommonJS package used in-process by the backend (`backend/src/smartcare/`). It has no
dependencies and never touches the database or the network: the backend supplies the input and
decides who may call it.

How it fits into CareCrypt: [docs/SMARTCARE_INTEGRATION.md](../docs/SMARTCARE_INTEGRATION.md).
