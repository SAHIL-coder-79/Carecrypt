const DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const DATE_TIME = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

// 'YYYY-MM-DD' strings are calendar dates; parse them without a time-zone shift.
function toDate(value) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number)
    return new Date(y, m - 1, d)
  }
  return new Date(value)
}

export const formatDate = (value) => (value ? DATE.format(toDate(value)) : '—')
export const formatDateTime = (value) => (value ? DATE_TIME.format(toDate(value)) : '—')

export function titleCase(value) {
  if (!value) return ''
  return value
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export const ROLE_LABEL = {
  PATIENT: 'Patient',
  CLINICIAN: 'Clinician',
  ADMIN: 'Administrator',
  SECURITY_ADMIN: 'Security administrator',
}

export const VISIT_TYPE_LABEL = {
  OPD: 'Outpatient',
  FOLLOW_UP: 'Follow-up',
  EMERGENCY: 'Emergency',
  TELECONSULT: 'Teleconsult',
}

export const SCOPE = {
  FULL_RECORD: { label: 'Full record', detail: 'Consent covers the complete record' },
  VISIT_HISTORY: { label: 'Visit history', detail: 'Contact details and address are withheld' },
  SUMMARY_ONLY: { label: 'Summary only', detail: 'Visit history and contact details are withheld' },
}
