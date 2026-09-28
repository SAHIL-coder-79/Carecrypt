import { formatCount, HATCH } from '../../lib/analytics.js'
import { StatTile } from '../ui.jsx'

// Headline number in the shared stat-tile style; null means suppressed.
export function Kpi({ label, value, detail, tone, icon }) {
  return <StatTile label={label} value={value === null ? null : formatCount(value)} detail={detail} tone={tone} icon={icon} />
}

// Two or more mutually exclusive options, as a row of toggle buttons.
export function Segmented({ label, value, options, onChange }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-md border border-slate-300 bg-white p-0.5 text-xs">
      {options.map(([key, text]) => (
        <button
          key={key}
          type="button"
          aria-pressed={value === key}
          onClick={() => onChange(key)}
          className={`rounded px-2.5 py-1 font-medium focus-visible:outline-2 focus-visible:outline-teal-600 ${
            value === key ? 'bg-teal-700 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          {text}
        </button>
      ))}
    </div>
  )
}

export function CategorySelect({ id, value, categories, onChange, labelFor }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <label htmlFor={id} className="text-slate-500">
        Category
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
      >
        <option value="">All categories</option>
        {categories.map((c) => (
          <option key={c} value={c}>
            {labelFor(c)}
          </option>
        ))}
      </select>
    </div>
  )
}

// Explains hidden values under a chart.
export function HiddenNote({ k, count, children }) {
  if (!count) return null
  return (
    <p className="mt-3 flex items-start gap-2 text-xs text-slate-500">
      <span aria-hidden="true" className="mt-0.5 inline-block h-3 w-3 shrink-0 rounded-sm border border-slate-300" style={HATCH} />
      <span>
        {count} {count === 1 ? 'value is' : 'values are'} hidden to protect small groups (fewer than {k} patients, or needed
        to keep such a group from being worked out). {children}
      </span>
    </p>
  )
}

// Tooltip box shared by the charts.
export function TooltipBox({ title, rows }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
      <p className="mb-1 font-semibold text-slate-900">{title}</p>
      <ul className="space-y-0.5">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center gap-2">
            {r.color && <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: r.color }} />}
            <span className="text-slate-600">{r.label}</span>
            <span className={`ml-auto pl-3 tabular-nums ${r.hidden ? 'italic text-slate-400' : 'font-medium text-slate-900'}`}>
              {r.value}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// Bar shape for Recharts: a normal bar, or for a hidden cell a hatched stub
// labelled "Hidden", so a hidden value never looks like zero. Hidden rows must
// have a value of 0. Needs <HatchPattern /> inside the same chart.
export function MaybeHiddenBar({ x, y, width, height, fill, payload }) {
  if (payload?.suppressed) {
    const stub = 22
    return (
      <g>
        <rect x={x} y={y - stub} width={width} height={stub} rx={3} fill="url(#hidden-hatch)" stroke="#cbd5e1" />
        <text x={x + width / 2} y={y - stub / 2 + 4} textAnchor="middle" fontSize={10} fill="#64748b">
          Hidden
        </text>
      </g>
    )
  }
  if (!height) return null
  return <rect x={x} y={y} width={width} height={height} rx={3} fill={fill} />
}

export function HatchPattern() {
  return (
    <defs>
      <pattern id="hidden-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="5" height="5" fill="#f8fafc" />
        <line x1="0" y1="0" x2="0" y2="5" stroke="#e2e8f0" strokeWidth="3" />
      </pattern>
    </defs>
  )
}
