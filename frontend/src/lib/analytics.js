import { titleCase } from './format.js'

// Fixed colour per condition category, in a fixed slot order, so a category looks
// the same in every chart and a filter never repaints the others. Validated
// categorical palette (adjacent CVD ΔE ≥ 9.1, normal-vision ΔE ≥ 19.6). Slots 3–5
// are below 3:1 contrast on white, so every chart also names categories in text.
export const CATEGORY_COLOR = {
  RESPIRATORY: '#2a78d6',
  INFECTIOUS: '#eb6834',
  ENDOCRINE: '#1baf7a',
  CARDIOVASCULAR: '#eda100',
  GENITOURINARY: '#e87ba4',
  MUSCULOSKELETAL: '#008300',
  HAEMATOLOGICAL: '#4a3aa7',
  NEUROLOGICAL: '#e34948',
}
export const TOTAL_COLOR = '#0f766e'

// Diagonal hatching that marks a hidden value.
export const HATCH = {
  backgroundImage: 'repeating-linear-gradient(45deg, #e2e8f0 0, #e2e8f0 2px, transparent 2px, transparent 5px)',
}

export const categoryColor = (category) => CATEGORY_COLOR[category] ?? '#64748b'
export const categoryLabel = (category) => titleCase(category)

const MONTH_SHORT = new Intl.DateTimeFormat('en-GB', { month: 'short', year: '2-digit' })
const MONTH_LONG = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' })

// 'YYYY-MM' -> 'Oct 25' / 'October 2025'
export function monthLabel(month, long = false) {
  if (!month) return '—'
  const [y, m] = month.split('-').map(Number)
  return (long ? MONTH_LONG : MONTH_SHORT).format(new Date(y, m - 1, 1))
}

const NUMBER = new Intl.NumberFormat('en-IN')
export const formatCount = (n) => (n === null || n === undefined ? '—' : NUMBER.format(n))

// Text for a hidden cell, e.g. "Hidden: fewer than 5 patients".
export function hiddenText(cell, k) {
  return cell.suppression === 'COMPLEMENTARY'
    ? 'Hidden: protects another hidden count'
    : `Hidden: fewer than ${k} patients`
}
