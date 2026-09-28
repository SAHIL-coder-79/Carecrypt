import { useMemo, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { categoryColor, categoryLabel, formatCount, hiddenText, monthLabel, TOTAL_COLOR } from '../../lib/analytics.js'
import { HiddenNote, Segmented, TooltipBox } from './common.jsx'

// Line chart of cases per month: the total, or one line per condition category.
// A hidden month is a gap in the line, never a zero.
export default function TrendChart({ data, k, rankedCategories }) {
  const [mode, setMode] = useState('total')
  const [picked, setPicked] = useState(null)
  const shown = picked ?? rankedCategories.slice(0, 4)

  const rows = useMemo(() => {
    const byMonth = new Map(data.months.map((m) => [m.month, { month: m.month, TOTAL: m.caseCount, TOTAL_cell: m }]))
    for (const c of data.byCategory) {
      const row = byMonth.get(c.month)
      if (row) Object.assign(row, { [c.category]: c.caseCount, [`${c.category}_cell`]: c })
    }
    return [...byMonth.values()]
  }, [data])

  const series = mode === 'total' ? [{ key: 'TOTAL', label: 'All cases', color: TOTAL_COLOR }] : shown.map((c) => ({ key: c, label: categoryLabel(c), color: categoryColor(c) }))
  const hiddenCount = rows.reduce((n, r) => n + series.filter((s) => r[`${s.key}_cell`]?.suppressed).length, 0)

  function toggle(category) {
    const next = shown.includes(category) ? shown.filter((c) => c !== category) : [...shown, category]
    setPicked(rankedCategories.filter((c) => next.includes(c)))
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Segmented
          label="Trend view"
          value={mode}
          onChange={setMode}
          options={[
            ['total', 'All cases'],
            ['category', 'By condition category'],
          ]}
        />
        {mode === 'category' && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Categories shown">
            {rankedCategories.map((c) => {
              const on = shown.includes(c)
              return (
                <button
                  key={c}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(c)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs focus-visible:outline-2 focus-visible:outline-teal-600 ${
                    on ? 'border-slate-300 bg-white text-slate-800' : 'border-transparent bg-slate-100 text-slate-400'
                  }`}
                >
                  <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: on ? categoryColor(c) : '#cbd5e1' }} />
                  {categoryLabel(c)}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: -8 }}>
            <CartesianGrid stroke="#e2e8f0" vertical={false} />
            <XAxis dataKey="month" tickFormatter={(m) => monthLabel(m)} tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} />
            <Tooltip
              content={({ active, payload }) => {
                const row = payload?.[0]?.payload
                if (!active || !row) return null
                return (
                  <TooltipBox
                    title={monthLabel(row.month, true)}
                    rows={series.map((s) => {
                      const cell = row[`${s.key}_cell`]
                      return {
                        key: s.key,
                        label: s.label,
                        color: s.color,
                        hidden: cell?.suppressed,
                        value: cell?.suppressed ? hiddenText(cell, k) : `${formatCount(cell?.caseCount ?? 0)} cases · ${formatCount(cell?.patientCount ?? 0)} patients`,
                      }
                    })}
                  />
                )
              }}
            />
            {series.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={s.color}
                strokeWidth={2}
                dot={{ r: 2.5 }}
                activeDot={{ r: 4 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <HiddenNote k={k} count={hiddenCount}>
        Hidden months appear as gaps in the line.
      </HiddenNote>
    </div>
  )
}
