import jsQR from 'jsqr'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useAuth } from '../../auth/context.js'
import Dialog from '../Dialog.jsx'

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
      setStatus({ state: 'error', message: FAILURES[code] ?? err.message, code, httpStatus: err.status })
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
      {status.state === 'error' && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {status.httpStatus && (
            <span className="mr-2 rounded bg-red-600 px-1.5 py-0.5 font-mono text-xs text-white">{status.httpStatus}</span>
          )}
          {status.message}
          {mode === 'camera' && (
            <button
              type="button"
              onClick={() => setStatus({ state: 'idle' })}
              className="ml-2 font-medium underline"
            >
              Scan again
            </button>
          )}
        </div>
      )}
    </div>
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
