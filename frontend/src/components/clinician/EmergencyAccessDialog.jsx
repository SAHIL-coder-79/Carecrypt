import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useAuth } from '../../auth/context.js'
import Dialog from '../Dialog.jsx'

export function EmergencyAccessDialog({ open, onClose, qrToken }) {
  const { request } = useAuth()
  const navigate = useNavigate()
  const [reason, setReason] = useState('')
  const [scope, setScope] = useState('FULL_RECORD')
  const [duration, setDuration] = useState('4')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const result = await request(`/api/qr/emergency-access`, {
        method: 'POST',
        body: { qrToken, reason, scope, durationHours: parseInt(duration, 10) }
      })
      onClose()
      navigate(`/clinician/patients/${result.patientId}`)
    } catch (err) {
      setError(err.body?.details?.[0]?.message || err.message)
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Emergency Access Request" description="Break-glass access for medical emergencies.">
      <form onSubmit={submit} className="space-y-4">
        {error && <div className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-800">{error}</div>}
        
        <div className="rounded bg-amber-50 p-3 text-sm text-amber-900 border border-amber-200">
          <strong className="block mb-1 font-bold text-amber-950">⚠️ WARNING: This event will be audited.</strong>
          Emergency access bypasses normal patient consent. Your identity, the patient reference, scope, and reason will be permanently recorded in the immutable audit log and available for review by security administrators and the patient.
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Patient Card</label>
          <input type="text" readOnly value={`Card ending in ${qrToken?.slice(-4) || '...'}`} className="w-full rounded border-slate-300 bg-slate-50 px-3 py-2 text-sm font-mono text-slate-500" />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Required Reason</label>
          <textarea required minLength={5} value={reason} onChange={e => setReason(e.target.value)} rows={3} placeholder="Describe the medical emergency..." className="w-full rounded border-slate-300 px-3 py-2 text-sm focus:border-red-600 focus:ring-red-600" />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Requested Scope</label>
            <select value={scope} onChange={e => setScope(e.target.value)} className="w-full rounded border-slate-300 px-3 py-2 text-sm focus:border-red-600 focus:ring-red-600">
              <option value="SUMMARY_ONLY">Summary Only</option>
              <option value="VISIT_HISTORY">Visit History</option>
              <option value="FULL_RECORD">Full Record</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Duration (Hours)</label>
            <input type="number" min="1" max="24" value={duration} onChange={e => setDuration(e.target.value)} className="w-full rounded border-slate-300 px-3 py-2 text-sm focus:border-red-600 focus:ring-red-600" />
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button type="button" onClick={onClose} className="rounded px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">Cancel</button>
          <button type="submit" disabled={busy || reason.length < 5} className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">Confirm Emergency Access</button>
        </div>
      </form>
    </Dialog>
  )
}