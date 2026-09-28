import { useEffect, useMemo, useRef, useState } from 'react'
import { scanTranscript, SYMPTOMS, t } from '../../lib/smartcareWorkspace.js'

// Symptom tracker: the 19 symptom cards of the SmartCare intake form.
export function SymptomTracker({ lang, selected, onToggle, flash }) {
  return (
    <fieldset>
      <legend className="sr-only">{t(lang, 'symptoms_legend', 'Symptoms')}</legend>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 2xl:grid-cols-3">
        {SYMPTOMS.map((s) => {
          const on = selected.has(s.code)
          return (
            <label
              key={s.code}
              className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3.5 py-3 text-sm transition-colors ${
                on
                  ? 'border-teal-500 bg-teal-50 text-teal-900'
                  : flash === s.code
                    ? 'border-indigo-400 bg-indigo-50'
                    : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              <input
                type="checkbox"
                name="symptom"
                value={s.code}
                checked={on}
                onChange={() => onToggle(s.code)}
                className="h-4 w-4 accent-teal-700"
              />
              <span aria-hidden="true" className="text-lg">
                {s.emoji}
              </span>
              <span className="font-medium">{t(lang, `symptom.${s.code}`, s.code)}</span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

const SPEECH_LANG = { en: 'en-IN', hi: 'hi-IN', mr: 'mr-IN' }

// Voice Clinical Assistant: speech recognition in English, Hindi or Marathi.
// Detected symptoms and duration are suggested, never applied without Apply.
// Audio stays in the browser's speech service; nothing is sent to CareCrypt.
export function VoiceAssistant({ lang, onApply, onLog }) {
  const Recognition = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [finalText, setFinalText] = useState('')
  // Suggestions are derived from the transcript; `settled` is the transcript as it
  // was when its suggestions were applied or discarded.
  const found = useMemo(() => scanTranscript(finalText), [finalText])
  const [settled, setSettled] = useState('')
  const [error, setError] = useState(null)
  const recRef = useRef(null)
  const meterRef = useRef(null)
  const audioRef = useRef(null)

  // Release the microphone when leaving the page.
  useEffect(() => () => stopRef.current(), [])

  const stopRef = useRef(() => {})
  stopRef.current = stop
  function stop() {
    recRef.current?.stop()
    recRef.current = null
    const a = audioRef.current
    if (a) {
      cancelAnimationFrame(a.frame)
      a.stream.getTracks().forEach((tr) => tr.stop())
      a.ctx.close()
      audioRef.current = null
    }
    setListening(false)
  }

  async function start() {
    setError(null)
    const rec = new Recognition()
    rec.lang = SPEECH_LANG[lang] ?? 'en-IN'
    rec.continuous = true
    rec.interimResults = true
    rec.onresult = (event) => {
      let live = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0].transcript
        if (event.results[i].isFinal) {
          setFinalText((prev) => `${prev}${prev && !/[.!?]$/.test(prev.trim()) ? '. ' : prev ? ' ' : ''}${text.trim()}`)
          onLog(`Voice: “${text.trim()}”`, 'info')
        } else {
          live += text
        }
      }
      setInterim(live)
    }
    rec.onerror = (e) => {
      setError(
        e.error === 'not-allowed'
          ? 'Microphone permission was refused.'
          : e.error === 'no-speech'
            ? 'No speech detected. Try again.'
            : `Speech recognition stopped (${e.error}).`,
      )
      stop()
    }
    rec.onend = () => setListening(false)
    try {
      rec.start()
    } catch {
      setError('Speech recognition could not start.')
      return
    }
    recRef.current = rec
    setListening(true)
    onLog(`Voice assistant listening (${rec.lang})`, 'info')

    // Level meter from the microphone (visual only).
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const ctx = new AudioContext()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 64
      ctx.createMediaStreamSource(stream).connect(analyser)
      const data = new Uint8Array(analyser.frequencyBinCount)
      const a = { stream, ctx, frame: 0 }
      const draw = () => {
        const canvas = meterRef.current
        if (canvas) {
          analyser.getByteFrequencyData(data)
          const g = canvas.getContext('2d')
          g.clearRect(0, 0, canvas.width, canvas.height)
          const w = canvas.width / data.length
          data.forEach((v, i) => {
            const h = (v / 255) * canvas.height
            g.fillStyle = '#0f766e'
            g.fillRect(i * w, canvas.height - h, w - 1, h)
          })
        }
        a.frame = requestAnimationFrame(draw)
      }
      audioRef.current = a
      draw()
    } catch {
      // The meter is optional; recognition works without it.
    }
  }

  function reset() {
    setFinalText('')
    setInterim('')
    setSettled('')
  }

  const hasSuggestions = finalText !== settled && (found.symptoms.size > 0 || found.durationDays)

  return (
    <section className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-xl shadow-sm">
            🎙️
          </span>
          <div>
            <h3 className="text-sm font-semibold text-slate-900">{t(lang, 'voice_assistant_title', 'Voice Clinical Assistant')}</h3>
            <p className="text-xs text-slate-500">{t(lang, 'voice_instructions')}</p>
          </div>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${listening ? 'bg-red-100 text-red-700' : 'bg-slate-200 text-slate-600'}`}
          role="status"
        >
          {listening ? '● Listening' : t(lang, 'voice_status_standby', 'Standby')}
        </span>
      </div>

      {!Recognition ? (
        <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
          This browser has no speech recognition. Use Chrome or Edge, or tick the symptoms below.
        </p>
      ) : (
        <>
          <canvas ref={meterRef} width="600" height="32" className="mt-3 h-8 w-full rounded-md border border-slate-200 bg-white" aria-hidden="true" />
          <p className="mt-2 min-h-10 rounded-md border border-dashed border-slate-300 bg-white px-3 py-2 text-sm text-slate-700" aria-live="polite">
            {interim || (listening ? '…' : <span className="text-slate-400">{t(lang, 'voice_listening_placeholder')}</span>)}
          </p>
          <div className="mt-3">
            <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <label htmlFor="final-transcript">{t(lang, 'final_transcript_label', 'Final Transcript')}</label>
              <button type="button" onClick={reset} className="text-teal-700 hover:underline">
                {t(lang, 'btn_reset', 'Reset')}
              </button>
            </div>
            <textarea
              id="final-transcript"
              value={finalText}
              onChange={(e) => setFinalText(e.target.value)}
              rows={3}
              placeholder="Transcript (you can also type here)"
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
            />
          </div>
          <button
            type="button"
            onClick={listening ? stop : start}
            className={`mt-3 w-full rounded-lg px-3 py-2.5 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 ${
              listening ? 'bg-red-600 text-white hover:bg-red-700' : 'border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
            }`}
          >
            {listening ? t(lang, 'btn_stop_recording', '⏹️ Stop Recording') : t(lang, 'btn_start_recording', '🎤 Start Recording')}
          </button>
        </>
      )}
      {error && (
        <p className="mt-2 text-xs text-red-700" role="alert">
          {error}
        </p>
      )}

      {hasSuggestions && (
        <div className="mt-4 rounded-lg border border-sky-200 bg-sky-50 p-3">
          <p className="text-sm font-semibold text-sky-900">💡 {t(lang, 'voice_review_title', 'Suggested Form Updates')}</p>
          {found.symptoms.size > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {[...found.symptoms].map((code) => {
                const s = SYMPTOMS.find((x) => x.code === code)
                return (
                  <li key={code} className="rounded-full border border-sky-200 bg-white px-2 py-0.5 text-xs text-sky-900">
                    ✅ {s?.emoji} {t(lang, `symptom.${code}`, code)}
                  </li>
                )
              })}
            </ul>
          )}
          {found.durationDays && (
            <p className="mt-2 text-sm text-sky-900">
              ⏳ Detected duration: <strong>{found.durationDays} days</strong>
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => {
                onApply(found)
                setSettled(finalText)
              }}
              className="flex-1 rounded-md bg-sky-700 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-800"
            >
              {t(lang, 'btn_apply_updates', 'Apply Updates')}
            </button>
            <button
              type="button"
              onClick={() => setSettled(finalText)}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              {t(lang, 'btn_discard', 'Discard')}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

const LOG_COLOR = { info: 'text-slate-300', success: 'text-emerald-300', warning: 'text-amber-300', alert: 'text-red-300' }
const LOG_PREFIX = { info: '[INFO]', success: '[OK]', warning: '[WARN]', alert: '[ALERT]' }

// Clinical Monitor: live log of what the workspace is doing.
export function ClinicalMonitor({ lang, symptomCount, log, analysing, result, scope }) {
  const logRef = useRef(null)
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [log])
  const escalation = result?.overallRisk
  return (
    <section className="rounded-xl bg-slate-900 p-4 font-mono text-xs text-slate-300 shadow-sm">
      <h2 className="flex items-center gap-2 font-sans text-[11px] font-extrabold uppercase tracking-[0.2em] text-slate-200">
        📡 {t(lang, 'ws.monitor')}
      </h2>
      <dl className="mt-3 divide-y divide-slate-800">
        <div className="flex justify-between py-2">
          <dt>SYSTEM STATUS</dt>
          <dd className="text-emerald-400">● ACTIVE</dd>
        </div>
        <div className="flex justify-between py-2">
          <dt>SYMPTOMS LOGGED</dt>
          <dd className="font-bold text-sky-300">{symptomCount}</dd>
        </div>
        <div className="flex justify-between py-2">
          <dt>CONSENT SCOPE</dt>
          <dd className="text-slate-200">{scope ?? '—'}</dd>
        </div>
      </dl>
      {analysing && <p className="mt-3 animate-pulse text-sky-300 motion-reduce:animate-none">Analyzing input…</p>}
      <ol ref={logRef} className="mt-3 max-h-64 space-y-1 overflow-y-auto" aria-label="Clinical event log">
        {log.map((e) => (
          <li key={e.id} className="leading-snug">
            <span className="text-slate-500">{e.time}</span> <span className={LOG_COLOR[e.level]}>{LOG_PREFIX[e.level]} {e.message}</span>
          </li>
        ))}
      </ol>
      <div
        className={`mt-4 rounded-lg border px-3 py-2 font-sans ${
          escalation?.escalationSuggested ? 'border-red-500/50 bg-red-500/10 text-red-200' : 'border-slate-700 bg-slate-800/60 text-slate-300'
        }`}
      >
        <p className="text-[10px] font-extrabold uppercase tracking-wide">👁️ Escalation watch</p>
        <p className="mt-0.5 text-xs">
          {!escalation
            ? 'No analysis yet'
            : escalation.escalationSuggested
              ? `${escalation.urgency} urgency: escalation suggested`
              : 'No high-risk vectors detected'}
        </p>
      </div>
    </section>
  )
}
