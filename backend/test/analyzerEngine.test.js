import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ANALYZER_VERSION,
  COMBINATION_RULES,
  analyzeIndividualAnomalies,
  evaluateMultiIndicatorCombinations,
  computeHistoricalTrends,
  generateMedicalReportAnalysis,
} from '../src/documents/reportAnalyzer.js'

describe('Intelligent Medical E-Report Analyzer Engine', () => {
  describe('Individual Anomaly Analysis', () => {
    it('accurately identifies abnormal results and flags deviations based on reference ranges', () => {
      const observations = [
        {
          id: '1',
          test_name: 'Hemoglobin',
          value_numeric: 9.8,
          unit: 'g/dL',
          reference_range: '12.0 - 17.5',
          reference_low: 12.0,
          reference_high: 17.5,
          is_abnormal: true,
          verification_status: 'VERIFIED',
        },
        {
          id: '2',
          test_name: 'WBC Count',
          value_numeric: 7200,
          unit: '/uL',
          reference_range: '4000 - 11000',
          reference_low: 4000,
          reference_high: 11000,
          is_abnormal: false,
          verification_status: 'VERIFIED',
        },
      ]

      const { anomalies, normalObservations } = analyzeIndividualAnomalies(observations)
      assert.equal(anomalies.length, 1)
      assert.equal(anomalies[0].testName, 'Hemoglobin')
      assert.equal(anomalies[0].deviation, 'LOW')
      assert.equal(anomalies[0].urgency, 'ABNORMAL')

      assert.equal(normalObservations.length, 1)
      assert.equal(normalObservations[0].testName, 'WBC Count')
    })

    it('distinguishes critical urgent physiologic thresholds from ordinary deviations', () => {
      const criticalObs = [
        {
          id: '1',
          test_name: 'Hemoglobin',
          value_numeric: 5.8, // < 7.0 g/dL -> critical transfusion threshold
          unit: 'g/dL',
          reference_range: '12.0 - 17.5',
          reference_low: 12.0,
          reference_high: 17.5,
          is_abnormal: true,
          verification_status: 'CORRECTED',
        },
        {
          id: '2',
          test_name: 'Platelet Count',
          value_numeric: 35000, // < 50,000 /uL -> critical bleeding risk
          unit: '/uL',
          reference_range: '150000 - 450000',
          reference_low: 150000,
          reference_high: 450000,
          is_abnormal: true,
          verification_status: 'VERIFIED',
        },
      ]

      const { anomalies } = analyzeIndividualAnomalies(criticalObs)
      assert.equal(anomalies.length, 2)
      assert.ok(anomalies.every((a) => a.urgency === 'CRITICAL'))
      assert.ok(anomalies.some((a) => a.clinicalContext.includes('transfusion threshold')))
      assert.ok(anomalies.some((a) => a.clinicalContext.includes('hemostatic threshold')))
    })

    it('separates unverified and rejected observations from verified findings', () => {
      const obsList = [
        {
          id: '1',
          test_name: 'Hemoglobin',
          value_numeric: 10.0,
          is_abnormal: true,
          verification_status: 'UNVERIFIED',
        },
        {
          id: '2',
          test_name: 'Triglycerides',
          value_numeric: 400,
          is_abnormal: true,
          verification_status: 'REJECTED',
        },
        {
          id: '3',
          test_name: 'HDL Cholesterol',
          value_numeric: 32,
          is_abnormal: true,
          verification_status: 'VERIFIED',
        },
      ]

      const { anomalies, unverifiedObservations, rejectedObservations } = analyzeIndividualAnomalies(obsList)
      assert.equal(anomalies.length, 1)
      assert.equal(anomalies[0].testName, 'HDL Cholesterol')
      assert.equal(unverifiedObservations.length, 1)
      assert.equal(unverifiedObservations[0].testName, 'Hemoglobin')
      assert.equal(rejectedObservations.length, 1)
      assert.equal(rejectedObservations[0].testName, 'Triglycerides')
    })
  })

  describe('Predefined Multi-Indicator Combination Rules', () => {
    it('triggers Microcytic Hypochromic Pattern (CC-COMB-001) when Hemoglobin and MCV are low', () => {
      const verified = [
        {
          test_name: 'Hemoglobin',
          value_numeric: 10.2,
          unit: 'g/dL',
          reference_range: '12.0 - 17.5',
          reference_low: 12.0,
          reference_high: 17.5,
          verification_status: 'VERIFIED',
        },
        {
          test_name: 'MCV',
          value_numeric: 74.0,
          unit: 'fL',
          reference_range: '80.0 - 100.0',
          reference_low: 80.0,
          reference_high: 100.0,
          verification_status: 'VERIFIED',
        },
      ]

      const { triggeredRules } = evaluateMultiIndicatorCombinations(verified)
      assert.equal(triggeredRules.length, 1)
      const rule = triggeredRules[0]
      assert.equal(rule.ruleId, 'CC-COMB-001')
      assert.equal(rule.title, 'Microcytic Hypochromic Anemia Pattern')
      assert.ok(rule.explanation.includes('microcytosis'))
      assert.ok(rule.recommendation.includes('serum ferritin'))
    })

    it('does NOT trigger combination rule when findings do not meet the criteria', () => {
      // Normocytic anemia (Hemoglobin low, but MCV normal)
      const verified = [
        {
          test_name: 'Hemoglobin',
          value_numeric: 10.5,
          unit: 'g/dL',
          reference_low: 12.0,
          verification_status: 'VERIFIED',
        },
        {
          test_name: 'MCV',
          value_numeric: 89.0, // Normal MCV!
          unit: 'fL',
          reference_low: 80.0,
          verification_status: 'VERIFIED',
        },
      ]

      const { triggeredRules, evaluatedRules } = evaluateMultiIndicatorCombinations(verified)
      assert.equal(triggeredRules.length, 0)
      const r1 = evaluatedRules.find((r) => r.id === 'CC-COMB-001')
      assert.equal(r1.status, 'NOT_TRIGGERED')
    })

    it('triggers Atherogenic Dyslipidemia Pattern (CC-COMB-002) for high TG and low HDL', () => {
      const verified = [
        {
          test_name: 'Triglycerides',
          value_numeric: 240,
          unit: 'mg/dL',
          reference_high: 150,
          verification_status: 'VERIFIED',
        },
        {
          test_name: 'HDL Cholesterol',
          value_numeric: 34,
          unit: 'mg/dL',
          reference_low: 40,
          verification_status: 'VERIFIED',
        },
      ]

      const { triggeredRules } = evaluateMultiIndicatorCombinations(verified)
      assert.ok(triggeredRules.some((r) => r.ruleId === 'CC-COMB-002'))
    })

    it('triggers Dual Cytopenia / Bicytopenia Alert (CC-COMB-003) for low Hemoglobin and low Platelets', () => {
      const verified = [
        {
          test_name: 'Hemoglobin',
          value_numeric: 8.9,
          unit: 'g/dL',
          reference_low: 12.0,
          verification_status: 'VERIFIED',
        },
        {
          test_name: 'Platelet Count',
          value_numeric: 90000,
          unit: '/uL',
          reference_low: 150000,
          verification_status: 'VERIFIED',
        },
      ]

      const { triggeredRules } = evaluateMultiIndicatorCombinations(verified)
      const cyto = triggeredRules.find((r) => r.ruleId === 'CC-COMB-003')
      assert.ok(cyto)
      assert.equal(cyto.urgency, 'URGENT')
      assert.ok(cyto.recommendation.includes('peripheral blood smear'))
    })

    it('marks rules as INSUFFICIENT_DATA when required indicators are missing, never negative', () => {
      const verified = [
        {
          test_name: 'Hemoglobin',
          value_numeric: 10.0,
          unit: 'g/dL',
          reference_low: 12.0,
          verification_status: 'VERIFIED',
        },
      ]

      const { triggeredRules, evaluatedRules } = evaluateMultiIndicatorCombinations(verified)
      assert.equal(triggeredRules.length, 0)
      const c1 = evaluatedRules.find((r) => r.id === 'CC-COMB-001')
      assert.equal(c1.status, 'INSUFFICIENT_DATA')
      assert.ok(c1.missingIndicators.includes('MCV'))
      assert.ok(c1.note.includes('Missing data is never treated as negative'))
    })
  })

  describe('Longitudinal Historical Trajectories', () => {
    it('calculates direction and percentage change across dated observations', () => {
      const datedObs = [
        {
          test_name: 'Hemoglobin',
          value_numeric: 11.0,
          unit: 'g/dL',
          report_date: '2026-06-01',
          verification_status: 'VERIFIED',
        },
        {
          test_name: 'Hemoglobin',
          value_numeric: 13.5,
          unit: 'g/dL',
          report_date: '2026-09-01',
          verification_status: 'VERIFIED',
        },
      ]

      const trends = computeHistoricalTrends(datedObs)
      assert.equal(trends.length, 1)
      const hgbTrend = trends[0]
      assert.equal(hgbTrend.testName, 'Hemoglobin')
      assert.equal(hgbTrend.firstRecorded.value, 11.0)
      assert.equal(hgbTrend.latestRecorded.value, 13.5)
      assert.equal(hgbTrend.direction, 'INCREASING')
      assert.equal(hgbTrend.percentageChange, 23)
    })
  })

  describe('Patient Profile & Consent Enforcement', () => {
    it('withholds detailed lab analytics when consent is SUMMARY_ONLY', () => {
      const analysis = generateMedicalReportAnalysis({
        patient: { id: 'p1', mrn: 'CC-001', demographics: { fullName: 'Aarav Sharma' } },
        access: { scope: 'SUMMARY_ONLY' },
        observations: [{ test_name: 'Hemoglobin', value_numeric: 9.0 }],
      })

      assert.equal(analysis.scopeWithheld, true)
      assert.ok(analysis.message.includes('SUMMARY_ONLY'))
      assert.equal(analysis.individualAnomalies, undefined)
      assert.equal(analysis.combinationFindings, undefined)
    })

    it('generates full report analysis with disclaimers for FULL_RECORD scope', () => {
      const analysis = generateMedicalReportAnalysis({
        patient: { id: 'p1', mrn: 'CC-001', demographics: { fullName: 'Aarav Sharma', ageYears: 42 } },
        access: { scope: 'FULL_RECORD' },
        observations: [
          {
            test_name: 'Hemoglobin',
            value_numeric: 6.5,
            unit: 'g/dL',
            reference_low: 12.0,
            reference_range: '12.0 - 17.5',
            is_abnormal: true,
            verification_status: 'VERIFIED',
          },
        ],
        chronicConditions: [{ code: 'E11', name: 'Type 2 Diabetes' }],
        allergies: [{ allergen: 'Penicillin', severity: 'SEVERE' }],
      })

      assert.equal(analysis.scopeWithheld, false)
      assert.equal(analysis.analyzerVersion, ANALYZER_VERSION)
      assert.equal(analysis.individualAnomalies.count, 1)
      assert.equal(analysis.clinicalReviewSummary.urgentSafetyAlert, true)
      assert.ok(analysis.clinicalReviewSummary.clinicalDisclaimer.includes('Decision Support Notice'))
    })
  })
})
