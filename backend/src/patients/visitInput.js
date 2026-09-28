import { HttpError } from '../lib/httpError.js'

// Validates and normalises the body of POST /api/patients/:id/visits.
// Rules mirror the database constraints so errors come back as clear 400s.

const VISIT_TYPES = ['OPD', 'FOLLOW_UP', 'EMERGENCY', 'TELECONSULT']
const SYMPTOM_SEVERITIES = ['MILD', 'MODERATE', 'SEVERE']
const DIAGNOSIS_TYPES = ['PROVISIONAL', 'CONFIRMED', 'DIFFERENTIAL']
const ROUTES = ['ORAL', 'INHALED', 'TOPICAL', 'IV', 'IM', 'SC', 'OTHER']
const CODE = /^[a-z][a-z0-9_]*$/
const ICD10 = /^[A-Z][0-9]{2}(\.[0-9A-Z]{1,4})?$/

// [min, max, integer]
const VITALS = {
  temperatureC: [30, 45, false],
  pulseBpm: [20, 250, true],
  systolic: [50, 300, true],
  diastolic: [20, 200, true],
  respiratoryRate: [4, 80, true],
  spo2Percent: [50, 100, true],
  weightKg: [0.5, 400, false],
  heightCm: [30, 250, false],
}

const MAX_BACKDATE_DAYS = 30

export function parseNewVisit(body, now = new Date()) {
  const errors = []
  const fail = (field, message) => errors.push({ field, message })
  const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

  if (!isObject(body)) {
    throw validationError([{ field: 'body', message: 'Request body must be a JSON object.' }])
  }

  const text = (value, field, { max, required = false }) => {
    if (value === undefined || value === null || value === '') {
      if (required) fail(field, 'is required.')
      return null
    }
    if (typeof value !== 'string') return fail(field, 'must be text.'), null
    const trimmed = value.trim()
    if (required && trimmed === '') return fail(field, 'is required.'), null
    if (trimmed.length > max) return fail(field, `must be at most ${max} characters.`), null
    return trimmed || null
  }

  const intIn = (value, field, min, max) => {
    if (value === undefined || value === null || value === '') return null
    if (!Number.isInteger(value) || value < min || value > max) {
      fail(field, `must be a whole number from ${min} to ${max}.`)
      return null
    }
    return value
  }

  const oneOf = (value, field, allowed, fallback) => {
    if (value === undefined || value === null) return fallback
    if (!allowed.includes(value)) return fail(field, `must be one of ${allowed.join(', ')}.`), fallback
    return value
  }

  const list = (value, field, max) => {
    if (value === undefined || value === null) return []
    if (!Array.isArray(value)) return fail(field, 'must be a list.'), []
    if (value.length > max) return fail(field, `must have at most ${max} entries.`), []
    return value
  }

  // Visit details
  const visitType = oneOf(body.visitType, 'visitType', VISIT_TYPES, 'OPD')
  let visitAt = now
  if (body.visitAt !== undefined && body.visitAt !== null && body.visitAt !== '') {
    const parsed = typeof body.visitAt === 'string' ? new Date(body.visitAt) : new Date(NaN)
    if (Number.isNaN(parsed.getTime())) {
      fail('visitAt', 'must be a date and time.')
    } else if (parsed.getTime() > now.getTime() + 5 * 60 * 1000) {
      fail('visitAt', 'cannot be in the future.')
    } else if (parsed.getTime() < now.getTime() - MAX_BACKDATE_DAYS * 24 * 3600 * 1000) {
      fail('visitAt', `cannot be more than ${MAX_BACKDATE_DAYS} days in the past.`)
    } else {
      visitAt = parsed
    }
  }
  const chiefComplaint = text(body.chiefComplaint, 'chiefComplaint', { max: 500, required: true })
  const notes = text(body.notes, 'notes', { max: 4000 })

  // Vitals
  const vitals = {}
  if (body.vitals !== undefined && body.vitals !== null) {
    if (!isObject(body.vitals)) {
      fail('vitals', 'must be an object.')
    } else {
      for (const [key, value] of Object.entries(body.vitals)) {
        const rule = VITALS[key]
        if (!rule) {
          fail(`vitals.${key}`, 'is not a recognised vital sign.')
          continue
        }
        if (value === null || value === undefined || value === '') continue
        const [min, max, integer] = rule
        if (typeof value !== 'number' || !Number.isFinite(value) || (integer && !Number.isInteger(value)) || value < min || value > max) {
          fail(`vitals.${key}`, `must be ${integer ? 'a whole number' : 'a number'} from ${min} to ${max}.`)
          continue
        }
        vitals[key] = integer ? value : Math.round(value * 10) / 10
      }
      const hasSys = vitals.systolic !== undefined
      const hasDia = vitals.diastolic !== undefined
      if (hasSys !== hasDia) fail('vitals', 'systolic and diastolic blood pressure must be given together.')
      if (hasSys && hasDia && vitals.systolic <= vitals.diastolic) {
        fail('vitals', 'systolic pressure must be higher than diastolic.')
      }
    }
  }

  // Symptoms
  const symptoms = []
  list(body.symptoms, 'symptoms', 30).forEach((s, i) => {
    const f = `symptoms[${i}]`
    if (!isObject(s)) return fail(f, 'must be an object.')
    if (typeof s.code !== 'string' || !CODE.test(s.code)) return fail(`${f}.code`, 'must be a symptom code.')
    symptoms.push({
      code: s.code,
      severity: oneOf(s.severity, `${f}.severity`, SYMPTOM_SEVERITIES, 'MODERATE'),
      durationDays: intIn(s.durationDays, `${f}.durationDays`, 0, 3650),
    })
  })
  duplicates(symptoms, 'symptoms', fail)

  // Diagnoses: at least one, exactly one primary, and the primary cannot be a differential.
  const diagnoses = []
  const rawDiagnoses = list(body.diagnoses, 'diagnoses', 10)
  if (rawDiagnoses.length === 0) fail('diagnoses', 'at least one diagnosis is required.')
  rawDiagnoses.forEach((d, i) => {
    const f = `diagnoses[${i}]`
    if (!isObject(d)) return fail(f, 'must be an object.')
    if (typeof d.code !== 'string' || !ICD10.test(d.code)) return fail(`${f}.code`, 'must be an ICD-10 code.')
    const type = oneOf(d.type, `${f}.type`, DIAGNOSIS_TYPES, 'PROVISIONAL')
    const isPrimary = d.isPrimary === true
    if (isPrimary && type === 'DIFFERENTIAL') fail(`${f}.type`, 'a primary diagnosis cannot be a differential.')
    diagnoses.push({ code: d.code, type, isPrimary, notes: text(d.notes, `${f}.notes`, { max: 300 }) })
  })
  if (rawDiagnoses.length > 0 && diagnoses.filter((d) => d.isPrimary).length !== 1) {
    fail('diagnoses', 'exactly one diagnosis must be marked primary.')
  }
  duplicates(diagnoses, 'diagnoses', fail)

  // Medications
  const medications = []
  list(body.medications, 'medications', 20).forEach((m, i) => {
    const f = `medications[${i}]`
    if (!isObject(m)) return fail(f, 'must be an object.')
    if (typeof m.code !== 'string' || !CODE.test(m.code)) return fail(`${f}.code`, 'must be a medication code.')
    medications.push({
      code: m.code,
      dose: text(m.dose, `${f}.dose`, { max: 100, required: true }),
      frequency: text(m.frequency, `${f}.frequency`, { max: 100, required: true }),
      route: oneOf(m.route, `${f}.route`, ROUTES, 'ORAL'),
      durationDays: intIn(m.durationDays, `${f}.durationDays`, 1, 365),
      instructions: text(m.instructions, `${f}.instructions`, { max: 300 }),
    })
  })
  duplicates(medications, 'medications', fail)

  // The clinician must explicitly submit the assessment as their own judgement.
  if (body.clinicianAttestation !== true) {
    fail('clinicianAttestation', 'must be true: confirm that the assessment is your own clinical judgement.')
  }

  // Optional link to a SmartCare Assist run the clinician reviewed.
  let decisionSupport = null
  if (body.decisionSupport !== undefined && body.decisionSupport !== null) {
    const ds = body.decisionSupport
    if (!isObject(ds)) {
      fail('decisionSupport', 'must be an object.')
    } else {
      if (!UUID.test(ds.analysisId ?? '')) fail('decisionSupport.analysisId', 'must be the analysisId returned by SmartCare.')
      if (ds.reviewed !== true) fail('decisionSupport.reviewed', 'must be true: decision support is linked only after review.')
      if (UUID.test(ds.analysisId ?? '') && ds.reviewed === true) decisionSupport = { analysisId: ds.analysisId.toLowerCase() }
    }
  }

  if (errors.length > 0) throw validationError(errors)
  return { visitType, visitAt, chiefComplaint, notes, vitals, symptoms, diagnoses, medications, decisionSupport }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function duplicates(items, field, fail) {
  const seen = new Set()
  for (const { code } of items) {
    if (seen.has(code)) fail(field, `${code} is listed more than once.`)
    seen.add(code)
  }
}

export function validationError(details) {
  return new HttpError(400, 'VALIDATION_FAILED', 'The visit could not be saved.', {
    body: { error: 'VALIDATION_FAILED', message: 'The visit could not be saved.', details },
  })
}
