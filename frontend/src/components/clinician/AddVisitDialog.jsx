import { useMemo, useRef, useState } from 'react'
import { useAuth } from '../../auth/context.js'
import { formatDateTime, titleCase, VISIT_TYPE_LABEL } from '../../lib/format.js'
import { smartCarePayload } from '../../lib/smartcare.js'
import { useApiData } from '../../lib/useApiData.js'
import Dialog from '../Dialog.jsx'
import { Badge, Spinner } from '../ui.jsx'
import SmartCarePanel from './SmartCarePanel.jsx'

const VISIT_TYPES = [
  ['OPD', 'Outpatient'],
  ['FOLLOW_UP', 'Follow-up'],
  ['EMERGENCY', 'Emergency'],
  ['TELECONSULT', 'Teleconsult'],
]
const SEVERITIES = ['MILD', 'MODERATE', 'SEVERE']
const DX_TYPES = ['PROVISIONAL', 'CONFIRMED', 'DIFFERENTIAL']
const ROUTES = ['ORAL', 'INHALED', 'TOPICAL', 'IV', 'IM', 'SC', 'OTHER']
const VITAL_FIELDS = [
  ['temperatureC', 'Temperature', '°C', '0.1'],
  ['pulseBpm', 'Pulse', 'bpm', '1'],
  ['systolic', 'BP systolic', 'mmHg', '1'],
  ['diastolic', 'BP diastolic', 'mmHg', '1'],
  ['respiratoryRate', 'Resp. rate', '/min', '1'],
  ['spo2Percent', 'SpO₂', '%', '1'],
  ['weightKg', 'Weight', 'kg', '0.1'],
  ['heightCm', 'Height', 'cm', '0.1'],
]

// The clinical visit workflow, in order. The last step saves.
const STEPS = ['Symptoms', 'Vitals', 'Decision support', 'Assessment', 'Medication', 'Notes & confirm']
// Which step a field named in a server validation error belongs to.
const FIELD_STEP = [
  [/^(visitType|visitAt|chiefComplaint|symptoms)/, 0],
  [/^vitals/, 1],
  [/^decisionSupport/, 2],
  [/^diagnoses/, 3],
  [/^medications/, 4],
  [/^(notes|clinicianAttestation)/, 5],
]

// Base field style; `input` adds full width for fields that fill their cell.
const field =
  'rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20'
const input = `w-full ${field}`

// `initial` (optional) pre-fills the form from the SmartCare workspace:
// { chiefComplaint, symptoms: [{ code, severity, durationDays }], vitals: { key: string }, analysis }
// where `analysis` is the SmartCare response for exactly those symptoms and vitals.
export default function AddVisitDialog({ open, onClose, patient, onCreated, initial = null }) {
  // Mounted only while open, so each new visit starts from an empty (or pre-filled) form.
  if (!open) return null
  return <VisitWorkflow patient={patient} onClose={onClose} onCreated={onCreated} initial={initial} />
}

function nowLocal() {
  const d = new Date()
  d.setSeconds(0, 0)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

function VisitWorkflow({ patient, onClose, onCreated, initial }) {
  const { request } = useAuth()
  const topRef = useRef(null)
  const reference = useApiData('/api/reference')
  const [maxVisitAt] = useState(nowLocal)
  const [form, setForm] = useState(() => ({
    visitType: 'OPD',
    visitAt: maxVisitAt,
    chiefComplaint: initial?.chiefComplaint ?? '',
    notes: '',
    vitals: { ...Object.fromEntries(VITAL_FIELDS.map(([k]) => [k, ''])), ...(initial?.vitals ?? {}) },
    symptoms: initial?.symptoms ?? [],
    diagnoses: [],
    medications: [],
  }))
  const [step, setStep] = useState(0)
  const [furthest, setFurthest] = useState(0)
  // { result, inputKey, reviewed }. A workspace analysis arrives unreviewed and keyed
  // to the pre-filled symptoms and vitals, so editing them marks it out of date.
  const [analysis, setAnalysis] = useState(() =>
    initial?.analysis
      ? {
          result: initial.analysis,
          inputKey: JSON.stringify(
            smartCarePayload(patient.id, initial.symptoms ?? [], {
              ...Object.fromEntries(VITAL_FIELDS.map(([k]) => [k, ''])),
              ...(initial.vitals ?? {}),
            }),
          ),
          reviewed: false,
        }
      : null,
  )
  const [attested, setAttested] = useState(false)
  const [stepError, setStepError] = useState(null)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  const ref = reference.data
  const catalogueCodes = useMemo(() => new Set((ref?.conditions ?? []).map((c) => c.code)), [ref])
  const names = useMemo(() => {
    if (!ref) return {}
    const map = {}
    for (const s of ref.symptoms) map[`s:${s.code}`] = s.name
    for (const c of ref.conditions) map[`c:${c.code}`] = c.name
    for (const m of ref.medications) map[`m:${m.code}`] = m
    return map
  }, [ref])

  // Drug allergies by class, for a warning before the server refuses.
  const allergyByClass = useMemo(() => {
    const map = {}
    for (const a of patient.allergies) if (a.drugClass) map[a.drugClass] = a
    return map
  }, [patient.allergies])

  // An analysis is attached to the visit only if it matches the current symptoms
  // and vitals and the clinician has confirmed reviewing it.
  const inputKey = JSON.stringify(smartCarePayload(patient.id, form.symptoms, form.vitals))
  const analysisFresh = Boolean(analysis) && analysis.inputKey === inputKey
  const linkedAnalysis = analysisFresh && analysis.reviewed ? analysis.result : null

  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const updateItem = (key, index, patch) =>
    setForm((f) => ({ ...f, [key]: f[key].map((item, i) => (i === index ? { ...item, ...patch } : item)) }))
  const removeItem = (key, index) =>
    setForm((f) => {
      const items = f[key].filter((_, i) => i !== index)
      if (key === 'diagnoses' && items.length > 0 && !items.some((d) => d.isPrimary)) items[0] = { ...items[0], isPrimary: true }
      return { ...f, [key]: items }
    })
  const addItem = (key, item) => setForm((f) => (f[key].some((x) => x.code === item.code) ? f : { ...f, [key]: [...f[key], item] }))
  const addDiagnosis = (code, fromSmartCare) =>
    addItem('diagnoses', {
      code,
      type: 'PROVISIONAL',
      isPrimary: form.diagnoses.length === 0,
      notes: fromSmartCare ? 'Considered after SmartCare Assist decision support' : '',
    })

  function problemAt(i) {
    if (i === 0 && !form.chiefComplaint.trim()) return 'Enter the chief complaint.'
    if (i === 2 && analysisFresh && !analysis.reviewed) {
      return 'Confirm that you have reviewed the SmartCare output before continuing.'
    }
    if (i === 3) {
      if (form.diagnoses.length === 0) return 'Record at least one diagnosis. This is your clinical assessment.'
      if (form.diagnoses.filter((d) => d.isPrimary).length !== 1) return 'Mark exactly one diagnosis as primary.'
    }
    if (i === 4 && form.medications.some((m) => !m.dose.trim() || !m.frequency.trim())) {
      return 'Enter a dose and frequency for each medication.'
    }
    if (i === 5 && !attested) return 'Confirm that this assessment is your own clinical judgement.'
    return null
  }

  function goTo(i) {
    setStepError(null)
    setStep(i)
    setFurthest((f) => Math.max(f, i))
    topRef.current?.scrollIntoView({ block: 'start' })
  }

  function next() {
    const problem = problemAt(step)
    if (problem) return setStepError(problem)
    goTo(step + 1)
  }

  async function save() {
    for (let i = 0; i < STEPS.length; i++) {
      const problem = problemAt(i)
      if (problem) {
        goTo(i)
        return setStepError(problem)
      }
    }
    setError(null)
    setSaving(true)
    const num = (v) => (v === '' || v === null ? undefined : Number(v))
    const body = {
      visitType: form.visitType,
      visitAt: new Date(form.visitAt).toISOString(),
      chiefComplaint: form.chiefComplaint,
      notes: form.notes || undefined,
      vitals: Object.fromEntries(
        Object.entries(form.vitals)
          .map(([k, v]) => [k, num(v)])
          .filter(([, v]) => v !== undefined),
      ),
      symptoms: form.symptoms.map((s) => ({ code: s.code, severity: s.severity, durationDays: num(s.durationDays) })),
      diagnoses: form.diagnoses.map((d) => ({ code: d.code, type: d.type, isPrimary: d.isPrimary, notes: d.notes || undefined })),
      medications: form.medications.map((m) => ({
        code: m.code,
        dose: m.dose,
        frequency: m.frequency,
        route: m.route,
        durationDays: num(m.durationDays),
        instructions: m.instructions || undefined,
      })),
      clinicianAttestation: attested,
      ...(linkedAnalysis && { decisionSupport: { analysisId: linkedAnalysis.analysisId, reviewed: true } }),
    }
    try {
      const result = await request(`/api/patients/${patient.id}/visits`, { method: 'POST', body })
      onCreated(result.visit)
    } catch (err) {
      setSaving(false)
      setError(err)
      // Take the clinician to the step the server complained about.
      const fieldName = err.body?.details?.[0]?.field
      const target = err.body?.error === 'ALLERGY_CONFLICT' ? 4 : FIELD_STEP.find(([re]) => re.test(fieldName ?? ''))?.[1]
      if (target !== undefined) goTo(target)
    }
  }

  const last = step === STEPS.length - 1
  const footer = (
    <>
      <span className="mr-auto self-center text-xs text-slate-500">
        Step {step + 1} of {STEPS.length}
      </span>
      <button type="button" onClick={onClose} className="rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">
        Cancel
      </button>
      {step > 0 && (
        <button
          type="button"
          onClick={() => goTo(step - 1)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
        >
          Back
        </button>
      )}
      {!last ? (
        <button type="button" onClick={next} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
          Next
        </button>
      ) : (
        <button
          type="button"
          onClick={save}
          disabled={!attested || saving}
          className="rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {saving ? 'Saving…' : 'Save visit'}
        </button>
      )}
    </>
  )

  let content
  if (reference.loading && !ref) {
    content = <Spinner label="Loading catalogues…" />
  } else if (reference.error) {
    content = <p className="text-sm text-red-700">Could not load catalogues: {reference.error.message}</p>
  } else if (step === 0) {
    content = (
      <>
        <Section title="Visit">
          <div className="grid gap-3 sm:grid-cols-3">
            <Labeled label="Type" htmlFor="visit-type">
              <select id="visit-type" className={input} value={form.visitType} onChange={(e) => set({ visitType: e.target.value })}>
                {VISIT_TYPES.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </Labeled>
            <Labeled label="Date and time" htmlFor="visit-at" className="sm:col-span-2">
              <input
                id="visit-at"
                type="datetime-local"
                className={input}
                value={form.visitAt}
                max={maxVisitAt}
                onChange={(e) => set({ visitAt: e.target.value })}
              />
            </Labeled>
          </div>
          <Labeled label="Chief complaint (required)" htmlFor="complaint">
            <input
              id="complaint"
              className={input}
              value={form.chiefComplaint}
              maxLength={500}
              onChange={(e) => set({ chiefComplaint: e.target.value })}
              placeholder="e.g. Fever and body ache for 3 days"
            />
          </Labeled>
        </Section>
        <Section title="Symptoms">
          <CatalogueSelect
            id="add-symptom"
            label="Add symptom"
            items={ref.symptoms}
            groupBy="category"
            taken={form.symptoms.map((s) => s.code)}
            onPick={(code) => addItem('symptoms', { code, severity: 'MODERATE', durationDays: '' })}
          />
          <ItemList empty="No symptoms added.">
            {form.symptoms.map((s, i) => (
              <Row key={s.code} onRemove={() => removeItem('symptoms', i)} label={names[`s:${s.code}`]}>
                <select
                  aria-label="Severity"
                  className={`${field} w-32`}
                  value={s.severity}
                  onChange={(e) => updateItem('symptoms', i, { severity: e.target.value })}
                >
                  {SEVERITIES.map((v) => (
                    <option key={v} value={v}>
                      {titleCase(v)}
                    </option>
                  ))}
                </select>
                <input
                  aria-label="Duration in days"
                  type="number"
                  min="0"
                  placeholder="Days"
                  className={`${field} w-24 tabular-nums`}
                  value={s.durationDays}
                  onChange={(e) => updateItem('symptoms', i, { durationDays: e.target.value })}
                />
              </Row>
            ))}
          </ItemList>
        </Section>
      </>
    )
  } else if (step === 1) {
    content = (
      <Section title="Vitals" hint="Leave blank what was not measured.">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {VITAL_FIELDS.map(([key, label, unit, stepSize]) => (
            <Labeled key={key} label={`${label} (${unit})`} htmlFor={`vital-${key}`}>
              <input
                id={`vital-${key}`}
                type="number"
                inputMode="decimal"
                step={stepSize}
                className={`${input} tabular-nums`}
                value={form.vitals[key]}
                onChange={(e) => set({ vitals: { ...form.vitals, [key]: e.target.value } })}
              />
            </Labeled>
          ))}
        </div>
      </Section>
    )
  } else if (step === 2) {
    content = (
      <div className="space-y-3">
        <SmartCarePanel
          patientId={patient.id}
          symptoms={form.symptoms}
          vitals={form.vitals}
          analysis={analysis}
          onAnalysis={setAnalysis}
          catalogueCodes={catalogueCodes}
          chosenCodes={form.diagnoses.map((d) => d.code)}
        />
        {analysisFresh ? (
          <label className="flex items-start gap-2 rounded-md border border-violet-200 bg-white px-3 py-2 text-sm">
            <input
              id="smartcare-reviewed"
              type="checkbox"
              className="mt-0.5"
              checked={analysis.reviewed}
              onChange={(e) => setAnalysis({ ...analysis, reviewed: e.target.checked })}
            />
            <span>
              I have reviewed this output. It is decision support, not a diagnosis, and I will make my own assessment.
            </span>
          </label>
        ) : (
          <p className="text-sm text-slate-600">
            {analysis
              ? 'Symptoms or vitals changed after the analysis. Run it again to attach it to this visit, or continue without it.'
              : 'Decision support is optional. You can continue without running it.'}
          </p>
        )}
      </div>
    )
  } else if (step === 3) {
    const suggestions = linkedAnalysis?.possibleConditions ?? []
    content = (
      <>
        {suggestions.length > 0 && (
          <div className="rounded-md border border-violet-200 bg-violet-50/50 px-3 py-2 text-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-violet-800">
              SmartCare suggested <span className="normal-case tracking-normal text-violet-700">(not a diagnosis)</span>
            </p>
            <ul className="mt-1 space-y-1">
              {suggestions.map((c) => (
                <li key={c.code} className="flex flex-wrap items-center gap-2">
                  <span>{c.name}</span>
                  <span className="text-xs text-slate-500">{c.strength.toLowerCase()}</span>
                  {c.relatedCodes
                    .filter((code) => catalogueCodes.has(code))
                    .map((code) => {
                      const chosen = form.diagnoses.some((d) => d.code === code)
                      return (
                        <button
                          key={code}
                          type="button"
                          disabled={chosen}
                          onClick={() => addDiagnosis(code, true)}
                          className="rounded border border-teal-300 bg-white px-2 py-0.5 text-xs text-teal-800 hover:bg-teal-50 disabled:border-slate-200 disabled:text-slate-400"
                        >
                          {chosen ? `${code} added` : `Add ${code} as provisional`}
                        </button>
                      )
                    })}
                </li>
              ))}
            </ul>
          </div>
        )}
        <Section title="Diagnosis / assessment" hint="Your clinical judgement. At least one; exactly one is primary.">
          <CatalogueSelect
            id="add-diagnosis"
            label="Add diagnosis"
            items={ref.conditions}
            groupBy="category"
            showCode
            taken={form.diagnoses.map((d) => d.code)}
            onPick={(code) => addDiagnosis(code, false)}
          />
          <ItemList empty="No diagnosis added.">
            {form.diagnoses.map((d, i) => (
              <Row key={d.code} onRemove={() => removeItem('diagnoses', i)} label={`${names[`c:${d.code}`]} · ${d.code}`}>
                <select
                  aria-label="Diagnosis status"
                  className={`${field} w-36`}
                  value={d.type}
                  onChange={(e) => updateItem('diagnoses', i, { type: e.target.value })}
                >
                  {DX_TYPES.map((v) => (
                    <option key={v} value={v} disabled={v === 'DIFFERENTIAL' && d.isPrimary}>
                      {titleCase(v)}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-1.5 text-sm text-slate-700">
                  <input
                    type="radio"
                    name="primary-diagnosis"
                    checked={d.isPrimary}
                    disabled={d.type === 'DIFFERENTIAL'}
                    onChange={() =>
                      setForm((f) => ({ ...f, diagnoses: f.diagnoses.map((x, j) => ({ ...x, isPrimary: j === i })) }))
                    }
                  />
                  Primary
                </label>
              </Row>
            ))}
          </ItemList>
        </Section>
      </>
    )
  } else if (step === 4) {
    content = (
      <Section title="Medication" hint="Optional.">
        <CatalogueSelect
          id="add-medication"
          label="Add medication"
          items={ref.medications}
          taken={form.medications.map((m) => m.code)}
          onPick={(code) => addItem('medications', { code, dose: '', frequency: '', route: 'ORAL', durationDays: '', instructions: '' })}
        />
        <ItemList empty="No medication added.">
          {form.medications.map((m, i) => {
            const drug = names[`m:${m.code}`]
            const allergy = allergyByClass[drug?.drugClass]
            return (
              <li key={m.code} className="space-y-2 rounded-md border border-slate-200 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{drug?.name}</span>
                  <RemoveButton onClick={() => removeItem('medications', i)} />
                </div>
                {allergy && (
                  <p className="rounded bg-red-50 px-2 py-1 text-sm text-red-800" role="alert">
                    Patient is allergic to {allergy.allergen} ({titleCase(allergy.severity).toLowerCase()}). The server will
                    refuse this prescription.
                  </p>
                )}
                <div className="grid gap-2 sm:grid-cols-4">
                  <input aria-label="Dose" placeholder="Dose, e.g. 500 mg" className={input} value={m.dose} onChange={(e) => updateItem('medications', i, { dose: e.target.value })} />
                  <input aria-label="Frequency" placeholder="Frequency" className={input} value={m.frequency} onChange={(e) => updateItem('medications', i, { frequency: e.target.value })} />
                  <select aria-label="Route" className={input} value={m.route} onChange={(e) => updateItem('medications', i, { route: e.target.value })}>
                    {ROUTES.map((r) => (
                      <option key={r} value={r}>
                        {r === 'IV' || r === 'IM' || r === 'SC' ? r : titleCase(r)}
                      </option>
                    ))}
                  </select>
                  <input aria-label="Days" type="number" min="1" placeholder="Days" className={`${input} tabular-nums`} value={m.durationDays} onChange={(e) => updateItem('medications', i, { durationDays: e.target.value })} />
                </div>
                <input aria-label="Instructions" placeholder="Instructions (optional)" className={input} value={m.instructions} onChange={(e) => updateItem('medications', i, { instructions: e.target.value })} />
              </li>
            )
          })}
        </ItemList>
      </Section>
    )
  } else {
    content = (
      <>
        <Section title="Notes">
          <label htmlFor="visit-notes" className="sr-only">
            Clinical notes
          </label>
          <textarea
            id="visit-notes"
            rows={3}
            maxLength={4000}
            className={input}
            value={form.notes}
            onChange={(e) => set({ notes: e.target.value })}
            placeholder="Examination findings, advice, follow-up plan"
          />
        </Section>
        <VisitSummary form={form} names={names} decisionSupport={linkedAnalysis} />
        <label className="flex items-start gap-2 rounded-md border border-teal-300 bg-teal-50 px-3 py-2.5 text-sm text-slate-900">
          <input id="attest" type="checkbox" className="mt-0.5" checked={attested} onChange={(e) => setAttested(e.target.checked)} />
          <span>
            <span className="font-medium">I confirm this assessment and plan are my own clinical judgement.</span>{' '}
            {linkedAnalysis ? 'SmartCare Assist output was used as decision support only.' : 'No decision support is attached.'}
          </span>
        </label>
      </>
    )
  }

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={`New visit: ${patient.demographics.fullName}`}
      description={`${patient.mrn} · ${patient.demographics.ageYears} years · ${titleCase(patient.demographics.gender)}`}
      footer={footer}
    >
      <div ref={topRef} className="space-y-5">
        <Stepper step={step} furthest={furthest} onSelect={goTo} />
        {error && <SubmitError error={error} />}
        {stepError && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900" role="alert">
            {stepError}
          </p>
        )}
        {content}
      </div>
    </Dialog>
  )
}

function Stepper({ step, furthest, onSelect }) {
  return (
    <ol className="flex flex-wrap gap-1.5" aria-label="Visit steps">
      {STEPS.map((label, i) => {
        const state = i === step ? 'current' : i < step ? 'done' : i <= furthest ? 'visited' : 'todo'
        return (
          <li key={label}>
            <button
              type="button"
              disabled={i > furthest}
              onClick={() => onSelect(i)}
              aria-current={i === step ? 'step' : undefined}
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
                state === 'current'
                  ? 'bg-teal-700 text-white'
                  : state === 'done'
                    ? 'bg-teal-50 text-teal-800 hover:bg-teal-100'
                    : state === 'visited'
                      ? 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      : 'bg-slate-50 text-slate-400'
              }`}
            >
              <span className="tabular-nums">{state === 'done' ? '✓' : i + 1}</span>
              {label}
            </button>
          </li>
        )
      })}
    </ol>
  )
}

function VisitSummary({ form, names, decisionSupport }) {
  const vitals = VITAL_FIELDS.filter(([k]) => form.vitals[k] !== '').map(([k, label, unit]) => `${label} ${form.vitals[k]} ${unit}`)
  const rows = [
    ['Visit', `${VISIT_TYPE_LABEL[form.visitType]}, ${formatDateTime(form.visitAt)}`],
    ['Complaint', form.chiefComplaint || '—'],
    ['Symptoms', form.symptoms.map((s) => `${names[`s:${s.code}`]} (${s.severity.toLowerCase()})`).join(', ') || 'None recorded'],
    ['Vitals', vitals.join(' · ') || 'None recorded'],
    [
      'Decision support',
      decisionSupport
        ? `Reviewed. Risk ${decisionSupport.overallRisk.level.toLowerCase()}; suggested ${decisionSupport.possibleConditions
            .map((c) => c.name)
            .join('; ')}`
        : 'Not used',
    ],
    [
      'Assessment',
      form.diagnoses
        .map((d) => `${names[`c:${d.code}`]} (${d.code}), ${d.type.toLowerCase()}${d.isPrimary ? ', primary' : ''}`)
        .join('; ') || '—',
    ],
    [
      'Medication',
      form.medications.map((m) => `${names[`m:${m.code}`]?.name} ${m.dose}, ${m.frequency}`).join('; ') || 'None',
    ],
  ]
  return (
    <div className="rounded-md border border-slate-200">
      <p className="border-b border-slate-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Review before saving
      </p>
      <dl className="divide-y divide-slate-100 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="grid gap-1 px-3 py-2 sm:grid-cols-[9rem_1fr]">
            <dt className="text-slate-500">
              {k}
              {k === 'Decision support' && decisionSupport && <Badge tone="violet" className="ml-1">CDS</Badge>}
            </dt>
            <dd className="min-w-0 text-slate-900">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function SubmitError({ error }) {
  const body = error.body
  return (
    <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
      <p className="font-medium">
        <span className="mr-2 rounded bg-red-600 px-1.5 py-0.5 font-mono text-xs text-white">{error.status}</span>
        {body?.error === 'FORBIDDEN' ? 'The server refused to save this visit.' : body?.message ?? error.message}
      </p>
      {body?.details && (
        <ul className="mt-1 list-disc pl-5">
          {body.details.map((d, i) => (
            <li key={i}>
              <span className="font-mono text-xs">{d.field}</span> {d.message}
            </li>
          ))}
        </ul>
      )}
      {body?.conflicts && (
        <ul className="mt-1 list-disc pl-5">
          {body.conflicts.map((c) => (
            <li key={c.medication}>
              {c.medicationName} ({c.drugClass.toLowerCase()}) conflicts with the recorded {c.allergen} allergy
              {c.reaction ? `: ${c.reaction}` : ''}
            </li>
          ))}
        </ul>
      )}
      {body?.reason && <p className="mt-1">Reason: {body.reason}</p>}
    </div>
  )
}

function Section({ title, hint, children }) {
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-semibold text-slate-900">
        {title}
        {hint && <span className="ml-2 font-normal text-slate-500">{hint}</span>}
      </legend>
      {children}
    </fieldset>
  )
}

function Labeled({ label, htmlFor, className = '', children }) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium text-slate-600">
        {label}
      </label>
      {children}
    </div>
  )
}

// A select that adds the chosen catalogue entry and resets.
function CatalogueSelect({ id, label, items, groupBy, showCode, taken, onPick }) {
  const groups = useMemo(() => {
    if (!groupBy) return [[null, items]]
    const map = new Map()
    for (const item of items) {
      const key = item[groupBy]
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(item)
    }
    return [...map.entries()]
  }, [items, groupBy])

  const option = (item) => (
    <option key={item.code} value={item.code} disabled={taken.includes(item.code)}>
      {item.name}
      {showCode ? ` (${item.code})` : ''}
    </option>
  )

  return (
    <div>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <select
        id={id}
        value=""
        onChange={(e) => e.target.value && onPick(e.target.value)}
        className={`${input} text-slate-600`}
      >
        <option value="">{label}…</option>
        {groups.map(([group, groupItems]) =>
          group ? (
            <optgroup key={group} label={titleCase(group)}>
              {groupItems.map(option)}
            </optgroup>
          ) : (
            groupItems.map(option)
          ),
        )}
      </select>
    </div>
  )
}

function ItemList({ empty, children }) {
  const hasItems = Array.isArray(children) ? children.length > 0 : Boolean(children)
  if (!hasItems) return <p className="text-sm text-slate-500">{empty}</p>
  return <ul className="space-y-2">{children}</ul>
}

function Row({ label, onRemove, children }) {
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 px-3 py-2">
      <span className="min-w-0 flex-1 text-sm font-medium">{label}</span>
      {children}
      <RemoveButton onClick={onRemove} />
    </li>
  )
}

function RemoveButton({ onClick }) {
  return (
    <button type="button" onClick={onClick} className="rounded px-2 py-1 text-sm text-slate-500 hover:bg-slate-100 hover:text-red-700">
      Remove
    </button>
  )
}
