import { useMemo } from 'react'
import { formatDate, titleCase } from '../../lib/format.js'
import { Badge, Card, EmptyState } from '../ui.jsx'

const DX_TONE = { CONFIRMED: 'teal', PROVISIONAL: 'amber', DIFFERENTIAL: 'neutral' }

// Every diagnosis made across the patient's visits: a per-condition summary,
// then the full list newest first.
export default function DiagnosisHistory({ visits }) {
  const { entries, summary } = useMemo(() => {
    const entries = visits.flatMap((v) =>
      v.diagnoses.map((d) => ({ ...d, date: v.date, visitId: v.id, clinician: v.clinician.name })),
    )
    const byCode = new Map()
    for (const e of entries) {
      if (e.type === 'DIFFERENTIAL') continue
      const s = byCode.get(e.code) ?? { code: e.code, name: e.name, count: 0, first: e.date, last: e.date }
      s.count += 1
      if (e.date < s.first) s.first = e.date
      if (e.date > s.last) s.last = e.date
      byCode.set(e.code, s)
    }
    const summary = [...byCode.values()].sort((a, b) => b.count - a.count || b.last.localeCompare(a.last))
    return { entries, summary }
  }, [visits])

  if (entries.length === 0) return <EmptyState>No diagnoses recorded.</EmptyState>

  return (
    <div className="space-y-6">
      <Card title="Conditions diagnosed" subtitle="Confirmed and provisional diagnoses, grouped by condition">
        <ul className="grid gap-2 sm:grid-cols-2">
          {summary.map((s) => (
            <li key={s.code} className="rounded-md bg-slate-50 px-3 py-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium">{s.name}</span>
                <span className="shrink-0 text-xs tabular-nums text-slate-500">×{s.count}</span>
              </div>
              <p className="text-xs text-slate-500">
                <span className="font-mono">{s.code}</span> ·{' '}
                {s.count === 1 ? formatDate(s.first) : `${formatDate(s.first)} to ${formatDate(s.last)}`}
              </p>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="All diagnoses" subtitle="Newest first, including differentials">
        <div className="overflow-x-auto [contain:inline-size]">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-1 pr-3 font-medium">Date</th>
                <th className="py-1 pr-3 font-medium">Diagnosis</th>
                <th className="py-1 pr-3 font-medium">Status</th>
                <th className="py-1 font-medium">Clinician</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {entries.map((e) => (
                <tr key={`${e.visitId}-${e.code}`}>
                  <td className="py-2 pr-3 tabular-nums text-slate-600">{formatDate(e.date)}</td>
                  <td className="py-2 pr-3">
                    <span className={e.isPrimary ? 'font-medium' : ''}>{e.name}</span>{' '}
                    <span className="font-mono text-xs text-slate-500">{e.code}</span>
                  </td>
                  <td className="py-2 pr-3">
                    <Badge tone={DX_TONE[e.type]}>{titleCase(e.type)}</Badge>
                    {e.isPrimary && <span className="ml-1 text-xs text-slate-500">primary</span>}
                  </td>
                  <td className="py-2 text-slate-600">{e.clinician}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
