import { useState } from 'react'
import { useAuth } from '../../auth/context.js'
import { Button, Card, StatusBadge, Alert } from '../../components/ui.jsx'
import { inputClass } from '../../lib/styles.js'
import { useApiData } from '../../lib/useApiData.js'
import { formatDate } from '../../lib/format.js'

export function ClinicianConsentRequests() {
  const { request } = useAuth()
  const { data, loading, error, reload } = useApiData('/api/clinicians/consent-requests')
  
  const [mrn, setMrn] = useState('')
  const [scope, setScope] = useState('VISIT_HISTORY')
  const [duration, setDuration] = useState('30')
  const [reason, setReason] = useState('')
  const [urgency, setUrgency] = useState('ROUTINE')
  const [busy, setBusy] = useState(false)
  const [reqError, setReqError] = useState(null)
  const [success, setSuccess] = useState(null)

  const SCOPES = [
    { id: 'FULL_RECORD', label: 'Full Record' },
    { id: 'VISIT_HISTORY', label: 'Visit History' },
    { id: 'SUMMARY_ONLY', label: 'Summary Only' },
  ]

  const DURATIONS = [
    [7, '7 days'],
    [30, '30 days'],
    [90, '3 months'],
    [365, '1 year'],
  ]

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setReqError(null)
    setSuccess(null)
    try {
      const finalReason = urgency === 'URGENT' ? `[URGENT] ${reason}` : reason
      await request('/api/clinicians/consent-requests', {
        method: 'POST',
        body: {
          mrn: mrn.trim(),
          scope,
          durationDays: duration ? Number(duration) : null,
          reason: finalReason,
        }
      })
      setSuccess('Request sent successfully.')
      setMrn('')
      setReason('')
      setUrgency('ROUTINE')
      reload()
    } catch (err) {
      setReqError(err)
    } finally {
      setBusy(false)
    }
  }

  const requests = data?.requests ?? []

  return (
    <div className="space-y-6 mb-6">
      <Card title="Request Patient Access" subtitle="Ask a patient to grant you access to their record">
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Patient MRN</label>
              <input required value={mrn} onChange={e => setMrn(e.target.value)} className={inputClass} placeholder="CC-..." />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Access Scope</label>
              <select value={scope} onChange={e => setScope(e.target.value)} className={inputClass}>
                {SCOPES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Duration</label>
              <select value={duration} onChange={e => setDuration(e.target.value)} className={inputClass}>
                {DURATIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Urgency</label>
              <select value={urgency} onChange={e => setUrgency(e.target.value)} className={inputClass}>
                <option value="ROUTINE">Routine</option>
                <option value="URGENT">Urgent</option>
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Reason</label>
            <input required minLength={3} maxLength={200} value={reason} onChange={e => setReason(e.target.value)} className={inputClass} placeholder="Why you need access" />
          </div>
          {reqError && <div className="text-sm text-red-600">{reqError.message}</div>}
          {success && <div className="text-sm text-green-600">{success}</div>}
          <div className="flex justify-end">
            <Button type="submit" disabled={busy || !mrn.trim() || reason.trim().length < 3}>
              {busy ? 'Sending...' : 'Send Request'}
            </Button>
          </div>
        </form>
      </Card>

      {requests.length > 0 && (
        <Card title="Sent Requests">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">MRN</th>
                  <th className="px-3 py-2 font-medium">Scope</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {requests.map(r => (
                  <tr key={r.id}>
                    <td className="px-3 py-2">{formatDate(r.createdAt)}</td>
                    <td className="px-3 py-2 font-mono">{r.patientMrn}</td>
                    <td className="px-3 py-2">{r.scope}</td>
                    <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
