import { useState } from 'react'
import { useAuth } from '../../auth/context.js'
import { smartCarePayload } from '../../lib/smartcare.js'
import { Badge } from '../ui.jsx'

const RISK_TONE = { HIGH: 'red', MODERATE: 'amber', LOW: 'green' }
const LEVEL_DOT = { HIGH: 'bg-red-600', MODERATE: 'bg-amber-500', INFO: 'bg-slate-400' }
const SOURCE_LABEL = {
  vitals: 'Vitals',
  history: 'History',
  visit_history: 'Visit history',
  medication: 'Medication',
  allergy: 'Allergy',
}
const REC_GROUPS = [
  ['ACTION', 'Suggested actions'],
  ['INVESTIGATION', 'Investigations to consider'],
  ['TREATMENT_OPTION', 'Treatment options to consider'],
]

// SmartCare Assist decision support inside the visit workflow. It never changes
// the form by itself: the clinician decides what, if anything, to record.
// `analysis` ({ result, inputKey, reviewed }) is owned by the form.
export default function SmartCarePanel({
  patientId,
  symptoms,
  vitals,
  analysis,
  onAnalysis,
  catalogueCodes,
  chosenCodes,
  onAddDiagnosis,
}) {
  const { request } = useAuth()
  const [run, setRun] = useState({ status: 'idle' })

  const payload = smartCarePayload(patientId, symptoms, vitals)
  const inputKey = JSON.stringify(payload)
  const stale = Boolean(analysis) && analysis.inputKey !== inputKey
  const state = run.status === 'running' || run.status === 'error' ? run : analysis ? { status: 'done', result: analysis.result } : run

  async function start() {
    setRun({ status: 'running' })
    try {
      const result = await request('/api/smartcare/analyze', { method: 'POST', body: payload })
      onAnalysis({ result, inputKey, reviewed: false })
      setRun({ status: 'idle' })
    } catch (error) {
      setRun({ status: 'error', error })
    }
  }

  return (
    <section className="rounded-lg border border-violet-200 bg-violet-50/50" aria-labelledby="smartcare-heading">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-violet-100 px-4 py-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-violet-800">Clinical Decision Support</p>
          <h3 id="smartcare-heading" className="text-sm font-semibold text-slate-900">
            SmartCare Assist
          </h3>
          <p className="text-xs text-slate-600">
            Uses the symptoms and vitals you entered with this patient&apos;s recorded history. It suggests; you decide.
          </p>
        </div>
        <button
          type="button"
          onClick={start}
          disabled={symptoms.length === 0 || state.status === 'running'}
          className="rounded-md bg-violet-700 px-3 py-2 text-sm font-medium text-white hover:bg-violet-800 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {state.status === 'running' ? 'Analysing…' : state.status === 'done' ? 'Run again' : 'Run SmartCare Assist'}
        </button>
      </header>

      <div className="space-y-4 px-4 py-3 text-sm">
        {symptoms.length === 0 && state.status === 'idle' && <p className="text-slate-600">Add at least one symptom to run it.</p>}
        {state.status === 'error' && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-red-800" role="alert">
            SmartCare could not run: {state.error.body?.reason ?? state.error.message}
          </p>
        )}
        {stale && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-amber-900" role="status">
            Symptoms or vitals changed since this analysis. Run it again to update.
          </p>
        )}
        {state.status === 'done' && (
          <Result
            result={state.result}
            catalogueCodes={catalogueCodes}
            chosenCodes={chosenCodes}
            onAddDiagnosis={onAddDiagnosis}
          />
        )}
      </div>
    </section>
  )
}

function Result({ result: r, catalogueCodes, chosenCodes, onAddDiagnosis }) {
  const ctx = r.contextUsed
  return (
    <div className={`space-y-4`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={RISK_TONE[r.overallRisk.level]}>Risk: {r.overallRisk.level}</Badge>
        <span className="text-slate-700">
          SmartCare score {r.overallRisk.score}/100 · urgency {r.overallRisk.urgency.toLowerCase()}
        </span>
        {r.overallRisk.escalationSuggested && <Badge tone="red">Escalation suggested</Badge>}
      </div>

      <div>
        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Possible conditions <span className="normal-case tracking-normal text-slate-400">(not a diagnosis)</span>
        </h4>
        <ul className="space-y-2">
          {r.possibleConditions.map((c) => {
            const addable = c.relatedCodes.filter((code) => catalogueCodes.has(code))
            return (
              <li key={c.code} className="rounded-md bg-white px-3 py-2 ring-1 ring-slate-200">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-slate-900">{c.name}</span>
                  <Badge tone={c.strength.startsWith('Strong') ? 'violet' : 'neutral'}>{c.strength}</Badge>
                </div>
                {c.previouslyRecorded.length > 0 && (
                  <p className="mt-0.5 text-xs text-slate-600">
                    Recorded before: {c.previouslyRecorded.map((d) => `${d.name} (${d.date})`).join('; ')}
                  </p>
                )}
                {onAddDiagnosis && addable.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {addable.map((code) => (
                      <button
                        key={code}
                        type="button"
                        onClick={() => onAddDiagnosis(code)}
                        disabled={chosenCodes.includes(code)}
                        className="rounded border border-teal-300 px-2 py-0.5 text-xs text-teal-800 hover:bg-teal-50 disabled:border-slate-200 disabled:text-slate-400"
                      >
                        {chosenCodes.includes(code) ? `${code} added` : `Add ${code} as provisional diagnosis`}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </div>

      {r.riskIndicators.length > 0 && (
        <div>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Risk indicators</h4>
          <ul className="space-y-1">
            {r.riskIndicators.map((i, n) => (
              <li key={n} className="flex gap-2">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${LEVEL_DOT[i.level]}`} aria-hidden="true" />
                <span className="text-slate-800">
                  <span className="mr-1 text-xs font-medium text-slate-500">{SOURCE_LABEL[i.source] ?? i.source}:</span>
                  {i.message}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-3">
        {REC_GROUPS.map(([type, title]) => {
          const items = r.recommendations.filter((x) => x.type === type)
          if (items.length === 0) return null
          return (
            <div key={type}>
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h4>
              <ul className="list-disc space-y-0.5 pl-4 text-slate-800">
                {items.map((x) => (
                  <li key={x.text}>
                    {x.text}
                    {x.caution && <span className="block text-xs font-medium text-red-700">{x.caution}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>

      <div className="rounded-md bg-white px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-200">
        <p className="font-medium text-slate-700">Patient context used ({ctx.consentScope.replace('_', ' ').toLowerCase()} consent)</p>
        <p>
          {[
            ctx.chronicConditions.length > 0 && `Conditions: ${ctx.chronicConditions.map((c) => c.name).join(', ')}`,
            ctx.previousDiagnoses.length > 0 && `${ctx.previousDiagnoses.length} previous diagnoses`,
            `${ctx.visitsConsidered} visits`,
            ctx.activeMedications.length > 0 && `Medicines: ${ctx.activeMedications.join(', ')}`,
            ctx.allergies.length > 0 && `Allergies: ${ctx.allergies.join(', ')}`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {ctx.withheldByConsent.length > 0 && <p>Not used (outside consent): {ctx.withheldByConsent.join(', ')}.</p>}
        <p className="mt-1">
          Input completeness {r.confidence.score}% ({r.confidence.level.toLowerCase()}). This measures the data given, not the
          likelihood of any condition.
        </p>
      </div>

      <p className="rounded-md border border-violet-200 bg-white px-3 py-2 text-xs font-medium text-violet-900">
        {r.disclaimer} {r.engine.name} {r.engine.version} ({r.engine.method}).
      </p>
    </div>
  )
}
