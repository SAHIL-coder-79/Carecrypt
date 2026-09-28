import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { categoryColor, categoryLabel, formatCount, HATCH, hiddenText, TOTAL_COLOR } from '../../lib/analytics.js'
import { HatchPattern, HiddenNote, MaybeHiddenBar, TooltipBox } from './common.jsx'

const AXIS_TICK = { fontSize: 11, fill: '#64748b' }

// Geographic breakdown: cases per district (bar chart), and a district x
// category table shaded by count. With a category chosen, the bars show that
// category only.
export default function LocationBreakdown({ data, k, category }) {
  const districts = data.locations
  const bars = districts.map((d) => {
    const cell = category ? data.byCategory.find((c) => c.district === d.district && c.category === category) : d
    const shown = cell ?? { patientCount: 0, caseCount: 0, suppressed: false }
    return { ...shown, district: d.district, state: d.state, value: shown.caseCount ?? 0 }
  })
  const categories = data.categories
  const max = Math.max(1, ...data.byCategory.map((c) => c.caseCount ?? 0))
  const hiddenCount = bars.filter((b) => b.suppressed).length + data.byCategory.filter((c) => c.suppressed).length

  return (
    <div className="space-y-4">
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={bars} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
            <HatchPattern />
            <CartesianGrid stroke="#e2e8f0" vertical={false} />
            <XAxis dataKey="district" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} interval={0} />
            <YAxis allowDecimals={false} tick={AXIS_TICK} tickLine={false} axisLine={false} />
            <Tooltip
              cursor={{ fill: '#f1f5f9' }}
              content={({ active, payload }) => {
                const b = payload?.[0]?.payload
                if (!active || !b) return null
                return (
                  <TooltipBox
                    title={`${b.district}, ${b.state}${category ? ` · ${categoryLabel(category)}` : ''}`}
                    rows={
                      b.suppressed
                        ? [{ key: 'h', label: 'Cases', value: hiddenText(b, k), hidden: true }]
                        : [
                            { key: 'c', label: 'Cases', value: formatCount(b.caseCount) },
                            { key: 'p', label: 'Patients', value: formatCount(b.patientCount) },
                          ]
                    }
                  />
                )
              }}
            />
            <Bar
              dataKey="value"
              name="Cases"
              fill={category ? categoryColor(category) : TOTAL_COLOR}
              shape={MaybeHiddenBar}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Phones: a compact list per district. The full table needs more width. */}
      <ul className="space-y-3 sm:hidden">
        {districts.map((d) => (
          <li key={d.district} className="rounded-lg border border-slate-200 p-3">
            <p className="flex items-baseline justify-between gap-2 text-sm">
              <span className="font-semibold text-slate-900">
                {d.district} <span className="font-normal text-slate-500">{d.state}</span>
              </span>
              <span className="tabular-nums text-slate-700">
                {d.suppressed ? <span className="italic text-slate-400">Hidden</span> : `${formatCount(d.caseCount)} cases`}
              </span>
            </p>
            <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              {categories.map((c) => {
                const cell = data.byCategory.find((x) => x.district === d.district && x.category === c)
                const value = !cell || (!cell.suppressed && cell.caseCount === 0)
                  ? '–'
                  : cell.suppressed
                    ? cell.suppression === 'COMPLEMENTARY' ? 'hidden' : `<${k}`
                    : formatCount(cell.caseCount)
                return (
                  <li key={c} className={`flex justify-between gap-2 ${category && c !== category ? 'opacity-40' : ''}`}>
                    <span className="flex items-center gap-1.5 text-slate-600">
                      <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: categoryColor(c) }} />
                      {categoryLabel(c)}
                    </span>
                    <span className={`tabular-nums ${cell?.suppressed ? 'italic text-slate-400' : 'text-slate-900'}`}>{value}</span>
                  </li>
                )
              })}
            </ul>
          </li>
        ))}
      </ul>

      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[36rem] border-separate border-spacing-0.5 text-xs">
          <caption className="sr-only">Cases by district and condition category</caption>
          <thead>
            <tr>
              <th scope="col" className="px-2 py-1 text-left font-medium text-slate-500">
                District
              </th>
              {categories.map((c) => (
                <th
                  key={c}
                  scope="col"
                  className={`px-1 py-1 text-center font-medium ${c === category ? 'text-slate-900' : 'text-slate-500'}`}
                >
                  <span aria-hidden="true" className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: categoryColor(c) }} />
                  {categoryLabel(c)}
                </th>
              ))}
              <th scope="col" className="px-2 py-1 text-right font-medium text-slate-500">
                All
              </th>
            </tr>
          </thead>
          <tbody>
            {districts.map((d) => (
              <tr key={d.district}>
                <th scope="row" className="whitespace-nowrap px-2 py-1.5 text-left font-medium text-slate-800">
                  {d.district}
                  <span className="block font-normal text-slate-500">{d.state}</span>
                </th>
                {categories.map((c) => {
                  const cell = data.byCategory.find((x) => x.district === d.district && x.category === c)
                  return <MatrixCell key={c} cell={cell} max={max} k={k} dim={category && c !== category} />
                })}
                <td className="px-2 py-1.5 text-right font-medium tabular-nums text-slate-800">
                  {d.suppressed ? <span className="italic font-normal text-slate-400">Hidden</span> : formatCount(d.caseCount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <HiddenNote k={k} count={hiddenCount}>
        Hatched cells are hidden; blank cells had no cases.
      </HiddenNote>
    </div>
  )
}

function MatrixCell({ cell, max, k, dim }) {
  const base = `h-9 min-w-14 rounded px-1 text-center tabular-nums ${dim ? 'opacity-40' : ''}`
  if (!cell || (!cell.suppressed && cell.caseCount === 0)) {
    return <td className={`${base} bg-slate-50 text-slate-300`}>–</td>
  }
  if (cell.suppressed) {
    return (
      <td className={`${base} text-slate-500`} style={HATCH} title={hiddenText(cell, k)}>
        <span className="sr-only">{hiddenText(cell, k)}</span>
        {/* A complementary cell may hold k or more patients, so only small groups read "<k". */}
        <span aria-hidden="true" className={cell.suppression === 'COMPLEMENTARY' ? 'italic' : ''}>
          {cell.suppression === 'COMPLEMENTARY' ? 'hidden' : `<${k}`}
        </span>
      </td>
    )
  }
  const strength = 0.12 + 0.78 * (cell.caseCount / max)
  return (
    <td
      className={`${base} font-medium ${strength > 0.55 ? 'text-white' : 'text-slate-900'}`}
      style={{ background: `rgba(15, 118, 110, ${strength.toFixed(2)})` }}
      title={`${formatCount(cell.caseCount)} cases, ${formatCount(cell.patientCount)} patients`}
    >
      {formatCount(cell.caseCount)}
    </td>
  )
}
