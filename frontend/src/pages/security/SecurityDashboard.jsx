import { Link } from 'react-router'
import { Kpi } from '../../components/analytics/common.jsx'
import { AlertTriangleIcon, BanIcon, CheckCircleIcon, FileTextIcon, KeyIcon, LockIcon } from '../../components/icons.jsx'
import AuditTrail from '../../components/security/AuditTrail.jsx'
import EventItem from '../../components/security/EventItem.jsx'
import ServerRefusal from '../../components/ServerRefusal.jsx'
import { ButtonLink, Card, DataTable, EmptyState, LoadingState, PageHeader } from '../../components/ui.jsx'
import { formatDateTime, ROLE_LABEL } from '../../lib/format.js'
import { useApiData } from '../../lib/useApiData.js'

// SECURITY_ADMIN overview: what needs attention now, and whether the audit log
// is intact. Patients appear only as record ids anywhere in the console.
export default function SecurityDashboard() {
  const summary = useApiData('/api/security/summary')
  const allowed = Boolean(summary.data)
  const events = useApiData(allowed && '/api/security/events?status=OPEN')

  if (summary.error) return <ServerRefusal error={summary.error} title="The security console is for security administrators" />
  if (!summary.data) return <LoadingState label="Loading security overview…" />
  const s = summary.data

  function refresh() {
    summary.reload()
    events.reload()
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Security dashboard"
        title="Security monitoring"
        description="Security events to review and the health of the tamper-evident audit trail. No clinical details are shown in this console."
        actions={
          <>
            <ButtonLink to="/security/events" variant="secondary" size="sm">
              All events
            </ButtonLink>
            <ButtonLink to="/security/audit" variant="secondary" size="sm">
              Audit logs
            </ButtonLink>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi
          label="Open security events"
          value={s.openEvents.total}
          detail={`${s.openEvents.HIGH} high · ${s.openEvents.MEDIUM} medium · ${s.openEvents.LOW} low`}
          tone={s.openEvents.HIGH ? 'red' : s.openEvents.total ? 'amber' : 'neutral'}
          icon={AlertTriangleIcon}
        />
        <Kpi label="Refused requests" value={s.last24Hours.deniedRequests} detail="Last 24 hours" icon={BanIcon} />
        <Kpi label="Failed sign-ins" value={s.last24Hours.failedLogins} detail="Last 24 hours" icon={KeyIcon} />
        <Kpi
          label="Custom analytics questions"
          value={s.last24Hours.analyticsQueries}
          detail={`${s.last24Hours.suppressedAnalyticsQueries} suppressed · last 24 hours`}
        />
        <div
          className={`rounded-xl border px-4 py-3.5 shadow-sm ${
            s.auditLog.chainIntact ? 'border-emerald-200 bg-emerald-50' : 'border-red-300 bg-red-50'
          }`}
        >
          <p className="text-xs font-medium text-slate-600">Audit log integrity</p>
          <p
            className={`mt-1.5 flex items-center gap-1.5 text-lg font-semibold ${
              s.auditLog.chainIntact ? 'text-emerald-800' : 'text-red-800'
            }`}
          >
            {s.auditLog.chainIntact ? <CheckCircleIcon className="h-5 w-5" /> : <LockIcon className="h-5 w-5" />}
            {s.auditLog.chainIntact ? 'Hash chain intact' : `Broken at entry ${s.auditLog.brokenAtSequence}`}
          </p>
          <p className="text-xs text-slate-600">
            {s.auditLog.entries.toLocaleString('en-IN')} entries · last {formatDateTime(s.auditLog.lastEntryAt)}
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card
          className="lg:col-span-2"
          title="Needs review"
          subtitle="Open security events, most severe first"
          action={
            <Link to="/security/events" className="text-xs font-medium text-teal-800 hover:underline">
              View all
            </Link>
          }
        >
          {events.error ? (
            <ServerRefusal error={events.error} />
          ) : !events.data ? (
            <LoadingState rows={2} />
          ) : events.data.events.length === 0 ? (
            <EmptyState icon={CheckCircleIcon} title="No open security events">
              Inference attempts, refused access to patient data and locked accounts appear here.
            </EmptyState>
          ) : (
            <ul className="space-y-3">
              {events.data.events.slice(0, 3).map((e) => (
                <EventItem key={e.id} event={e} onResolved={refresh} />
              ))}
            </ul>
          )}
        </Card>

        <Card title="Refused requests, last 7 days" subtitle="By role and protected resource" bodyClassName="p-0">
          <DataTable
            caption="Refused requests by role and resource"
            minWidth="18rem"
            dense
            rowKey={(d) => `${d.role}-${d.resource}`}
            rows={s.deniedLast7Days}
            empty="No refusals."
            columns={[
              { key: 'role', header: 'Role', render: (d) => ROLE_LABEL[d.role] ?? d.role ?? 'Unknown' },
              { key: 'resource', header: 'Resource', render: (d) => <span className="font-mono text-xs">{d.resource}</span> },
              { key: 'count', header: 'Count', align: 'right', render: (d) => d.count },
            ]}
          />
        </Card>
      </div>

      <AuditTrail title="Latest refused requests" initialFilters={{ outcome: 'DENIED' }} pageSize={8} />

      <p className="flex items-center gap-2 text-xs text-slate-500">
        <FileTextIcon className="h-4 w-4" />
        Every view of this console is itself recorded in the audit log (SECURITY_AUDIT_VIEW).
      </p>
    </div>
  )
}
