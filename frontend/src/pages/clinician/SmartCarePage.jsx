import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useAuth } from '../../auth/context.js'
import { Segmented } from '../../components/analytics/common.jsx'
import Dialog from '../../components/Dialog.jsx'
import { PlusIcon, SparkIcon } from '../../components/icons.jsx'
import ServerRefusal from '../../components/ServerRefusal.jsx'
import SmartCareActivity from '../../components/smartcare/Activity.jsx'
import { BodyMap, GuidancePanel, SymptomRefTable } from '../../components/smartcare/Anatomy.jsx'
import { ClinicalMonitor, SymptomTracker, VoiceAssistant } from '../../components/smartcare/Intake.jsx'
import Results from '../../components/smartcare/Results.jsx'
import { Alert, Button, Card, EmptyState, LoadingState, PageHeader } from '../../components/ui.jsx'
import { SCOPE, titleCase } from '../../lib/format.js'
import { smartCarePayload } from '../../lib/smartcare.js'
import { inputClass } from '../../lib/styles.js'
import { useApiData } from '../../lib/useApiData.js'
import { guidance, HISTORY_OPTIONS, LANGUAGES, REGION_SYMPTOMS, SYMPTOMS, t, VITALS } from '../../lib/smartcareWorkspace.js'

const SEVERITY = { Low: 'MILD', Medium: 'MODERATE', High: 'SEVERE' }
const EMPTY_VITALS = Object.fromEntries(VITALS.map((v) => [v.key, '']))

function savedLang() {
  try {
    return localStorage.getItem('carecrypt.smartcare.lang') ?? 'en'
  } catch {
    return 'en'
  }
}

// SmartCare Assist workspace: the decision-support screen of the SmartCare Assist
// project (body map, clinical guidance, symptom table, symptom tracker, voice
// assistant, vitals, clinical monitor and full results), running against the
// patient's CareCrypt record. Analysis needs the patient's active consent.
export default function SmartCarePage() {
  const [params, setParams] = useSearchParams()
  const [lang, setLangState] = useState(savedLang)
  const tab = params.get('tab') === 'runs' ? 'runs' : 'workspace'
  const patientId = params.get('patient') ?? ''
  const patients = useApiData('/api/patients')
  const runs = useApiData(tab === 'runs' && '/api/smartcare/runs')

  function setLang(value) {
    setLangState(value)
    try {
      localStorage.setItem('carecrypt.smartcare.lang', value)
    } catch {
      // Remembering the language is a convenience only.
    }
  }
  const setParam = (key, value) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  return (
    <div>
      <PageHeader
        eyebrow="SmartCare Assist · Clinical Decision Support"
        title="Decision support workspace"
        description="Map symptoms on the body, speak or tick them, add vitals, and analyse them against the patient's longitudinal record. SmartCare never creates a diagnosis."
        actions={
          <label className="flex items-center gap-2 text-sm text-slate-600">
            🌐 <span className="sr-only sm:not-sr-only">{t(lang, 'lang_label', 'Language').replace('🌐', '').replace(':', '')}</span>
            <select value={lang} onChange={(e) => setLang(e.target.value)} className={`${inputClass} w-auto py-1.5`} aria-label="Language">
              {LANGUAGES.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        }
      />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="SmartCare view"
          value={tab}
          onChange={(v) => setParam('tab', v === 'runs' ? 'runs' : '')}
          options={[
            ['workspace', 'Workspace'],
            ['runs', 'Recent runs'],
          ]}
        />
        <p className="text-xs text-amber-800">⚠️ {t(lang, 'disclaimer_label', 'Clinical Disclaimer:')} {t(lang, 'disclaimer_pcw')}</p>
      </div>

      {tab === 'runs' ? (
        runs.error ? (
          <ServerRefusal error={runs.error} />
        ) : !runs.data ? (
          <LoadingState label="Loading SmartCare activity…" />
        ) : (
          <SmartCareActivity data={runs.data} />
        )
      ) : patients.error ? (
        <ServerRefusal error={patients.error} />
      ) : !patients.data ? (
        <LoadingState label="Loading your patients…" />
      ) : (
        <>
          <PatientPicker patients={patients.data.patients} value={patientId} onChange={(id) => setParam('patient', id)} />
          {patientId ? (
            <Workspace key={patientId} lang={lang} patientId={patientId} />
          ) : (
            <Card>
              <EmptyState icon={SparkIcon} title="Choose a patient to start">
                SmartCare runs on a patient&apos;s record, so the server checks that the patient has given you an active consent.
              </EmptyState>
            </Card>
          )}
        </>
      )}
    </div>
  )
}

function PatientPicker({ patients, value, onChange }) {
  return (
    <Card className="mb-5" bodyClassName="p-4">
      <label htmlFor="sc-patient" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Patient (active consent)
      </label>
      <select id="sc-patient" value={value} onChange={(e) => onChange(e.target.value)} className={`mt-1 ${inputClass}`}>
        <option value="">Choose a patient…</option>
        {patients.map((p) => (
          <option key={p.id} value={p.id}>
            {p.fullName} · {p.mrn} · {p.ageYears}y {titleCase(p.gender).charAt(0)} · {SCOPE[p.consentScope]?.label}
          </option>
        ))}
      </select>
    </Card>
  )
}

let logId = 0
const stamp = () => new Date().toTimeString().slice(0, 8)
const entry = (message, level = 'info') => ({ id: ++logId, time: stamp(), message, level })

function Workspace({ lang, patientId }) {
  const { request } = useAuth()
  const navigate = useNavigate()
  const record = useApiData(`/api/patients/${patientId}`)

  const [symptoms, setSymptoms] = useState(() => new Set())
  const [severity, setSeverity] = useState('Medium')
  const [duration, setDuration] = useState('1')
  const [vitals, setVitals] = useState(EMPTY_VITALS)
  const [history, setHistory] = useState(() => new Set())
  const [extraMeds, setExtraMeds] = useState('')
  const [pregnant, setPregnant] = useState(false)
  const [hover, setHover] = useState(null)
  const [focus, setFocus] = useState(null)
  const [popup, setPopup] = useState(null) // region id
  const [flash, setFlash] = useState(null)
  const [log, setLog] = useState(() => [
    entry('SmartCare Assist engine ready (rule-based, v2.0.0).'),
    entry('Anatomical vectors synchronised.'),
  ])
  const [run, setRun] = useState({ status: 'idle' }) // idle | running | done | error
  const [formError, setFormError] = useState(null)

  const addLog = (message, level) => setLog((l) => [...l.slice(-40), entry(message, level)])
  const activeRegions = useMemo(
    () => new Set([...symptoms].map((c) => SYMPTOMS.find((s) => s.code === c)?.region).filter(Boolean)),
    [symptoms],
  )

  if (record.error) return <ServerRefusal error={record.error} />
  if (!record.data) return <LoadingState label="Loading the patient's record…" />
  const { patient, access } = record.data
  const d = patient.demographics
  const canStartVisit = access.sections.visitHistory
  const name = (code) => t(lang, `symptom.${code}`, code)

  function changeSymptoms(next, source) {
    const added = [...next].filter((c) => !symptoms.has(c))
    setSymptoms(next)
    added.forEach((c) => addLog(`Symptom registered: ${t('en', `symptom.${c}`, c)}${source ? ` (${source})` : ''}`))
    if (next.has('headache') && next.has('high_bp') && !(symptoms.has('headache') && symptoms.has('high_bp'))) {
      addLog('Interaction pattern detected: hypertensive warning (headache + high BP).', 'alert')
    }
  }
  function toggle(code) {
    const next = new Set(symptoms)
    if (next.has(code)) next.delete(code)
    else next.add(code)
    changeSymptoms(next)
  }
  function pickFromTable(code) {
    const s = SYMPTOMS.find((x) => x.code === code)
    if (!symptoms.has(code)) changeSymptoms(new Set([...symptoms, code]), 'quick reference')
    setFocus(s.region)
    setFlash(code)
  }
  function applyVoice(found) {
    const next = new Set([...symptoms, ...found.symptoms])
    changeSymptoms(next, 'voice')
    if (found.durationDays) {
      setDuration(String(found.durationDays))
      addLog(`Duration from voice: ${found.durationDays} days`)
    }
  }

  async function analyse(e) {
    e.preventDefault()
    setFormError(null)
    const problems = []
    if (symptoms.size === 0) problems.push('Select at least one symptom.')
    for (const v of VITALS) {
      if (vitals[v.key] !== '' && (Number(vitals[v.key]) < v.min || Number(vitals[v.key]) > v.max)) {
        problems.push(`${v.name} must be between ${v.min} and ${v.max} ${v.unit}.`)
      }
    }
    if ((vitals.systolic === '') !== (vitals.diastolic === '')) problems.push('Enter both blood pressure values, or neither.')
    if (vitals.systolic !== '' && Number(vitals.systolic) <= Number(vitals.diastolic)) problems.push('Systolic must be higher than diastolic.')
    if (duration !== '' && !(Number.isInteger(Number(duration)) && Number(duration) >= 0)) problems.push('Duration must be a whole number of days.')
    if (problems.length) {
      setFormError(problems)
      addLog(`Vital guardrails blocked analysis: ${problems[0]}`, 'warning')
      return
    }

    const symptomList = [...symptoms].map((code) => ({ code, severity: SEVERITY[severity], durationDays: duration }))
    const medications = extraMeds
      .split(',')
      .map((m) => m.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''))
      .filter((m) => /^[a-z][a-z0-9_]{1,59}$/.test(m))
    const body = {
      ...smartCarePayload(patientId, symptomList, vitals),
      relevantHistory: [...history],
      medications,
      pregnant: pregnant && d.gender === 'FEMALE',
    }
    setRun({ status: 'running' })
    addLog('Submitting for clinical assessment…')
    try {
      const result = await request('/api/smartcare/analyze', { method: 'POST', body })
      setRun({ status: 'done', result, inputs: { symptomList, vitals, history: [...history].map((h) => titleCase(h)), pregnant: body.pregnant } })
      addLog(`Analysis complete. Risk ${result.overallRisk.level} (${result.overallRisk.score}/100), urgency ${result.overallRisk.urgency}.`, result.overallRisk.level === 'HIGH' ? 'alert' : 'success')
      if (result.possibleConditions[0]) addLog(`Leading pattern: ${result.possibleConditions[0].name}.`)
      if (result.assessment.maternal.applicable) addLog('Maternal risk protocol active.', 'warning')
      if (result.overallRisk.escalationSuggested) addLog('Escalation suggested by SmartCare.', 'alert')
    } catch (error) {
      setRun({ status: 'error', error })
      addLog(`Analysis refused: ${error.body?.reason ?? error.body?.error ?? error.message}`, 'alert')
    }
  }

  function startVisit() {
    const complaint = run.inputs.symptomList.map((s) => t('en', `symptom.${s.code}`, s.code).toLowerCase()).join(', ')
    navigate(`/clinician/patients/${patientId}?newVisit=1`, {
      state: {
        visitPrefill: {
          patientId,
          chiefComplaint: complaint.charAt(0).toUpperCase() + complaint.slice(1) + (duration ? ` for ${duration} day${duration === '1' ? '' : 's'}` : ''),
          symptoms: run.inputs.symptomList,
          vitals: run.inputs.vitals,
          analysis: run.result,
        },
      },
    })
  }

  function exportJson() {
    const blob = new Blob(
      [
        JSON.stringify(
          { exportedAt: new Date().toISOString(), patientMrn: patient.mrn, inputs: run.inputs, decisionSupport: run.result },
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    )
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `smartcare-${patient.mrn}-${run.result.analysisId.slice(0, 8)}.json`
    link.click()
    URL.revokeObjectURL(url)
    addLog('Decision support exported as JSON.')
  }

  const region = hover ?? focus

  return (
    <div className="grid gap-5 xl:grid-cols-[18rem_minmax(0,1fr)_16rem]">
      {/* Left: anatomical focus */}
      <aside className="space-y-4 print:hidden">
        <Card title={`👤 ${t(lang, 'ws.body_panel')}`} bodyClassName="p-4">
          <BodyMap
            lang={lang}
            activeRegions={activeRegions}
            focus={region}
            onHover={setHover}
            onSelect={(id) => {
              setFocus(id)
              setPopup(id)
            }}
          />
        </Card>
        <GuidancePanel lang={lang} region={region} />
        <SymptomRefTable lang={lang} selected={symptoms} focusRegion={region} onPick={pickFromTable} />
      </aside>

      {/* Centre: intake and results */}
      <div className="min-w-0 space-y-5">
        <Card bodyClassName="p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t(lang, 'soap.presentation', 'Presentation')}</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">
                {d.fullName} <span className="font-mono text-sm font-normal text-slate-500">{patient.mrn}</span>
              </p>
              <p className="text-sm text-slate-600">
                {d.ageYears} years · {titleCase(d.gender)} · {d.location.district}, {d.location.state} · consent: {SCOPE[access.scope].label}
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5 text-xs">
              {patient.allergies.length ? (
                patient.allergies.map((a) => (
                  <span key={a.allergen} className="rounded-md bg-red-50 px-2 py-1 font-medium text-red-800 ring-1 ring-inset ring-red-200">
                    Allergy: {a.allergen}
                  </span>
                ))
              ) : (
                <span className="rounded-md bg-slate-50 px-2 py-1 text-slate-600">No known allergies</span>
              )}
              {patient.chronicConditions
                .filter((c) => c.status === 'ACTIVE')
                .map((c) => (
                  <span key={c.code} className="rounded-md bg-slate-50 px-2 py-1 text-slate-700 ring-1 ring-inset ring-slate-200">
                    {c.name}
                  </span>
                ))}
            </div>
          </div>
        </Card>

        {run.status === 'done' ? (
          <Results
            lang={lang}
            result={run.result}
            inputs={run.inputs}
            patient={d}
            actions={
              <div className="flex flex-wrap gap-2 print:hidden">
                <Button onClick={startVisit} disabled={!canStartVisit}>
                  <PlusIcon className="h-4 w-4" />
                  Start a visit with this analysis
                </Button>
                <Button variant="secondary" onClick={exportJson}>
                  📄 Export JSON
                </Button>
                <Button variant="secondary" onClick={() => window.print()}>
                  🖨️ Print
                </Button>
                <Button variant="ghost" onClick={() => setRun({ status: 'idle' })}>
                  ✏️ Edit inputs
                </Button>
                {!canStartVisit && (
                  <p className="w-full text-xs text-slate-500">Recording a visit needs visit-history consent from this patient.</p>
                )}
              </div>
            }
          />
        ) : (
          <form onSubmit={analyse} className="space-y-5" noValidate>
            <Card title={`🩺 ${t(lang, 'symptoms_legend', 'Symptoms')}`} subtitle={`${symptoms.size} selected`}>
              <div className="space-y-5">
                <VoiceAssistant lang={lang} onApply={applyVoice} onLog={addLog} />
                <SymptomTracker lang={lang} selected={symptoms} onToggle={toggle} flash={flash} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block text-sm">
                    <span className="font-medium text-slate-700">{t(lang, 'duration_label', 'Duration (days):')}</span>
                    <input type="number" min="0" max="3650" value={duration} onChange={(e) => setDuration(e.target.value)} className={`mt-1 ${inputClass}`} />
                  </label>
                  <label className="block text-sm">
                    <span className="font-medium text-slate-700">{t(lang, 'severity_label', 'Severity:')}</span>
                    <select
                      value={severity}
                      onChange={(e) => {
                        setSeverity(e.target.value)
                        if (e.target.value === 'High') addLog('Severity multiplier layer engaged.', 'alert')
                      }}
                      className={`mt-1 ${inputClass}`}
                    >
                      <option value="Low">{t(lang, 'severity.low', 'Low')}</option>
                      <option value="Medium">{t(lang, 'severity.medium', 'Moderate')}</option>
                      <option value="High">{t(lang, 'severity.high', 'Severe')}</option>
                    </select>
                  </label>
                </div>
              </div>
            </Card>

            <Card title={`📊 ${t(lang, 'vitals_section', 'Vital signs')}`} subtitle="Optional but recommended. Out-of-range values are refused.">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                {VITALS.map((v) => (
                  <label key={v.key} className="block text-sm">
                    <span className="font-medium text-slate-700">{t(lang, v.label)}</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      step={v.step ?? 1}
                      min={v.min}
                      max={v.max}
                      placeholder={String(v.placeholder)}
                      value={vitals[v.key]}
                      onChange={(e) => setVitals((x) => ({ ...x, [v.key]: e.target.value }))}
                      className={`mt-1 ${inputClass}`}
                    />
                  </label>
                ))}
              </div>
            </Card>

            <Card title={`📋 ${t(lang, 'medical_history', 'Medical history')}`} subtitle="Recorded conditions, allergies and medications are loaded from the record. Add anything the patient reports that is not recorded yet.">
              <fieldset>
                <legend className="text-sm font-medium text-slate-700">{t(lang, 'chronic_conditions_label', 'Chronic conditions')}</legend>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
                  {HISTORY_OPTIONS.map(([key, labelKey, fallback]) => (
                    <label key={key} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={history.has(key)}
                        onChange={() => {
                          const next = new Set(history)
                          if (next.has(key)) next.delete(key)
                          else next.add(key)
                          setHistory(next)
                        }}
                        className="h-4 w-4 accent-teal-700"
                      />
                      {t(lang, labelKey, fallback)}
                    </label>
                  ))}
                  {d.gender === 'FEMALE' && (
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={pregnant}
                        onChange={(e) => {
                          setPregnant(e.target.checked)
                          if (e.target.checked) addLog('Maternal risk protocol monitoring active.', 'warning')
                        }}
                        className="h-4 w-4 accent-teal-700"
                      />
                      {t(lang, 'history.pregnancy', 'Pregnancy')}
                    </label>
                  )}
                </div>
              </fieldset>
              <label className="mt-4 block text-sm">
                <span className="font-medium text-slate-700">Other current medications (comma-separated)</span>
                <input value={extraMeds} onChange={(e) => setExtraMeds(e.target.value)} placeholder="e.g. aspirin, warfarin" className={`mt-1 ${inputClass}`} />
              </label>
            </Card>

            {formError && (
              <Alert tone="danger" title="Check the inputs">
                <ul className="list-disc pl-5">
                  {formError.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </Alert>
            )}
            {run.status === 'error' && <ServerRefusal error={run.error} />}

            <Button type="submit" className="w-full py-3 text-base" disabled={run.status === 'running'}>
              🔍 {run.status === 'running' ? t(lang, 'analyzing_case', 'Analysing…') : t(lang, 'submit_button', 'Submit for clinical assessment')}
            </Button>
          </form>
        )}
      </div>

      {/* Right: clinical monitor */}
      <aside className="print:hidden">
        <div className="xl:sticky xl:top-6">
          <ClinicalMonitor
            lang={lang}
            symptomCount={symptoms.size}
            log={log}
            analysing={run.status === 'running'}
            result={run.status === 'done' ? run.result : null}
            scope={SCOPE[access.scope].label}
          />
        </div>
      </aside>

      <Dialog
        open={Boolean(popup)}
        onClose={() => setPopup(null)}
        title={popup ? guidance(lang, popup).region : ''}
        description="Select the symptoms present in this region."
        footer={
          <Button onClick={() => setPopup(null)}>{t(lang, 'ws.region_popup_confirm')}</Button>
        }
      >
        {popup && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {REGION_SYMPTOMS[popup].map((code) => {
              const s = SYMPTOMS.find((x) => x.code === code)
              return (
                <label key={code} className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm">
                  <input type="checkbox" checked={symptoms.has(code)} onChange={() => toggle(code)} className="h-4 w-4 accent-teal-700" />
                  <span aria-hidden="true">{s.emoji}</span>
                  {name(code)}
                </label>
              )
            })}
          </div>
        )}
      </Dialog>
    </div>
  )
}
