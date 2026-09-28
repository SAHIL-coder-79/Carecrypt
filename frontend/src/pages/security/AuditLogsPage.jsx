import AuditTrail from '../../components/security/AuditTrail.jsx'
import { Alert, PageHeader } from '../../components/ui.jsx'

// The full audit trail, filterable by action, outcome and role.
export default function AuditLogsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Audit logs"
        title="Audit trail"
        description="Every sign-in, record access, consent change, decision-support run, analytics question and refusal. Append-only and hash-chained: any edit or deletion is detectable."
      />
      <Alert tone="info">
        Patient records appear only as ids and patient accounts as “Patient account”. Diagnoses, prescriptions and
        other clinical details are removed before entries reach this console.
      </Alert>
      <AuditTrail pageSize={50} />
    </div>
  )
}
