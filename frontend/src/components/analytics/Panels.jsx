import { formatCount, monthLabel } from '../../lib/analytics.js'
import { AlertTriangleIcon } from '../icons.jsx'
import ServerRefusal from '../ServerRefusal.jsx'
import { Card, EmptyState, Spinner } from '../ui.jsx'

// Loading and error states for one analytics panel.
export function Panel({ state, children }) {
  if (state.error) return <ServerRefusal error={state.error} />
  if (!state.data) return <Spinner />
  return children(state.data)
}

// Notifiable-disease clusters that pass the minimum-group check.
export function Signals({ signals, k }) {
  const latest = signals.slice(0, 6)
  return (
    <Card
      title="Notifiable disease clusters"
      subtitle={`Last three months: a district with at least ${k} patients diagnosed with a notifiable disease in one month`}
    >
      {latest.length === 0 ? (
        <EmptyState icon={AlertTriangleIcon} title="No cluster large enough to report">
          Clusters smaller than {k} patients stay hidden.
        </EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {latest.map((s) => (
            <li
              key={`${s.month}-${s.district}-${s.code}`}
              className="flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50/60 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                  <AlertTriangleIcon className="h-4 w-4 shrink-0 text-red-600" />
                  {s.name}
                </p>
                <p className="mt-0.5 text-xs text-slate-600">
                  {s.district}, {s.state} · {monthLabel(s.month, true)}
                </p>
              </div>
              <p className="shrink-0 text-right">
                <span className="block text-xl font-semibold tabular-nums text-slate-900">{formatCount(s.patientCount)}</span>
                <span className="block text-xs text-slate-500">patients</span>
              </p>
            </li>
          ))}
        </ul>
      )}
      {signals.length > latest.length && (
        <p className="mt-3 text-xs text-slate-500">
          Showing the {latest.length} most recent of {signals.length}.
        </p>
      )}
    </Card>
  )
}
