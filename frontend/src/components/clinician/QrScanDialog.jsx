import jsQR from 'jsqr'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useAuth } from '../../auth/context.js'
import Dialog from '../Dialog.jsx'
import { EmergencyAccessDialog } from './EmergencyAccessDialog.jsx'

const MODES = [
  { id: 'camera', label: 'Camera' },
  { id: 'upload', label: 'Upload image' },
  { id: 'manual', label: 'Enter code' },
]

const FAILURES = {
  QR_NOT_RECOGNISED: 'This is not a CareCrypt patient card.',
  QR_REVOKED: 'This card has been revoked. Ask the patient for their current card.',
  QR_EXPIRED: 'This card has expired. Ask the patient for their current card.',
  NO_ACTIVE_CONSENT: 'The card is valid, but this patient has not given you consent. Their record stays closed.',
  TOO_MANY_REQUESTS: 'Too many scans in a short time. Wait a minute and try again.',
}

// Decodes a patient QR card and asks the server who it belongs to. The server
// checks consent: a valid card alone does not open a record.
export default function QrScanDialog({ open, onClose }) {
  return (
    <Dialog open={open} onClose={onClose} title="Scan patient QR card" description="Only cards of patients who have given you consent will open.">
      <ScanPanel onClose={onClose} />
    </Dialog>
  )
}

// Also used inline on the QR Scanner page (without a dialog to close).
export function ScanPanel({ onClose = () => {} }) {
  const { request } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState('camera')
  const [status, setStatus] = useState({ state: 'idle' })

  async function resolve(token) {
    setStatus({ state: 'resolving' })
    try {
      const result = await request('/api/qr/resolve', { method: 'POST', body: { qrToken: token } })
      onClose()
      navigate(`/clinician/patients/${result.patientId}`)
    } catch (err) {
      const code = err.body?.reason ?? err.body?.error
      setStatus({ state: 'error', message: FAILURES[code] ?? err.message, code, httpStatus: err.status, qrToken: token })
    }
  }

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Scan method" className="inline-flex rounded-md border border-slate-200 p-0.5">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={mode === m.id}
            onClick={() => {
              setMode(m.id)
              setStatus({ state: 'idle' })
            }}
            className={`rounded px-3 py-1.5 text-sm ${
              mode === m.id ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* The camera runs only while idle, so a rejected card is not re-read in a loop. */}
      {mode === 'camera' && status.state === 'idle' && <CameraScanner onCode={resolve} />}
      {mode === 'upload' && <ImageScanner onCode={resolve} onError={(message) => setStatus({ state: 'error', message })} />}
      {mode === 'manual' && <ManualEntry onCode={resolve} busy={status.state === 'resolving'} />}

      {status.state === 'resolving' && <p className="text-sm text-slate-600">Checking card with the server…</p>}
      
      {status.state === 'success' && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900" role="status">
          <div className="flex items-center gap-2 font-semibold text-emerald-800">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-xs text-white">✓</span>
            Consent Request Sent Successfully!
          </div>
          <p className="mt-1 text-emerald-700">{status.message}</p>
        </div>
      )}

      {status.state === 'error' && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
          <div className="flex items-start gap-2">
            {status.httpStatus && (
              <span className="rounded bg-red-600 px-1.5 py-0.5 font-mono text-xs font-bold text-white shrink-0">{status.httpStatus}</span>
            )}
            <div className="flex-1 font-medium">{status.message}</div>
          </div>
          {mode === 'camera' && (
            <button
              type="button"
              onClick={() => setStatus({ state: 'idle' })}
              className="mt-2 text-xs font-semibold underline text-red-700 hover:text-red-900"
            >
              Scan again
            </button>
          )}
          {status.code === 'NO_ACTIVE_CONSENT' && status.qrToken && (
            <div className="mt-4 pt-3 border-t border-red-200/60 flex gap-2.5 flex-wrap">
              <button
                type="button"
                onClick={() => setStatus({ ...status, showConsentRequest: true, showEmergency: false })}
                className="rounded-md bg-teal-700 px-3.5 py-2 text-xs font-bold text-white shadow-sm hover:bg-teal-800 transition-colors flex items-center gap-1.5"
              >
                <span>🔔</span> Request Standard Consent
              </button>
              <button
                type="button"
                onClick={() => setStatus({ ...status, showEmergency: true, showConsentRequest: false })}
                className="rounded-md bg-red-600 px-3.5 py-2 text-xs font-bold text-white shadow-sm hover:bg-red-700 transition-colors flex items-center gap-1.5"
              >
                <span>🚨</span> Request Emergency Break-Glass Access
              </button>
            </div>
          )}
        </div>
      )}

      {status.showConsentRequest && (
        <QrConsentRequestForm
          qrToken={status.qrToken}
          onClose={() => setStatus({ ...status, showConsentRequest: false })}
          onSuccess={() => {
            setStatus({
              state: 'success',
              message: 'The patient has received your consent request notification. They can approve it from their Consent page to grant you access.',
            })
          }}
        />
      )}

      {status.showEmergency && (
        <EmergencyAccessDialog 
          open={true} 
          onClose={() => setStatus({ ...status, showEmergency: false })} 
          qrToken={status.qrToken} 
        />
      )}
    </div>
  )
}

function QrConsentRequestForm({ qrToken, onClose, onSuccess }) {
  const { request } = useAuth()
  const [scope, setScope] = useState('VISIT_HISTORY')
  const [duration, setDuration] = useState('30')
  const [reason, setReason] = useState('')
  const [urgency, setUrgency] = useState('ROUTINE')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const SCOPES = [
    { id: 'FULL_RECORD', label: 'Full Record' },
    { id: 'VISIT_HISTORY', label: 'Visit History' },
    { id: 'SUMMARY_ONLY', label: 'Summary Only' },
  ]
  const DURATIONS = [[7, '7 days'], [30, '30 days'], [90, '3 months'], [365, '1 year']]

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const finalReason = urgency === 'URGENT' ? `[URGENT] ${reason}` : reason
      await request('/api/clinicians/consent-requests', {
        method: 'POST',
        body: { qrToken, scope, durationDays: Number(duration), reason: finalReason }
      })
      onSuccess()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-4 rounded-md border border-slate-200 bg-slate-50 p-4">
      <h3 className="font-semibold text-slate-800">Request Consent via QR</h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Access Scope</label>
          <select value={scope} onChange={e => setScope(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
            {SCOPES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Duration</label>
          <select value={duration} onChange={e => setDuration(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
            {DURATIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Urgency</label>
          <select value={urgency} onChange={e => setUrgency(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
            <option value="ROUTINE">Routine</option>
            <option value="URGENT">Urgent</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Reason</label>
          <input required minLength={3} maxLength={200} value={reason} onChange={e => setReason(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" placeholder="Why you need access" />
        </div>
      </div>
      {error && (
        <div className="rounded border border-red-200 bg-red-50 p-2.5 text-sm text-red-700">
          {error.message || 'Failed to submit request.'}
        </div>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onClose} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-100">Cancel</button>
        <button type="submit" disabled={busy || reason.trim().length < 3} className="rounded-md bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50">
          {busy ? 'Sending Request...' : 'Send Request'}
        </button>
      </div>
    </form>
  )
}

function CameraScanner({ onCode }) {
  const videoRef = useRef(null)
  const [cameraError, setCameraError] = useState(null)
  // Latest callback, read by the scan loop without restarting the camera.
  const onCodeRef = useRef(onCode)
  useEffect(() => {
    onCodeRef.current = onCode
  }, [onCode])

  useEffect(() => {
    let stream
    let timer
    let stopped = false
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })

    function stop() {
      stopped = true
      clearInterval(timer)
      stream?.getTracks().forEach((t) => t.stop())
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      Promise.resolve().then(() => setCameraError('This browser cannot use the camera here. Use Upload image or Enter code.'))
      return stop
    }

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then((s) => {
        if (stopped) return s.getTracks().forEach((t) => t.stop())
        stream = s
        const video = videoRef.current
        video.srcObject = s
        video.play().catch(() => {})
        timer = setInterval(() => {
          if (video.readyState < 2 || !video.videoWidth) return
          canvas.width = video.videoWidth
          canvas.height = video.videoHeight
          ctx.drawImage(video, 0, 0)
          const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
          const code = jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' })
          if (code?.data) {
            stop()
            onCodeRef.current(code.data)
          }
        }, 250)
      })
      .catch((err) => {
        setCameraError(
          err.name === 'NotAllowedError'
            ? 'Camera permission was refused. Use Upload image or Enter code instead.'
            : 'No camera is available. Use Upload image or Enter code instead.',
        )
      })

    return stop
  }, [])

  if (cameraError) return <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">{cameraError}</p>

  return (
    <div className="relative overflow-hidden rounded-md bg-slate-900">
      <video ref={videoRef} muted playsInline className="aspect-video w-full object-cover" />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-40 w-40 rounded-lg border-2 border-white/80" />
      </div>
      <p className="absolute bottom-2 left-0 right-0 text-center text-xs text-white/90">Hold the card inside the square</p>
    </div>
  )
}

function ImageScanner({ onCode, onError }) {
  async function onFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const bitmap = await createImageBitmap(file)
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const ctx = canvas.getContext('2d')
      ctx.drawImage(bitmap, 0, 0)
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const code = jsQR(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' })
      if (code?.data) onCode(code.data)
      else onError('No QR code was found in that image. Try a sharper photo.')
    } catch {
      onError('That file could not be read as an image.')
    }
  }

  return (
    <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-600 hover:border-teal-600 hover:bg-teal-50/40">
      <span className="font-medium text-slate-800">Choose a photo of the patient card</span>
      <span className="text-xs">PNG or JPEG. The image is decoded in your browser and not uploaded.</span>
      <input type="file" accept="image/*" onChange={onFile} className="sr-only" />
    </label>
  )
}

function ManualEntry({ onCode, busy }) {
  const [value, setValue] = useState('')
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (value.trim()) onCode(value.trim())
      }}
    >
      <label htmlFor="qr-code-text" className="sr-only">
        Card code
      </label>
      <input
        id="qr-code-text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Paste the code printed under the QR"
        autoComplete="off"
        className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 font-mono text-sm focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
      />
      <button
        type="submit"
        disabled={busy || !value.trim()}
        className="rounded-md bg-teal-700 px-3 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50"
      >
        Open
      </button>
    </form>
  )
}
