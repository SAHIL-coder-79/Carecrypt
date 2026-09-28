import { useState } from 'react'
import { formatDate, formatDateTime, titleCase, VISIT_TYPE_LABEL } from '../../lib/format.js'
import { Badge, Card, EmptyState, Withheld } from '../ui.jsx'

// Sections of a longitudinal patient record, shared by the patient record page
// and the clinician workspace.

const SEVERITY_TONE = { LIFE_THREATENING: 'red', SEVERE: 'red', MODERATE: 'amber', MILD: 'neutral' }

export function AllergiesCard({ allergies }) {
  return (
    <Card title="Allergies">
      {allergies.length === 0 ? (
        <EmptyState>No known allergies recorded.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {allergies.map((a) => (
            <li key={a.allergen}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{a.allergen}</span>
                <Badge tone={SEVERITY_TONE[a.severity]}>{titleCase(a.severity)}</Badge>
                <span className="text-xs text-slate-500">{titleCase(a.type)}</span>
              </div>
              {a.reaction && <p className="text-sm text-slate-600">{a.reaction}</p>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

export function ConditionsCard({ conditions }) {
  return (
    <Card title="Chronic conditions">
      {conditions.length === 0 ? (
        <EmptyState>No long-term conditions recorded.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {conditions.map((c) => (
            <li key={c.code} className={c.status === 'RESOLVED' ? 'opacity-60' : ''}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{c.name}</span>
                <span className="font-mono text-xs text-slate-500">{c.code}</span>
                {c.status !== 'ACTIVE' && <Badge>{titleCase(c.status)}</Badge>}
              </div>
              <p className="text-sm text-slate-600">
                Since {formatDate(c.onsetDate)}
                {c.resolvedDate && `, resolved ${formatDate(c.resolvedDate)}`}
                {c.notes && ` · ${c.notes}`}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

export function MedicationsCard({ medications, scopeLabel }) {
  const [showHistory, setShowHistory] = useState(false)
  return (
    <Card
      title="Medications"
      subtitle="Current courses, from prescriptions whose duration has not ended"
      action={
        medications.history && (
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="text-xs font-medium text-teal-800 hover:underline"
            aria-expanded={showHistory}
          >
            {showHistory ? 'Hide' : 'Show'} prescription history ({medications.history.length})
          </button>
        )
      }
    >
      {medications.active.length === 0 ? (
        <EmptyState>No current medications.</EmptyState>
      ) : (
        <ul className="divide-y divide-slate-100">
          {medications.active.map((m) => (
            <li key={m.code} className="flex flex-wrap items-baseline justify-between gap-2 py-2 first:pt-0 last:pb-0">
              <div>
                <span className="font-medium">{m.name}</span> <span className="text-sm text-slate-700">{m.dose}</span>
                <p className="text-sm text-slate-600">
                  {m.frequency} · {titleCase(m.route)}
                </p>
              </div>
              <span className="text-xs tabular-nums text-slate-500">until {formatDate(m.endsAt)}</span>
            </li>
          ))}
        </ul>
      )}

      {!medications.history && (
        <div className="mt-3">
          <Withheld scope={scopeLabel} />
        </div>
      )}

      {showHistory && medications.history && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-1 pr-3 font-medium">Prescribed</th>
                <th className="py-1 pr-3 font-medium">Medication</th>
                <th className="py-1 pr-3 font-medium">Dose</th>
                <th className="py-1 pr-3 font-medium">Days</th>
                <th className="py-1 font-medium">By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {medications.history.map((m) => (
                <tr key={`${m.visitId}-${m.code}`}>
                  <td className="py-1.5 pr-3 tabular-nums text-slate-600">{formatDate(m.prescribedAt)}</td>
                  <td className="py-1.5 pr-3">{m.name}</td>
                  <td className="py-1.5 pr-3 text-slate-700">{m.dose}</td>
                  <td className="py-1.5 pr-3 tabular-nums text-slate-700">{m.durationDays ?? '—'}</td>
                  <td className="py-1.5 text-slate-600">{m.prescribedBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

// The newest visit starts expanded, or `openVisitId` if given.
export function VisitHistory({ visits, scopeLabel, openVisitId }) {
  return (
    <Card title="Visit history" subtitle={visits ? `${visits.length} visits, newest first` : undefined}>
      {!visits ? (
        <Withheld scope={scopeLabel} />
      ) : visits.length === 0 ? (
        <EmptyState>No visits recorded.</EmptyState>
      ) : (
        <ol className="space-y-3">
          {visits.map((v, i) => (
            <VisitEntry key={v.id} visit={v} defaultOpen={openVisitId ? v.id === openVisitId : i === 0} />
          ))}
        </ol>
      )}
    </Card>
  )
}

const TYPE_TONE = { EMERGENCY: 'red', FOLLOW_UP: 'blue', OPD: 'neutral', TELECONSULT: 'violet' }
const DX_TONE = { CONFIRMED: 'teal', PROVISIONAL: 'amber', DIFFERENTIAL: 'neutral' }

export function VisitEntry({ visit, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen)
  const primary = visit.diagnoses.find((d) => d.isPrimary)

  return (
    <li className="rounded-md border border-slate-200">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-left hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-teal-600"
      >
        <span className="w-24 shrink-0 text-sm font-medium tabular-nums">{formatDate(visit.date)}</span>
        <Badge tone={TYPE_TONE[visit.type]}>{VISIT_TYPE_LABEL[visit.type]}</Badge>
        <span className="min-w-0 flex-1 text-sm text-slate-800">{primary?.name ?? visit.chiefComplaint}</span>
        <span className="text-xs text-slate-500">{visit.clinician.name}</span>
        <span className="text-slate-400" aria-hidden="true">
          {open ? '−' : '+'}
        </span>
      </button>

      {open && (
        <div className="space-y-4 border-t border-slate-100 px-3 py-3 text-sm">
          <p className="text-slate-600">
            {formatDateTime(visit.date)} · {visit.facility.name} · {visit.clinician.name} ({visit.clinician.specialty})
          </p>

          {visit.chiefComplaint && (
            <Field label="Chief complaint">
              <p>{visit.chiefComplaint}</p>
            </Field>
          )}

          <Field label="Symptoms">
            <div className="flex flex-wrap gap-1.5">
              {visit.symptoms.map((s) => (
                <Badge key={s.code} tone={s.severity === 'SEVERE' ? 'amber' : 'neutral'}>
                  {s.name}
                  <span className="ml-1 text-slate-500">
                    {titleCase(s.severity)}
                    {s.durationDays != null && `, ${s.durationDays}d`}
                  </span>
                </Badge>
              ))}
            </div>
          </Field>

          <Field label="Vitals">
            <Vitals vitals={visit.vitals} />
          </Field>

          <Field label="Diagnosis">
            <ul className="space-y-1">
              {visit.diagnoses.map((d) => (
                <li key={d.code} className="flex flex-wrap items-center gap-2">
                  <span className={d.isPrimary ? 'font-medium' : ''}>{d.name}</span>
                  <span className="font-mono text-xs text-slate-500">{d.code}</span>
                  <Badge tone={DX_TONE[d.type]}>{titleCase(d.type)}</Badge>
                  {d.isPrimary && <Badge tone="neutral">Primary</Badge>}
                  {d.notes && <span className="text-xs text-slate-500">{d.notes}</span>}
                </li>
              ))}
            </ul>
          </Field>

          <Field label="Medication">
            <ul className="space-y-1">
              {visit.medications.map((m) => (
                <li key={m.code}>
                  <span className="font-medium">{m.name}</span> {m.dose}, {m.frequency.toLowerCase()}
                  {m.durationDays && ` for ${m.durationDays} days`}
                  {m.instructions && <span className="text-slate-500"> · {m.instructions}</span>}
                </li>
              ))}
            </ul>
          </Field>

          {visit.notes && (
            <Field label="Notes">
              <p className="text-slate-700">{visit.notes}</p>
            </Field>
          )}

          {visit.assessment && (
            <p className="text-xs text-slate-500">
              Assessment confirmed by {visit.assessment.confirmedBy} on {formatDateTime(visit.assessment.confirmedAt)}.
            </p>
          )}

          {visit.decisionSupport && (
            <div className="rounded-md border border-violet-200 bg-violet-50/50 px-3 py-2 text-xs text-slate-700">
              <p className="font-semibold uppercase tracking-wide text-violet-800">
                Clinical Decision Support <span className="font-normal normal-case tracking-normal">(reviewed, not a diagnosis)</span>
              </p>
              <p className="mt-0.5">
                {visit.decisionSupport.engine}: risk {visit.decisionSupport.riskLevel.toLowerCase()} (
                {visit.decisionSupport.riskScore}/100). Suggested{' '}
                {visit.decisionSupport.suggestedConditions.map((c) => c.name).join('; ') || 'nothing specific'}.
              </p>
            </div>
          )}
        </div>
      )}
    </li>
  )
}

export function Field({ label, children }) {
  return (
    <div>
      <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">{label}</h3>
      {children}
    </div>
  )
}

// Flags values outside common adult reference ranges. Display only.
export function Vitals({ vitals }) {
  const bp = vitals.bloodPressure
  const items = [
    { label: 'Temp', value: vitals.temperatureC, unit: '°C', high: vitals.temperatureC >= 38 },
    { label: 'Pulse', value: vitals.pulseBpm, unit: 'bpm', high: vitals.pulseBpm > 100 },
    {
      label: 'BP',
      value: bp ? `${bp.systolic}/${bp.diastolic}` : null,
      unit: 'mmHg',
      high: bp && (bp.systolic >= 140 || bp.diastolic >= 90),
    },
    { label: 'Resp.', value: vitals.respiratoryRate, unit: '/min', high: vitals.respiratoryRate > 20 },
    { label: 'SpO₂', value: vitals.spo2Percent, unit: '%', high: vitals.spo2Percent != null && vitals.spo2Percent < 95 },
  ].filter((i) => i.value != null)

  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {items.map((i) => (
        <div
          key={i.label}
          className={`rounded-md px-2 py-1.5 ${i.high ? 'bg-amber-50 ring-1 ring-amber-200' : 'bg-slate-50'}`}
        >
          <dt className="text-xs text-slate-500">{i.label}</dt>
          <dd className="tabular-nums">
            <span className="font-medium">{i.value}</span> <span className="text-xs text-slate-500">{i.unit}</span>
          </dd>
        </div>
      ))}
    </dl>
  )
}

export function DemographicsCard({ demographics: d, access, scopeLabel }) {
  const rows = [
    ['Date of birth', formatDate(d.dateOfBirth)],
    ['Sex', titleCase(d.gender)],
    ['Blood group', d.bloodGroup ?? 'Unknown'],
    ['District', `${d.location.district}, ${d.location.state}`],
  ]
  if (d.contact) {
    rows.push(
      ['Address', [d.location.addressLine, d.location.city, d.location.pincode].filter(Boolean).join(', ')],
      ['Phone', d.contact.phone ?? '—'],
      ['Email', d.contact.email ?? '—'],
      ['Emergency contact', d.emergencyContact?.name ? `${d.emergencyContact.name}, ${d.emergencyContact.phone}` : '—'],
    )
  }
  return (
    <Card title="Demographics">
      <dl className="space-y-2 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[8rem_1fr] gap-2">
            <dt className="text-slate-500">{k}</dt>
            <dd className="min-w-0 text-slate-800 [overflow-wrap:anywhere]">{v}</dd>
          </div>
        ))}
      </dl>
      {!access.sections.contactDetails && (
        <div className="mt-3">
          <Withheld scope={scopeLabel} />
        </div>
      )}
    </Card>
  )
}

const EVENT_DOT = {
  VISIT: 'bg-teal-600',
  ALLERGY_RECORDED: 'bg-red-500',
  CONSENT_GRANTED: 'bg-sky-500',
  CONSENT_REVOKED: 'bg-slate-500',
  RECORD_ACCESSED: 'bg-emerald-500',
  ACCESS_DENIED: 'bg-red-600',
}

export function RecentActivity({ events, isSelf }) {
  return (
    <Card
      title="Recent activity"
      subtitle={isSelf ? 'Includes who opened your record and blocked attempts' : 'Clinical and consent events'}
    >
      {events.length === 0 ? (
        <EmptyState>No recent activity.</EmptyState>
      ) : (
        <ol className="space-y-3">
          {events.map((e, i) => (
            <li key={`${e.type}-${e.at}-${i}`} className="flex gap-3">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${EVENT_DOT[e.type] ?? 'bg-slate-400'}`} />
              <div className="min-w-0">
                <p className={`text-sm ${e.type === 'ACCESS_DENIED' ? 'font-medium text-red-800' : 'text-slate-800'}`}>
                  {e.title}
                </p>
                {e.detail && <p className="text-xs text-slate-500">{e.detail}</p>}
                <p className="text-xs tabular-nums text-slate-400">{formatDateTime(e.at)}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  )
}
