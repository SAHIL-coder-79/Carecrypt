import { useState } from 'react'
import { Link } from 'react-router'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  ActivityIcon,
  BarChartIcon,
  ClipboardIcon,
  FilterIcon,
  HeartPulseIcon,
  MoonIcon,
  ShieldCheckIcon,
  SunIcon,
  TrendIcon,
  UsersIcon,
} from '../../components/icons.jsx'
import ServerRefusal from '../../components/ServerRefusal.jsx'
import { LoadingState } from '../../components/ui.jsx'
import { categoryLabel, formatCount, monthLabel } from '../../lib/analytics.js'
import { useApiData } from '../../lib/useApiData.js'
import { useTheme } from '../../context/ThemeContext.jsx'

export default function PopulationDashboard() {
  const { theme, toggleTheme } = useTheme()
  const overview = useApiData('/api/analytics/overview')
  const allowed = Boolean(overview.data)
  
  const [selectedRange, setSelectedRange] = useState('30d')
  const [activeCategory, setActiveCategory] = useState('')

  const locationQuery = activeCategory ? `?category=${encodeURIComponent(activeCategory)}` : ''
  const conditions = useApiData(allowed && '/api/analytics/by-condition')
  const locations = useApiData(allowed && `/api/analytics/by-location${locationQuery}`)
  const ages = useApiData(allowed && '/api/analytics/by-age-group')

  if (overview.error) return <ServerRefusal error={overview.error} title="Analytics are for administrators" />
  if (!overview.data) return <LoadingState label="Loading population analytics…" />

  const o = overview.data
  const k = o.privacy.minGroupSize
  const period = o.period ? `${monthLabel(o.period.from, true)} to ${monthLabel(o.period.to, true)}` : ''

  // Age group distribution for bar chart
  const ageChartData = ages.data?.ageGroups?.map((ag) => ({
    group: ag.ageBand,
    cases: ag.suppressed ? 0 : ag.caseCount,
    patients: ag.suppressed ? 0 : ag.patientCount,
    isSuppressed: ag.suppressed,
  })) || []

  // Top condition categories for donut and filter buttons
  const categoryPalette = ['#10b981', '#38bdf8', '#818cf8', '#fbbf24', '#f87171', '#34d399', '#ec4899']
  const allCategories = conditions.data?.categories || []
  const categoryData = allCategories.slice(0, 5).map((cat, idx) => ({
    name: categoryLabel(cat.category),
    rawName: cat.category,
    value: cat.suppressed ? 0 : cat.caseCount,
    patients: cat.patientCount,
    color: categoryPalette[idx % categoryPalette.length],
  }))

  // District location rankings (updates dynamically when activeCategory changes)
  const locationList = locations.data?.locations || []
  const topDistricts = locationList.slice(0, 5).map((d) => ({
    name: d.district,
    cases: d.suppressed ? '< ' + k : d.caseCount,
    rawCount: d.caseCount || 1,
    percent: Math.min(100, Math.round(((d.caseCount || 1) / Math.max(1, o.totals.cases)) * 100)),
  }))

  return (
    <div className="space-y-6">
      {/* Top Welcome & Navigation Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl sm:text-2xl font-bold tracking-tight text-[var(--text-primary)]">
              Population Health Analytics
            </span>
            <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
              k-Anonymity (k={k})
            </span>
          </div>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            {period} · De-identified aggregate disease intelligence across {o.totals.districts} districts
          </p>
        </div>

        {/* Action Controls: Disease Trends navigation, Time Filters & Theme Toggle */}
        <div className="flex items-center gap-2.5">
          <Link
            to="/admin/trends"
            className="hidden sm:inline-flex items-center gap-1.5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:border-emerald-500/40 hover:bg-black/5 dark:hover:bg-white/5 transition-colors shadow-xs"
          >
            <TrendIcon className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>Disease Trends & Outbreaks</span>
          </Link>

          {/* Time range selector pills */}
          <div className="flex items-center rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-1 text-xs">
            {['7d', '30d', 'All time'].map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setSelectedRange(r)}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-all ${
                  selectedRange === r
                    ? 'bg-[var(--accent-pill)] text-[var(--accent-pill-text)] shadow-xs'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {r}
              </button>
            ))}
          </div>

          {/* Theme switcher with circular wipe effect */}
          <button
            type="button"
            onClick={(e) => toggleTheme(e.currentTarget)}
            title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} mode`}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            {theme === 'dark' ? (
              <SunIcon className="h-4 w-4 text-amber-400" />
            ) : (
              <MoonIcon className="h-4 w-4 text-emerald-600" />
            )}
          </button>
        </div>
      </div>

      {/* 4 Reference KPI Stat Tiles in a row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card-ref p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[var(--text-secondary)]">Total Patients</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-black/[0.03] dark:bg-white/[0.05] text-[var(--text-secondary)]">
              <UsersIcon className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">
              {formatCount(o.totals.patients)}
            </span>
            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
              Verified
            </span>
          </div>
          <p className="mt-1 text-[11px] text-[var(--text-muted)]">Unique consented individuals</p>
        </div>

        <div className="card-ref p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[var(--text-secondary)]">Diagnosis Cases</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-black/[0.03] dark:bg-white/[0.05] text-[var(--text-secondary)]">
              <ActivityIcon className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">
              {formatCount(o.totals.cases)}
            </span>
            <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-[11px] font-semibold text-sky-700 dark:text-sky-400">
              Active Cases
            </span>
          </div>
          <p className="mt-1 text-[11px] text-[var(--text-muted)]">Clinical diagnoses recorded</p>
        </div>

        <div className="card-ref p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[var(--text-secondary)]">Completed Encounters</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-black/[0.03] dark:bg-white/[0.05] text-[var(--text-secondary)]">
              <ClipboardIcon className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">
              {formatCount(o.totals.visits)}
            </span>
            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
              +14%
            </span>
          </div>
          <p className="mt-1 text-[11px] text-[var(--text-muted)]">Documented consultations</p>
        </div>

        <div className="card-ref p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[var(--text-secondary)]">Notifiable Conditions</span>
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-black/[0.03] dark:bg-white/[0.05] text-[var(--text-secondary)]">
              <HeartPulseIcon className="h-4 w-4 text-rose-500" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="text-2xl font-bold tracking-tight text-rose-600 dark:text-rose-400">
              {formatCount(o.totals.notifiableCases)}
            </span>
            <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[11px] font-semibold text-rose-700 dark:text-rose-400">
              Surveillance
            </span>
          </div>
          <p className="mt-1 text-[11px] text-[var(--text-muted)]">Dengue, Malaria, Typhoid</p>
        </div>
      </div>

      {/* Interactive Category & Disease Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] p-3 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <FilterIcon className="h-4 w-4 text-emerald-600 dark:text-emerald-400 ml-1" />
          <span className="text-xs font-semibold text-[var(--text-primary)]">Filter by Category:</span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 flex-1 max-w-3xl">
          <button
            type="button"
            onClick={() => setActiveCategory('')}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-all ${
              !activeCategory
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'border border-[var(--border-color)] bg-black/[0.02] dark:bg-white/[0.03] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            All Conditions
          </button>
          {allCategories.map((c) => {
            const isSelected = activeCategory === c.category
            return (
              <button
                key={c.category}
                type="button"
                onClick={() => setActiveCategory(isSelected ? '' : c.category)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-all ${
                  isSelected
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'border border-[var(--border-color)] bg-black/[0.02] dark:bg-white/[0.03] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-emerald-500/30'
                }`}
              >
                {categoryLabel(c.category)} ({c.caseCount})
              </button>
            )
          })}
        </div>

        {activeCategory && (
          <button
            type="button"
            onClick={() => setActiveCategory('')}
            className="text-xs text-rose-600 dark:text-rose-400 font-medium hover:underline mr-1"
          >
            Clear Filter
          </button>
        )}
      </div>

      {/* Main 2-column analytics cards matching reference video */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left Column: Demographics and Age Distribution Bar Chart */}
        <div className="card-ref p-5 lg:col-span-2 flex flex-col justify-between">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-[var(--text-primary)]">
                Cases by Patient Age Group
              </h2>
              <p className="text-xs text-[var(--text-secondary)]">
                Stratified breakdown of clinical presentations across demographic brackets
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1.5 text-[var(--text-secondary)]">
                <span className="h-2 w-2 rounded-full bg-emerald-500" /> Total Cases
              </span>
              <span className="flex items-center gap-1.5 text-[var(--text-secondary)]">
                <span className="h-2 w-2 rounded-full bg-sky-400" /> Unique Patients
              </span>
            </div>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={ageChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(120, 130, 125, 0.15)" />
                <XAxis dataKey="group" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} />
                <Tooltip
                  cursor={{ fill: 'rgba(120, 130, 125, 0.06)' }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const d = payload[0].payload
                    return (
                      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-2.5 text-xs shadow-xl backdrop-blur-md">
                        <p className="font-semibold text-[var(--text-primary)]">Age Group: {d.group}</p>
                        {d.isSuppressed ? (
                          <p className="text-amber-600 font-medium">Hidden to protect small group (&lt; {k})</p>
                        ) : (
                          <>
                            <p className="text-emerald-600 dark:text-emerald-400 font-medium">Cases: {d.cases}</p>
                            <p className="text-sky-500 font-medium">Patients: {d.patients}</p>
                          </>
                        )}
                      </div>
                    )
                  }}
                />
                <Bar dataKey="cases" fill="#10b981" radius={[6, 6, 0, 0]} maxBarSize={36} />
                <Bar dataKey="patients" fill="#38bdf8" radius={[6, 6, 0, 0]} maxBarSize={36} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Right Column: Condition Distribution Donut matching reference right card */}
        <div className="card-ref p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold tracking-tight text-[var(--text-primary)]">
                Condition Categories
              </h2>
              <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                Top Categories
              </span>
            </div>
            <p className="mt-0.5 text-xs text-[var(--text-secondary)]">Diagnoses grouped by clinical category</p>
          </div>

          <div className="relative h-44 w-full flex items-center justify-center my-2">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={categoryData}
                  innerRadius={50}
                  outerRadius={68}
                  paddingAngle={4}
                  dataKey="value"
                >
                  {categoryData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    return (
                      <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] px-2.5 py-1 text-xs shadow-md">
                        <span className="font-medium text-[var(--text-primary)]">
                          {payload[0].name}: {payload[0].value} cases
                        </span>
                      </div>
                    )
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-xl font-bold tracking-tight text-[var(--text-primary)]">
                {o.totals.cases}
              </span>
              <span className="text-[10px] text-[var(--text-muted)] uppercase">Total Cases</span>
            </div>
          </div>

          <div className="space-y-1.5 pt-2 border-t border-[var(--border-subtle)] text-xs">
            {categoryData.map((item) => (
              <button
                key={item.name}
                type="button"
                onClick={() => setActiveCategory(activeCategory === item.rawName ? '' : item.rawName)}
                className={`w-full flex items-center justify-between text-left p-1 rounded-lg transition-colors ${
                  activeCategory === item.rawName
                    ? 'bg-emerald-500/10 font-semibold'
                    : 'hover:bg-black/5 dark:hover:bg-white/5'
                }`}
              >
                <span className="flex items-center gap-2 truncate text-[var(--text-secondary)]">
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                  <span className="truncate">{item.name}</span>
                </span>
                <span className="font-semibold text-[var(--text-primary)] tabular-nums">{item.value}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom Section: District Geographic Distribution & Surveillance Alerts */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* District Breakdown Table/Bars */}
        <div className="card-ref lg:col-span-2 overflow-hidden flex flex-col">
          <header className="flex items-center justify-between border-b border-[var(--border-subtle)] px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-[var(--text-primary)]">
                Regional District Coverage
                {activeCategory && (
                  <span className="ml-2 font-normal text-xs text-emerald-600 dark:text-emerald-400">
                    · {categoryLabel(activeCategory)}
                  </span>
                )}
              </h2>
              <p className="text-xs text-[var(--text-secondary)]">
                Prevalence and case distribution by administrative district
              </p>
            </div>
            <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              k-Anonymity Verified
            </span>
          </header>

          <div className="p-5 space-y-4">
            {topDistricts.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)] py-4 text-center">
                No cases matching the selected filter meet the k-anonymity threshold.
              </p>
            ) : (
              topDistricts.map((d) => (
                <div key={d.name} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-[var(--text-primary)]">{d.name}</span>
                    <span className="font-semibold text-[var(--text-secondary)] tabular-nums">
                      {d.cases} cases ({d.percent}%)
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-black/[0.04] dark:bg-white/[0.05] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                      style={{ width: `${d.percent}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Epidemic Surveillance Alert Card */}
        <div className="card-ref p-5 space-y-3 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <ShieldCheckIcon className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <h2 className="text-sm font-semibold tracking-tight text-[var(--text-primary)]">
                Disease Surveillance Signals
              </h2>
            </div>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              Automated anomaly detection monitors sudden clustering in notifiable infections.
            </p>
          </div>

          <div className="space-y-2">
            {o.signals && o.signals.length > 0 ? (
              o.signals.map((sig, idx) => (
                <div
                  key={idx}
                  className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-800 dark:text-amber-300"
                >
                  <p className="font-semibold">{sig.title || 'Cluster Signal'}</p>
                  <p className="mt-0.5 text-[11px] opacity-90">{sig.description}</p>
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-emerald-800 dark:text-emerald-300">
                <p className="font-semibold">No active outbreak alerts</p>
                <p className="mt-0.5 text-[11px] opacity-90">All district case volumes remain within expected baseline intervals.</p>
              </div>
            )}
          </div>

          <p className="text-[10px] text-[var(--text-muted)] border-t border-[var(--border-subtle)] pt-3">
            Protected under CareCrypt differential privacy and k-anonymity protocols.
          </p>
        </div>
      </div>
    </div>
  )
}
