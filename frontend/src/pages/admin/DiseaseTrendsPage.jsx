import { useState } from 'react'
import { ConditionBars } from '../../components/analytics/BarCharts.jsx'
import { CategorySelect } from '../../components/analytics/common.jsx'
import CustomQuery from '../../components/analytics/CustomQuery.jsx'
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
  const time = useApiData(allowed && '/api/analytics/by-time')
  const conditions = useApiData(allowed && '/api/analytics/by-condition')
  const locations = useApiData(allowed && '/api/analytics/by-location')
  const [category, setCategory] = useState('')

  if (overview.error) return <ServerRefusal error={overview.error} title="Analytics are for administrators" />
  if (!overview.data) return <LoadingState label="Loading disease trends…" />

  const o = overview.data
  const k = o.privacy.minGroupSize
  const ranked = conditions.data?.categories.map((c) => c.category) ?? o.topCategories.map((c) => c.category)

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Disease trends"
        title="Trends by time and condition"
        description={`Diagnosis cases per month and per condition. Values covering fewer than ${k} patients appear as gaps or hidden markers, never as zero.`}
      />

      <Card title="Cases over time" subtitle="Diagnosis cases per month">
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
    </div>
  )
}
