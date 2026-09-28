import { useState } from 'react'
import { useAuth } from '../../auth/context.js'
import { categoryLabel, formatCount, HATCH, monthLabel } from '../../lib/analytics.js'

const AGE_BANDS = ['0-4', '5-14', '15-24', '25-44', '45-64', '65+']
const GENDERS = ['FEMALE', 'MALE', 'OTHER']
const SUPPRESSION_TEXT = {
  SMALL_GROUP: (k) => `Fewer than ${k} patients match. The count is withheld so nobody can be singled out.`,
  DIFFERENCE: (k) =>
    `The answer differs from a broader question by fewer than ${k} patients. Subtracting the two would expose a small group, so it is withheld.`,
}

// "Ask a specific question": one aggregate count for a combination of filters.
// The server answers or suppresses; repeated narrowing is reported to security.
export default function CustomQuery({ districts, categories, conditions, period, k }) {
  const { request } = useAuth()
  const [filters, setFilters] = useState({})
  const [state, setState] = useState({ status: 'idle' })

  const months = []
  if (period) {
    let [y, m] = period.from.split('-').map(Number)
    const [ty, tm] = period.to.split('-').map(Number)
    while (y < ty || (y === ty && m <= tm)) {
      months.push(`${y}-${String(m).padStart(2, '0')}`)
      m += 1
      if (m > 12) [y, m] = [y + 1, 1]
    }
  }

  function set(key, value) {
    setFilters((f) => {
      const next = { ...f }
      if (value) next[key] = value
      else delete next[key]
      // A district implies its state.
      if (key === 'district') {
        const d = districts.find((x) => x.district === value)
        if (d) next.state = d.state
        else delete next.state
      }
      return next
    })
  }

  async function run(e) {
    e.preventDefault()
    setState({ status: 'running' })
    try {
      const qs = new URLSearchParams(filters).toString()
      const body = await request(`/api/analytics/query${qs ? `?${qs}` : ''}`)
      setState({ status: 'done', body })
    } catch (error) {
      setState({ status: 'error', error })
    }
  }

  const select = 'mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20'
  const field = (id, label, key, options) => (
    <div>
      <label htmlFor={id} className="text-xs font-medium text-slate-600">
        {label}
      </label>
      <select id={id} className={select} value={filters[key] ?? ''} onChange={(e) => set(key, e.target.value)}>
        <option value="">Any</option>
        {options.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
    </div>
  )

  return (
    <div className="space-y-4">
      <form onSubmit={run} className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {field('q-district', 'District', 'district', districts.map((d) => [d.district, d.district]))}
        {field('q-category', 'Category', 'category', categories.map((c) => [c, categoryLabel(c)]))}
        {field(
          'q-condition',
          'Condition',
          'condition',
          conditions.map((c) => [c.code, `${c.name} (${c.code})`]),
        )}
        {field('q-month', 'Month', 'month', months.map((m) => [m, monthLabel(m, true)]))}
        {field('q-age', 'Age group', 'ageBand', AGE_BANDS.map((a) => [a, a]))}
        {field('q-gender', 'Gender', 'gender', GENDERS.map((g) => [g, g.charAt(0) + g.slice(1).toLowerCase()]))}
        <div className="flex items-center gap-3 sm:col-span-3 lg:col-span-6">
          <button
            type="submit"
            disabled={state.status === 'running'}
            className="rounded-md bg-teal-700 px-3 py-2 text-sm font-medium text-white hover:bg-teal-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 disabled:opacity-60"
          >
            {state.status === 'running' ? 'Asking…' : 'Count cases'}
          </button>
          <p className="text-xs text-slate-500">
            Every question is logged. Narrowing repeatedly into small groups is reported to security.
          </p>
        </div>
      </form>

      <div aria-live="polite">
        {state.status === 'done' && <Answer body={state.body} k={k} />}
        {state.status === 'error' && <QueryError error={state.error} />}
      </div>
    </div>
  )
}

function Answer({ body, k }) {
  const { result, inferenceControl, filters } = body
  const described = Object.keys(filters).length
    ? Object.entries(filters)
        .filter(([key]) => key !== 'state' || !filters.district)
        .map(([key, v]) => (key === 'category' ? categoryLabel(v) : key === 'month' ? monthLabel(v, true) : v))
        .join(' · ')
    : 'All patients'

  return (
    <div className="space-y-3">
      {result.suppressed ? (
        <div className="rounded-md border border-slate-300 p-4" style={HATCH} role="status">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-600">{described}</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">Suppressed</p>
          <p className="mt-1 max-w-prose text-sm text-slate-700">{SUPPRESSION_TEXT[result.suppression]?.(k) ?? 'Withheld.'}</p>
        </div>
      ) : (
        <div className="rounded-md border border-teal-200 bg-teal-50 p-4" role="status">
          <p className="text-xs font-medium uppercase tracking-wide text-teal-800">{described}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
            {formatCount(result.caseCount)} <span className="text-sm font-normal text-slate-600">cases</span>
          </p>
          <p className="text-sm text-slate-600">{formatCount(result.patientCount)} patients</p>
        </div>
      )}
      {inferenceControl.flagged && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-900" role="alert">
          <p className="font-semibold">Security event raised</p>
          <p className="mt-1">{inferenceControl.message}</p>
        </div>
      )}
    </div>
  )
}

function QueryError({ error }) {
  if (error.body?.error === 'ANALYTICS_QUERY_BLOCKED') {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-900" role="alert">
        <p className="font-semibold">Custom questions are paused</p>
        <p className="mt-1">{error.body.message}</p>
      </div>
    )
  }
  return (
    <p className="rounded-md border border-red-200 bg-white p-3 text-sm text-red-800" role="alert">
      {error.body?.details?.map((d) => `${d.field}: ${d.message}`).join(' ') ?? error.message}
    </p>
  )
}
