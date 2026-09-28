import { analyticsQuery } from '../db/analyticsPool.js'
import { countSuppressed, protect, toCell } from './suppression.js'

// Reads the aggregate views (as carecrypt_analytics) and applies complementary
// suppression. Every function returns cells without identifiers: districts,
// months, condition codes and categories only.
//
// Protection always runs on a whole table before any filtering, so what is
// hidden never depends on the filter a caller chooses.

const month = (date) => date.slice(0, 7) // 'YYYY-MM-01' -> 'YYYY-MM'
const ALL = () => 'all'

export async function loadOverview() {
  const { rows } = await analyticsQuery('SELECT * FROM analytics.overview_totals')
  const o = rows[0]
  return {
    k: o.min_group_size,
    suppressed: o.is_suppressed,
    totals: {
      patients: o.patient_count === null ? null : Number(o.patient_count),
      cases: o.case_count === null ? null : Number(o.case_count),
      visits: o.visit_count === null ? null : Number(o.visit_count),
      notifiableCases: o.notifiable_case_count === null ? null : Number(o.notifiable_case_count),
      conditions: Number(o.condition_count),
      districts: Number(o.district_count),
    },
    period: o.first_month ? { from: month(o.first_month), to: month(o.last_month) } : null,
  }
}

async function cells(sql) {
  const { rows } = await analyticsQuery(sql)
  return rows.map(toCell)
}

export async function loadLocations(overview) {
  const raw = await cells('SELECT state, district, patient_count, case_count, is_suppressed FROM analytics.cases_by_location')
  const locations = protect(raw, [{ key: ALL, total: () => overview.totals.cases }], overview.k)
  return sortBy(locations, (c) => [c.state, c.district])
}

export async function loadCategories(overview) {
  const raw = await cells(
    'SELECT condition_category AS category, patient_count, case_count, is_suppressed FROM analytics.cases_by_category',
  )
  const categories = protect(raw, [{ key: ALL, total: () => overview.totals.cases }], overview.k)
  return sortByCases(categories, (c) => c.category)
}

export async function loadLocationCategory(overview, locations, categories) {
  const raw = await cells(
    `SELECT state, district, condition_category AS category, patient_count, case_count, is_suppressed
       FROM analytics.location_category`,
  )
  const byDistrict = totalsBy(locations, (c) => `${c.state}|${c.district}`)
  const byCategory = totalsBy(categories, (c) => c.category)
  const cellsOut = protect(
    raw,
    [
      { key: (c) => `${c.state}|${c.district}`, total: (g) => byDistrict.get(g) ?? null },
      { key: (c) => c.category, total: (g) => byCategory.get(g) ?? null },
    ],
    overview.k,
  )
  return sortBy(cellsOut, (c) => [c.state, c.district, c.category])
}

export async function loadConditions(overview, categories) {
  const raw = await cells(
    `SELECT condition_code AS code, condition_name AS name, condition_category AS category,
            is_notifiable AS notifiable, patient_count, case_count, is_suppressed
       FROM analytics.cases_by_condition`,
  )
  const byCategory = totalsBy(categories, (c) => c.category)
  const conditions = protect(
    raw,
    [
      { key: ALL, total: () => overview.totals.cases },
      { key: (c) => c.category, total: (g) => byCategory.get(g) ?? null },
    ],
    overview.k,
  )
  return sortByCases(conditions, (c) => c.code)
}

export async function loadMonths(overview) {
  const raw = await cells(
    `SELECT to_char(month, 'YYYY-MM') AS month, patient_count, case_count, is_suppressed FROM analytics.cases_monthly`,
  )
  const months = protect(raw, [{ key: ALL, total: () => overview.totals.cases }], overview.k)
  return fillMonths(months, overview.period, (m) => ({ month: m }))
}

export async function loadCategoryMonths(overview, months, categories) {
  const raw = await cells(
    `SELECT to_char(month, 'YYYY-MM') AS month, condition_category AS category, patient_count, case_count, is_suppressed
       FROM analytics.category_monthly`,
  )
  const byMonth = totalsBy(months, (c) => c.month)
  const byCategory = totalsBy(categories, (c) => c.category)
  const protectedCells = protect(
    raw,
    [
      { key: (c) => c.month, total: (g) => byMonth.get(g) ?? null },
      { key: (c) => c.category, total: (g) => byCategory.get(g) ?? null },
    ],
    overview.k,
  )
  // Zero-fill every month x category so a chart can tell "no cases" from "hidden".
  const filled = []
  for (const { category } of categories) {
    const own = protectedCells.filter((c) => c.category === category)
    filled.push(...fillMonths(own, overview.period, (m) => ({ month: m, category })))
  }
  return sortBy(filled, (c) => [c.month, c.category])
}

export async function loadAgeBands(overview) {
  const raw = await cells(
    'SELECT age_band AS "ageBand", patient_count, case_count, is_suppressed FROM analytics.cases_by_age_band',
  )
  const bands = protect(raw, [{ key: ALL, total: () => overview.totals.cases }], overview.k)
  const order = ['0-4', '5-14', '15-24', '25-44', '45-64', '65+']
  return order.map(
    (ageBand) =>
      bands.find((b) => b.ageBand === ageBand) ?? { ageBand, patientCount: 0, caseCount: 0, suppressed: false, suppression: null },
  )
}

// Notifiable diseases with a visible (>= k patients) district cluster in the last three months.
export async function loadSignals() {
  const { rows } = await analyticsQuery(
    `SELECT to_char(month, 'YYYY-MM') AS month, state, district, condition_code AS code, condition_name AS name,
            patient_count, visit_count
       FROM analytics.condition_monthly_by_district
      WHERE is_notifiable AND NOT is_suppressed
        AND month >= date_trunc('month', now()) - interval '2 months'
      ORDER BY month DESC, patient_count DESC, district`,
  )
  return rows.map((r) => ({
    month: r.month,
    state: r.state,
    district: r.district,
    code: r.code,
    name: r.name,
    patientCount: Number(r.patient_count),
    visitCount: Number(r.visit_count),
  }))
}

export function privacy(k, ...tables) {
  return {
    minGroupSize: k,
    suppressedCells: countSuppressed(...tables),
    rules: [
      `Counts for groups of fewer than ${k} patients are hidden (SMALL_GROUP).`,
      'Further cells are hidden where a hidden count could otherwise be worked out from a published total (COMPLEMENTARY).',
      'Patients who opted out of secondary use are not counted.',
    ],
  }
}

// Helpers

function totalsBy(cellsIn, key) {
  return new Map(cellsIn.map((c) => [key(c), c.suppressed ? null : c.caseCount]))
}

function fillMonths(cellsIn, period, base) {
  if (!period) return cellsIn
  const byMonth = new Map(cellsIn.map((c) => [c.month, c]))
  const out = []
  let [y, m] = period.from.split('-').map(Number)
  const [toY, toM] = period.to.split('-').map(Number)
  while (y < toY || (y === toY && m <= toM)) {
    const key = `${y}-${String(m).padStart(2, '0')}`
    out.push(byMonth.get(key) ?? { ...base(key), patientCount: 0, caseCount: 0, suppressed: false, suppression: null })
    m += 1
    if (m > 12) {
      m = 1
      y += 1
    }
  }
  return out
}

function sortBy(list, key) {
  return [...list].sort((a, b) => {
    const ka = key(a)
    const kb = key(b)
    for (let i = 0; i < ka.length; i++) {
      const cmp = String(ka[i]).localeCompare(String(kb[i]))
      if (cmp !== 0) return cmp
    }
    return 0
  })
}

// Largest visible counts first, hidden cells last, then by name for a stable order.
function sortByCases(list, name) {
  return [...list].sort((a, b) => (b.caseCount ?? -1) - (a.caseCount ?? -1) || name(a).localeCompare(name(b)))
}
