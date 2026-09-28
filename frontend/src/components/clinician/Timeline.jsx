import { useMemo, useState } from 'react'
import { formatDate, titleCase, VISIT_TYPE_LABEL } from '../../lib/format.js'
import { Badge, EmptyState } from '../ui.jsx'

const TYPE_TONE = { EMERGENCY: 'red', FOLLOW_UP: 'blue', OPD: 'neutral', TELECONSULT: 'violet' }

// Longitudinal timeline: years, then visits, each visit shown as
// Visit → Symptoms → Diagnosis → Treatment.
export default function Timeline({ visits, highlightVisitId }) {
  const [order, setOrder] = useState('oldest')

  const years = useMemo(() => {
    const sorted = [...visits].sort((a, b) =>
      order === 'oldest' ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date),
    )
    const groups = []
    for (const v of sorted) {
      const year = new Date(v.date).getFullYear()
      if (groups.at(-1)?.year !== year) groups.push({ year, visits: [] })
      groups.at(-1).visits.push(v)
    }
    return groups
  }, [visits, order])

  if (visits.length === 0) return <EmptyState>No visits recorded yet.</EmptyState>

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          {visits.length} visits across {years.length} {years.length === 1 ? 'year' : 'years'}
        </p>
        <div role="group" aria-label="Order" className="inline-flex rounded-md border border-slate-200 p-0.5 text-sm">
          {[
            ['oldest', 'Oldest first'],
            ['newest', 'Newest first'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={order === value}
              onClick={() => setOrder(value)}
              className={`rounded px-3 py-1 ${order === value ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <ol className="space-y-2">
        {years.map(({ year, visits: yearVisits }) => (
          <li key={year}>
            <div className="flex items-center gap-3">
              <span className="rounded-md bg-slate-900 px-2.5 py-1 text-sm font-semibold tabular-nums text-white">{year}</span>
              <span className="text-xs text-slate-500">
                {yearVisits.length} {yearVisits.length === 1 ? 'visit' : 'visits'}
              </span>
            </div>
            <ol className="ml-[1.35rem] space-y-4 border-l-2 border-slate-200 py-4 pl-6">
              {yearVisits.map((v) => (
                <TimelineVisit key={v.id} visit={v} highlight={v.id === highlightVisitId} />
              ))}
            </ol>
          </li>
        ))}
      </ol>
    </div>
  )
}

function TimelineVisit({ visit, highlight }) {
  const primary = visit.diagnoses.find((d) => d.isPrimary)
  const others = visit.diagnoses.filter((d) => !d.isPrimary)
  const v = visit.vitals

  return (
    <li className="relative">
      <span
        className={`absolute top-4 -left-[calc(1.5rem+7px)] h-3 w-3 rounded-full ring-4 ring-slate-50 ${
          visit.type === 'EMERGENCY' ? 'bg-red-600' : 'bg-teal-600'
        }`}
        aria-hidden="true"
      />
      <article
        className={`rounded-lg border bg-white ${highlight ? 'border-teal-500 ring-2 ring-teal-500/20' : 'border-slate-200'}`}
      >
        <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-100 px-4 py-2.5">
          <h3 className="text-sm font-semibold tabular-nums">{formatDate(visit.date)}</h3>
          <Badge tone={TYPE_TONE[visit.type]}>{VISIT_TYPE_LABEL[visit.type]}</Badge>
          {highlight && <Badge tone="teal">Just added</Badge>}
          {visit.decisionSupport && <Badge tone="violet">Decision support reviewed</Badge>}
          <span className="text-xs text-slate-500">
            {visit.clinician.name} · {visit.facility.name}
          </span>
        </header>

        <div className="grid gap-2 p-4 md:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] md:gap-3">
          <Stage label="Visit" accent="border-slate-400">
            <p className="text-sm text-slate-800">{visit.chiefComplaint ?? 'No complaint recorded'}</p>
            <p className="mt-1 text-xs tabular-nums text-slate-500">
              {[
                v.temperatureC != null && `${v.temperatureC} °C`,
                v.bloodPressure && `BP ${v.bloodPressure.systolic}/${v.bloodPressure.diastolic}`,
                v.spo2Percent != null && `SpO₂ ${v.spo2Percent}%`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </Stage>
          <Arrow />
          <Stage label="Symptoms" accent="border-amber-400">
            {visit.symptoms.length === 0 ? (
              <p className="text-sm text-slate-500">None recorded</p>
            ) : (
              <ul className="flex flex-wrap gap-1">
                {visit.symptoms.map((s) => (
                  <li key={s.code}>
                    <Badge tone={s.severity === 'SEVERE' ? 'amber' : 'neutral'}>{s.name}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Stage>
          <Arrow />
          <Stage label="Diagnosis" accent="border-teal-500">
            {primary ? (
              <>
                <p className="text-sm font-medium text-slate-900">{primary.name}</p>
                <p className="text-xs text-slate-500">
                  <span className="font-mono">{primary.code}</span> · {titleCase(primary.type)}
                </p>
              </>
            ) : (
              <p className="text-sm text-slate-500">None recorded</p>
            )}
            {others.length > 0 && (
              <p className="mt-1 text-xs text-slate-500">
                Also: {others.map((d) => `${d.name} (${titleCase(d.type).toLowerCase()})`).join('; ')}
              </p>
            )}
          </Stage>
          <Arrow />
          <Stage label="Treatment" accent="border-sky-500">
            {visit.medications.length === 0 ? (
              <p className="text-sm text-slate-500">No medication</p>
            ) : (
              <ul className="space-y-0.5 text-sm text-slate-800">
                {visit.medications.map((m) => (
                  <li key={m.code}>
                    {m.name} <span className="text-slate-500">{m.dose}</span>
                    {m.durationDays && <span className="text-xs text-slate-500"> · {m.durationDays} d</span>}
                  </li>
                ))}
              </ul>
            )}
          </Stage>
        </div>
      </article>
    </li>
  )
}

function Stage({ label, accent, children }) {
  return (
    <section className={`min-w-0 border-l-2 pl-3 md:border-l-0 md:border-t-2 md:pl-0 md:pt-2 ${accent}`}>
      <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</h4>
      {children}
    </section>
  )
}

function Arrow() {
  return (
    <span className="flex items-center justify-start pl-3 text-slate-400 md:justify-center md:pl-0 md:pt-4" aria-hidden="true">
      <span className="md:hidden">↓</span>
      <span className="hidden md:inline">→</span>
    </span>
  )
}
