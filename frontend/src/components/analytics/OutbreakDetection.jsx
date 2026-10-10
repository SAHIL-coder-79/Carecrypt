import { useState, useEffect } from 'react'
import { Card, Spinner } from '../ui.jsx'
import { useApiData } from '../../lib/useApiData.js'

export default function OutbreakDetection({ districts, categories, k }) {
  const [district, setDistrict] = useState(districts[0] || 'Bengaluru Urban')
  const [category, setCategory] = useState(categories.find(c => c === 'INFECTIOUS') || categories[0])
  
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!district || !category) return
    let mounted = true
    setLoading(true)
    fetch(`/api/analytics/outbreak-detection?district=${encodeURIComponent(district)}&category=${encodeURIComponent(category)}`, {
      headers: {
        Authorization: `Bearer ${localStorage.getItem('token')}`
      }
    })
      .then(res => {
        if (!res.ok) throw new Error('Failed to fetch')
        return res.json()
      })
      .then(json => {
        if (mounted) {
          setData(json)
          setLoading(false)
        }
      })
      .catch(err => {
        if (mounted) {
          setError(err.message)
          setLoading(false)
        }
      })
    return () => { mounted = false }
  }, [district, category])

  return (
    <Card 
      title="Outbreak Anomaly Detection" 
      subtitle={`Analyzes historical aggregate counts to detect unusual spikes. Values below ${k} are strictly excluded and flagged as unavailable.`}
    >
      <div className="flex gap-4 mb-4">
        <div>
          <label className="block text-sm font-medium mb-1">Region</label>
          <select 
            value={district} 
            onChange={e => setDistrict(e.target.value)}
            className="rounded border-slate-300 shadow-sm"
          >
            {districts.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Disease Category</label>
          <select 
            value={category} 
            onChange={e => setCategory(e.target.value)}
            className="rounded border-slate-300 shadow-sm"
          >
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>
      
      {loading ? (
        <Spinner />
      ) : error ? (
        <div className="text-red-600">Error: {error}</div>
      ) : data ? (
        <div className="space-y-4">
          <div className="flex justify-between items-center text-sm text-slate-500">
            <span>Model: {data.model}</span>
            <span>Threshold: {data.threshold}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b">
                  <th className="py-2 px-3 font-semibold text-sm">Month</th>
                  <th className="py-2 px-3 font-semibold text-sm text-right">Aggregate Count</th>
                  <th className="py-2 px-3 font-semibold text-sm text-right">Baseline</th>
                  <th className="py-2 px-3 font-semibold text-sm">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.results.map(r => (
                  <tr key={r.month} className={`border-b ${r.isAlert ? 'bg-red-50' : ''} ${r.isSyntheticOutbreak ? 'border-red-300' : ''}`}>
                    <td className="py-2 px-3 whitespace-nowrap text-sm">{r.month}</td>
                    <td className="py-2 px-3 text-right text-sm font-mono">
                      {r.isSuppressed ? (
                        <span className="text-slate-400 italic">Unavailable (&lt;{k})</span>
                      ) : (
                        r.caseCount
                      )}
                    </td>
                    <td className="py-2 px-3 text-right text-sm font-mono text-slate-500">
                      {r.expectedBaseline ?? '-'}
                    </td>
                    <td className="py-2 px-3 text-sm">
                      {r.isAlert ? (
                        <span className="inline-flex items-center gap-1 text-red-700 font-medium">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                          </svg>
                          OUTBREAK DETECTED
                        </span>
                      ) : (
                        <span className="text-slate-500">{r.explanation}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </Card>
  )
}
