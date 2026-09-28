import { Link } from 'react-router'
import { formatDateTime } from '../../lib/format.js'
import { SparkIcon } from '../icons.jsx'
import { Badge, Card, DataTable, EmptyState, StatTile } from '../ui.jsx'

const RISK_TONE = { HIGH: 'red', MODERATE: 'amber', LOW: 'green' }

// The clinician's own SmartCare runs and whether each was reviewed and linked
// to a saved visit (GET /api/smartcare/runs).
export default function SmartCareActivity({ data }) {
  const linked = data.runs.filter((r) => r.status === 'REVIEWED_AND_LINKED').length
  const high = data.runs.filter((r) => r.riskLevel === 'HIGH').length

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile label="Runs (latest 50)" value={data.runs.length} />
        <StatTile label="Reviewed and linked to a visit" value={linked} tone="teal" />
        <StatTile label="High-risk assessments" value={high} tone={high ? 'red' : 'neutral'} />
      </div>

      <Card
        title="Recent runs"
        subtitle={`${data.engine.name} ${data.engine.version}, ${data.engine.method}`}
        bodyClassName="p-0"
      >
        {data.runs.length === 0 ? (
          <EmptyState icon={SparkIcon} title="No SmartCare runs yet">
            Open a patient, choose Add new visit, record symptoms and vitals, then run SmartCare Assist.
          </EmptyState>
        ) : (
          <DataTable
            caption="SmartCare runs"
            rowKey={(r) => r.id}
            rows={data.runs}
            columns={[
              { key: 'when', header: 'When', render: (r) => <span className="whitespace-nowrap">{formatDateTime(r.createdAt)}</span> },
              {
                key: 'patient',
                header: 'Patient',
                render: (r) =>
                  r.patient ? (
                    <Link to={`/clinician/patients/${r.patient.id}`} className="font-medium text-teal-800 hover:underline">
                      {r.patient.fullName}
                    </Link>
                  ) : (
                    <span className="text-slate-500">Consent ended · details withheld</span>
                  ),
              },
              {
                key: 'risk',
                header: 'Risk',
                render: (r) => (r.riskLevel ? <Badge tone={RISK_TONE[r.riskLevel]}>{r.riskLevel}</Badge> : '—'),
              },
              {
                key: 'suggested',
                header: 'Possible conditions',
                render: (r) =>
                  r.suggestedConditions ? (
                    <span className="text-slate-700">
                      {r.suggestedConditions
                        .slice(0, 2)
                        .map((c) => c.name)
                        .join(', ') || '—'}
                    </span>
                  ) : (
                    '—'
                  ),
              },
              {
                key: 'status',
                header: 'Status',
                render: (r) =>
                  r.status === 'REVIEWED_AND_LINKED' ? (
                    <Badge tone="violet">Reviewed · linked to visit</Badge>
                  ) : (
                    <Badge>Not used in a visit</Badge>
                  ),
              },
            ]}
          />
        )}
      </Card>
    </div>
  )
}
