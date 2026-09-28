import { useState } from 'react'
import { useAuth } from '../../auth/context.js'
import { formatDateTime, ROLE_LABEL } from '../../lib/format.js'
import { inputClass } from '../../lib/styles.js'
import { Badge, Button } from '../ui.jsx'

const SEVERITY_TONE = { HIGH: 'red', MEDIUM: 'amber', LOW: 'neutral' }

// One security event, with its details and (while open) a resolution form.
export default function EventItem({ event: e, onResolved }) {
  const { request } = useAuth()
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState({ busy: false, error: null })

  async function resolve(ev) {
    ev.preventDefault()
    setSaving({ busy: true, error: null })
    try {
      await request(`/api/security/events/${e.id}/resolve`, { method: 'POST', body: { note } })
      onResolved()
    } catch (error) {
      setSaving({ busy: false, error })
    }
  }

  return (
    <li
      className={`rounded-lg border p-4 ${
        e.status === 'OPEN' && e.severity === 'HIGH' ? 'border-red-200 bg-red-50/40' : 'border-slate-200 bg-white'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={SEVERITY_TONE[e.severity]}>{e.severity}</Badge>
            <span className="text-sm font-semibold text-slate-900">{e.title}</span>
            {e.status === 'RESOLVED' && <Badge tone="green">Resolved</Badge>}
          </div>
          <p className="mt-1 text-sm text-slate-700">{e.summary}</p>
          <p className="mt-1 text-xs text-slate-500">
            {formatDateTime(e.detectedAt)} ·{' '}
            {e.user ? `${e.user.name} (${ROLE_LABEL[e.user.role] ?? e.user.role})` : 'Unknown account'}
            {e.user?.email ? ` · ${e.user.email}` : ''}
          </p>
          {e.status === 'RESOLVED' && (
            <p className="mt-1 text-xs text-slate-600">
              Resolved by {e.resolvedBy} on {formatDateTime(e.resolvedAt)}: “{e.resolutionNote}”
            </p>
          )}
        </div>
        <Button variant="secondary" size="sm" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? 'Hide details' : 'Details'}
        </Button>
      </div>
      {open && (
        <pre className="mt-2 overflow-x-auto rounded bg-slate-900 p-3 font-mono text-xs text-slate-100">
          {JSON.stringify(e.details, null, 2)}
        </pre>
      )}
      {e.status === 'OPEN' && (
        <form onSubmit={resolve} className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <label htmlFor={`note-${e.id}`} className="text-xs font-medium text-slate-600">
              Resolution note
            </label>
            <input
              id={`note-${e.id}`}
              value={note}
              onChange={(ev) => setNote(ev.target.value)}
              placeholder="What was found and what was done"
              className={`mt-1 ${inputClass}`}
            />
          </div>
          <Button type="submit" disabled={saving.busy || note.trim().length < 3}>
            {saving.busy ? 'Saving…' : 'Mark resolved'}
          </Button>
          {saving.error && (
            <p className="w-full text-xs text-red-700" role="alert">
              {saving.error.message}
            </p>
          )}
        </form>
      )}
    </li>
  )
}
