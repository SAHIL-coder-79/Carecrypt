import { useState } from 'react'
import { Link } from 'react-router'
import { ClipboardIcon } from '../../components/icons.jsx'
import ServerRefusal from '../../components/ServerRefusal.jsx'
import { Badge, Card, DataTable, EmptyState, LoadingState, PageHeader, StatTile } from '../../components/ui.jsx'
import { formatDateTime, VISIT_TYPE_LABEL } from '../../lib/format.js'
import { useApiData } from '../../lib/useApiData.js'

// The clinician's own visits. What each row shows follows the patient's current
// consent, decided by the server.
export default function VisitsPage() {
  const visits = useApiData('/api/clinicians/me/visits?limit=100')

  return (
    <div>
      <PageHeader
        eyebrow="Visits"
        title="Visits you recorded"
        description="Newest first. Details follow each patient's consent today: if a patient has withdrawn access, only the date and type remain visible to you."
      />
      {visits.error ? (
        <ServerRefusal error={visits.error} />
      ) : !visits.data ? (
        <LoadingState label="Loading visits…" />
      ) : (
        <Content list={visits.data.visits} />
      )}
    </div>
  )
}

function Content({ list }) {
  const withheld = list.filter((v) => v.withheld === 'NO_ACTIVE_CONSENT').length
  const reviewed = list.filter((v) => v.decisionSupportReviewed).length
  // Captured once, so the count does not change between renders.
  const [since] = useState(() => Date.now() - 30 * 864e5)
  const month = list.filter((v) => new Date(v.date).getTime() > since).length

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile label="Visits in the last 30 days" value={month} />
        <StatTile label="With reviewed decision support" value={reviewed} tone="teal" />
        <StatTile label="Hidden: consent withdrawn or expired" value={withheld} detail="Date and type only" />
      </div>
      <Card title={`${list.length} most recent visits`} bodyClassName="p-0">
        {list.length === 0 ? (
          <EmptyState icon={ClipboardIcon} title="No visits recorded yet" />
        ) : (
          <DataTable
            caption="Your visits"
            rowKey={(v) => v.id}
            rows={list}
            columns={[
              { key: 'date', header: 'Date', render: (v) => <span className="whitespace-nowrap">{formatDateTime(v.date)}</span> },
              {
                key: 'patient',
                header: 'Patient',
                render: (v) =>
                  v.patient ? (
                    <Link to={`/clinician/patients/${v.patient.id}`} className="font-medium text-teal-800 hover:underline">
                      {v.patient.fullName}
                      <span className="ml-2 font-mono text-xs font-normal text-slate-500">{v.patient.mrn}</span>
                    </Link>
                  ) : (
                    <span className="text-slate-500">Consent ended</span>
                  ),
              },
              { key: 'type', header: 'Type', render: (v) => VISIT_TYPE_LABEL[v.visitType] ?? v.visitType },
              {
                key: 'dx',
                header: 'Primary diagnosis',
                render: (v) =>
                  v.primaryDiagnosis ? (
                    <span>
                      {v.primaryDiagnosis.name}
                      <span className="ml-1.5 font-mono text-xs text-slate-500">{v.primaryDiagnosis.code}</span>
                      {v.primaryDiagnosis.type === 'PROVISIONAL' && (
                        <Badge tone="amber" className="ml-2">
                          Provisional
                        </Badge>
                      )}
                    </span>
                  ) : v.withheld === 'SCOPE' ? (
                    <span className="text-slate-500">Not in consent scope</span>
                  ) : (
                    <span className="text-slate-400">Withheld</span>
                  ),
              },
              {
                key: 'ds',
                header: 'Decision support',
                render: (v) =>
                  v.decisionSupportReviewed ? <Badge tone="violet">Reviewed</Badge> : <span className="text-slate-400">—</span>,
              },
              { key: 'facility', header: 'Facility', render: (v) => <span className="text-slate-600">{v.facility}</span> },
            ]}
          />
        )}
      </Card>
    </div>
  )
}
