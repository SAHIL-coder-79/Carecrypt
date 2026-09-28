import { GUIDANCE, STRINGS } from './smartcareStrings.js'

// Data and helpers for the SmartCare Assist workspace (/clinician/smartcare),
// ported from the SmartCare Assist project (healthcare-dss/frontend).

export const LANGUAGES = [
  ['en', 'English'],
  ['hi', 'हिन्दी (Hindi)'],
  ['mr', 'मराठी (Marathi)'],
]

// Strings the original project had only as English defaults in its HTML.
const EXTRA = {
  en: {
    'ws.body_panel': 'Anatomical Focus',
    'ws.monitor': 'Clinical Monitor',
    'ws.guide_header': 'Clinical Assistant',
    'ws.region_popup_confirm': 'Confirm selection',
    'ws.vitals.bp_systolic': 'BP systolic (mmHg)',
    'ws.vitals.bp_diastolic': 'BP diastolic (mmHg)',
    'ws.vitals.pulse': 'Heart rate (bpm)',
    'ws.vitals.temp': 'Temperature (°C)',
    'ws.vitals.spo2': 'SpO2 (%)',
    'ws.vitals.rr': 'Resp. rate (/min)',
    'ws.dci_disclaimer': 'The Diagnostic Certainty Index reflects data completeness, not diagnostic accuracy.',
    // CareCrypt wording: a decision-support summary, not an AI-generated note.
    summary_header: 'Clinical summary (SOAP)',
  },
  hi: {
    'ws.body_panel': 'शारीरिक फोकस',
    'ws.monitor': 'क्लिनिकल मॉनिटर',
    'ws.guide_header': 'क्लिनिकल सहायक',
    'ws.region_popup_confirm': 'चयन की पुष्टि करें',
    'ws.vitals.bp_systolic': 'बीपी सिस्टोलिक (mmHg)',
    'ws.vitals.bp_diastolic': 'बीपी डायस्टोलिक (mmHg)',
    'ws.vitals.pulse': 'हृदय गति (bpm)',
    'ws.vitals.temp': 'तापमान (°C)',
    'ws.vitals.spo2': 'SpO2 (%)',
    'ws.vitals.rr': 'श्वसन दर (/मिनट)',
    'ws.dci_disclaimer': 'डायग्नोस्टिक सर्टेनटी इंडेक्स डेटा की पूर्णता दर्शाता है, निदान की सटीकता नहीं।',
  },
  mr: {
    'ws.body_panel': 'शारीरिक लक्ष',
    'ws.monitor': 'क्लिनिकल मॉनिटर',
    'ws.guide_header': 'क्लिनिकल सहाय्यक',
    'ws.region_popup_confirm': 'निवड निश्चित करा',
    'ws.vitals.bp_systolic': 'बीपी सिस्टोलिक (mmHg)',
    'ws.vitals.bp_diastolic': 'बीपी डायस्टोलिक (mmHg)',
    'ws.vitals.pulse': 'हृदय गती (bpm)',
    'ws.vitals.temp': 'तापमान (°C)',
    'ws.vitals.spo2': 'SpO2 (%)',
    'ws.vitals.rr': 'श्वसन दर (/मिनिट)',
    'ws.dci_disclaimer': 'डायग्नोस्टिक सर्टेन्टी इंडेक्स माहितीची पूर्णता दर्शवतो, निदानाची अचूकता नाही.',
  },
}

export function t(lang, key, fallback) {
  return EXTRA[lang]?.[key] ?? STRINGS[lang]?.[key] ?? EXTRA.en[key] ?? STRINGS.en[key] ?? fallback ?? key
}

export function guidance(lang, regionId) {
  const set = GUIDANCE[lang] ?? GUIDANCE.en
  return set[regionId] ?? set.idle
}

// The 19 symptoms of the SmartCare intake form, in its order, with the body
// region each belongs to (from SYMPTOM_REF_DATA). Codes are CareCrypt's ref.symptoms codes.
export const SYMPTOMS = [
  { code: 'fever', emoji: '🌡️', region: 'systemic', regionKey: 'reftable.region.systemic' },
  { code: 'cough', emoji: '😷', region: 'chest', regionKey: 'reftable.region.chest' },
  { code: 'breathlessness', emoji: '😮‍💨', region: 'chest', regionKey: 'reftable.region.chest' },
  { code: 'chest_pain', emoji: '💔', region: 'chest', regionKey: 'reftable.region.chest' },
  { code: 'headache', emoji: '🤕', region: 'head', regionKey: 'reftable.region.head' },
  { code: 'rash', emoji: '🔴', region: 'systemic', regionKey: 'reftable.region.systemic' },
  { code: 'diarrhea', emoji: '💩', region: 'abdomen', regionKey: 'reftable.region.abdomen' },
  { code: 'vomiting', emoji: '🤮', region: 'abdomen', regionKey: 'reftable.region.abdomen' },
  { code: 'abdominal_pain', emoji: '🤢', region: 'abdomen', regionKey: 'reftable.region.abdomen' },
  { code: 'fatigue', emoji: '😴', region: 'systemic', regionKey: 'reftable.region.systemic' },
  { code: 'body_ache', emoji: '💪', region: 'systemic', regionKey: 'reftable.region.systemic' },
  { code: 'sore_throat', emoji: '🗣️', region: 'neck', regionKey: 'reftable.region.neck' },
  { code: 'joint_pain', emoji: '🦴', region: 'leftArm', regionKey: 'reftable.region.limbs' },
  { code: 'nausea', emoji: '😵', region: 'abdomen', regionKey: 'reftable.region.abdomen' },
  { code: 'dizziness', emoji: '💫', region: 'head', regionKey: 'reftable.region.head' },
  { code: 'confusion', emoji: '😵‍💫', region: 'head', regionKey: 'reftable.region.head' },
  { code: 'swelling', emoji: '🎈', region: 'rightLeg', regionKey: 'reftable.region.leg' },
  { code: 'palpitations', emoji: '❤️', region: 'chest', regionKey: 'reftable.region.chest' },
  { code: 'high_bp', emoji: '📈', region: 'chest', regionKey: 'reftable.region.chest' },
]

// Symptoms offered when a body region is clicked (bodyRegionMap in the original).
export const REGION_SYMPTOMS = {
  head: ['headache', 'dizziness', 'confusion', 'fever'],
  neck: ['sore_throat', 'cough'],
  chest: ['chest_pain', 'breathlessness', 'cough', 'palpitations'],
  abdomen: ['abdominal_pain', 'vomiting', 'diarrhea', 'nausea'],
  leftArm: ['joint_pain', 'body_ache', 'rash'],
  rightArm: ['joint_pain', 'body_ache', 'rash'],
  leftLeg: ['joint_pain', 'swelling', 'body_ache', 'rash'],
  rightLeg: ['joint_pain', 'swelling', 'body_ache', 'rash'],
  systemic: ['fever', 'fatigue', 'rash', 'body_ache'],
}

// Chronic conditions of the intake form → the keys SmartCare weights.
export const HISTORY_OPTIONS = [
  ['diabetes', 'history.diabetes', 'Diabetes'],
  ['hypertension', 'history.hypertension', 'Hypertension'],
  ['heart_disease', 'history.heart_disease', 'Heart Disease'],
  ['asthma', 'history.asthma', 'Asthma/COPD'],
  ['kidney_disease', 'history.kidney_disease', 'Kidney Disease'],
  ['cancer', 'history.cancer', 'Cancer'],
]

// Vital sign fields with the original guardrails (values outside are refused
// before analysis) and the ranges drawn by the vitals visualiser.
export const VITALS = [
  { key: 'systolic', name: 'BP systolic', label: 'ws.vitals.bp_systolic', placeholder: 120, min: 40, max: 300, normal: [90, 139], critical: [80, 180], unit: 'mmHg' },
  { key: 'diastolic', name: 'BP diastolic', label: 'ws.vitals.bp_diastolic', placeholder: 80, min: 30, max: 200, normal: [60, 89], critical: [50, 120], unit: 'mmHg' },
  { key: 'pulseBpm', name: 'Heart rate', label: 'ws.vitals.pulse', placeholder: 72, min: 20, max: 250, normal: [60, 100], critical: [40, 130], unit: 'bpm' },
  { key: 'temperatureC', name: 'Temperature', label: 'ws.vitals.temp', placeholder: 37, min: 30, max: 45, step: 0.1, normal: [36.1, 37.5], critical: [35, 39.5], unit: '°C' },
  { key: 'spo2Percent', name: 'SpO2', label: 'ws.vitals.spo2', placeholder: 98, min: 50, max: 100, normal: [95, 100], critical: [90, 100], unit: '%' },
  { key: 'respiratoryRate', name: 'Resp. rate', label: 'ws.vitals.rr', placeholder: 16, min: 4, max: 80, normal: [12, 20], critical: [8, 28], unit: '/min' },
]

// 'normal' | 'warning' | 'critical' for a vital value.
export function vitalStatus(v, value) {
  if (value === '' || value === null || value === undefined) return null
  const n = Number(value)
  if (n < v.critical[0] || n > v.critical[1]) return 'critical'
  if (n < v.normal[0] || n > v.normal[1]) return 'warning'
  return 'normal'
}

// ---- Voice: keyword detection in English, Hindi and Marathi (voice-handler.js).
const KEYWORDS = {
  fever: ['fever', 'feverish', 'temperature', 'shivering', 'बुखार', 'ताप', 'taap'],
  cough: ['cough', 'coughing', 'khasi', 'khokla', 'खांसी', 'खोकला', 'khokle'],
  breathlessness: ['breathlessness', 'short of breath', 'breathing difficulty', 'saans', 'सांस', 'दम', 'श्वास'],
  chest_pain: ['chest pain', 'chest tightness', 'sine mein dard', 'chhatit dukhne', 'सीने में दर्द', 'छातीत दुखणे'],
  headache: ['headache', 'head pain', 'migraine', 'sar dard', 'doke dukhi', 'सिर दर्द', 'डोकेदुखी', 'डोके दुखणे'],
  rash: ['rash', 'red spots', 'दाने', 'पुरळ', 'rashes', 'khaj'],
  diarrhea: ['diarrhea', 'diarrhoea', 'loose motions', 'दस्त', 'जुलाब', 'dast', 'julab'],
  vomiting: ['vomiting', 'throwing up', 'vomit', 'उल्टी', 'उलट्या', 'ulti'],
  abdominal_pain: ['abdominal pain', 'stomach ache', 'stomach pain', 'pet dard', 'pot dukhi', 'पेट दर्द', 'पोटदुखी', 'पोटात दुखणे'],
  fatigue: ['fatigue', 'tiredness', 'weakness', 'कमजोरी', 'थकान', 'थकवा', 'kamzori', 'thakan'],
  body_ache: ['body ache', 'body pain', 'बदन दर्द', 'अंगदुखी', 'badan dard', 'ang dukhi'],
  sore_throat: ['sore throat', 'throat pain', 'गले में दर्द', 'घसा दुखणे', 'gala kharab'],
  joint_pain: ['joint pain', 'joints', 'जोड़ों में दर्द', 'सांधेदुखी', 'sandhe dukhi'],
  nausea: ['nausea', 'feeling sick', 'जी मिचलाना', 'मळमळ', 'ji michlana', 'malmal'],
  dizziness: ['dizziness', 'dizzy', 'vertigo', 'चक्कर', 'chakkar', 'giddiness'],
  confusion: ['confusion', 'confused', 'disoriented', 'उलझन', 'गोंधळ'],
  swelling: ['swelling', 'swollen', 'सूजन', 'सूज', 'sujan'],
  palpitations: ['palpitations', 'palpitation', 'racing heart', 'धड़कन', 'धडधड', 'dhadkan'],
  high_bp: ['high bp', 'high blood pressure', 'hypertension', 'बीपी ज्यादा', 'बीपी जास्त'],
}
const NUMBERS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  एक: 1, दो: 2, तीन: 3, चार: 4, पांच: 5, छह: 6, सात: 7, आठ: 8, नौ: 9, दस: 10,
  दोन: 2, पाच: 5, सहा: 6, नऊ: 9, दहा: 10,
}
const NEGATION = /\b(no|not|without|denies|denied)\s+(\w+\s+){0,2}$/

// Returns { symptoms: Set<code>, durationDays: number|null } found in a transcript.
// English phrases preceded by "no", "not", "without" or "denies" are ignored.
export function scanTranscript(text) {
  const lower = (text ?? '').toLowerCase()
  const symptoms = new Set()
  for (const [code, words] of Object.entries(KEYWORDS)) {
    for (const w of words) {
      let from = 0
      let i
      while ((i = lower.indexOf(w.toLowerCase(), from)) !== -1) {
        if (!NEGATION.test(lower.slice(Math.max(0, i - 30), i))) {
          symptoms.add(code)
          break
        }
        from = i + w.length
      }
      if (symptoms.has(code)) break
    }
  }
  let durationDays = null
  const re = /(\d+|one|two|three|four|five|six|seven|eight|nine|ten|एक|दो|तीन|चार|पांच|छह|सात|आठ|नौ|दस|दोन|पाच|सहा|नऊ|दहा)\s*(days?|weeks?|दिन|हफ्ते|हफ़्ते|दिवस|आठवडे)/gi
  let m
  while ((m = re.exec(lower)) !== null) {
    const n = Number.parseInt(m[1], 10) || NUMBERS[m[1]] || 0
    if (n > 0) durationDays = /week|हफ्ते|हफ़्ते|आठवडे/.test(m[2]) ? n * 7 : n
  }
  return { symptoms, durationDays }
}
