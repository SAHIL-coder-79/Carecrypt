import { assess, ENGINE, label } from './engine.js'

// Translates between CareCrypt's data model and SmartCare Assist, and adds the
// context-aware layer: previous diagnoses, visit history and medication history
// shape both the engine input and the risk indicators returned.

export const DISCLAIMER = 'Decision support only. Final clinical judgment remains with the clinician.'
export const OUTPUT_LABEL = 'Clinical Decision Support'

const DAY = 86_400_000

// ICD-10 (CareCrypt) → SmartCare comorbidity keys used in its risk weights.
const HISTORY_KEYS = [
  [/^E1[0-4]/, 'diabetes'],
  [/^I1[0-5]/, 'hypertension'],
  [/^I2[0-5]|^I50/, 'heart_disease'],
  [/^J45/, 'asthma'],
  [/^J44/, 'copd'],
  [/^N18/, 'kidney_disease'],
  [/^C/, 'cancer'],
  [/^B2[0-4]/, 'immunocompromised'],
]
const WEIGHTED_KEYS = new Set(['diabetes', 'hypertension', 'heart_disease', 'asthma', 'kidney_disease', 'cancer', 'immunocompromised'])
const ENGINE_HISTORY_KEYS = new Set([...WEIGHTED_KEYS, 'copd', 'pregnancy'])

// CareCrypt medication codes → SmartCare drug-interaction keys.
const MEDICATION_KEYS = { metformin: 'metformin', atorvastatin: 'statins', aspirin: 'aspirin', warfarin: 'warfarin' }

// SmartCare treatment options → drug classes that a recorded drug allergy may rule out.
const TREATMENT_DRUG_CLASSES = {
  'treatment.aspirin': ['NSAID'],
  'treatment.nsaids': ['NSAID'],
  'treatment.antibiotics': ['PENICILLIN', 'MACROLIDE', 'SULFONAMIDE'],
  'treatment.antibiotics_uti': ['NITROFURAN', 'SULFONAMIDE'],
}

// SmartCare condition groups → related ICD-10 codes in the CareCrypt catalogue.
const RELATED_CODES = {
  respiratory_infection: ['J06.9', 'J18.9'],
  acute_gastroenteritis: ['A09'],
  urinary_tract_infection_pyelo: ['N39.0'],
  hypertensive_emergency: ['I10'],
  diabetic_emergency: ['E11.9'],
  musculoskeletal_pain: ['M54.5'],
  migraine: ['G43.9'],
}

const RISK_LEVEL = { Red: 'HIGH', Amber: 'MODERATE', Green: 'LOW' }

const conditionName = (code) => {
  const text = label(`condition.${code}`)
  return text === `condition.${code}` || text.toLowerCase() === code.replace(/_/g, ' ') ? titleize(code) : text
}
const titleize = (code) => {
  const s = code.replace(/_/g, ' ')
  return code === 'common_illness' ? 'Common or non-specific illness' : s.charAt(0).toUpperCase() + s.slice(1)
}
const fmtDate = (d) => new Date(d).toISOString().slice(0, 10)

/**
 * @param {object} request   validated API input
 * @param {object} context   from loadPatientContext()
 * @param {Date}   now
 */
export function analyze(request, context, now = new Date()) {
  const { patient } = context
  const visits = context.visits ?? []

  // ---- History: recorded (chronic conditions + confirmed/provisional diagnoses) and clinician-reported
  const recordedCodes = new Set(context.chronicConditions.map((c) => c.condition_code))
  const previousDiagnoses = []
  for (const v of visits) {
    for (const d of v.diagnoses) {
      if (d.type === 'DIFFERENTIAL') continue
      previousDiagnoses.push({ code: d.code, name: d.name, date: fmtDate(v.visit_at) })
    }
  }
  const historyKeys = new Set()
  for (const code of [...recordedCodes, ...request.relevantHistory]) {
    if (ENGINE_HISTORY_KEYS.has(code)) historyKeys.add(code)
    for (const [pattern, key] of HISTORY_KEYS) if (pattern.test(code)) historyKeys.add(key)
  }
  if (request.pregnant && patient.gender === 'FEMALE') historyKeys.add('pregnancy')

  // ---- Medications: currently active + clinician-reported
  const medicationCodes = new Set([...context.activeMedications.map((m) => m.medication_code), ...request.medications])
  const engineMedications = [...medicationCodes].map((c) => MEDICATION_KEYS[c] ?? c)

  // ---- Current encounter
  const symptomCodes = request.currentSymptoms.map((s) => s.code)
  const severity = request.currentSymptoms.some((s) => s.severity === 'SEVERE')
    ? 'High'
    : request.currentSymptoms.some((s) => s.severity === 'MODERATE')
      ? 'Medium'
      : 'Low'
  const duration = Math.max(0, ...request.currentSymptoms.map((s) => s.durationDays ?? 0))
  const v = request.vitals
  const engineVitals = {
    ...(v.temperatureC != null && { temperature: v.temperatureC }),
    ...(v.pulseBpm != null && { heart_rate: v.pulseBpm }),
    ...(v.respiratoryRate != null && { respiratory_rate: v.respiratoryRate }),
    ...(v.spo2Percent != null && { spo2: v.spo2Percent }),
    ...(v.systolic != null && { bp_systolic: v.systolic, bp_diastolic: v.diastolic, bp: `${v.systolic}/${v.diastolic}` }),
  }

  const raw = assess({
    age: patient.age_years,
    symptoms: symptomCodes,
    severity,
    duration,
    vitals: engineVitals,
    medicalHistory: [...historyKeys],
    currentMedications: engineMedications,
    allergies: context.allergies.map((a) => a.allergen),
  })

  // ---- Possible conditions (never a diagnosis)
  const ordered = [...raw.differential]
  if (!ordered.some((d) => d.code === raw.base.conditionCode) && raw.base.conditionCode !== 'undifferentiated') {
    ordered.unshift({ code: raw.base.conditionCode, matchScore: (raw.base.confidence ?? 0) / 100 })
  }
  const possibleConditions = ordered.slice(0, 3).map((d) => {
    const related = RELATED_CODES[d.code] ?? []
    const seenBefore = uniqueBy(
      previousDiagnoses.filter((p) => related.includes(p.code)),
      (p) => `${p.code}|${p.date}`,
    )
    return {
      code: d.code,
      name: conditionName(d.code),
      symptomMatch: Math.round(d.matchScore * 100),
      strength: d.matchScore >= 1 ? 'Strong symptom match' : d.matchScore >= 0.5 ? 'Partial symptom match' : 'Weak symptom match',
      relatedCodes: related,
      previouslyRecorded: seenBefore.slice(0, 3),
    }
  })

  // ---- Risk indicators: current presentation, then longitudinal context
  const riskIndicators = []
  const add = (level, source, message) => riskIndicators.push({ level, source, message })

  for (const f of raw.base.vitalFindings) add(f.startsWith('CRITICAL') ? 'HIGH' : 'MODERATE', 'vitals', f)
  for (const r of raw.maternal.reasons ?? []) add('HIGH', 'history', label(r))

  for (const c of context.chronicConditions) {
    const keys = HISTORY_KEYS.filter(([p]) => p.test(c.condition_code)).map(([, k]) => k)
    const weighted = keys.some((k) => WEIGHTED_KEYS.has(k))
    add(
      weighted ? 'MODERATE' : 'INFO',
      'history',
      `Known ${c.name}${c.onset_date ? ` since ${c.onset_date.slice(0, 4)}` : ''}${weighted ? '; factored into the risk score' : ''}.`,
    )
  }

  // Similar or returning presentation within 90 days.
  const current = new Set(symptomCodes)
  for (const past of visits) {
    const age = (now - new Date(past.visit_at)) / DAY
    if (age > 90) break
    const overlap = past.symptoms.filter((s) => current.has(s.code)).map((s) => s.name)
    if (overlap.length >= 2 || (overlap.length === 1 && current.size === 1)) {
      const primary = past.diagnoses.find((d) => d.isPrimary)
      const days = Math.max(0, Math.round(age))
      add(
        days <= 14 ? 'HIGH' : 'MODERATE',
        'visit_history',
        `Similar symptoms (${overlap.join(', ')}) ${days} days ago on ${fmtDate(past.visit_at)}${
          primary ? `, recorded as ${primary.name}` : ''
        }. Consider non-resolution, recurrence or complication.`,
      )
      break
    }
  }

  // Recent emergency presentation.
  const recentEmergency = visits.find((x) => x.visit_type === 'EMERGENCY' && (now - new Date(x.visit_at)) / DAY <= 30)
  if (recentEmergency) {
    add('MODERATE', 'visit_history', `Emergency visit on ${fmtDate(recentEmergency.visit_at)} within the last 30 days.`)
  }

  // Blood pressure trend across recorded visits.
  if (v.systolic != null) {
    const previous = visits.filter((x) => x.systolic_bp_mmhg != null).slice(0, 3)
    if (v.systolic >= 140 && previous.length >= 2 && previous.every((x) => x.systolic_bp_mmhg >= 140)) {
      add(
        'MODERATE',
        'visit_history',
        `Blood pressure elevated at this and the last ${previous.length} recorded visits (${previous
          .map((x) => `${x.systolic_bp_mmhg}/${x.diastolic_bp_mmhg}`)
          .join(', ')}).`,
      )
    }
  }

  for (const w of raw.base.warnings) add('HIGH', 'medication', w)

  // ---- Recommendations
  const allergyClasses = new Map(context.allergies.filter((a) => a.drug_class).map((a) => [a.drug_class, a]))
  const recommendations = []
  for (const key of raw.escalation.suggestedActions) recommendations.push({ type: 'ACTION', text: label(key) })
  for (const key of raw.base.labTests) recommendations.push({ type: 'INVESTIGATION', text: label(key) })
  for (const key of raw.base.treatments) {
    const conflicts = (TREATMENT_DRUG_CLASSES[key] ?? []).map((cls) => allergyClasses.get(cls)).filter(Boolean)
    const rec = { type: 'TREATMENT_OPTION', text: label(key) }
    if (conflicts.length > 0) {
      rec.caution = `Recorded allergy: ${conflicts.map((a) => `${a.allergen} (${a.severity.toLowerCase().replace('_', '-')})`).join(', ')}. Choose an agent from another class.`
      add('HIGH', 'allergy', `${label(key)}: patient has a recorded ${conflicts.map((a) => a.allergen).join(', ')} allergy.`)
    }
    recommendations.push(rec)
  }

  // ---- Engine reasoning, with SmartCare keys turned into text
  const topName = conditionName(raw.base.conditionCode)
  // SmartCare calls its symptom-rule match "confidence"; say what it is.
  const reasoning = [...new Set(raw.escalation.allReasons)].map((r) =>
    label(r)
      .replace('aligns with undefined', `aligns with ${topName}`)
      .replace('possible undefined', `possible ${topName}`)
      .replace(/\((\d+)% confidence\)/, '($1% symptom-pattern match)'),
  )

  return {
    label: OUTPUT_LABEL,
    patientId: patient.id,
    generatedAt: now.toISOString(),
    engine: ENGINE,
    possibleConditions,
    riskIndicators,
    overallRisk: {
      level: RISK_LEVEL[raw.escalation.riskColor] ?? 'LOW',
      color: raw.escalation.riskColor,
      score: raw.escalation.finalScore,
      urgency: raw.escalation.urgency,
      escalationSuggested: ['Critical', 'High'].includes(raw.escalation.urgency),
    },
    recommendations,
    confidence: {
      score: raw.confidence.dci.score,
      level: raw.confidence.confidenceLevel,
      meaning: 'How complete and consistent the input is, not the probability of a condition.',
      components: raw.confidence.dci.components,
    },
    reasoning,
    // Engine detail behind the headline, for the decision-support workspace:
    // score breakdown, vital findings and the maternal pathway.
    assessment: {
      severity,
      durationDays: duration,
      symptomsAnalysed: symptomCodes,
      baseRiskScore: raw.base.score,
      urgency: raw.escalation.urgency,
      vitalFindings: raw.base.vitalFindings.map(label),
      scoreBreakdown: raw.base.reasoningLog.map((r) => ({ factor: r.modifier, impact: r.impact, reason: label(r.reason) })),
      maternal: {
        applicable: raw.maternal.isMaternal,
        scoreModifier: raw.maternal.riskScoreModifier,
        reasons: raw.maternal.reasons.map(label),
      },
      suggestedActions: raw.escalation.suggestedActions.map(label),
    },
    contextUsed: {
      consentScope: context.scope,
      chronicConditions: context.chronicConditions.map((c) => ({ code: c.condition_code, name: c.name })),
      previousDiagnoses: dedupe(previousDiagnoses).slice(0, 8),
      visitsConsidered: visits.length,
      activeMedications: [...new Set(context.activeMedications.map((m) => m.generic_name))],
      allergies: context.allergies.map((a) => a.allergen),
      clinicianReported: { history: request.relevantHistory, medications: request.medications },
      withheldByConsent: context.visits === null ? ['visit history', 'previous diagnoses'] : [],
    },
    disclaimer: DISCLAIMER,
  }
}

function uniqueBy(items, key) {
  const seen = new Set()
  return items.filter((item) => (seen.has(key(item)) ? false : seen.add(key(item))))
}

function dedupe(diagnoses) {
  const seen = new Set()
  return diagnoses.filter((d) => (seen.has(d.code) ? false : seen.add(d.code)))
}
