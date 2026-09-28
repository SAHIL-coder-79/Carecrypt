// Escalation Engine
// Determines final risk level, confidence, and recommended actions based on aggregated data

// Helper: Map category (Low/Medium/High) to standardized color (Green/Amber/Red)
function mapCategoryToColor(category) {
    if (!category) return 'Green';
    const cat = category.toLowerCase();
    if (cat === 'high') return 'Red';
    if (cat === 'medium') return 'Amber';
    return 'Green';
}

function determineEscalation(baseRiskData, maternalRiskData, originalInput = {}, imageTriage = {}) {
    let score = baseRiskData.score;
    const reasons = [...baseRiskData.reasons];

    const { symptoms = [], severity = 'Low', vitals = {} } = originalInput;
    const s = new Set(symptoms);

    // Apply maternal risk modifiers
    if (maternalRiskData && maternalRiskData.isMaternal) {
        score += maternalRiskData.riskScoreModifier;
        if (maternalRiskData.reasons) {
            reasons.push(...maternalRiskData.reasons);
        }
    }

    // Apply image triage escalation modifier (safe: defaults to 0 if not provided)
    const imageModifier = (imageTriage && typeof imageTriage.escalationModifier === 'number')
        ? imageTriage.escalationModifier
        : 0;
    if (imageModifier !== 0) {
        score += imageModifier;
        reasons.push('escalation.reason.image_triage_modifier');
    }

    // Clamp score
    score = Math.min(score, 100);

    // Prepare inputs for intelligent escalation
    const generalRisk = {
        score: score,
        category: score >= 70 ? 'High' : score >= 35 ? 'Medium' : 'Low'
    };

    // Call intelligent escalation to get priority-based overrides
    const intelligentResult = intelligentEscalation({
        generalRisk,
        maternalRisk: maternalRiskData,
        symptoms,
        age: originalInput.age,
        baseRiskData
    });

    // Use intelligent result for risk/urgency/actions
    const riskColor = intelligentResult.riskColor || mapCategoryToColor(generalRisk.category);
    const urgency = intelligentResult.urgency;

    // ── ESCALATION STABILITY GUARD ───────────────────────────────────────────────
    // Prevents accidental Red escalation from stacked minor modifiers.
    // Red is confirmed only if:
    //   (a) a direct critical trigger symptom is present, OR
    //   (b) normalised final score exceeds 85 (high-confidence zone)
    // This does NOT affect cases already classified Red by intelligentEscalation
    // due to severe symptoms (chest pain, seizures, etc.) — those already have
    // hasCriticalTrigger = true naturally.
    const CRITICAL_TRIGGER_SYMPTOMS = [
        'chest_pain', 'breathlessness', 'confusion', 'severe_bleeding',
        'seizures', 'difficulty_swallowing'
    ];
    const hasCriticalTrigger = symptoms.some(sym => CRITICAL_TRIGGER_SYMPTOMS.includes(sym));
    const confirmedRed = hasCriticalTrigger || score > 85;

    let finalRiskColor = riskColor;
    if (riskColor === 'Red' && !confirmedRed) {
        finalRiskColor = 'Amber';
        reasons.push('escalation.reason.stability_guard_downgrade');
        console.log('[EscalationGuard] Red downgraded to Amber: no critical trigger, score', score);
    }

    // Calculate confidence - Maintain original fidelity
    let confidence = 35 + (s.size * 12) + (severity === 'High' ? 15 : 0) + (Object.keys(vitals).length * 5);

    if (s.size === 0) confidence = 25;
    if (baseRiskData.vitalFindings && baseRiskData.vitalFindings.length > 0) confidence += 10;

    confidence = Math.min(95, confidence);

    // Use intelligent recommendations if escalation required
    const suggestedActions = [];
    if (intelligentResult.escalationRequired) {
        suggestedActions.push(intelligentResult.recommendedActionKey);
        // Map other actions based on risk color
        if (riskColor === 'Red') {
            suggestedActions.push('action.emergency_transport');
            suggestedActions.push('action.bls_measures');
        } else if (riskColor === 'Amber') {
            suggestedActions.push('action.monitor_vitals');
            suggestedActions.push('action.prepare_escalation');
        } else {
            suggestedActions.push('action.followup_standard');
        }
    } else {
        suggestedActions.push(intelligentResult.recommendedActionKey);
        suggestedActions.push('action.followup_standard');
        suggestedActions.push('action.patient_education');
    }

    // Add intelligent reasoning to reasons list
    if (intelligentResult.reasoningKeys) {
        reasons.push(...intelligentResult.reasoningKeys);
    }

    return {
        risk: finalRiskColor, // Backward compatibility
        riskColor: finalRiskColor, // Standardized
        confidence,
        suggestedActions,
        finalScore: score,
        allReasons: [...new Set(reasons)], // Deduplicate
        urgency // EXPOSE URGENCY for server.js status logic
    };
}

// Intelligent Escalation Logic
// Determines escalation requirements based on general risk, maternal risk, and symptoms
function intelligentEscalation({ generalRisk, maternalRisk = null, symptoms = [], age = null, baseRiskData = {} }) {
    let escalationLevelKey = 'escalation.level.none';
    let urgencyKey = 'urgency.low';
    let urgencyValue = 'Low';
    let riskColor = 'Green';
    const reasoningKeys = [];
    let escalationRequired = false;
    let recommendedActionKey = 'action.routine_care';

    // ── CRITICAL OVERRIDE: SCORE 100 ─────────────────────────────────────────
    // If the aggregate risk has reached 100, the case is objectively critical.
    if (generalRisk && generalRisk.score >= 100) {
        return {
            escalationRequired: true,
            escalationLevelKey: 'escalation.level.emergency',
            urgency: 'Critical',
            urgencyKey: 'urgency.critical',
            riskColor: 'Red',
            recommendedActionKey: 'action.emergency_eval',
            reasoningKeys: ['escalation.reason.general_high', 'escalation.reason.immediate_eval']
        };
    }

    // Define severe symptoms that override all other rules
    const severeSymptoms = [
        'chest pain', 'chest_pain',
        'breathing difficulty', 'breathing_difficulty', 'breathlessness',
        'seizures', 'seizure'
    ];

    // Check for severe symptoms (HIGHEST PRIORITY)
    const hasSevereSymptom = symptoms.some(symptom =>
        severeSymptoms.some(severe => symptom.toLowerCase().includes(severe.toLowerCase()))
    );

    if (hasSevereSymptom) {
        // Nuance for isolated symptoms in low-risk profiles
        const isAged = age && age > 45;
        const hasVitalIssues = (baseRiskData.vitalFindings || []).some(f => f.includes('CRITICAL'));
        const isMaternalHigh = maternalRisk && maternalRisk.riskScoreModifier >= 25;

        // Scenario: Isolated chest pain in a young person with no vital issues -> Amber
        // BUT: If the score is already high (>75), don't downgrade
        if (symptoms.length === 1 && symptoms.includes('chest_pain') && !isAged && !hasVitalIssues && generalRisk.score < 75) {
            urgencyValue = 'High';
            urgencyKey = 'urgency.high';
            riskColor = 'Amber';
            reasoningKeys.push('escalation.reason.isolated_chest_pain_young');
            recommendedActionKey = 'action.urgent_clinical_eval';
        }
        // Scenario: Altered mental status / Seizures / Severe Airway -> ALWAYS RED
        else if (symptoms.some(s => ['seizures', 'confusion', 'difficulty_swallowing'].includes(s))) {
            escalationRequired = true;
            escalationLevelKey = 'escalation.level.emergency';
            urgencyValue = 'Critical';
            urgencyKey = 'urgency.critical';
            riskColor = 'Red';
            reasoningKeys.push('escalation.reason.neurological_airway_emergency');
            recommendedActionKey = 'action.call_emergency';
        }
        // Scenario: Breathlessness with stable vitals -> Amber (unless COPD/Heart history)
        else if (symptoms.includes('breathlessness') && !hasVitalIssues && generalRisk.score < 75) {
            urgencyValue = 'High';
            urgencyKey = 'urgency.high';
            riskColor = 'Amber';
            reasoningKeys.push('escalation.reason.stable_respiratory_effort');
            recommendedActionKey = 'action.primary_eval';
        }
        else {
            escalationRequired = true;
            escalationLevelKey = 'escalation.level.emergency';
            urgencyValue = 'Critical';
            urgencyKey = 'urgency.critical';
            riskColor = 'Red';
            reasoningKeys.push('escalation.reason.severe_symptoms');
            reasoningKeys.push('escalation.reason.immediate_intervention');
            recommendedActionKey = 'action.call_emergency';
        }

        return {
            escalationRequired,
            escalationLevelKey,
            urgency: urgencyValue,
            urgencyKey,
            riskColor,
            recommendedActionKey,
            reasoningKeys
        };
    }

    // Additional checks for non-severe but concerning patterns
    if (age < 5 && symptoms.includes('fever') && baseRiskData.score > 40) {
        urgencyValue = 'Medium';
        urgencyKey = 'urgency.medium';
        riskColor = 'Amber';
        reasoningKeys.push('escalation.reason.pediatric_fever_caution');
        recommendedActionKey = 'action.primary_eval';

        return {
            escalationRequired: true,
            escalationLevelKey: 'escalation.level.primary',
            urgency: urgencyValue,
            urgencyKey,
            riskColor,
            recommendedActionKey,
            reasoningKeys
        };
    }

    // Check maternal risk (SECOND PRIORITY)
    // NOTE: maternalRisk from evaluateMaternalRisk uses riskScoreModifier
    const mRiskScore = maternalRisk ? (maternalRisk.riskScoreModifier || 0) : 0;
    if (maternalRisk && maternalRisk.isMaternal && mRiskScore >= 25) {
        escalationRequired = true;
        escalationLevelKey = 'escalation.level.specialist';
        urgencyKey = 'urgency.critical'; // High maternal modifier is critical
        reasoningKeys.push('escalation.reason.maternal_high');
        reasoningKeys.push('escalation.reason.specialized_care');
        recommendedActionKey = 'action.urgent_obgyn';

        return {
            escalationRequired,
            escalationLevelKey,
            urgency: 'Critical',
            urgencyKey,
            riskColor: 'Red',
            recommendedActionKey,
            reasoningKeys
        };
    }

    // Check general risk category (THIRD PRIORITY) - Score based classification
    if (generalRisk && generalRisk.category === 'High') {
        escalationRequired = true;
        escalationLevelKey = 'escalation.level.emergency';
        urgencyKey = 'urgency.critical';
        reasoningKeys.push('escalation.reason.general_high');
        reasoningKeys.push('escalation.reason.immediate_eval');
        recommendedActionKey = 'action.emergency_eval';

        return {
            escalationRequired,
            escalationLevelKey,
            urgency: 'Critical',
            urgencyKey,
            riskColor: 'Red',
            recommendedActionKey,
            reasoningKeys
        };
    }

    if (generalRisk && generalRisk.category === 'Medium') {
        escalationRequired = true;
        escalationLevelKey = 'escalation.level.primary';
        urgencyKey = 'urgency.medium';
        reasoningKeys.push('escalation.reason.general_medium');
        reasoningKeys.push('escalation.reason.clinical_eval');
        recommendedActionKey = 'action.primary_eval';

        return {
            escalationRequired,
            escalationLevelKey,
            urgency: 'Medium',
            urgencyKey,
            riskColor: 'Amber',
            recommendedActionKey,
            reasoningKeys
        };
    }

    // Check for moderate maternal risk
    if (maternalRisk && maternalRisk.isMaternal && mRiskScore > 0) {
        escalationRequired = true;
        escalationLevelKey = 'escalation.level.primary';
        urgencyKey = 'urgency.medium';
        reasoningKeys.push('escalation.reason.maternal_moderate');
        reasoningKeys.push('escalation.reason.enhanced_prenatal');
        recommendedActionKey = 'action.prenatal_followup';

        return {
            escalationRequired,
            escalationLevelKey,
            urgency: 'Medium',
            urgencyKey,
            riskColor: 'Amber',
            recommendedActionKey,
            reasoningKeys
        };
    }

    // Check for persistent moderate symptoms (FOURTH PRIORITY)
    const moderateSymptoms = ['fever', 'vomiting', 'diarrhea', 'cough', 'abdominal_pain'];
    const hasPersistentModerate = symptoms.some(s => moderateSymptoms.includes(s)) && (baseRiskData.duration >= 3 || baseRiskData.severity === 'High');

    if (hasPersistentModerate && generalRisk.score >= 40) {
        escalationRequired = true;
        escalationLevelKey = 'escalation.level.primary';
        urgencyValue = 'Medium';
        urgencyKey = 'urgency.medium';
        riskColor = 'Amber';
        reasoningKeys.push('escalation.reason.persistent_symptoms');
        recommendedActionKey = 'action.primary_eval';

        return {
            escalationRequired,
            escalationLevelKey,
            urgency: urgencyValue,
            urgencyKey,
            riskColor,
            recommendedActionKey,
            reasoningKeys
        };
    }

    // Low risk - no escalation needed
    if (generalRisk && generalRisk.category === 'Low' || generalRisk.score < 35) {
        reasoningKeys.push('escalation.reason.general_low');
        reasoningKeys.push('escalation.reason.no_immediate');
        recommendedActionKey = 'action.routine_care_followup';
        riskColor = 'Green';
        urgencyValue = 'Low';
        urgencyKey = 'urgency.low';
    } else {
        reasoningKeys.push('escalation.reason.no_risk_factors');
        recommendedActionKey = 'action.routine_care';
        riskColor = 'Green';
        urgencyValue = 'Low';
        urgencyKey = 'urgency.low';
    }

    // Final urgency/color normalization
    if (urgencyKey === 'urgency.critical') { riskColor = 'Red'; urgencyValue = 'Critical'; }
    else if (urgencyKey === 'urgency.high') { riskColor = 'Amber'; urgencyValue = 'High'; }
    else if (urgencyKey === 'urgency.medium') { riskColor = 'Amber'; urgencyValue = 'Medium'; }

    return {
        escalationRequired,
        escalationLevelKey,
        urgency: urgencyValue,
        urgencyKey,
        riskColor,
        recommendedActionKey,
        reasoningKeys
    };
}

module.exports = { determineEscalation, intelligentEscalation };
