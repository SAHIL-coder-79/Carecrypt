// Maternal Health Risk Engine
// Dedicated logic for pregnancy and maternal health assessments

function evaluateMaternalRisk({ age, symptoms = [], medicalHistory = [], vitals = {} }) {
    const isPregnant = medicalHistory.includes('pregnancy') || medicalHistory.includes('pregnant');
    const reasons = [];
    let riskScoreModifier = 0;

    if (isPregnant) {
        if (age < 18) {
            riskScoreModifier += 15;
            reasons.push('maternal.reason.age_under_18');
        } else if (age > 35) {
            riskScoreModifier += 15;
            reasons.push('maternal.reason.age_over_35');
        }

        if (vitals.bp_systolic >= 140 || vitals.bp_diastolic >= 90) {
            riskScoreModifier += 30;
            reasons.push('maternal.reason.preeclampsia_risk');
        }
    }

    return {
        isMaternal: isPregnant,
        riskScoreModifier,
        reasons
    };
}

// Weighted Maternal Risk Scoring System
// Comprehensive assessment for pregnancy-related risks
function calculateMaternalRiskScore({ pregnancyWeeks, bp, hemoglobin, age, previousComplications = false, symptoms = [] }) {
    let maternalScore = 0;
    const explanation = [];

    // Parse BP from string format "120/80"
    let systolicBP = null;
    if (bp && typeof bp === 'string') {
        const bpParts = bp.split('/');
        if (bpParts.length === 2) {
            systolicBP = parseInt(bpParts[0], 10);
        }
    }

    // 1. Age-based risk
    if (age !== undefined && age !== null) {
        if (age < 18) {
            maternalScore += 15;
            explanation.push({ key: 'maternal.exp.age_young', val: age });
        } else if (age > 35) {
            maternalScore += 15;
            explanation.push({ key: 'maternal.exp.age_advanced', val: age });
        }
    }

    // 2. Blood Pressure assessment
    if (systolicBP !== null && systolicBP >= 140) {
        maternalScore += 20;
        explanation.push({ key: 'maternal.exp.bp_high', val: systolicBP });
    }

    // 3. Hemoglobin assessment (anemia screening)
    if (hemoglobin !== undefined && hemoglobin !== null && hemoglobin < 10) {
        maternalScore += 20;
        explanation.push({ key: 'maternal.exp.anemia', val: hemoglobin });
    }

    // 4. Previous pregnancy complications
    if (previousComplications === true) {
        maternalScore += 25;
        explanation.push({ key: 'maternal.exp.prev_complications' });
    }

    // 5. High-risk maternal symptoms
    const maternalRiskSymptoms = ['swelling', 'severe headache', 'severe_headache', 'headache', 'blurred vision', 'blurred_vision'];
    const hasRiskSymptom = symptoms.some(symptom =>
        maternalRiskSymptoms.some(risk => symptom.toLowerCase().includes(risk.toLowerCase()))
    );

    if (hasRiskSymptom) {
        maternalScore += 20;
        explanation.push({ key: 'maternal.exp.risk_symptoms' });
    }

    // Cap score at 100
    maternalScore = Math.min(maternalScore, 100);

    // Determine maternal risk level
    let maternalRiskLevelKey;
    if (maternalScore <= 30) {
        maternalRiskLevelKey = 'maternal.level.normal';
    } else if (maternalScore <= 60) {
        maternalRiskLevelKey = 'maternal.level.moderate';
    } else {
        maternalRiskLevelKey = 'maternal.level.high';
    }

    return {
        maternalScore,
        maternalRiskLevel: maternalRiskLevelKey, // frontend will translate this key
        explanation
    };
}

module.exports = { evaluateMaternalRisk, calculateMaternalRiskScore };
