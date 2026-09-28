import * as repo from '../patients/repository.js'
import { sectionsFor } from '../patients/access.js'

// Loads the parts of the longitudinal record SmartCare may use, limited to what
// the clinician's consent scope allows. Nothing here is sent to the client except
// through the summary in contextUsed.
export async function loadPatientContext(patientId, grant) {
  const sections = sectionsFor(grant.scope)
  const [patient, chronic, allergies, medications, visits] = await Promise.all([
    repo.getPatient(patientId),
    repo.getChronicConditions(patientId),
    repo.getAllergies(patientId),
    repo.getMedicationHistory(patientId),
    sections.visitHistory ? repo.getVisits(patientId, { limit: 20 }) : Promise.resolve(null),
  ])

  return {
    patient,
    scope: grant.scope,
    chronicConditions: chronic.filter((c) => c.status !== 'RESOLVED'),
    allergies,
    activeMedications: medications.filter((m) => m.is_active),
    visits, // null when the consent scope does not include visit history
  }
}
