import { useState } from 'react'
import { useAuth } from '../../auth/context.js'
import { Alert, Badge, Button, Card, EmptyState, LoadingState } from '../../components/ui.jsx'
import { formatDate, SCOPE } from '../../lib/format.js'
import { useApiData } from '../../lib/useApiData.js'

export function PatientConsentRequests({ patientId, onResolved }) {
  const { request } = useAuth()
  const { data, loading, error, reload } = useApiData(`/api/consent/${patientId}/requests`)
  
  const [resolvingId, setResolvingId] = useState(null)
  const [confirmApprove, setConfirmApprove] = useState(null)
  const [busy, setBusy] = useState(false)
  const [reqError, setReqError] = useState(null)

  if (loading && !data) return null
  if (error) return null

  const requests = data?.requests ?? []
  const pending = requests.filter(r => r.status === 'PENDING')
  
  async function resolveRequest(reqId, status) {
    setBusy(true)
    setReqError(null)
    try {
      await request(`/api/consent/requests/${reqId}/resolve`, {
        method: 'POST',
        body: { status }
      })
      setConfirmApprove(null)
      reload()
      if (onResolved) onResolved(status === 'APPROVED' ? 'Request approved and access granted.' : 'Request denied.')
    } catch (err) {
      setReqError(err)
    } finally {
      setBusy(false)
      setResolvingId(null)
    }
  }

  if (requests.length === 0) return null

  return (
    <div className="space-y-4 mb-8">
      {pending.length > 0 && (
        <Alert tone="warning" title="New Consent Requests">
          You have {pending.length} new request(s) for access to your medical record.
        </Alert>
      )}

      {reqError && <Alert tone="danger">{reqError.message}</Alert>}

      {pending.map(r => (
        <Card key={r.id} className="border-l-4 border-l-amber-500">
          <div className="flex justify-between items-start mb-2">
            <div>
              <h3 className="font-semibold text-lg">{r.clinicianName || r.clinician?.name || 'Clinician'}</h3>
              <p className="text-sm text-slate-600">
                {r.clinicianSpecialty || r.clinician?.specialty || ''}{' '}
                {(r.clinicianFacility || r.clinician?.facility) ? `· ${r.clinicianFacility || r.clinician?.facility}` : ''}{' '}
                {(r.clinicianDistrict || r.clinician?.district) ? `· ${r.clinicianDistrict || r.clinician?.district}` : ''}
              </p>
            </div>
            <span className="text-xs text-slate-500">{formatDate(r.createdAt)}</span>
          </div>
          
          <div className="bg-slate-50 p-3 rounded-md mb-4 text-sm space-y-2">
            <div><strong className="text-slate-700">Reason:</strong> {r.reason}</div>
            <div><strong className="text-slate-700">Requested Access:</strong> <Badge tone="blue">{SCOPE[r.scope]?.label || r.scope}</Badge></div>
            <div><strong className="text-slate-700">Duration:</strong> {r.requestedDurationDays ? `${r.requestedDurationDays} days` : 'Until revoked'}</div>
          </div>

          {confirmApprove === r.id ? (
             <div className="flex flex-wrap items-center gap-2 p-3 bg-amber-50 rounded-md border border-amber-200">
               <span className="text-sm text-amber-900 font-medium">Are you sure you want to grant this access?</span>
               <button onClick={() => { setResolvingId(r.id); resolveRequest(r.id, 'APPROVED') }} disabled={busy} className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-60">Yes, Approve Access</button>
               <button onClick={() => setConfirmApprove(null)} disabled={busy} className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-200">Cancel</button>
             </div>
          ) : (
             <div className="flex gap-2">
                <Button onClick={() => setConfirmApprove(r.id)} disabled={busy} className="bg-teal-600 text-white hover:bg-teal-700">Approve Access</Button>
                <Button onClick={() => { setResolvingId(r.id); resolveRequest(r.id, 'DENIED') }} disabled={busy} variant="secondary">Deny Request</Button>
             </div>
          )}
        </Card>
      ))}

      {requests.length > pending.length && (
         <details className="text-sm text-slate-600 cursor-pointer p-2 bg-slate-50 rounded">
           <summary className="font-medium">View Past Requests</summary>
           <div className="mt-2 space-y-2">
             {requests.filter(r => r.status !== 'PENDING').map(r => (
               <div key={r.id} className="p-2 border rounded">
                 <div><strong>{r.clinicianName}</strong> requested {r.scope} on {formatDate(r.createdAt)}</div>
                 <div className="text-xs mt-1">Status: <Badge tone="neutral">{r.status}</Badge></div>
               </div>
             ))}
           </div>
         </details>
      )}
    </div>
  )
}
