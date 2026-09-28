import { useAuth } from '../../auth/context.js'
import { BanIcon, CheckCircleIcon, HistoryIcon, UsersIcon } from '../../components/icons.jsx'
import ServerRefusal from '../../components/ServerRefusal.jsx'
import { Alert, Badge, ButtonLink, Card, DataTable, EmptyState, LoadingState, PageHeader, StatTile } from '../../components/ui.jsx'
import { formatDateTime } from '../../lib/format.js'
import { useApiData } from '../../lib/useApiData.js'

// Who used this patient's record, from the audit log. Only the patient can read
// it; the server refuses everyone else (other roles send a placeholder id and
// get the server's 403, so the refusal is real, not a hidden page).
export default function AccessHistoryPage() {
  const { user } = useAuth()
  const log = useApiData(`/api/patients/${user.patientId ?? 'me'}/access-log`)

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Access history"
        title="Who has used your record"
        description="Every time a clinician opened your record, scanned your card or recorded a visit, and every refused attempt. Taken from CareCrypt's tamper-evident audit log."
        actions={
          <ButtonLink to="/patient/consent" variant="secondary" size="sm">
            Manage access
          </ButtonLink>
        }
      />
      {log.error ? (
        <ServerRefusal error={log.error} />
      ) : !log.data ? (
        <LoadingState label="Loading your access history…" />
      ) : (
        <Content data={log.data} />
      )}
    </div>
  )
}

function Content({ data }) {
  const { summary, entries } = data
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile label="Clinicians who opened your record" value={summary.clinicians} icon={UsersIcon} tone="teal" />
        <StatTile
          label="Accesses by others"
          value={summary.allowedAccesses}
          detail={summary.lastAccessAt ? `Latest ${formatDateTime(summary.lastAccessAt)}` : 'None yet'}
          icon={CheckCircleIcon}
        />
        <StatTile
          label="Refused attempts"
          value={summary.refusedAttempts}
          detail="Blocked by the server"
          tone={summary.refusedAttempts ? 'red' : 'neutral'}
          icon={BanIcon}
        />
      </div>

      {summary.refusedAttempts > 0 && (
        <Alert tone="info" title="Refused attempts were stopped">
          Someone without your consent, or without the right role, tried to use your record. The server refused and
          nothing was shared. If you do not recognise a clinician, revoke their access on the consent page.
        </Alert>
      )}

      <Card title="Activity" subtitle="Newest first. Your own views of your record are not listed." bodyClassName="p-0">
        {entries.length === 0 ? (
          <EmptyState icon={HistoryIcon} title="No activity yet" />
        ) : (
          <DataTable
            caption="Record access history"
            minWidth="36rem"
            rowKey={(e) => e.id}
            rows={entries}
            columns={[
              { key: 'when', header: 'When', render: (e) => <span className="whitespace-nowrap">{formatDateTime(e.occurredAt)}</span> },
              {
                key: 'who',
                header: 'Who',
                render: (e) => (
                  <span>
                    <span className="font-medium text-slate-900">{e.actor.name}</span>
                    {e.actor.facility && <span className="block text-xs text-slate-500">{e.actor.facility}</span>}
                  </span>
                ),
              },
              { key: 'what', header: 'What', render: (e) => e.description },
              {
                key: 'outcome',
                header: 'Outcome',
                render: (e) =>
                  e.outcome === 'ALLOWED' ? <Badge tone="green">Allowed</Badge> : <Badge tone="red">Refused</Badge>,
              },
            ]}
          />
        )}
      </Card>
    </>
  )
}
