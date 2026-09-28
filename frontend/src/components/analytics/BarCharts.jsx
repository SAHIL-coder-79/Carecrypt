import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { categoryColor, categoryLabel, formatCount, HATCH, hiddenText, TOTAL_COLOR } from '../../lib/analytics.js'
import { HatchPattern, HiddenNote, MaybeHiddenBar, TooltipBox } from './common.jsx'

const AXIS_TICK = { fontSize: 11, fill: '#64748b' }
const truncate = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

function cellTooltip(k, titleOf) {
  function CellTooltip({ active, payload }) {
    const cell = payload?.[0]?.payload
    if (!active || !cell) return null
    return (
      <TooltipBox
        title={titleOf(cell)}
        rows={[
          { key: 'c', label: 'Cases', value: formatCount(cell.caseCount) },
          { key: 'p', label: 'Patients', value: formatCount(cell.patientCount) },
        ]}
      />
    )
  }
  return CellTooltip
}

// Horizontal bars, one per visible condition, coloured by category. Hidden
// conditions are listed under the chart without numbers.
export function ConditionBars({ conditions, k }) {
  const visible = conditions.filter((c) => !c.suppressed)
  const hidden = conditions.filter((c) => c.suppressed)

  return (
    <div>
      {visible.length === 0 ? (
        <p className="text-sm text-slate-500">Every condition in this selection is hidden.</p>
      ) : (
        <div style={{ height: Math.max(120, visible.length * 30 + 30) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={visible} layout="vertical" margin={{ top: 0, right: 24, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="#e2e8f0" horizontal={false} />
              <XAxis type="number" allowDecimals={false} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} />
              <YAxis
                type="category"
                dataKey="name"
                width={170}
                tick={AXIS_TICK}
                tickLine={false}
                axisLine={false}
                tickFormatter={(name) => truncate(name, 26)}
              />
              <Tooltip cursor={{ fill: '#f1f5f9' }} content={cellTooltip(k, (c) => `${c.name} (${c.code})`)} />
              <Bar dataKey="caseCount" name="Cases" radius={[0, 3, 3, 0]} isAnimationActive={false}>
                {visible.map((c) => (
                  <Cell key={c.code} fill={categoryColor(c.category)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      {hidden.length > 0 && (
        <div className="mt-3">
          <p className="text-xs text-slate-500">Present but hidden (small groups):</p>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {hidden.map((c) => (
              <li key={c.code} title={hiddenText(c, k)} className="rounded border border-slate-200 px-1.5 py-0.5 text-xs text-slate-600" style={HATCH}>
                {c.name}
                {c.notifiable && <span className="ml-1 text-red-700">·&nbsp;notifiable</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// Compact list of categories with proportional bars.
export function CategoryBars({ categories, k, selected, onSelect }) {
  const max = Math.max(1, ...categories.map((c) => c.caseCount ?? 0))
  return (
    <ul className="space-y-2">
      {categories.map((c) => (
        <li key={c.category}>
          <button
            type="button"
            onClick={() => onSelect(selected === c.category ? '' : c.category)}
            aria-pressed={selected === c.category}
            className={`w-full rounded-md px-2 py-1.5 text-left focus-visible:outline-2 focus-visible:outline-teal-600 ${
              selected === c.category ? 'bg-teal-50 ring-1 ring-teal-200' : 'hover:bg-slate-50'
            }`}
          >
            <span className="flex items-baseline justify-between gap-2 text-xs">
              <span className="flex items-center gap-1.5 font-medium text-slate-800">
                <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: categoryColor(c.category) }} />
                {categoryLabel(c.category)}
              </span>
              <span className={c.suppressed ? 'italic text-slate-400' : 'tabular-nums text-slate-700'}>
                {c.suppressed ? 'Hidden' : `${formatCount(c.caseCount)} cases`}
              </span>
            </span>
            <span className="mt-1 block h-1.5 rounded-full bg-slate-100">
              {c.suppressed ? (
                <span className="block h-1.5 w-full rounded-full" style={HATCH} title={hiddenText(c, k)} />
              ) : (
                <span
                  className="block h-1.5 rounded-full"
                  style={{ width: `${(c.caseCount / max) * 100}%`, background: categoryColor(c.category) }}
                />
              )}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

const AGE_ORDER_LABEL = { '0-4': '0–4', '5-14': '5–14', '15-24': '15–24', '25-44': '25–44', '45-64': '45–64', '65+': '65+' }

// Vertical bars per age band (age at the visit). Hidden bands show as a hatched stub.
export function AgeGroupBars({ ageGroups, k }) {
  const rows = ageGroups.map((a) => ({ ...a, label: AGE_ORDER_LABEL[a.ageBand] ?? a.ageBand, value: a.caseCount ?? 0 }))
  const hiddenCount = rows.filter((r) => r.suppressed).length
  return (
    <div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
            <HatchPattern />
            <CartesianGrid stroke="#e2e8f0" vertical={false} />
            <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} />
            <YAxis allowDecimals={false} tick={AXIS_TICK} tickLine={false} axisLine={false} />
            <Tooltip
              cursor={{ fill: '#f1f5f9' }}
              content={({ active, payload }) => {
                const a = payload?.[0]?.payload
                if (!active || !a) return null
                return (
                  <TooltipBox
                    title={`Age ${a.label}`}
                    rows={
                      a.suppressed
                        ? [{ key: 'h', label: 'Cases', value: hiddenText(a, k), hidden: true }]
                        : [
                            { key: 'c', label: 'Cases', value: formatCount(a.caseCount) },
                            { key: 'p', label: 'Patients', value: formatCount(a.patientCount) },
                          ]
                    }
                  />
                )
              }}
            />
            <Bar dataKey="value" name="Cases" fill={TOTAL_COLOR} shape={MaybeHiddenBar} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <HiddenNote k={k} count={hiddenCount} />
    </div>
  )
}
