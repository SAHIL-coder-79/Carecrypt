import { useState } from 'react'
import { formatDateTime, ROLE_LABEL } from '../../lib/format.js'
import { useApiData } from '../../lib/useApiData.js'
import ServerRefusal from '../ServerRefusal.jsx'
import { Badge, Button, Card, DataTable, EmptyState, Spinner } from '../ui.jsx'

const OUTCOME_TONE = { SUCCESS: 'green', DENIED: 'red', FAILURE: 'amber' }
const ACTIONS = [
  'ACCESS_DENIED', 'LOGIN', 'PATIENT_RECORD_VIEW', 'QR_PATIENT_ACCESS', 'QR_CARD_ISSUE', 'CONSENT_GRANT', 'CONSENT_REVOKE',
  'SMARTCARE_ANALYZE', 'VISIT_CREATE', 'ANALYTICS_VIEW', 'ANALYTICS_QUERY', 'SECURITY_EVENT', 'SECURITY_EVENT_RESOLVE',
  'SECURITY_AUDIT_VIEW',
]

// Audit trail table with filters and paging, newest first.
export default function AuditTrail({ initialFilters = {}, pageSize = 25, title = 'Audit trail' }) {
  const [filters, setFilters] = useState({ action: '', outcome: '', role: '', ...initialFilters })
  const [before, setBefore] = useState(null)
  const qs = new URLSearchParams(
    Object.entries({ ...filters, limit: String(pageSize), ...(before && { before: String(before) }) }).filter(([, v]) => v),
  ).toString()
  const audit = useApiData(`/api/security/audit?${qs}`)

  const change = (key) => (e) => {
    setBefore(null)
    setFilters((f) => ({ ...f, [key]: e.target.value }))
  }
  const select = 'mt-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs focus:border-teal-600 focus:outline-none'

  return (
    <Card
      title={title}
      subtitle="Newest first. Every entry is hash-chained to the one before it."
      bodyClassName="p-0"
      action={
        <div className="flex flex-wrap gap-2 text-xs">
          <label className="text-slate-500">
            Action
            <select className={`${select} ml-1`} value={filters.action} onChange={change('action')}>
              <option value="">All</option>
              {ACTIONS.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </label>
          <label className="text-slate-500">
            Outcome
            <select className={`${select} ml-1`} value={filters.outcome} onChange={change('outcome')}>
              <option value="">All</option>
              <option>SUCCESS</option>
              <option>DENIED</option>
              <option>FAILURE</option>
            </select>
          </label>
          <label className="text-slate-500">
            Role
            <select className={`${select} ml-1`} value={filters.role} onChange={change('role')}>
              <option value="">All</option>
              {Object.entries(ROLE_LABEL).map(([r, l]) => (
                <option key={r} value={r}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </div>
      }
    >
      {audit.error ? (
        <div className="p-4">
          <ServerRefusal error={audit.error} />
        </div>
      ) : !audit.data ? (
        <div className="p-5">
          <Spinner />
        </div>
      ) : audit.data.entries.length === 0 ? (
        <div className="p-5">
          <EmptyState>No entries match.</EmptyState>
        </div>
      ) : (
        <>
          <DataTable
            caption="Audit trail"
            dense
            minWidth="52rem"
            rowKey={(e) => e.sequence}
            rows={audit.data.entries}
            columns={[
              { key: 'seq', header: '#', render: (e) => <span className="tabular-nums text-slate-500">{e.sequence}</span> },
              { key: 'time', header: 'Time', render: (e) => <span className="whitespace-nowrap">{formatDateTime(e.occurredAt)}</span> },
              {
                key: 'who',
                header: 'Who',
                render: (e) =>
                  e.actor ? (
                    <>
                      <span className="text-slate-900">{e.actor.name}</span>
                      <span className="block text-xs text-slate-500">{ROLE_LABEL[e.actor.role] ?? e.actor.role}</span>
                    </>
                  ) : (
                    <span className="text-slate-500">Anonymous</span>
                  ),
              },
              { key: 'action', header: 'Action', render: (e) => <span className="font-mono text-xs">{e.action}</span> },
              { key: 'outcome', header: 'Outcome', render: (e) => <Badge tone={OUTCOME_TONE[e.outcome]}>{e.outcome}</Badge> },
              {
                key: 'patient',
                header: 'Patient record',
                render: (e) => (
                  <span className="font-mono text-xs text-slate-600" title={e.patientRecordId ?? ''}>
                    {e.patientRecordId ? `${e.patientRecordId.slice(0, 8)}…` : '—'}
                  </span>
                ),
              },
              {
                key: 'detail',
                header: 'Detail',
                render: (e) => (
                  <span className="text-xs text-slate-600">
                    {[e.reason, e.resourceId && e.resourceType !== 'session' ? `${e.resourceType} ${e.resourceId}` : null]
                      .filter(Boolean)
                      .join(' · ')}
                    {Object.keys(e.metadata).length > 0 && (
                      <span className="mt-0.5 block break-all font-mono text-[11px] text-slate-500">{JSON.stringify(e.metadata)}</span>
                    )}
                  </span>
                ),
              },
            ]}
          />
          <div className="flex gap-2 px-4 py-3">
            {before && (
              <Button variant="secondary" size="sm" onClick={() => setBefore(null)}>
                Newest
              </Button>
            )}
            {audit.data.nextBefore && (
              <Button variant="secondary" size="sm" onClick={() => setBefore(audit.data.nextBefore)}>
                Older entries
              </Button>
            )}
          </div>
        </>
      )}
    </Card>
  )
}
