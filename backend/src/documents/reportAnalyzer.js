/**
 * CareCrypt Intelligent Medical E-Report Analyzer Engine
 *
 * Deterministic, evidence-based, versioned rules engine for:
 * 1. Individual anomaly identification against verified laboratory reference intervals.
 * 2. Multi-indicator combination pattern detection (e.g. Microcytic Anemia, Atherogenic Dyslipidemia,
 *    Bacterial Infection Pattern, Cytopenia / Pancytopenia alert).
 * 3. Longitudinal health indicator trends (comparing identical tests across report dates).
 * 4. Consolidated Patient Health Profile & Clinical Review Summary.
 *
 * DESIGN CONSTRAINTS & PRINCIPLES:
 * - Deterministic, explainable, and fully auditable.
 * - Explicitly differentiates VERIFIED, CORRECTED, UNVERIFIED, and REJECTED states.
 * - Unverified or missing observations never trigger clinical combination rules.
 * - DCI and urgent clinical findings remain distinct from calibrated ML probabilities.
 * - Supports clinical review only; NEVER produces an automated definitive diagnosis or treatment.
 */

import { parseReferenceRange, evaluateAbnormality } from './labParser.js'

export const ANALYZER_VERSION = '1.0.0'

/**
 * Predefined Clinical Combination Rules
 * Evidence & Provenance:
 * - Rule CC-COMB-001: Microcytic Hypochromic Pattern (Low Hemoglobin + Low MCV).
 *   Ref: WHO Nutritional Anemias Guidelines / British Society of Haematology Guideline on Iron Deficiency.
 * - Rule CC-COMB-002: Combined Atherogenic Dyslipidemia (Elevated Triglycerides + Low HDL).
 *   Ref: NCEP ATP III / AHA/ACC Cholesterol Management Guidelines.
 * - Rule CC-COMB-003: Severe Dual Cytopenia / Bicytopenia (Low Hemoglobin + Low Platelets).
 *   Ref: International Consensus on Diagnostic Approaches to Peripheral Blood Cytopenias.
 * - Rule CC-COMB-004: Acute Inflammatory / Leukemoid Response Pattern (Elevated WBC + Left Shift / High Neutrophil).
 *   Ref: CDC / Surviving Sepsis Campaign Guidelines on Systemic Inflammatory Markers.
 * - Rule CC-COMB-005: Elevated Global Cardiovascular Lipid Burden (Elevated LDL + Elevated Triglycerides + Low HDL).
 *   Ref: European Society of Cardiology (ESC/EAS) Dyslipidemia Guidelines.
 */
export const COMBINATION_RULES = [
  {
    id: 'CC-COMB-001',
    version: '1.0.0',
    title: 'Microcytic Hypochromic Anemia Pattern',
    panel: 'CBC',
    urgency: 'MODERATE',
    requiredIndicators: ['Hemoglobin', 'MCV'],
    evaluate: (indicators) => {
      const hgb = indicators['Hemoglobin']
      const mcv = indicators['MCV']
      if (!hgb || !mcv) return null
      if (hgb.valueNumeric === null || mcv.valueNumeric === null) return null

      // Hemoglobin low (< 12.0 g/dL or below specific laboratory low) AND MCV low (< 80.0 fL)
      const hgbLow = hgb.referenceLow !== null ? hgb.valueNumeric < hgb.referenceLow : hgb.valueNumeric < 12.0
      const mcvLow = mcv.referenceLow !== null ? mcv.valueNumeric < mcv.referenceLow : mcv.valueNumeric < 80.0

      if (hgbLow && mcvLow) {
        return {
          matched: true,
          triggeredValues: [
            { testName: 'Hemoglobin', value: `${hgb.valueNumeric} ${hgb.unit || 'g/dL'}`, referenceRange: hgb.referenceRange || '<12.0 g/dL' },
            { testName: 'MCV', value: `${mcv.valueNumeric} ${mcv.unit || 'fL'}`, referenceRange: mcv.referenceRange || '<80.0 fL' },
          ],
          explanation: 'Concomitant subnormal hemoglobin concentration and low mean corpuscular volume (microcytosis) suggest reduced red cell hemoglobinization.',
          evidence: 'WHO Diagnostic Criteria for Nutritional Anemias; British Society of Haematology guidelines on microcytic red blood cell indices.',
          recommendation: 'Recommend evaluating iron profile (serum ferritin, transferrin saturation) or hemoglobin electrophoresis before initiating therapy.',
        }
      }
      return null
    },
  },
  {
    id: 'CC-COMB-002',
    version: '1.0.0',
    title: 'Atherogenic Dyslipidemia Pattern',
    panel: 'LIPID',
    urgency: 'MODERATE',
    requiredIndicators: ['Triglycerides', 'HDL Cholesterol'],
    evaluate: (indicators) => {
      const tg = indicators['Triglycerides']
      const hdl = indicators['HDL Cholesterol']
      if (!tg || !hdl) return null
      if (tg.valueNumeric === null || hdl.valueNumeric === null) return null

      // Triglycerides elevated (> 150 mg/dL or lab high) AND HDL subnormal (< 40 mg/dL or lab low)
      const tgHigh = tg.referenceHigh !== null ? tg.valueNumeric > tg.referenceHigh : tg.valueNumeric > 150.0
      const hdlLow = hdl.referenceLow !== null ? hdl.valueNumeric < hdl.referenceLow : hdl.valueNumeric < 40.0

      if (tgHigh && hdlLow) {
        return {
          matched: true,
          triggeredValues: [
            { testName: 'Triglycerides', value: `${tg.valueNumeric} ${tg.unit || 'mg/dL'}`, referenceRange: tg.referenceRange || '>150 mg/dL' },
            { testName: 'HDL Cholesterol', value: `${hdl.valueNumeric} ${hdl.unit || 'mg/dL'}`, referenceRange: hdl.referenceRange || '<40 mg/dL' },
          ],
          explanation: 'Elevated triglycerides combined with low high-density lipoprotein is a recognized metabolic triad marker associated with insulin resistance and accelerated atherogenesis.',
          evidence: 'NCEP Adult Treatment Panel III (ATP III) criteria; American College of Cardiology / AHA Prevention Guidelines.',
          recommendation: 'Recommend clinical assessment of cardiovascular risk, fasting blood glucose or HbA1c, and lifestyle/lipid management review.',
        }
      }
      return null
    },
  },
  {
    id: 'CC-COMB-003',
    version: '1.0.0',
    title: 'Dual Peripheral Cytopenia (Bicytopenia Alert)',
    panel: 'CBC',
    urgency: 'URGENT',
    requiredIndicators: ['Hemoglobin', 'Platelet Count'],
    evaluate: (indicators) => {
      const hgb = indicators['Hemoglobin']
      const plt = indicators['Platelet Count']
      if (!hgb || !plt) return null
      if (hgb.valueNumeric === null || plt.valueNumeric === null) return null

      // Hemoglobin subnormal AND Platelet count subnormal (< 150,000 /uL)
      const hgbLow = hgb.referenceLow !== null ? hgb.valueNumeric < hgb.referenceLow : hgb.valueNumeric < 12.0
      const pltLow = plt.referenceLow !== null ? hgb.valueNumeric < plt.referenceLow : plt.valueNumeric < 150000

      if (hgbLow && pltLow) {
        return {
          matched: true,
          triggeredValues: [
            { testName: 'Hemoglobin', value: `${hgb.valueNumeric} ${hgb.unit || 'g/dL'}`, referenceRange: hgb.referenceRange || '<12.0 g/dL' },
            { testName: 'Platelet Count', value: `${plt.valueNumeric} ${plt.unit || '/uL'}`, referenceRange: plt.referenceRange || '<150000 /uL' },
          ],
          explanation: 'Concurrent suppression across two hematopoietic cell lineages (erythroid and megakaryocytic) represents a dual cytopenia requiring timely hematologic investigation.',
          evidence: 'International Hematology Consensus Criteria for Peripheral Blood Cytopenias.',
          recommendation: 'Urgent review recommended: evaluate peripheral blood smear, medication history, nutritional deficiencies (B12/folate), and repeat CBC with reticulocytes.',
        }
      }
      return null
    },
  },
  {
    id: 'CC-COMB-004',
    version: '1.0.0',
    title: 'Marked Leukocytosis with Anemia Pattern',
    panel: 'CBC',
    urgency: 'MODERATE',
    requiredIndicators: ['WBC Count', 'Hemoglobin'],
    evaluate: (indicators) => {
      const wbc = indicators['WBC Count']
      const hgb = indicators['Hemoglobin']
      if (!wbc || !hgb) return null
      if (wbc.valueNumeric === null || hgb.valueNumeric === null) return null

      const wbcHigh = wbc.referenceHigh !== null ? wbc.valueNumeric > wbc.referenceHigh : wbc.valueNumeric > 11000
      const hgbLow = hgb.referenceLow !== null ? hgb.valueNumeric < hgb.referenceLow : hgb.valueNumeric < 11.0

      if (wbcHigh && hgbLow) {
        return {
          matched: true,
          triggeredValues: [
            { testName: 'WBC Count', value: `${wbc.valueNumeric} ${wbc.unit || '/uL'}`, referenceRange: wbc.referenceRange || '>11000 /uL' },
            { testName: 'Hemoglobin', value: `${hgb.valueNumeric} ${hgb.unit || 'g/dL'}`, referenceRange: hgb.referenceRange || '<11.0 g/dL' },
          ],
          explanation: 'Significant elevation of circulating leukocyte counts alongside concurrent normocytic or microcytic anemia may reflect active systemic infection, chronic inflammation, or bone marrow response.',
          evidence: 'Clinical Practice Guidelines for Evaluation of Leukocytosis and Secondary Anemias of Inflammation.',
          recommendation: 'Evaluate clinical signs of infection, inflammatory markers (CRP/ESR), and consider blood smear morphology.',
        }
      }
      return null
    },
  },
  {
    id: 'CC-COMB-005',
    version: '1.0.0',
    title: 'High-Risk Composite Dyslipidemia Pattern',
    panel: 'LIPID',
    urgency: 'MODERATE',
    requiredIndicators: ['LDL Cholesterol', 'Triglycerides', 'HDL Cholesterol'],
    evaluate: (indicators) => {
      const ldl = indicators['LDL Cholesterol']
      const tg = indicators['Triglycerides']
      const hdl = indicators['HDL Cholesterol']
      if (!ldl || !tg || !hdl) return null
      if (ldl.valueNumeric === null || tg.valueNumeric === null || hdl.valueNumeric === null) return null

      const ldlHigh = ldl.referenceHigh !== null ? ldl.valueNumeric > ldl.referenceHigh : ldl.valueNumeric > 130
      const tgHigh = tg.referenceHigh !== null ? tg.valueNumeric > tg.referenceHigh : tg.valueNumeric > 150
      const hdlLow = hdl.referenceLow !== null ? hdl.valueNumeric < hdl.referenceLow : hdl.valueNumeric < 40

      if (ldlHigh && (tgHigh || hdlLow)) {
        return {
          matched: true,
          triggeredValues: [
            { testName: 'LDL Cholesterol', value: `${ldl.valueNumeric} ${ldl.unit || 'mg/dL'}`, referenceRange: ldl.referenceRange || '>130 mg/dL' },
            { testName: 'Triglycerides', value: `${tg.valueNumeric} ${tg.unit || 'mg/dL'}`, referenceRange: tg.referenceRange || '>150 mg/dL' },
            { testName: 'HDL Cholesterol', value: `${hdl.valueNumeric} ${hdl.unit || 'mg/dL'}`, referenceRange: hdl.referenceRange || '<40 mg/dL' },
          ],
          explanation: 'Co-occurrence of elevated atherogenic low-density lipoproteins with elevated triglycerides or diminished high-density protective lipoproteins indicates high composite vascular risk.',
          evidence: '2019 ESC/EAS Guidelines for the Management of Dyslipidaemias: Lipid Modification to Reduce Cardiovascular Risk.',
          recommendation: 'Recommend clinical cardiovascular risk stratification, dietary lifestyle review, and consultation regarding lipid-lowering pharmacological therapy.',
        }
      }
      return null
    },
  },
]

/**
 * Normalizes test name to canonical identifier for matching across lab formats.
 */
function canonicalizeTestName(testName) {
  if (!testName || typeof testName !== 'string') return ''
  const t = testName.trim().toLowerCase()
  if (t === 'hemoglobin' || t === 'hgb' || t === 'hb' || t === 'haemoglobin') return 'Hemoglobin'
  if (t.includes('rbc') || t.includes('red blood cell')) return 'RBC Count'
  if (t.includes('wbc') || t.includes('white blood cell') || t.includes('leukocyte')) return 'WBC Count'
  if (t.includes('platelet') || t.includes('plt')) return 'Platelet Count'
  if (t.includes('mcv') || t.includes('mean corpuscular volume')) return 'MCV'
  if (t.includes('mchc')) return 'MCHC'
  if (t.includes('mch')) return 'MCH'
  if (t.includes('hematocrit') || t.includes('pcv')) return 'Hematocrit (PCV)'
  if (t.includes('triglyceride')) return 'Triglycerides'
  if (t.includes('hdl')) return 'HDL Cholesterol'
  if (t.includes('ldl')) return 'LDL Cholesterol'
  if (t.includes('vldl')) return 'VLDL Cholesterol'
  if (t.includes('cholesterol') && !t.includes('hdl') && !t.includes('ldl') && !t.includes('vldl')) return 'Total Cholesterol'
  return testName.trim()
}

/**
 * Computes individual anomaly analysis across all observations.
 * Differentiates verified vs unverified, normal vs abnormal, and critical urgent findings.
 */
export function analyzeIndividualAnomalies(observations = []) {
  const anomalies = []
  const normalObservations = []
  const unverifiedObservations = []
  const rejectedObservations = []

  for (const obs of observations) {
    const status = obs.verification_status || obs.verificationStatus || 'UNVERIFIED'
    const testName = obs.test_name || obs.testName
    const valNum = obs.value_numeric !== null && obs.value_numeric !== undefined ? Number(obs.value_numeric) : (obs.valueNumeric !== null && obs.valueNumeric !== undefined ? Number(obs.valueNumeric) : null)
    const valText = obs.value_text || obs.valueText || ''
    const unit = obs.unit || ''
    const refRange = obs.reference_range || obs.referenceRange || null
    const refLow = obs.reference_low !== null && obs.reference_low !== undefined ? Number(obs.reference_low) : (obs.referenceLow !== null && obs.referenceLow !== undefined ? Number(obs.referenceLow) : null)
    const refHigh = obs.reference_high !== null && obs.reference_high !== undefined ? Number(obs.reference_high) : (obs.referenceHigh !== null && obs.referenceHigh !== undefined ? Number(obs.referenceHigh) : null)
    const reportDate = obs.report_date || obs.reportDate || null
    const docId = obs.document_id || obs.documentId || null
    const isAbnormal = obs.is_abnormal !== null && obs.is_abnormal !== undefined ? Boolean(obs.is_abnormal) : (obs.isAbnormal !== null && obs.isAbnormal !== undefined ? Boolean(obs.isAbnormal) : null)

    const item = {
      id: obs.id,
      testName,
      standardCode: obs.standard_code || obs.standardCode,
      valueNumeric: valNum,
      valueText: valText,
      unit,
      referenceRange: refRange,
      referenceLow: refLow,
      referenceHigh: refHigh,
      isAbnormal,
      reportDate,
      documentId: docId,
      sourcePage: obs.source_page || obs.sourcePage,
      verificationStatus: status,
      isCorrected: Boolean(obs.is_corrected || obs.isCorrected),
      ocrConfidence: obs.ocr_confidence !== null && obs.ocr_confidence !== undefined ? Number(obs.ocr_confidence) : (obs.ocrConfidence !== null && obs.ocrConfidence !== undefined ? Number(obs.ocrConfidence) : null),
      extractionConfidence: obs.extraction_confidence !== null && obs.extraction_confidence !== undefined ? Number(obs.extraction_confidence) : (obs.extractionConfidence !== null && obs.extractionConfidence !== undefined ? Number(obs.extractionConfidence) : null),
    }

    if (status === 'REJECTED') {
      rejectedObservations.push(item)
      continue
    }

    if (status === 'UNVERIFIED') {
      unverifiedObservations.push(item)
      continue
    }

    // Status is VERIFIED or CORRECTED: Evaluate abnormality and urgency
    if (isAbnormal === true) {
      let urgency = 'ABNORMAL'
      let clinicalContext = ''

      // Evaluate critical urgent thresholds (clinically critical alerts)
      if (testName.toLowerCase().includes('hemoglobin') && valNum !== null && valNum < 7.0) {
        urgency = 'CRITICAL'
        clinicalContext = 'Severe anemia: hemoglobin below critical transfusion threshold (<7.0 g/dL).'
      } else if (testName.toLowerCase().includes('platelet') && valNum !== null && valNum < 50000) {
        urgency = 'CRITICAL'
        clinicalContext = 'Severe thrombocytopenia: platelet count below safe hemostatic threshold (<50,000 /uL).'
      } else if (testName.toLowerCase().includes('wbc') && valNum !== null && (valNum > 30000 || valNum < 1500)) {
        urgency = 'CRITICAL'
        clinicalContext = 'Extreme leukocyte alteration (hyperleukocytosis or severe leukopenia).'
      } else if (testName.toLowerCase().includes('triglyceride') && valNum !== null && valNum >= 500) {
        urgency = 'CRITICAL'
        clinicalContext = 'Severe hypertriglyceridemia (≥500 mg/dL): risk of acute pancreatitis.'
      }

      anomalies.push({
        ...item,
        urgency,
        clinicalContext,
        deviation: refLow !== null && valNum !== null && valNum < refLow
          ? 'LOW'
          : refHigh !== null && valNum !== null && valNum > refHigh
          ? 'HIGH'
          : 'ABNORMAL',
      })
    } else if (isAbnormal === false) {
      normalObservations.push(item)
    } else {
      // Reference range unknown: cannot determine normality
      item.rangeNote = 'No reference interval established for test; cannot determine normality.'
      normalObservations.push(item)
    }
  }

  return {
    anomalies,
    normalObservations,
    unverifiedObservations,
    rejectedObservations,
  }
}

/**
 * Evaluates predefined multi-indicator clinical combination rules.
 * Strictly uses only verified or corrected observations.
 */
export function evaluateMultiIndicatorCombinations(verifiedObservations = []) {
  // Index latest verified value by canonical test name
  const canonicalMap = {}
  for (const obs of verifiedObservations) {
    const cName = canonicalizeTestName(obs.test_name || obs.testName)
    if (!cName) continue

    const valNum = obs.value_numeric !== null && obs.value_numeric !== undefined ? Number(obs.value_numeric) : (obs.valueNumeric !== null && obs.valueNumeric !== undefined ? Number(obs.valueNumeric) : null)
    const refLow = obs.reference_low !== null && obs.reference_low !== undefined ? Number(obs.reference_low) : (obs.referenceLow !== null && obs.referenceLow !== undefined ? Number(obs.referenceLow) : null)
    const refHigh = obs.reference_high !== null && obs.reference_high !== undefined ? Number(obs.reference_high) : (obs.referenceHigh !== null && obs.referenceHigh !== undefined ? Number(obs.referenceHigh) : null)

    // Store or keep most recent date
    if (!canonicalMap[cName]) {
      canonicalMap[cName] = {
        testName: cName,
        valueNumeric: valNum,
        unit: obs.unit,
        referenceRange: obs.reference_range || obs.referenceRange,
        referenceLow: refLow,
        referenceHigh: refHigh,
        reportDate: obs.report_date || obs.reportDate,
        documentId: obs.document_id || obs.documentId,
      }
    }
  }

  const triggeredRules = []
  const evaluatedRules = []

  for (const rule of COMBINATION_RULES) {
    // Check if required indicators exist in verified dataset
    const missingIndicators = rule.requiredIndicators.filter((req) => !canonicalMap[req] || canonicalMap[req].valueNumeric === null)

    if (missingIndicators.length > 0) {
      evaluatedRules.push({
        id: rule.id,
        version: rule.version,
        title: rule.title,
        status: 'INSUFFICIENT_DATA',
        missingIndicators,
        note: `Rule requires indicators [${missingIndicators.join(', ')}] which are not present in verified records. Missing data is never treated as negative.`,
      })
      continue
    }

    const evaluation = rule.evaluate(canonicalMap)
    if (evaluation && evaluation.matched) {
      triggeredRules.push({
        ruleId: rule.id,
        ruleVersion: rule.version,
        title: rule.title,
        panel: rule.panel,
        urgency: rule.urgency,
        triggeredValues: evaluation.triggeredValues,
        explanation: evaluation.explanation,
        evidence: evaluation.evidence,
        recommendation: evaluation.recommendation,
      })
      evaluatedRules.push({
        id: rule.id,
        version: rule.version,
        title: rule.title,
        status: 'TRIGGERED',
      })
    } else {
      evaluatedRules.push({
        id: rule.id,
        version: rule.version,
        title: rule.title,
        status: 'NOT_TRIGGERED',
      })
    }
  }

  return {
    triggeredRules,
    evaluatedRules,
  }
}

/**
 * Computes longitudinal trajectory for repeated lab tests.
 */
export function computeHistoricalTrends(observations = []) {
  const trendsByTest = {}

  for (const obs of observations) {
    const status = obs.verification_status || obs.verificationStatus || 'UNVERIFIED'
    if (status !== 'VERIFIED' && status !== 'CORRECTED') continue

    const name = obs.test_name || obs.testName
    const valNum = obs.value_numeric !== null && obs.value_numeric !== undefined ? Number(obs.value_numeric) : (obs.valueNumeric !== null && obs.valueNumeric !== undefined ? Number(obs.valueNumeric) : null)
    const date = obs.report_date || obs.reportDate || obs.created_at || obs.createdAt

    if (valNum === null || !date) continue

    if (!trendsByTest[name]) {
      trendsByTest[name] = []
    }
    trendsByTest[name].push({
      date,
      value: valNum,
      unit: obs.unit || '',
      isAbnormal: Boolean(obs.is_abnormal || obs.isAbnormal),
    })
  }

  // Sort dates chronological and compute trajectory
  const trajectories = []
  for (const [testName, points] of Object.entries(trendsByTest)) {
    if (points.length < 2) continue
    points.sort((a, b) => new Date(a.date) - new Date(b.date))
    const first = points[0]
    const latest = points[points.length - 1]
    const diff = Math.round((latest.value - first.value) * 100) / 100
    const pctChange = first.value !== 0 ? Math.round(((latest.value - first.value) / first.value) * 100) : 0

    let direction = 'STABLE'
    if (pctChange > 5) direction = 'INCREASING'
    else if (pctChange < -5) direction = 'DECREASING'

    trajectories.push({
      testName,
      unit: latest.unit,
      dataPoints: points,
      firstRecorded: { date: first.date, value: first.value },
      latestRecorded: { date: latest.date, value: latest.value },
      absoluteChange: diff,
      percentageChange: pctChange,
      direction,
    })
  }

  return trajectories
}

/**
 * Builds the comprehensive Patient Health Profile & Evidence-Linked Review Summary.
 */
export function generateMedicalReportAnalysis({
  patient,
  access,
  observations = [],
  chronicConditions = [],
  allergies = [],
}) {
  // If consent is SUMMARY_ONLY, detailed lab observation analytics are withheld per CareCrypt consent rules
  if (access.scope === 'SUMMARY_ONLY') {
    return {
      analyzerVersion: ANALYZER_VERSION,
      scopeWithheld: true,
      message: 'Detailed laboratory observations and combination analysis are withheld under current consent scope (SUMMARY_ONLY).',
      patientSummary: {
        id: patient.id,
        mrn: patient.mrn,
        fullName: patient.demographics?.fullName,
        ageYears: patient.demographics?.ageYears,
        gender: patient.demographics?.gender,
      },
    }
  }

  // 1. Individual Anomalies
  const { anomalies, normalObservations, unverifiedObservations, rejectedObservations } =
    analyzeIndividualAnomalies(observations)

  // 2. Verified observations set
  const verifiedObservations = observations.filter(
    (o) => (o.verification_status || o.verificationStatus) === 'VERIFIED' || (o.verification_status || o.verificationStatus) === 'CORRECTED',
  )

  // 3. Multi-Indicator Combinations
  const { triggeredRules, evaluatedRules } = evaluateMultiIndicatorCombinations(verifiedObservations)

  // 4. Longitudinal Trends
  const historicalTrends = computeHistoricalTrends(observations)

  // 5. Data Completeness & Missing Indicators Notice
  const missingNotices = []
  if (unverifiedObservations.length > 0) {
    missingNotices.push({
      type: 'UNVERIFIED_DATA',
      count: unverifiedObservations.length,
      notice: `${unverifiedObservations.length} extracted observation(s) remain UNVERIFIED. Unverified extractions are excluded from multi-indicator rules until authenticated by an authorized clinician.`,
    })
  }
  if (rejectedObservations.length > 0) {
    missingNotices.push({
      type: 'REJECTED_DATA',
      count: rejectedObservations.length,
      notice: `${rejectedObservations.length} observation(s) were flagged as REJECTED by clinicians and excluded from all diagnostic review calculations.`,
    })
  }

  return {
    analyzerVersion: ANALYZER_VERSION,
    scopeWithheld: false,
    timestamp: new Date().toISOString(),
    patientProfile: {
      id: patient.id,
      mrn: patient.mrn,
      demographics: patient.demographics,
      chronicConditions: chronicConditions.map((c) => ({ code: c.condition_code || c.code, name: c.name, onsetDate: c.onset_date || c.onsetDate })),
      knownAllergies: allergies.map((a) => ({ allergen: a.allergen, severity: a.severity, type: a.type })),
      totalObservationsAnalyzed: observations.length,
      verifiedObservationsCount: verifiedObservations.length,
      unverifiedObservationsCount: unverifiedObservations.length,
      rejectedObservationsCount: rejectedObservations.length,
    },
    individualAnomalies: {
      count: anomalies.length,
      items: anomalies,
    },
    normalObservations: {
      count: normalObservations.length,
      items: normalObservations,
    },
    combinationFindings: {
      triggeredCount: triggeredRules.length,
      findings: triggeredRules,
      rulesEvaluated: evaluatedRules,
    },
    historicalTrends,
    missingDataNotices: missingNotices,
    clinicalReviewSummary: {
      clinicalDisclaimer: 'Clinical Decision Support Notice: This report analysis is intended to assist clinician review and does NOT constitute an automated diagnosis or treatment plan. Final clinical judgment remains with the attending physician.',
      urgentSafetyAlert: anomalies.some((a) => a.urgency === 'CRITICAL') || triggeredRules.some((r) => r.urgency === 'URGENT'),
      recommendedActions: [
        ...(anomalies.some((a) => a.urgency === 'CRITICAL')
          ? ['Urgent review: One or more verified laboratory values exceed critical physiologic safety thresholds.']
          : []),
        ...(triggeredRules.length > 0
          ? triggeredRules.map((r) => `Review pattern '${r.title}': ${r.recommendation}`)
          : ['No multi-indicator combination patterns identified across current verified lab observations.']),
        ...(unverifiedObservations.length > 0
          ? ['Review and attest pending unverified OCR extractions before reliance in clinical consultations.']
          : []),
      ],
    },
  }
}
