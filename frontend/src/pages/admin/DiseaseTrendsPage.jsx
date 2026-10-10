import { useState } from 'react'
import { ConditionBars } from '../../components/analytics/BarCharts.jsx'
import { CategorySelect } from '../../components/analytics/common.jsx'
import CustomQuery from '../../components/analytics/CustomQuery.jsx'
import OutbreakDetection from '../../components/analytics/OutbreakDetection.jsx'
import { Panel } from '../../components/analytics/Panels.jsx'
import TrendChart from '../../components/analytics/TrendChart.jsx'
import ServerRefusal from '../../components/ServerRefusal.jsx'
import { Card, LoadingState, PageHeader, Spinner } from '../../components/ui.jsx'
import { categoryLabel } from '../../lib/analytics.js'
import { useApiData } from '../../lib/useApiData.js'

// Disease trends over time and by condition, plus the custom question tool.
export default function DiseaseTrendsPage() {
  const overview = useApiData('/api/analytics/overview')
  const allowed = Boolean(overview.data)
  const [trendFrom, setTrendFrom] = useState('')
  const [trendTo, setTrendTo] = useState('')
  const [trendCategory, setTrendCategory] = useState('')
  
  const [appliedTrendFrom, setAppliedTrendFrom] = useState('')
  const [appliedTrendTo, setAppliedTrendTo] = useState('')
  const [appliedTrendCategory, setAppliedTrendCategory] = useState('')
  const [trendError, setTrendError] = useState('')

  const trendParams = new URLSearchParams()
  if (appliedTrendFrom) trendParams.set('from', appliedTrendFrom)
  if (appliedTrendTo) trendParams.set('to', appliedTrendTo)
  if (appliedTrendCategory) trendParams.set('category', appliedTrendCategory)
  const timeQuery = trendParams.toString() ? `?${trendParams.toString()}` : ''

  const time = useApiData(allowed && `/api/analytics/by-time${timeQuery}`)
  const conditions = useApiData(allowed && '/api/analytics/by-condition')
  const locations = useApiData(allowed && '/api/analytics/by-location')
  const [category, setCategory] = useState('')

  if (overview.error) return <ServerRefusal error={overview.error} title="Analytics are for administrators" />
  if (!overview.data) return <LoadingState label="Loading disease trends…" />

  const o = overview.data
  const k = o.privacy.minGroupSize
  const ranked = conditions.data?.categories.map((c) => c.category) ?? o.topCategories.map((c) => c.category)

  const handleTrendApply = (e) => {
    e.preventDefault()
    setTrendError('')
    if (trendFrom && trendTo && trendFrom > trendTo) {
      setTrendError('From Month cannot be later than To Month.')
      return
    }
    setAppliedTrendFrom(trendFrom)
    setAppliedTrendTo(trendTo)
    setAppliedTrendCategory(trendCategory)
  }

  const handleTrendReset = () => {
    setTrendError('')
    setTrendFrom('')
    setTrendTo('')
    setTrendCategory('')
    setAppliedTrendFrom('')
    setAppliedTrendTo('')
    setAppliedTrendCategory('')
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Disease trends"
        title="Trends by time and condition"
        description={`Diagnosis cases per month and per condition. Values covering fewer than ${k} patients appear as gaps or hidden markers, never as zero.`}
      />

      <Card title="Cases over time" subtitle="Diagnosis cases per month">
        <form onSubmit={handleTrendApply} className="mb-6 flex flex-wrap items-end gap-4 rounded-md border border-slate-200 bg-slate-50 p-4 shadow-sm">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="trend-from" className="text-xs font-semibold text-slate-700">From Month</label>
            <input type="month" id="trend-from" value={trendFrom} onChange={(e) => setTrendFrom(e.target.value)} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="trend-to" className="text-xs font-semibold text-slate-700">To Month</label>
            <input type="month" id="trend-to" value={trendTo} onChange={(e) => setTrendTo(e.target.value)} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="trend-category" className="text-xs font-semibold text-slate-700">Category</label>
            <select id="trend-category" value={trendCategory} onChange={(e) => setTrendCategory(e.target.value)} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600">
              <option value="">All categories</option>
              {conditions.data?.categories.map((c) => (
                <option key={c.category} value={c.category}>{categoryLabel(c.category)}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2 pb-0.5">
            <button type="submit" className="rounded-md bg-teal-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:ring-offset-1">Apply Filters</button>
            <button type="button" onClick={handleTrendReset} className="rounded-md border border-slate-300 bg-white px-4 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:ring-offset-1">Reset</button>
          </div>
          {trendError && <p className="w-full text-sm font-medium text-red-600">{trendError}</p>}
        </form>
        <Panel state={time}>{(d) => <TrendChart data={d} k={k} rankedCategories={ranked} />}</Panel>
      </Card>

      <Card
        title="Cases by condition"
        subtitle={category ? categoryLabel(category) : 'All categories'}
        action={
          conditions.data && (
            <CategorySelect
              id="condition-category"
              value={category}
              categories={conditions.data.categories.map((c) => c.category)}
              onChange={setCategory}
              labelFor={categoryLabel}
            />
          )
        }
      >
        <Panel state={conditions}>
          {(d) => (
            <ConditionBars k={k} conditions={category ? d.conditions.filter((c) => c.category === category) : d.conditions} />
          )}
        </Panel>
      </Card>

      <Card
        title="Ask a specific question"
        subtitle={`One count for any combination of filters. Answers that would expose fewer than ${k} patients are suppressed, and repeated narrowing is reported to security.`}
      >
        {locations.data && conditions.data ? (
          <CustomQuery
            districts={locations.data.locations}
            categories={locations.data.categories}
            conditions={conditions.data.conditions}
            period={o.period}
            k={k}
          />
        ) : (
          <Spinner />
        )}
      </Card>

      {locations.data && conditions.data && (
        <OutbreakDetection 
          districts={locations.data.locations.map(l => l.district)} 
          categories={locations.data.categories} 
          k={k} 
        />
      )}
    </div>
  )
}
