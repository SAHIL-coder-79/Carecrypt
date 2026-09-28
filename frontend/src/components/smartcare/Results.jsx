import { t, VITALS, vitalStatus } from '../../lib/smartcareWorkspace.js'
import { Badge, Card } from '../ui.jsx'

// SmartCare Assist results, as in the original results screen: emergency banner,
// assessment, vitals visualiser, risk heatmap, SOAP summary, reasoning trail,
// recommendations and differential. Everything is decision support.

const RISK = {
  HIGH: { tone: 'red', label: 'High risk (Red)', box: 'border-red-300 bg-red-50', text: 'text-red-800' },
  MODERATE: { tone: 'amber', label: 'Moderate risk (Amber)', box: 'border-amber-300 bg-amber-50', text: 'text-amber-900' },
  LOW: { tone: 'green', label: 'Low risk (Green)', box: 'border-emerald-300 bg-emerald-50', text: 'text-emerald-900' },
}
const DIRECTIVE = {
  Critical: 'Immediate escalation: emergency evaluation now.',
  High: 'Urgent clinical review within hours.',
  Medium: 'Clinical review at this visit; safety-net advice.',
  Low: 'Routine care and follow-up as needed.',
}
const STATUS = {
  normal: { bar: 'bg-emerald-500', text: 'text-emerald-800', label: 'Normal' },
  warning: { bar: 'bg-amber-500', text: 'text-amber-800', label: 'Warning' },
  critical: { bar: 'bg-red-600', text: 'text-red-700', label: 'Critical' },
}
const band = (score) => (score >= 70 ? 'HIGH' : score >= 35 ? 'MODERATE' : 'LOW')
const symptomName = (lang, code) => t(lang, `symptom.${code}`, code.replace(/_/g, ' '))

export default function Results({ lang, result, inputs, patient, actions }) {
  const risk = RISK[result.overallRisk.level] ?? RISK.LOW
  const a = result.assessment
  const top = result.possibleConditions[0]

  return (
    <div className="space-y-5" id="smartcare-results">
      {result.overallRisk.level === 'HIGH' && (
        <div role="alert" className="rounded-xl border border-red-300 bg-red-600 px-5 py-3 text-sm font-semibold text-white shadow-sm">
          🚨 {t(lang, 'emergency', 'URGENT: High-risk case — seek immediate medical attention!')}
        </div>
      )}

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-violet-700">
              {result.label} · {t(lang, 'ai_suggestion', 'Clinical Assessment Result')}
            </p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
              {top ? `Possible: ${top.name}` : 'No specific pattern matched'}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              DCI {result.confidence.score}/100 · Risk score {result.overallRisk.score}/100 · Triage {result.overallRisk.urgency}
            </p>
          </div>
          <Badge tone={risk.tone} className="px-3 py-1 text-sm">
            {risk.label}
          </Badge>
        </div>
        <div className={`mt-4 flex items-center gap-2 rounded-lg border-l-4 px-4 py-2.5 text-sm font-semibold ${risk.box} ${risk.text}`}>
          <span aria-hidden="true">🧭</span>
          Triage directive: {DIRECTIVE[result.overallRisk.urgency] ?? DIRECTIVE.Low}
        </div>
        <p className="mt-3 text-xs text-slate-500">{result.disclaimer}</p>
      </Card>

      <VitalsVisualizer vitals={inputs.vitals} />

      <Card title={`📈 ${t(lang, 'heatmap_title', 'Structured Risk Stratification Heatmap')}`}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <HeatTile label="📋 General risk" value={`${a.baseRiskScore}/100`} level={band(a.baseRiskScore)} />
          <HeatTile
            label="🤰 Maternal"
            value={a.maternal.applicable ? `+${a.maternal.scoreModifier}` : 'N/A'}
            level={a.maternal.applicable ? band(a.maternal.scoreModifier * 2) : 'LOW'}
            note={a.maternal.applicable ? 'Maternal pathway active' : 'Not applicable'}
          />
          <HeatTile label="🎯 DCI" value={`${result.confidence.score}/100`} level={result.confidence.score >= 70 ? 'LOW' : result.confidence.score >= 40 ? 'MODERATE' : 'HIGH'} note={result.confidence.level} />
          <HeatTile label="🚨 Triage" value={result.overallRisk.urgency} level={result.overallRisk.level} note={`Final score ${result.overallRisk.score}/100`} />
        </div>
      </Card>

      <Card title={`📋 ${t(lang, 'summary_header', 'Clinical Summary')}`}>
        <Soap lang={lang} result={result} inputs={inputs} patient={patient} />
      </Card>

      <details className="group rounded-xl border border-slate-200 bg-white shadow-sm">
        <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3.5 text-sm font-semibold text-slate-900">
          🧠 Explain the decision support
          <span aria-hidden="true" className="text-slate-400 group-open:rotate-180">
            ▼
          </span>
        </summary>
        <div className="space-y-5 border-t border-slate-100 px-5 py-4 text-sm">
          <Section title="📋 Triggered symptoms">
            <div className="flex flex-wrap gap-1.5">
              {a.symptomsAnalysed.map((c) => (
                <Badge key={c} tone="teal">
                  ✅ {symptomName(lang, c)}
                </Badge>
              ))}
            </div>
          </Section>
          <Section title="📊 Triggered vital findings">
            {a.vitalFindings.length ? (
              <ul className="list-disc space-y-0.5 pl-5 text-slate-700">
                {a.vitalFindings.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            ) : (
              <p className="text-slate-500">No abnormal vital findings.</p>
            )}
          </Section>
          <Section title="⚖️ Score breakdown">
            <ul className="space-y-1">
              {a.scoreBreakdown.map((r, i) => (
                <li key={i} className="flex gap-3">
                  <span className="w-12 shrink-0 text-right font-mono font-semibold text-slate-900">+{r.impact}</span>
                  <span className="text-slate-700">
                    <strong className="font-semibold">{r.factor}</strong>: {r.reason}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
          <Section title="⚠️ Risk indicators (including the patient's record)">
            <ul className="space-y-1.5">
              {result.riskIndicators.map((r, i) => (
                <li key={i} className="flex items-start gap-2">
                  <Badge tone={r.level === 'HIGH' ? 'red' : r.level === 'MODERATE' ? 'amber' : 'neutral'}>{r.level}</Badge>
                  <span className="text-slate-700">
                    {r.message} <span className="text-xs text-slate-400">({r.source.replace('_', ' ')})</span>
                  </span>
                </li>
              ))}
            </ul>
          </Section>
          <Section title="🔍 Pattern logic">
            <ul className="list-disc space-y-0.5 pl-5 text-slate-700">
              {result.reasoning.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </Section>
          <Section title={`🎯 Diagnostic Certainty Index: ${result.confidence.score}/100 (${result.confidence.level})`}>
            <div className="grid gap-2 sm:grid-cols-2">
              {Object.entries(result.confidence.components ?? {}).map(([k, v]) => (
                <div key={k}>
                  <div className="flex justify-between text-xs text-slate-600">
                    <span className="capitalize">{k}</span>
                    <span className="tabular-nums">{v}</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-slate-100">
                    <div className="h-1.5 rounded-full bg-teal-600" style={{ width: `${Math.min(100, Math.max(0, v))}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-500">⚕️ {t(lang, 'ws.dci_disclaimer')}</p>
          </Section>
        </div>
      </details>

      <Recommendations result={result} />

      <Card title="🧠 Differential diagnosis (possible conditions)" subtitle="Symptom-pattern match, not probability">
        <ul className="space-y-3">
          {result.possibleConditions.map((c) => (
            <li key={c.code}>
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span className="font-semibold text-slate-900">
                  {c.name}
                  {c.relatedCodes.length > 0 && <span className="ml-2 font-mono text-xs text-slate-500">{c.relatedCodes.join(', ')}</span>}
                </span>
                <span className="text-xs text-slate-600">
                  {c.symptomMatch}% match · {c.strength}
                </span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-slate-100">
                <div className="h-2 rounded-full bg-violet-600" style={{ width: `${c.symptomMatch}%` }} />
              </div>
              {c.previouslyRecorded.length > 0 && (
                <p className="mt-1 text-xs text-violet-800">
                  Recorded before: {c.previouslyRecorded.map((p) => `${p.name} (${p.date})`).join('; ')}
                </p>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <ContextUsed context={result.contextUsed} />

      {actions}
    </div>
  )
}

function Section({ title, children }) {
  return (
    <section>
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      {children}
    </section>
  )
}

function HeatTile({ label, value, level, note }) {
  const r = RISK[level]
  return (
    <div className={`rounded-lg border p-3 ${r.box}`}>
      <p className="text-xs font-semibold text-slate-600">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${r.text}`}>{value}</p>
      <p className="mt-0.5 text-[11px] text-slate-600">{note ?? r.label}</p>
    </div>
  )
}

// Physiological trend monitoring: each entered vital against its normal band.
function VitalsVisualizer({ vitals }) {
  const entered = VITALS.filter((v) => vitals[v.key] !== '' && vitals[v.key] != null)
  if (entered.length === 0) return null
  return (
    <Card title="📊 Physiological monitoring" subtitle="Entered vitals against normal and critical bands">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {entered.map((v) => {
          const value = Number(vitals[v.key])
          const status = STATUS[vitalStatus(v, value)]
          const lo = v.min
          const hi = v.max
          const pos = (x) => `${((Math.min(hi, Math.max(lo, x)) - lo) / (hi - lo)) * 100}%`
          return (
            <div key={v.key} className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-baseline justify-between">
                <span className="text-xs font-semibold text-slate-600">{v.name}</span>
                <span className={`text-xs font-semibold ${status.text}`}>{status.label}</span>
              </div>
              <p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">
                {value} <span className="text-xs font-normal text-slate-500">{v.unit}</span>
              </p>
              <div className="relative mt-2 h-2 rounded-full bg-red-100" aria-hidden="true">
                <div className="absolute inset-y-0 bg-amber-100" style={{ left: pos(v.critical[0]), right: `calc(100% - ${pos(v.critical[1])})` }} />
                <div className="absolute inset-y-0 bg-emerald-200" style={{ left: pos(v.normal[0]), right: `calc(100% - ${pos(v.normal[1])})` }} />
                <div className={`absolute top-1/2 h-3.5 w-1.5 -translate-y-1/2 rounded-full ${status.bar}`} style={{ left: pos(value) }} />
              </div>
              <p className="mt-1 text-[10px] text-slate-500">
                Normal {v.normal[0]}–{v.normal[1]} {v.unit}
              </p>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

function Soap({ lang, result, inputs, patient }) {
  const a = result.assessment
  const ctx = result.contextUsed
  const history = [...ctx.chronicConditions.map((c) => c.name), ...inputs.history]
  const complaints = a.symptomsAnalysed.map((c) => symptomName(lang, c).toLowerCase()).join(', ')
  const block = (title, children) => (
    <div>
      <h3 className="border-b border-slate-200 pb-1 text-xs font-bold uppercase tracking-wide text-slate-500">{title}</h3>
      <div className="mt-2 space-y-1 text-sm leading-relaxed text-slate-700">{children}</div>
    </div>
  )
  return (
    <div className="grid gap-5 md:grid-cols-2">
      {block(
        t(lang, 'soap.presentation', 'Presentation'),
        <>
          <p>
            {patient.ageYears}-year-old {patient.gender.toLowerCase()}
            {inputs.pregnant ? ', pregnant' : ''}. Complaints: {complaints}, for {a.durationDays} day{a.durationDays === 1 ? '' : 's'},
            severity {a.severity.toLowerCase()}.
          </p>
          <p>{history.length ? `History: ${history.join(', ')}.` : 'No recorded chronic conditions.'}</p>
          <p>{ctx.allergies.length ? `Allergies: ${ctx.allergies.join(', ')}.` : 'No known allergies.'}</p>
          <p>{ctx.activeMedications.length ? `Current medications: ${ctx.activeMedications.join(', ')}.` : 'No active medications.'}</p>
        </>,
      )}
      {block(
        t(lang, 'soap.findings', 'Findings'),
        a.vitalFindings.length ? a.vitalFindings.map((f) => <p key={f}>{f}.</p>) : <p>Vital signs within expected parameters, or not recorded.</p>,
      )}
      {block(
        t(lang, 'soap.assessment', 'Assessment'),
        <>
          <p>
            Risk score {result.overallRisk.score}/100 ({result.overallRisk.level.toLowerCase()}), general risk {a.baseRiskScore}/100.
          </p>
          {result.possibleConditions.slice(0, 2).map((c) => (
            <p key={c.code}>
              Possible {c.name.toLowerCase()} ({c.symptomMatch}% symptom-pattern match).
            </p>
          ))}
          <p>
            {a.maternal.applicable ? `Maternal risk pathway active: ${a.maternal.reasons.join('; ') || 'monitor'}.` : 'No maternal risk pathway.'}
          </p>
        </>,
      )}
      {block(
        t(lang, 'soap.plan', 'Plan'),
        <>
          <p>
            Urgency: {result.overallRisk.urgency}. {result.overallRisk.escalationSuggested ? 'Escalation suggested.' : 'No escalation suggested.'}
          </p>
          {a.suggestedActions.map((x) => (
            <p key={x}>• {x}</p>
          ))}
          <p className="text-xs text-slate-500">To be confirmed by the treating clinician.</p>
        </>,
      )}
    </div>
  )
}

function Recommendations({ result }) {
  const by = (type) => result.recommendations.filter((r) => r.type === type)
  const warnings = result.riskIndicators.filter((r) => r.source === 'medication' || r.source === 'allergy')
  const groups = [
    ['💊 Treatment options to consider', by('TREATMENT_OPTION')],
    ['🧪 Suggested investigations', by('INVESTIGATION')],
    ['📝 Suggested actions', by('ACTION')],
  ]
  return (
    <Card title="Recommendations" subtitle="Options to consider, not orders">
      <div className="grid gap-5 md:grid-cols-2">
        {groups.map(([title, items]) => (
          <div key={title}>
            <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
            {items.length === 0 ? (
              <p className="mt-1 text-sm text-slate-500">None.</p>
            ) : (
              <ul className="mt-1.5 space-y-1.5 text-sm text-slate-700">
                {items.map((r) => (
                  <li key={r.text}>
                    • {r.text}
                    {r.caution && <span className="mt-0.5 block rounded bg-red-50 px-2 py-1 text-xs font-medium text-red-800">⚠️ {r.caution}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        <div>
          <h3 className="text-sm font-semibold text-slate-900">⚠️ Warnings</h3>
          {warnings.length === 0 ? (
            <p className="mt-1 text-sm text-slate-500">No drug interaction or allergy warnings.</p>
          ) : (
            <ul className="mt-1.5 space-y-1.5 text-sm text-red-800">
              {warnings.map((w) => (
                <li key={w.message}>• {w.message}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  )
}

function ContextUsed({ context }) {
  const row = (label, value) => (
    <div className="grid gap-1 sm:grid-cols-[12rem_minmax(0,1fr)]">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-slate-800">{value}</dd>
    </div>
  )
  return (
    <Card title="🗂️ Longitudinal context used" subtitle={`Loaded from the patient's record under ${context.consentScope.replace('_', ' ').toLowerCase()} consent`}>
      <dl className="space-y-2 text-sm">
        {row('Chronic conditions', context.chronicConditions.map((c) => `${c.name} (${c.code})`).join(', ') || 'None recorded')}
        {row('Previous diagnoses', context.previousDiagnoses.map((d) => `${d.name} (${d.date})`).join('; ') || 'None')}
        {row('Visits considered', context.visitsConsidered)}
        {row('Active medications', context.activeMedications.join(', ') || 'None')}
        {row('Allergies', context.allergies.join(', ') || 'None recorded')}
        {row('Clinician-reported', [...context.clinicianReported.history, ...context.clinicianReported.medications].join(', ') || 'Nothing added')}
        {context.withheldByConsent.length > 0 && row('Withheld by consent', context.withheldByConsent.join(', '))}
      </dl>
    </Card>
  )
}

