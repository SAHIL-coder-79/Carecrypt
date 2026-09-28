// Builds the SmartCare request from the visit form. The JSON of this payload is
// also used to tell whether an analysis still matches the form ("stale" otherwise).
export function smartCarePayload(patientId, symptoms, vitals) {
  return {
    patientId,
    currentSymptoms: symptoms.map((s) => ({
      code: s.code,
      severity: s.severity,
      ...(s.durationDays !== '' && { durationDays: Number(s.durationDays) }),
    })),
    vitals: Object.fromEntries(
      ['temperatureC', 'pulseBpm', 'systolic', 'diastolic', 'respiratoryRate', 'spo2Percent']
        .filter((k) => vitals[k] !== '')
        .map((k) => [k, Number(vitals[k])]),
    ),
  }
}
