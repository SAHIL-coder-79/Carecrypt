import { useMemo, useState } from 'react'
import { useAuth } from '../../auth/context.js'
import ServerRefusal from '../../components/ServerRefusal.jsx'
import { Alert, Badge, ButtonLink, Card, LoadingState, PageHeader } from '../../components/ui.jsx'
import { formatDate } from '../../lib/format.js'
import { useApiData } from '../../lib/useApiData.js'

const SCOPES = [
  { id: 'FULL_RECORD', label: 'Full record', detail: 'Everything, including your contact details and address.' },
  { id: 'VISIT_HISTORY', label: 'Visit history', detail: 'Visits, diagnoses and medicines. Not your contact details.' },
  { id: 'SUMMARY_ONLY', label: 'Summary only', detail: 'Allergies, long-term conditions and current medicines. No visits.' },
]
const SCOPE_LABEL = Object.fromEntries(SCOPES.map((s) => [s.id, s.label]))
const DURATIONS = [
  [7, '7 days'],
  [30, '30 days'],
  [90, '3 months'],
  [365, '1 year'],
  ['', 'Until I revoke it'],
]
const PURPOSES = ['Ongoing treatment', 'Second opinion', 'Specialist referral', 'Follow-up after hospital visit', 'Emergency care']
const STATUS_TONE = { ACTIVE: 'green', EXPIRED: 'neutral', REVOKED: 'red', PENDING: 'amber' }

const input =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20'

export default function ConsentPage() {
  const { user } = useAuth()
  const consents = useApiData(user.patientId ? `/api/consent/${user.patientId}` : null)
  const directory = useApiData('/api/clinicians')
  const [notice, setNotice] = useState(null)

  if (!user.patientId) {
    return <p className="text-sm text-slate-600">This screen is for patients managing access to their own record.</p>
  }
  if ((consents.loading && !consents.data) || (directory.loading && !directory.data)) {
    return <LoadingState label="Loading your consents…" />
  }
  if (consents.error || directory.error) return <ServerRefusal error={consents.error ?? directory.error} />

  const all = consents.data.consents
  const active = all.filter((c) => c.status === 'ACTIVE')
  const past = all.filter((c) => c.status !== 'ACTIVE')

  const refresh = (message) => {
    setNotice(message)
    consents.reload()
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Consent"
        title="Who can see your record"
        description="Clinicians can open your record only while you have given them access. You choose what they see and for how long, and you can revoke access at any time. Every change is recorded in the audit log."
        actions={
          <ButtonLink to="/patient/access-history" variant="secondary" size="sm">
            See who accessed your record
          </ButtonLink>
        }
      />

      {notice && <Alert tone="success">{notice}</Alert>}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="order-2 space-y-6 lg:order-1">
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-slate-900">
              Active access <span className="font-normal text-slate-500">({active.length})</span>
            </h2>
            {active.length === 0 ? (
              <p className="text-sm text-slate-500">No clinician can currently open your record.</p>
            ) : (
              active.map((c) => <AccessCard key={c.id} consent={c} onRevoked={refresh} />)
            )}
          </section>

          {past.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-slate-900">
                Past access <span className="font-normal text-slate-500">({past.length})</span>
              </h2>
              {past.map((c) => (
                <AccessCard key={c.id} consent={c} />
              ))}
            </section>
          )}
        </div>

        <div className="order-1 lg:order-2">
          <GrantForm clinicians={directory.data.clinicians} active={active} onGranted={refresh} />
        </div>
      </div>
    </div>
  )
}

function durationText(c) {
  if (!c.expiresAt) return 'Until you revoke it'
  const total = Math.round((new Date(c.expiresAt) - new Date(c.grantedAt)) / 86_400_000)
  const left = Math.ceil((new Date(c.expiresAt) - Date.now()) / 86_400_000)
  const until = `until ${formatDate(c.expiresAt)}`
  if (c.status === 'ACTIVE') return `${total} days, ${until} (${left} ${left === 1 ? 'day' : 'days'} left)`
  return `${total} days, ${until}`
}

function Field({ label, children }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] gap-2 text-sm">
      <dt className="font-medium text-slate-500">{label}:</dt>
      <dd className="min-w-0 text-slate-900">{children}</dd>
    </div>
  )
}

function AccessCard({ consent: c, onRevoked }) {
  const { request } = useAuth()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function revoke() {
    setBusy(true)
    setError(null)
    try {
      await request(`/api/consent/${c.id}`, { method: 'DELETE', body: { reason: 'Revoked by patient' } })
      onRevoked(`${c.clinician.name} can no longer open your record.`)
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }

  return (
    <article
      className={`rounded-lg border bg-white ${c.status === 'ACTIVE' ? 'border-slate-200' : 'border-slate-200 opacity-80'}`}
    >
      <header className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Access request</h3>
        <Badge tone={STATUS_TONE[c.status]}>{c.status}</Badge>
      </header>
      <dl className="space-y-1.5 px-4 py-3">
        <Field label="Clinician">
          <span className="font-medium">{c.clinician.name}</span>
          <span className="text-slate-600">
            {' '}
            · {c.clinician.specialty}, {c.clinician.facility}, {c.clinician.district}
          </span>
        </Field>
        <Field label="Purpose">{c.purpose}</Field>
        <Field label="Access">{SCOPE_LABEL[c.scope]}</Field>
        <Field label="Duration">{durationText(c)}</Field>
        <Field label="Status">
          {c.status === 'ACTIVE' && `Granted ${formatDate(c.grantedAt)} ${c.channel === 'IN_PERSON' ? 'in person' : 'online'}`}
          {c.status === 'REVOKED' &&
            `Revoked ${formatDate(c.revokedAt)}${
              c.revokedReason && c.revokedReason !== 'Revoked by patient' ? ` (${c.revokedReason})` : ''
            }`}
          {c.status === 'EXPIRED' && `Expired ${formatDate(c.expiresAt)}`}
          {c.status === 'PENDING' && `Starts ${formatDate(c.grantedAt)}`}
        </Field>
      </dl>

      {onRevoked && (
        <footer className="border-t border-slate-100 px-4 py-3">
          {!confirming ? (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-red-600"
            >
              REVOKE ACCESS
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Confirm revoke">
              <span className="text-sm text-slate-700">Stop {c.clinician.name} from opening your record now?</span>
              <button
                type="button"
                onClick={revoke}
                disabled={busy}
                className="rounded-md bg-red-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-60"
              >
                {busy ? 'Revoking…' : 'Yes, revoke access'}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={busy}
                className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
            </div>
          )}
          {error && <p className="mt-2 text-sm text-red-700">{error.message}</p>}
        </footer>
      )}
    </article>
  )
}

function GrantForm({ clinicians, active, onGranted }) {
  const { request } = useAuth()
  const [clinicianId, setClinicianId] = useState('')
  const [purpose, setPurpose] = useState('')
  const [scope, setScope] = useState('VISIT_HISTORY')
  const [duration, setDuration] = useState('30')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const byState = useMemo(() => {
    const groups = new Map()
    for (const c of clinicians) {
      const key = `${c.district}, ${c.state}`
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(c)
    }
    return [...groups.entries()]
  }, [clinicians])

  const chosen = clinicians.find((c) => c.id === clinicianId)
  const replacing = active.find((c) => c.clinician.id === clinicianId)
  const durationLabel = DURATIONS.find(([v]) => String(v) === duration)?.[1]
  const ready = chosen && purpose.trim().length >= 3

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { consent } = await request('/api/consent', {
        method: 'POST',
        body: { clinicianId, purpose: purpose.trim(), scope, durationDays: duration === '' ? null : Number(duration) },
      })
      setClinicianId('')
      setPurpose('')
      setBusy(false)
      onGranted(`${consent.clinician.name} can now open your record (${SCOPE_LABEL[consent.scope].toLowerCase()}).`)
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }

  return (
    <Card title="New access request" subtitle="Give a clinician access to your record">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="consent-clinician" className="mb-1 block text-xs font-medium text-slate-600">
            Clinician
          </label>
          <select id="consent-clinician" className={input} value={clinicianId} onChange={(e) => setClinicianId(e.target.value)}>
            <option value="">Choose a clinician…</option>
            {byState.map(([place, list]) => (
              <optgroup key={place} label={place}>
                {list.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}, {c.specialty}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="consent-purpose" className="mb-1 block text-xs font-medium text-slate-600">
            Purpose
          </label>
          <input
            id="consent-purpose"
            className={input}
            list="consent-purposes"
            maxLength={200}
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            placeholder="Why this clinician needs access"
          />
          <datalist id="consent-purposes">
            {PURPOSES.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </div>

        <fieldset>
          <legend className="mb-1 text-xs font-medium text-slate-600">What they can see</legend>
          <div className="space-y-2">
            {SCOPES.map((s) => (
              <label
                key={s.id}
                className={`flex cursor-pointer gap-2 rounded-md border px-3 py-2 text-sm ${
                  scope === s.id ? 'border-teal-600 bg-teal-50' : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <input type="radio" name="consent-scope" value={s.id} checked={scope === s.id} onChange={() => setScope(s.id)} className="mt-0.5" />
                <span>
                  <span className="font-medium">{s.label}</span>
                  <span className="block text-xs text-slate-600">{s.detail}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label htmlFor="consent-duration" className="mb-1 block text-xs font-medium text-slate-600">
            Duration
          </label>
          <select id="consent-duration" className={input} value={duration} onChange={(e) => setDuration(e.target.value)}>
            {DURATIONS.map(([value, label]) => (
              <option key={label} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div className="rounded-md bg-slate-50 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Access request</p>
          <dl className="space-y-1">
            <Field label="Clinician">{chosen ? `${chosen.name}, ${chosen.facility}` : '—'}</Field>
            <Field label="Purpose">{purpose.trim() || '—'}</Field>
            <Field label="Duration">{durationLabel}</Field>
            <Field label="Status">Not granted yet</Field>
          </dl>
          {replacing && (
            <p className="mt-2 text-xs text-amber-800">
              This replaces {replacing.clinician.name}&apos;s current access ({SCOPE_LABEL[replacing.scope].toLowerCase()}).
            </p>
          )}
        </div>

        {error && (
          <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
            {error.body?.details ? error.body.details.map((d) => `${d.field} ${d.message}`).join(' ') : error.message}
          </div>
        )}

        <button
          type="submit"
          disabled={!ready || busy}
          className="w-full rounded-md bg-teal-700 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {busy ? 'Granting…' : 'GRANT ACCESS'}
        </button>
      </form>
    </Card>
  )
}
