import { analyticsQuery } from '../db/analyticsPool.js'
import { HttpError } from '../lib/httpError.js'

// Custom aggregate query: one count for any combination of equality filters.
// The minimum-group and differencing checks run inside the database
// (analytics.query_cases), so a small count never reaches this process.

const AGE_BANDS = ['0-4', '5-14', '15-24', '25-44', '45-64', '65+']
const GENDERS = ['FEMALE', 'MALE', 'OTHER', 'UNDISCLOSED']
const PLACE = /^[A-Za-z][A-Za-z .()'-]{0,59}$/

export const FILTERS = Object.freeze({
  state: { valid: (v) => PLACE.test(v), hint: 'a state name' },
  district: { valid: (v) => PLACE.test(v), hint: 'a district name' },
  category: { valid: (v) => /^[A-Z_]{2,40}$/.test(v), hint: 'a condition category such as INFECTIOUS' },
  condition: { valid: (v) => /^[A-Z][0-9]{2}(\.[0-9A-Z]{1,4})?$/.test(v), hint: 'an ICD-10 code such as A90' },
  month: { valid: (v) => /^\d{4}-(0[1-9]|1[0-2])$/.test(v), hint: 'a month in the form YYYY-MM' },
  ageBand: { valid: (v) => AGE_BANDS.includes(v), hint: `one of ${AGE_BANDS.join(', ')}` },
  gender: { valid: (v) => GENDERS.includes(v), hint: `one of ${GENDERS.join(', ')}` },
})

// Returns the filters as an object with keys in a fixed order (so equal queries
// compare equal), or throws 400.
export function parseFilters(query) {
  const details = []
  for (const [field, value] of Object.entries(query)) {
    if (!FILTERS[field]) {
      details.push({ field, message: `Unknown filter. Allowed: ${Object.keys(FILTERS).join(', ')}.` })
    } else if (typeof value !== 'string') {
      details.push({ field, message: 'Give this filter once.' })
    } else if (!FILTERS[field].valid(value.trim())) {
      details.push({ field, message: `Must be ${FILTERS[field].hint}.` })
    }
  }
  if (details.length > 0) {
    throw new HttpError(400, 'VALIDATION_FAILED', 'Invalid analytics query.', {
      body: { error: 'VALIDATION_FAILED', message: 'Invalid analytics query.', details },
    })
  }
  const filters = {}
  for (const key of Object.keys(FILTERS)) {
    if (query[key] !== undefined && query[key].trim() !== '') filters[key] = query[key].trim()
  }
  return filters
}

export async function runCustomQuery(filters) {
  const { rows } = await analyticsQuery('SELECT * FROM analytics.query_cases($1::jsonb)', [JSON.stringify(filters)])
  const r = rows[0]
  return {
    patientCount: r.patient_count === null ? null : Number(r.patient_count),
    caseCount: r.case_count === null ? null : Number(r.case_count),
    suppressed: r.is_suppressed,
    suppression: r.suppression,
    // For DIFFERENCE: the coarser query that the answer could be subtracted from.
    riskFilters: r.risk_filters,
    minGroupSize: r.min_group_size,
  }
}
