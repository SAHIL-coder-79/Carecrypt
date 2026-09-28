// Advanced Rule-based AI engine for healthcare decision support
// Core Risk Logic: Condition matching, Vitals, Drug Interactions, Base Scoring

// Knowledge base for conditions
const CONDITIONS_DB = {
  respiratory_infection: {
    key: 'condition.respiratory_infection',
    triggers: [['fever', 'cough', 'breathlessness'], ['fever', 'cough', 'chest_pain'], ['cough', 'breathlessness', 'chest_pain']],
    treatments: ['treatment.rest', 'treatment.antipyretics', 'treatment.monitor_oxygen', 'treatment.antibiotics'],
    labTests: ['lab.cbc', 'lab.cxr', 'lab.covid', 'lab.sputum'],
    urgency: 'high'
  },
  infectious_exanthem: {
    key: 'condition.infectious_exanthem',
    triggers: [['fever', 'rash'], ['fever', 'rash', 'itching']],
    treatments: ['treatment.symptomatic', 'treatment.antihistamines', 'treatment.hydration', 'treatment.isolate'],
    labTests: ['lab.cbc', 'lab.viral_panel'],
    urgency: 'medium'
  },
  acute_gastroenteritis: {
    key: 'condition.acute_gastroenteritis',
    triggers: [['diarrhea', 'vomiting'], ['diarrhea', 'fever'], ['vomiting', 'abdominal_pain'], ['nausea', 'vomiting', 'diarrhea']],
    treatments: ['treatment.ort', 'treatment.brat', 'treatment.antiemetics', 'treatment.dehydration_monitor'],
    labTests: ['lab.stool', 'lab.electrolytes'],
    urgency: 'medium'
  },
  cardiorespiratory_concern: {
    key: 'condition.cardiorespiratory_concern',
    triggers: [['chest_pain', 'breathlessness'], ['chest_pain', 'sweating'], ['chest_pain', 'arm_pain'], ['palpitations', 'chest_pain'], ['palpitations', 'breathlessness'], ['chest_pain', 'nausea', 'sweating']],
    treatments: ['treatment.urgent_attention', 'treatment.aspirin', 'treatment.oxygen', 'treatment.ecg_monitor'],
    labTests: ['lab.troponin', 'lab.ddimer', 'lab.ecg', 'lab.cxr', 'lab.ctpa'],
    urgency: 'critical'
  },
  possible_systemic_infection: {
    key: 'condition.possible_systemic_infection',
    triggers: [['headache', 'fever', 'neck_stiffness'], ['headache', 'fever', 'photophobia'], ['fever', 'confusion', 'dizziness'], ['fever', 'severe_bleeding']],
    treatments: ['treatment.urgent_eval', 'treatment.antipyretics', 'treatment.iv_fluids', 'treatment.antibiotics'],
    labTests: ['lab.cbc', 'lab.blood_cultures', 'lab.lp', 'lab.crp'],
    urgency: 'critical'
  },
  urinary_tract_infection_pyelo: {
    key: 'condition.urinary_tract_infection_pyelo',
    triggers: [['dysuria', 'frequency'], ['dysuria', 'fever'], ['back_pain', 'fever', 'dysuria'], ['frequency', 'back_pain']],
    treatments: ['treatment.antibiotics_uti', 'treatment.fluids', 'treatment.analgesics'],
    labTests: ['lab.urinalysis', 'lab.urine_culture', 'lab.renal_function'],
    urgency: 'medium'
  },
  hypertensive_emergency: {
    key: 'condition.hypertensive_emergency',
    triggers: [['headache', 'blurred_vision'], ['chest_pain', 'headache'], ['headache', 'swelling', 'blurred_vision']],
    treatments: ['treatment.bp_control', 'treatment.iv_antihypertensives', 'treatment.monitoring', 'treatment.cause_identification'],
    labTests: ['lab.renal_function', 'lab.ecg', 'lab.fundoscopy', 'lab.ct_head'],
    urgency: 'critical'
  },
  diabetic_emergency: {
    key: 'condition.diabetic_emergency',
    triggers: [['vomiting', 'abdominal_pain', 'confusion'], ['excessive_thirst', 'frequent_urination'], ['confusion', 'shaking_trembling', 'sweating']],
    treatments: ['treatment.iv_fluids', 'treatment.insulin', 'treatment.electrolytes', 'treatment.glucose_monitor'],
    labTests: ['lab.glucose', 'lab.abg', 'lab.electrolytes', 'lab.ketones', 'lab.renal_function'],
    urgency: 'critical'
  },
  anaphylaxis: {
    key: 'condition.anaphylaxis',
    triggers: [['rash', 'swelling'], ['breathlessness', 'rash'], ['swelling', 'difficulty_swallowing'], ['rash', 'nausea', 'breathlessness']],
    treatments: ['treatment.antihistamines', 'treatment.epinephrine', 'treatment.corticosteroids', 'treatment.allergen_removal'],
    labTests: ['lab.tryptase', 'lab.ige'],
    urgency: 'high'
  },
  vestibular_neurological: {
    key: 'condition.vestibular_neurological',
    triggers: [['dizziness', 'blurred_vision'], ['dizziness', 'headache', 'nausea'], ['shaking_trembling', 'dizziness']],
    treatments: ['treatment.stroke_eval', 'treatment.vestibular_suppressants', 'treatment.neuro_consult'],
    labTests: ['lab.mri_ct', 'lab.audiometry'],
    urgency: 'high'
  },
  musculoskeletal_pain: {
    key: 'condition.musculoskeletal_pain',
    triggers: [['joint_pain'], ['back_pain'], ['muscle_pain'], ['joint_pain', 'muscle_pain']],
    treatments: ['treatment.nsaids', 'treatment.rest', 'treatment.heat_ice', 'treatment.physio'],
    labTests: ['lab.xray_trauma', 'lab.esr_crp'],
    urgency: 'low'
  },
  anxiety_panic: {
    key: 'condition.anxiety_panic',
    triggers: [['palpitations', 'sweating', 'trembling'], ['breathlessness', 'chest_tightness'], ['palpitations', 'dizziness', 'breathlessness']],
    treatments: ['treatment.reassurance', 'treatment.breathing', 'treatment.anxiolytics', 'treatment.mental_health'],
    labTests: ['lab.tft', 'lab.ecg'],
    urgency: 'low'
  },
  migraine: {
    key: 'condition.migraine',
    triggers: [['headache', 'nausea'], ['headache', 'photophobia'], ['headache', 'aura'], ['headache', 'dizziness'], ['headache', 'blurred_vision']],
    treatments: ['treatment.triptans', 'treatment.nsaids', 'treatment.rest_dark', 'treatment.hydration', 'treatment.antiemetics'],
    labTests: ['lab.ct_mri_redflags'],
    urgency: 'low'
  },
  common_illness: {
    key: 'condition.common_illness',
    triggers: [['fatigue'], ['body_ache'], ['sore_throat'], ['nausea'], ['runny_nose'], ['fatigue', 'body_ache']],
    treatments: ['treatment.rest', 'treatment.hydration', 'treatment.antipyretics'],
    labTests: ['lab.cbc'],
    urgency: 'low'
  }
};

// Drug interaction database (simplified)
const DRUG_INTERACTIONS = {
  'aspirin': ['warfarin', 'ibuprofen', 'clopidogrel'],
  'warfarin': ['aspirin', 'nsaids', 'antibiotics'],
  'metformin': ['contrast_dye', 'alcohol'],
  'ace_inhibitors': ['potassium', 'nsaids', 'lithium'],
  'ssri': ['maoi', 'tramadol', 'triptans'],
  'statins': ['grapefruit', 'fibrates', 'macrolides']
};

// Vital signs normal ranges
const VITAL_RANGES = {
  bp_systolic: { low: 90, normal_low: 100, normal_high: 130, high: 140, critical_high: 180 },
  bp_diastolic: { low: 60, normal_low: 65, normal_high: 85, high: 90, critical_high: 120 },
  heart_rate: { low: 50, normal_low: 60, normal_high: 100, high: 110, critical_high: 150 },
  temperature: { low: 35.5, normal_low: 36.1, normal_high: 37.2, high: 38, critical_high: 40 },
  spo2: { critical_low: 90, low: 94, normal: 95 },
  respiratory_rate: { low: 10, normal_low: 12, normal_high: 20, high: 25, critical_high: 30 }
};

// Analyze vitals and return risk factors
function analyzeVitals(vitals = {}) {
  const findings = [];
  let vitalScore = 0;

  if (vitals.bp_systolic) {
    if (vitals.bp_systolic >= VITAL_RANGES.bp_systolic.critical_high) {
      findings.push('CRITICAL: Severely elevated blood pressure');
      vitalScore += 40;
    } else if (vitals.bp_systolic >= VITAL_RANGES.bp_systolic.high) {
      findings.push('Elevated blood pressure');
      vitalScore += 15;
    } else if (vitals.bp_systolic < VITAL_RANGES.bp_systolic.low) {
      findings.push('Low blood pressure - possible hypotension');
      vitalScore += 20;
    }
  }

  if (vitals.heart_rate) {
    if (vitals.heart_rate >= VITAL_RANGES.heart_rate.critical_high) {
      findings.push('CRITICAL: Severe tachycardia');
      vitalScore += 35;
    } else if (vitals.heart_rate >= VITAL_RANGES.heart_rate.high) {
      findings.push('Tachycardia (elevated heart rate)');
      vitalScore += 15;
    } else if (vitals.heart_rate < VITAL_RANGES.heart_rate.low) {
      findings.push('Bradycardia (low heart rate)');
      vitalScore += 20;
    }
  }

  if (vitals.temperature) {
    if (vitals.temperature >= VITAL_RANGES.temperature.critical_high) {
      findings.push('CRITICAL: High fever (hyperpyrexia)');
      vitalScore += 35;
    } else if (vitals.temperature >= VITAL_RANGES.temperature.high) {
      findings.push('Fever present');
      vitalScore += 10;
    } else if (vitals.temperature < VITAL_RANGES.temperature.low) {
      findings.push('Hypothermia');
      vitalScore += 25;
    }
  }

  if (vitals.spo2) {
    if (vitals.spo2 < VITAL_RANGES.spo2.critical_low) {
      findings.push('CRITICAL: Severe hypoxia - immediate oxygen needed');
      vitalScore += 50;
    } else if (vitals.spo2 < VITAL_RANGES.spo2.low) {
      findings.push('Low oxygen saturation - supplemental oxygen may be needed');
      vitalScore += 25;
    }
  }

  if (vitals.respiratory_rate) {
    if (vitals.respiratory_rate >= VITAL_RANGES.respiratory_rate.critical_high) {
      findings.push('CRITICAL: Severe tachypnea');
      vitalScore += 30;
    } else if (vitals.respiratory_rate >= VITAL_RANGES.respiratory_rate.high) {
      findings.push('Elevated respiratory rate');
      vitalScore += 15;
    }
  }

  return { findings, vitalScore };
}

// Check for drug interactions
function checkDrugInteractions(currentMedications = [], proposedTreatments = []) {
  const warnings = [];
  const meds = currentMedications.map(m => m.toLowerCase());

  for (const med of meds) {
    const interactions = DRUG_INTERACTIONS[med] || [];
    for (const treatment of proposedTreatments) {
      const treatmentLower = treatment.toLowerCase();
      for (const interaction of interactions) {
        if (treatmentLower.includes(interaction)) {
          warnings.push(`Potential interaction: ${med} with ${treatment}`);
        }
      }
    }
  }

  return warnings;
}

// Match symptoms to conditions with confidence scoring
function matchCondition(symptoms) {
  const s = new Set(symptoms || []);
  if (s.size === 0) return { code: 'undifferentiated', name: 'Undifferentiated complaint', confidence: 0, urgency: 'low', treatments: [], labTests: [] };

  const matches = [];

  for (const [code, data] of Object.entries(CONDITIONS_DB)) {
    let bestMatchInTriggers = 0;
    for (const trigger of data.triggers) {
      const matchedCount = trigger.filter(t => s.has(t)).length;
      const ratio = matchedCount / trigger.length;
      if (ratio > bestMatchInTriggers) bestMatchInTriggers = ratio;
    }

    if (bestMatchInTriggers > 0) {
      matches.push({ code, ...data, matchScore: bestMatchInTriggers });
    }
  }

  // Sort by match score and then by urgency
  matches.sort((a, b) => {
    if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
    const urgencyMap = { critical: 4, high: 3, medium: 2, low: 1 };
    return urgencyMap[b.urgency] - urgencyMap[a.urgency];
  });

  if (matches.length > 0) {
    const top = matches[0];
    const confidence = Math.round(top.matchScore * 100);
    return { ...top, confidence };
  }

  return {
    code: 'common_illness',
    name: 'Unspecified illness',
    confidence: 30,
    urgency: 'low',
    treatments: ['Symptomatic treatment', 'Rest and hydration'],
    labTests: ['Complete Blood Count if persistent']
  };
}

// Differential diagnosis - returns top 3 possible conditions
function getDifferentialDiagnosis(symptoms = []) {
  const s = new Set(symptoms);
  const matches = [];

  for (const [code, data] of Object.entries(CONDITIONS_DB)) {
    let matchScore = 0;
    for (const trigger of data.triggers) {
      const matched = trigger.filter(t => s.has(t)).length;
      const ratio = matched / trigger.length;
      if (ratio > matchScore) matchScore = ratio;
    }
    if (matchScore > 0) {
      matches.push({ code, name: data.name, matchScore, urgency: data.urgency });
    }
  }

  return matches
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 3);
}

// ── Optional Score Normalization ─────────────────────────────────────────────
// Sigmoid-curve smoothing: normalizedScore = 100 * (1 - exp(-rawScore / 100))
// Default OFF — avoids distorting current moderate-range cases.
const ENABLE_SCORE_SMOOTHING = false;

// ── Symptom Cluster Definitions ───────────────────────────────────────────────
// Cluster bonuses are SEPARATE from per-symptom scoring.
// Each cluster fires only when ALL listed symptoms are present simultaneously.
const SYMPTOM_CLUSTERS = [
  { symptoms: ['fever', 'headache', 'vomiting'], bonus: 18, label: 'Meningitic triad cluster' },
  { symptoms: ['chest_pain', 'breathlessness', 'sweating'], bonus: 20, label: 'ACS symptom cluster' },
  { symptoms: ['fever', 'rash', 'confusion'], bonus: 20, label: 'Toxic/systemic cluster' },
  { symptoms: ['diarrhea', 'vomiting', 'fever'], bonus: 12, label: 'Acute gastroenteritis cluster' }
];

// ── Severity Multiplier Table ─────────────────────────────────────────────────
// Applied after base accumulation. Only 'Severe' carries a multiplier > 1.0.
// Configurable — edit the Severe value to adjust aggression (1.15–1.25 range).
const SEVERITY_MULTIPLIER = { Severe: 1.20, High: 1.0, Medium: 1.0, Low: 1.0 };

// Evaluate Base Risk
function evaluateBaseRisk({ age, symptoms = [], severity = 'Low', duration = 0, vitals = {}, currentMedications = [], allergies = [], medicalHistory = [], isMaternal = false }) {
  const s = new Set(symptoms || []);
  const reasons = [];
  const warnings = [];

  // Match condition from symptoms with confidence
  const matched = matchCondition(symptoms);
  let condition = matched.name;
  let conditionCode = matched.code;
  let treatments = [...(matched.treatments || [])];
  let labTests = [...(matched.labTests || [])];
  let urgency = matched.urgency || 'low';
  let confidence = matched.confidence || 0;

  // Analysis reasoning
  if (s.size > 0) {
    if (confidence > 70) {
      reasons.push(`Clinical presentation strongly aligns with ${condition} (${confidence}% confidence)`);
    } else {
      reasons.push(`Symptoms suggest possible ${condition} (Clinical overlap noted)`);
    }
  }

  // Risk scoring (Refined calibration)
  let score = 0;
  const reasoningLog = []; // Structured explainability log for all new modifiers

  // 1. Severity Weights (Rebalanced for Amber/Red reliability)
  const severityMap = { 'High': 35, 'Medium': 15, 'Low': 5 };
  score += severityMap[severity] || 5;
  if (severity !== 'Low') reasons.push(`Presenting severity: ${severity}`);

  // 1.5 Base Symptom Scoring (Hierarchical weights)
  const SYMPTOM_WEIGHTS = {
    // High-risk flags (handled separately, but base points added)
    'chest_pain': 15, 'breathlessness': 15, 'confusion': 15, 'severe_bleeding': 15,
    // Significant symptoms
    'fever': 12, 'cough': 10, 'vomiting': 10, 'diarrhea': 10, 'headache': 10, 'abdominal_pain': 10,
    // Minor symptoms
    'fatigue': 5, 'body_ache': 5, 'sore_throat': 5, 'nausea': 5, 'dizziness': 5, 'joint_pain': 5, 'swelling': 5
  };

  if (s.size > 0) {
    let symptomPoints = 0;
    symptoms.forEach(sym => {
      symptomPoints += SYMPTOM_WEIGHTS[sym.toLowerCase()] || 8; // Default 8 for unknown
    });

    // Cap base symptom points to prevent inflation in multi-symptom routine cases
    symptomPoints = Math.min(symptomPoints, 50);

    score += symptomPoints;
    reasoningLog.push({ modifier: 'Base Symptoms', impact: symptomPoints, reason: `${s.size} symptom(s) with cumulative weight` });
  }

  // 2. Vulnerable Populations
  if (age !== undefined && age !== null) {
    if (age >= 75) { score += 35; reasons.push('Geriatric clinical risk (75+)'); }
    else if (age >= 65) { score += 20; reasons.push('Elderly patient (65-74)'); }
    else if (age < 2) { score += 30; reasons.push('High pediatric vulnerability (<2y)'); }
    else if (age < 12) { score += 10; reasons.push('Pediatric patient'); }
  }

  // 3. High-Risk Red Flags (Weighted)
  const redFlags = {
    'chest_pain': { pts: 25, msg: 'Acute chest pain detected' },
    'breathlessness': { pts: 25, msg: 'Respiratory distress / Dyspnea' },
    'confusion': { pts: 35, msg: 'Altered mental status / Confusion' },
    'severe_bleeding': { pts: 40, msg: 'Critical hemorrhagic risk' },
    'difficulty_swallowing': { pts: 20, msg: 'Possible airway compromise' }
  };

  for (const [flag, data] of Object.entries(redFlags)) {
    if (s.has(flag)) {
      score += data.pts;
      reasons.push(data.msg);
      urgency = 'critical'; // Propagate to critical if flag exists
    }
  }

  // 4. Clinical Combinations
  if (s.has('fever') && s.has('dizziness')) {
    score += 15;
    reasons.push('Fever with neurological signs (dizziness)');
  }
  if (s.has('palpitations') && (s.has('chest_pain') || s.has('dizziness'))) {
    score += 25;
    reasons.push('Palpitations with associated cardiac symptoms');
  }

  // 5. Vital Sign Impact
  const vitalAnalysis = analyzeVitals(vitals);
  score += vitalAnalysis.vitalScore;
  reasons.push(...vitalAnalysis.findings);

  // 6. Chronicity
  if (duration >= 14) { score += 15; reasons.push('Chronic symptom duration (>2 weeks)'); }
  else if (duration >= 7) { score += 10; reasons.push('Sub-acute duration (>1 week)'); }

  // ── A. SYMPTOM CLUSTER WEIGHTING ─────────────────────────────────────────────
  // Fires only when the FULL cluster is present — separate from per-symptom scoring.
  for (const cluster of SYMPTOM_CLUSTERS) {
    if (cluster.symptoms.every(sym => s.has(sym))) {
      score += cluster.bonus;
      reasons.push(`Cluster bonus: ${cluster.label} (+${cluster.bonus})`);
      reasoningLog.push({ modifier: 'Symptom Cluster', impact: cluster.bonus, reason: cluster.label });
    }
  }

  // ── B. SEVERITY MULTIPLIER ────────────────────────────────────────────────────
  // Applied to accumulated score (not just the severity flat points) for 'Severe' only.
  const mult = SEVERITY_MULTIPLIER[severity] || 1.0;
  if (mult > 1.0) {
    const bonus = Math.round(score * (mult - 1.0));
    score += bonus;
    reasons.push(`Severity multiplier (${severity} x${mult}): +${bonus}`);
    reasoningLog.push({ modifier: 'Severity Multiplier', impact: bonus, reason: `${severity} symptom intensity (x${mult})` });
  }

  // ── C. DURATION PERSISTENCE MODIFIER ─────────────────────────────────────────
  // Covers the 5–6 day gap not handled by existing chronicity block (7d, 14d).
  if (duration >= 5 && duration < 7) {
    score += 5;
    reasons.push('Sub-acute persistence (5–6 days): +5');
    reasoningLog.push({ modifier: 'Duration Modifier', impact: 5, reason: 'Sub-acute persistence (5–6 days)' });
  }

  // ── D. VITAL INTERACTION LOGIC ────────────────────────────────────────────────
  // Rule-based interactions between specific vitals and symptoms.
  if (vitals.bp_systolic >= 140 && s.has('headache')) {
    score += 10;
    reasons.push('Vital interaction: hypertensive headache (+10)');
    reasoningLog.push({ modifier: 'Vital Interaction', impact: 10, reason: 'High BP + headache — hypertensive warning' });
  }
  if (vitals.heart_rate >= 110 && s.has('fever')) {
    score += 8;
    reasons.push('Vital interaction: tachycardia + fever — infection stress (+8)');
    reasoningLog.push({ modifier: 'Vital Interaction', impact: 8, reason: 'High HR + fever — infection stress modifier' });
  }

  // ── E. DEMOGRAPHIC SENSITIVITY ────────────────────────────────────────────────
  // NOTE: Elderly age risk (65+ and 75+) is fully handled by Block 2 (Vulnerable Populations).
  // Block 2 assigns +20 for ages 65–74y and +35 for ages 75+y.
  // A separate frailty modifier here would double-count those patients and inflate scores.
  // Only the non-overlapping demographic amplification patterns are retained below.
  if (age < 5 && s.has('fever')) {
    score += 10;
    reasons.push('Demographic: pediatric fever vulnerability (age < 5) +10');
    reasoningLog.push({ modifier: 'Demographic Sensitivity', impact: 10, reason: 'Pediatric fever vulnerability (age < 5)' });
  }
  if (isMaternal && (s.has('infection') || s.has('fever'))) {
    score += 7;
    reasons.push('Demographic: maternal infection amplification +7');
    reasoningLog.push({ modifier: 'Demographic Sensitivity', impact: 7, reason: 'Maternal infection amplification' });
  }

  // 7. Comorbidity Weights
  const comorbidityWeights = {
    'heart_disease': 20, 'diabetes': 15, 'hypertension': 15, 'asthma': 10, // CareCrypt patch: was 'hop' (typo)
    'immunocompromised': 25, 'cancer': 15, 'kidney_disease': 20
  };
  for (const condition of medicalHistory) {
    const weight = comorbidityWeights[condition.toLowerCase()];
    if (weight) {
      score += weight;
      reasons.push(`High-risk comorbidity: ${condition}`);
    }
  }

  // Safety Checks (Drug Interactions & Allergies)
  const drugWarnings = checkDrugInteractions(currentMedications, treatments);
  warnings.push(...drugWarnings);

  for (const allergy of allergies) {
    const allergyLower = allergy.toLowerCase();
    const originalCount = treatments.length;
    treatments = treatments.filter(t => !t.toLowerCase().includes(allergyLower));
    if (treatments.length < originalCount) {
      warnings.push(`CONTRAINDICATION: ${allergy} allergy. Alternatives required.`);
    }
  }

  // ── Score Normalization (opt-in) ──────────────────────────────────────────────
  if (ENABLE_SCORE_SMOOTHING) {
    score = Math.round(100 * (1 - Math.exp(-score / 100)));
  }

  // Recalibrate score for final output
  score = Math.min(score, 100);

  return {
    score,
    confidence,
    reasons,
    warnings,
    condition,
    conditionCode,
    treatments,
    labTests,
    calculatedUrgency: urgency,
    vitalFindings: vitalAnalysis.findings,
    reasoningLog          // NEW: structured explainability entries for all new modifiers
  };
}


// Weighted Risk Scoring System
// Accepts BP in string format (e.g., "120/80"), temperature, pulse, age, symptoms, and comorbidities
function calculateWeightedRiskScore({ bp, temperature, pulse, age, symptoms = [], comorbidities = [] }) {
  let score = 0;
  const explanation = [];

  // Parse BP from string format "120/80"
  let systolicBP = null;
  if (bp && typeof bp === 'string') {
    const bpParts = bp.split('/');
    if (bpParts.length === 2) {
      systolicBP = parseInt(bpParts[0], 10);
    }
  }

  // 1. Blood Pressure scoring
  if (systolicBP !== null && systolicBP >= 150) {
    score += 25;
    explanation.push(`Elevated systolic BP (${systolicBP} mmHg) adds 25 points`);
  }

  // 2. Temperature scoring (assuming Fahrenheit)
  if (temperature !== undefined && temperature !== null && temperature >= 101) {
    score += 20;
    explanation.push(`High temperature (${temperature}°F) adds 20 points`);
  }

  // 3. Pulse scoring
  if (pulse !== undefined && pulse !== null && pulse >= 110) {
    score += 15;
    explanation.push(`Elevated pulse (${pulse} bpm) adds 15 points`);
  }

  // 4. Age scoring
  if (age !== undefined && age !== null && age >= 60) {
    score += 10;
    explanation.push(`Age ${age} years (≥60) adds 10 points`);
  }

  // 5. Severe symptoms scoring
  const severeSymptoms = ['chest_pain', 'chest pain', 'breathing_difficulty', 'breathing difficulty', 'breathlessness'];
  const hasSevereSymptom = symptoms.some(symptom =>
    severeSymptoms.some(severe => symptom.toLowerCase().includes(severe.toLowerCase()))
  );

  if (hasSevereSymptom) {
    score += 25;
    explanation.push('Severe symptoms (chest pain/breathing difficulty) add 25 points');
  }

  // 6. Comorbidities scoring
  const riskComorbidities = ['diabetes', 'hypertension'];
  const hasRiskComorbidity = comorbidities.some(comorbidity =>
    riskComorbidities.some(risk => comorbidity.toLowerCase().includes(risk.toLowerCase()))
  );

  if (hasRiskComorbidity) {
    score += 10;
    explanation.push('High-risk comorbidities (diabetes/hypertension) add 10 points');
  }

  // Cap score at 100
  score = Math.min(score, 100);

  // Determine category
  let category;
  if (score <= 30) {
    category = 'Low';
  } else if (score <= 60) {
    category = 'Medium';
  } else {
    category = 'High';
  }

  return {
    score,
    category,
    explanation
  };
}

module.exports = {
  evaluateBaseRisk,
  analyzeVitals,
  checkDrugInteractions,
  matchCondition,
  getDifferentialDiagnosis,
  calculateWeightedRiskScore,
  CONDITIONS_DB,
  VITAL_RANGES,
  DRUG_INTERACTIONS
};
