// Confidence Engine
// Calculates a confidence score for the AI decision based on data completeness and risk clarity

function calculateConfidence(patientData, generalRiskDetails, maternalRiskDetails, escalationDetails) {
    const reasoning = [];

    // ── Diagnostic Certainty Index (DCI) Components ──────────────────────────

    // 1. Data Completeness (40%)
    const { age, symptoms = [], vitals = {} } = patientData;
    const completenessKeys = ['age', 'bp', 'heart_rate', 'temperature'];
    let presentCount = 0;

    if (age !== undefined && age !== null) presentCount++;
    if (vitals.bp || patientData.bp) presentCount++;
    if (vitals.heart_rate || patientData.pulse) presentCount++;
    if (vitals.temperature || patientData.temperature) presentCount++;

    const completeness = (presentCount / completenessKeys.length);
    reasoning.push(`Data completeness: ${Math.round(completeness * 100)}% (${presentCount}/${completenessKeys.length} key fields)`);

    // 2. Symptom Coherence (30%)
    // Measures if symptoms form a recognized clinical cluster or are sufficiently detailed
    const s = new Set(symptoms);
    let coherence = 0.5; // Base coherence
    if (s.size >= 3) coherence = 1.0;
    else if (s.size >= 2) coherence = 0.8;
    else if (s.size === 1) coherence = 0.6;

    // Bonus for known clusters
    const hasCluster = (generalRiskDetails.reasoningLog || []).some(entry => entry.modifier === 'Symptom Cluster');
    if (hasCluster) {
        coherence = Math.min(1.0, coherence + 0.2);
        reasoning.push('Symptom coherence bonus: clinical cluster identified (+20%)');
    }
    reasoning.push(`Symptom coherence: ${Math.round(coherence * 100)}%`);

    // 3. Vital Alignment (20%)
    // Checks if vitals justify the stated severity/risk
    let alignment = 0.7; // Base alignment
    const isHighRisk = (escalationDetails.riskColor === 'Red');
    const hasCriticalVitals = (generalRiskDetails.vitalFindings || []).some(f => f.includes('CRITICAL'));

    if (isHighRisk && hasCriticalVitals) alignment = 1.0;
    else if (!isHighRisk && !hasCriticalVitals) alignment = 0.9;
    else if (isHighRisk && !hasCriticalVitals) alignment = 0.4; // Disconnect: High risk but stable vitals

    reasoning.push(`Vital alignment score: ${Math.round(alignment * 100)}%`);

    // 4. Conflict Penalty (10% max deduction)
    let conflictPenalty = 0;

    // Conflict 1: fever symptom but temperature is normal
    const hasFeverSymptom = s.has('fever');
    const temp = vitals.temperature || patientData.temperature;
    if (hasFeverSymptom && temp !== undefined && temp < 37.5) {
        conflictPenalty += 0.05;
        reasoning.push('Conflict detected: Fever reported but temperature is normal (-5%)');
    }

    // Conflict 2: severe bleeding but HR/BP stable (possible but suspicious in low-resource setting)
    if (s.has('severe_bleeding') && !hasCriticalVitals) {
        conflictPenalty += 0.05;
        reasoning.push('Conflict detected: Severe bleeding reported with stable vitals (-5%)');
    }

    // ── Final DCI Calculation ────────────────────────────────────────────────
    const rawDCI = (completeness * 0.40) + (coherence * 0.30) + (alignment * 0.20) - conflictPenalty;
    const score = Math.max(0, Math.min(100, Math.round(rawDCI * 100)));

    // Determine Level
    let confidenceLevel = 'Moderate';
    if (score <= 40) confidenceLevel = 'Low';
    else if (score >= 71) confidenceLevel = 'High';

    return {
        confidenceScore: score, // Backward compatibility
        confidenceLevel,
        reasoning,
        dci: {
            score: score,
            components: {
                completeness: Math.round(completeness * 100),
                coherence: Math.round(coherence * 100),
                alignment: Math.round(alignment * 100),
                penalty: Math.round(conflictPenalty * 100)
            },
            label: 'Diagnostic Certainty Index'
        }
    };
}

module.exports = { calculateConfidence };
