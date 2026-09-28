import { useState } from 'react'
import { AgeGroupBars, CategoryBars } from '../../components/analytics/BarCharts.jsx'
import { CategorySelect, Kpi } from '../../components/analytics/common.jsx'
import LocationBreakdown from '../../components/analytics/LocationBreakdown.jsx'
import { Panel, Signals } from '../../components/analytics/Panels.jsx'
import { ActivityIcon, BarChartIcon, ClipboardIcon, UsersIcon } from '../../components/icons.jsx'
import ServerRefusal from '../../components/ServerRefusal.jsx'
import { Badge, ButtonLink, Card, LoadingState, PageHeader } from '../../components/ui.jsx'
import { categoryLabel, formatCount, monthLabel } from '../../lib/analytics.js'
import { useApiData } from '../../lib/useApiData.js'

// ADMIN population dashboard. Everything comes from /api/analytics, which
// returns aggregate counts only: no patient, visit or prescription.
export default function PopulationDashboard() {
  const overview = useApiData('/api/analytics/overview')
  // The other panels load only once the server has accepted the caller, so a
  // refused role produces one refusal, not several.
  const allowed = Boolean(overview.data)
  const conditions = useApiData(allowed && '/api/analytics/by-condition')
  const locations = useApiData(allowed && '/api/analytics/by-location')
  const ages = useApiData(allowed && '/api/analytics/by-age-group')
  const [category, setCategory] = useState('')

  if (overview.error) return <ServerRefusal error={overview.error} title="Analytics are for administrators" />
  if (!overview.data) return <LoadingState label="Loading population analytics…" />

  const o = overview.data
  const k = o.privacy.minGroupSize
  const period = o.period ? `${monthLabel(o.period.from, true)} to ${monthLabel(o.period.to, true)}. ` : ''

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Population dashboard"
        title="Population health"
        description={`${period}Aggregate, de-identified counts. Groups of fewer than ${k} patients are hidden.`}
        actions={
          <>
            <Badge tone="teal">Aggregate · de-identified</Badge>
            <ButtonLink to="/admin/trends" variant="secondary" size="sm">
              Disease trends
            </ButtonLink>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Patients counted" value={o.totals.patients} detail="With a diagnosis in the period" icon={UsersIcon} />
        <Kpi label="Diagnosis cases" value={o.totals.cases} detail="Confirmed or provisional" icon={ActivityIcon} />
        <Kpi label="Completed visits" value={o.totals.visits} icon={ClipboardIcon} />
        <Kpi label="Notifiable disease cases" value={o.totals.notifiableCases} detail="Dengue, malaria, typhoid, …" tone="red" />
        <Kpi
          label="Coverage"
          value={o.totals.districts}
          detail={`districts · ${formatCount(o.totals.conditions)} conditions`}
          icon={BarChartIcon}
        />
      </div>

      <Signals signals={o.signals} k={k} />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Condition categories" subtitle="All cases in the period. Select one to show it by district.">
          <Panel state={conditions}>
            {(d) => <CategoryBars categories={d.categories} k={k} selected={category} onSelect={setCategory} />}
          </Panel>
        </Card>
        <Card title="Cases by age group" subtitle="Age at the visit" className="lg:col-span-2">
          <Panel state={ages}>{(d) => <AgeGroupBars ageGroups={d.ageGroups} k={k} />}</Panel>
        </Card>
      </div>

      <Card
        title="Cases by location"
        subtitle={`By patient's home district${category ? ` · ${categoryLabel(category)}` : ''}`}
        action={
          locations.data && (
            <CategorySelect
              id="location-category"
              value={category}
              categories={locations.data.categories}
              onChange={setCategory}
              labelFor={categoryLabel}
            />
          )
        }
      >
        <Panel state={locations}>{(d) => <LocationBreakdown data={d} k={k} category={category} />}</Panel>
      </Card>
    </div>
  )
}
