// SmartCare Assist: rule-based clinical decision support.
//
// This is the engine pipeline from the SmartCare Assist project (healthcare-dss),
// run in the same order as its POST /analyze route:
//   maternal risk → base risk → escalation → confidence (DCI) → differential
// The engines in ./engines are copied from healthcare-dss/backend/services; see SOURCE.md.
// Not included: the image "neural scan" (a colour heuristic) and the RandomForest
// model (trained on random labels). SmartCare output is decision support, never a diagnosis.

const riskEngine = require('./engines/riskEngine')
const maternalRiskEngine = require('./engines/maternalRiskEngine')
const escalationEngine = require('./engines/escalationEngine')
const confidenceEngine = require('./engines/confidenceEngine')
const LABELS = require('./labels.en.json')

const ENGINE = Object.freeze({ name: 'SmartCare Assist', version: '2.0.0', method: 'rule-based' })

/**
 * Runs the SmartCare pipeline on one encounter.
 * Input uses SmartCare's own vocabulary:
 * @param {object} input
 * @param {number} input.age
 * @param {string[]} input.symptoms           snake_case symptom ids, e.g. 'fever'
 * @param {'Low'|'Medium'|'High'} input.severity
 * @param {number} [input.duration]           days
 * @param {object} [input.vitals]             bp_systolic, bp_diastolic, bp ('120/80'), heart_rate, temperature (°C), spo2, respiratory_rate
 * @param {string[]} [input.medicalHistory]   e.g. 'diabetes', 'hypertension', 'pregnancy'
 * @param {string[]} [input.currentMedications] e.g. 'metformin', 'statins'
 * @param {string[]} [input.allergies]
 */
function assess(input) {
  const {
    age,
    symptoms = [],
    severity = 'Low',
    duration = 0,
    vitals = {},
    medicalHistory = [],
    currentMedications = [],
    allergies = [],
  } = input

  const maternal = maternalRiskEngine.evaluateMaternalRisk({ age, symptoms, medicalHistory, vitals })
  const base = riskEngine.evaluateBaseRisk({
    age,
    symptoms,
    severity,
    duration,
    vitals,
    currentMedications,
    allergies,
    medicalHistory,
    isMaternal: maternal.isMaternal,
  })
  // `age` is passed through so the escalation rules that use it can apply.
  const escalation = escalationEngine.determineEscalation(base, maternal, { symptoms, severity, vitals, age }, {})
  const confidence = confidenceEngine.calculateConfidence({ age, symptoms, vitals }, base, maternal, escalation)
  const differential = riskEngine.getDifferentialDiagnosis(symptoms)

  return { engine: ENGINE, base, maternal, escalation, confidence, differential }
}

// English text for a SmartCare message key (e.g. 'lab.cbc'); plain text passes through.
function label(key) {
  if (typeof key !== 'string') return key
  if (LABELS[key]) return LABELS[key]
  if (/^[a-z_]+(\.[a-z0-9_]+)+$/.test(key)) {
    const last = key.split('.').pop().replace(/_/g, ' ')
    return last.charAt(0).toUpperCase() + last.slice(1)
  }
  return key
}

module.exports = { assess, label, ENGINE, CONDITIONS_DB: riskEngine.CONDITIONS_DB }
