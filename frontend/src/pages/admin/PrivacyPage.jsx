import { LockIcon, ShieldCheckIcon } from '../../components/icons.jsx'
import ServerRefusal from '../../components/ServerRefusal.jsx'
import { Alert, Badge, ButtonLink, Card, DataTable, LoadingState, PageHeader, StatTile } from '../../components/ui.jsx'
import { useApiData } from '../../lib/useApiData.js'

const SEVERITY_TONE = { HIGH: 'red', MEDIUM: 'amber', LOW: 'neutral' }

// How analytics protect patients, and the admin's own standing with the
// inference controls. All values come from GET /api/analytics/privacy.
export default function PrivacyPage() {
  const privacy = useApiData('/api/analytics/privacy')

  if (privacy.error) return <ServerRefusal error={privacy.error} title="Analytics are for administrators" />
  if (!privacy.data) return <LoadingState label="Loading privacy controls…" />
  const p = privacy.data
  const me = p.myCustomQueries

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Privacy"
        title="How analytics protect patients"
        description="Administrators see population trends, never individuals. These controls are enforced by the server and the database, not by this page."
      />

      {me.paused ? (
        <Alert tone="danger" title="Your custom questions are paused">
          A security event was raised for a pattern in your recent questions. A security administrator must review it
          before you can ask more. The dashboards remain available.
        </Alert>
      ) : (
        <Alert tone="success" title="Your custom questions are available">
          Keep questions broad. Repeatedly narrowing into small groups is reported to security and pauses custom questions.
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile label="Minimum group size" value={p.minGroupSize} detail="Smaller groups are always hidden" tone="teal" icon={ShieldCheckIcon} />
        <StatTile label={`Your questions, last ${p.inferenceDetection.windowMinutes} minutes`} value={me.inWindow} />
        <StatTile
          label="Of those, suppressed"
          value={me.suppressedInWindow}
          tone={me.suppressedInWindow ? 'amber' : 'neutral'}
        />
      </div>

      <Card title="Protections in force">
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {p.protections.map((x) => (
            <li key={x.key} className="rounded-lg border border-slate-200 p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <ShieldCheckIcon className="h-4 w-4 text-teal-700" />
                {x.title}
              </p>
              <p className="mt-1 text-sm text-slate-600">{x.text}</p>
            </li>
          ))}
        </ul>
      </Card>

      <Card
        title="Inference detection"
        subtitle={`Patterns checked after every custom question, over the last ${p.inferenceDetection.windowMinutes} minutes`}
        bodyClassName="p-0"
      >
        <DataTable
          caption="Inference detection rules"
          minWidth="32rem"
          rowKey={(r) => r.type}
          rows={p.inferenceDetection.rules}
          columns={[
            { key: 'type', header: 'Event', render: (r) => <span className="font-mono text-xs">{r.type}</span> },
            { key: 'severity', header: 'Severity', render: (r) => <Badge tone={SEVERITY_TONE[r.severity]}>{r.severity}</Badge> },
            { key: 'text', header: 'Raised when', render: (r) => <span className="text-slate-700">{r.text}</span> },
          ]}
        />
      </Card>

      <Card title="Individual records">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="flex max-w-2xl items-start gap-2 text-sm text-slate-600">
            <LockIcon className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
            Administrators cannot open patient records. The interface does not hide the page; try it and the server
            refuses, records the attempt and raises a security event.
          </p>
          <ButtonLink to="/patients" variant="secondary" size="sm">
            Try to open the patient list
          </ButtonLink>
        </div>
      </Card>
    </div>
  )
}
