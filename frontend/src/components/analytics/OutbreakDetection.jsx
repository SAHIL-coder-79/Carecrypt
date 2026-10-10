import { useEffect, useState } from 'react'
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from 'recharts'
import { useAuth } from '../../auth/context.js'
import { monthLabel } from '../../lib/analytics.js'
import { Card, Spinner } from '../ui.jsx'

export default function OutbreakDetection({ districts, categories, k }) {
  const { request } = useAuth()
  const [district, setDistrict] = useState(districts[0] || 'Bengaluru Urban')
  const [category, setCategory] = useState(categories.find((c) => c === 'INFECTIOUS') || categories[0])

  const [loading, setLoading] = useState(false)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!district || !category) return
    let mounted = true
    setLoading(true)
    request(`/api/analytics/outbreak-detection?district=${encodeURIComponent(district)}&category=${encodeURIComponent(category)}`)
      .then((json) => {
        if (mounted) {
          setData(json)
          setLoading(false)
        }
      })
      .catch((err) => {
        if (mounted) {
          setError(err.message)
          setLoading(false)
        }
      })
    return () => {
      mounted = false
    }
  }, [district, category])

  // Custom Tooltip for Outbreak Detection
  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload || !payload.length) return null
    const row = payload[0].payload
    return (
      <div className="rounded-md border border-slate-200 bg-white p-3 text-xs shadow-md max-w-[250px]">
        <p className="mb-2 font-semibold text-slate-900">{monthLabel(row.month, true)}</p>
        <div className="space-y-1">
          <div className="flex justify-between">
            <span className="text-slate-600">Reported Cases:</span>
            <span className="font-mono font-medium">{row.isSuppressed ? 'Unavailable' : row.caseCount}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Expected Baseline:</span>
            <span className="font-mono text-slate-500">{row.expectedBaseline ?? 'Unavailable'}</span>
          </div>
          {row.anomalyScore > 0 && (
            <div className="flex justify-between">
              <span className="text-slate-600">Deviation:</span>
              <span className="font-mono text-slate-500">+{Math.round(row.anomalyScore * 100)}%</span>
            </div>
          )}
        </div>
        <div className="mt-2 border-t pt-2">
          {row.isAlert && (
            <span className="mb-1 block font-bold text-red-600">
              {row.isSyntheticOutbreak ? 'Synthetic demo alert — not a real outbreak.' : 'OUTBREAK DETECTED'}
            </span>
          )}
          <span className={`block leading-relaxed ${row.isAlert ? 'text-red-700 font-medium' : 'text-slate-500'}`}>{row.explanation}</span>
        </div>
      </div>
    )
  }

  // Determine if there are alerts
  const hasAlerts = data?.results?.some((r) => r.isAlert)
  const isSynthetic = data?.isSynthetic

  return (
    <Card
      title="Outbreak Intelligence"
      subtitle={`Explainable anomaly detection analyzing aggregate counts to flag unusual spikes. Values below ${k} are excluded.`}
    >
      <div className="mb-6 flex gap-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Region</label>
          <select
            value={district}
            onChange={(e) => setDistrict(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600"
          >
            {districts.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Disease Category</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600"
          >
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <Spinner />
      ) : error ? (
        <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-600">Error: {error}</div>
      ) : data ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>
              <strong>Model:</strong> {data.model} | <strong>Threshold:</strong> {data.threshold}
            </span>
            {isSynthetic && <span className="rounded-full bg-orange-100 px-2 py-0.5 font-medium text-orange-800">Synthetic Fallback Data</span>}
          </div>

          <div className="h-72 w-full rounded-md border border-slate-100 bg-white pt-4 pr-4">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data.results}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="month" tickFormatter={(m) => monthLabel(m)} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="expectedBaseline" name="Expected Baseline" fill="#e0f2fe" stroke="#38bdf8" strokeWidth={2} fillOpacity={0.5} connectNulls={false} isAnimationActive={false} />
                <Area type="monotone" dataKey="caseCount" name="Actual Cases" fill="#fee2e2" stroke="#ef4444" strokeWidth={2} fillOpacity={0.5} dot={{ r: 3, fill: '#ef4444', strokeWidth: 2, stroke: '#ffffff' }} connectNulls={false} isAnimationActive={false} />
                {/* Scatter to highlight alerts */}
                <Scatter data={data.results.filter((r) => r.isAlert)} dataKey="caseCount" fill="#b91c1c" shape="circle" isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Explanation Panel */}
          {hasAlerts && (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-4">
              <h4 className="flex items-center gap-2 font-bold text-red-800">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                Why this alert?
              </h4>
              <p className="mt-1 text-sm text-red-700">
                The detector identified a month where the actual reported cases exceeded the 6-month expected baseline by more than 50% (threshold: {data.threshold}). 
                {isSynthetic && ' Note: This specific spike is synthetic demonstration data and not a clinically validated event.'}
              </p>
            </div>
          )}
        </div>
      ) : null}
    </Card>
  )
}
