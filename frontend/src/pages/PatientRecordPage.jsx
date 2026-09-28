import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { useAuth } from '../auth/context.js'
import ServerRefusal from '../components/ServerRefusal.jsx'
import {
  AllergiesCard,
  ConditionsCard,
  DemographicsCard,
  MedicationsCard,
  RecentActivity,
  VisitHistory,
} from '../components/record/sections.jsx'
import { CardIcon, HistoryIcon } from '../components/icons.jsx'
import { Badge, ButtonLink, LoadingState } from '../components/ui.jsx'
import { SCOPE, titleCase } from '../lib/format.js'

export default function PatientRecordPage() {
  const { patientId } = useParams()
  const { request, user } = useAuth()
  // Result of the last request, tagged with the id it was for. While it does not
  // match the id in the URL (first load or navigation), the page shows loading.
  const [state, setState] = useState(null)

  useEffect(() => {
    let cancelled = false
    request(`/api/patients/${encodeURIComponent(patientId)}`)
      .then((data) => !cancelled && setState({ patientId, status: 'ok', ...data }))
      .catch((error) => !cancelled && setState({ patientId, status: 'error', error }))
    return () => {
      cancelled = true
    }
  }, [patientId, request])

  if (!state || state.patientId !== patientId) return <LoadingState label="Loading patient record…" />
  if (state.status === 'error') {
    return (
      <div className="max-w-3xl space-y-4">
        {user.role === 'CLINICIAN' && <BackLink />}
        <ServerRefusal error={state.error} />
      </div>
    )
  }

  const { patient, access } = state
  const scopeLabel = access.via === 'SELF' ? 'your own record' : SCOPE[access.scope].label.toLowerCase()

  return (
    <div className="space-y-6">
      {user.role === 'CLINICIAN' && <BackLink />}
      <RecordHeader patient={patient} access={access} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="grid gap-6 md:grid-cols-2">
            <AllergiesCard allergies={patient.allergies} />
            <ConditionsCard conditions={patient.chronicConditions} />
          </div>
          <MedicationsCard medications={patient.medications} scopeLabel={scopeLabel} />
          <VisitHistory visits={patient.visitHistory} scopeLabel={scopeLabel} />
        </div>
        <div className="space-y-6">
          <DemographicsCard demographics={patient.demographics} access={access} scopeLabel={scopeLabel} />
          <RecentActivity events={patient.recentActivity} isSelf={access.via === 'SELF'} />
        </div>
      </div>
    </div>
  )
}

function BackLink() {
  return (
    <Link to="/clinician/patients" className="text-sm text-teal-800 hover:underline">
      ← My patients
    </Link>
  )
}

function RecordHeader({ patient, access }) {
  const d = patient.demographics
  return (
    <section className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{d.fullName}</h1>
        <p className="mt-1 text-sm text-slate-600">
          <span className="font-mono text-slate-700">{patient.mrn}</span>
          <span className="mx-2 text-slate-300">|</span>
          {d.ageYears} years · {titleCase(d.gender)}
          {d.bloodGroup && (
            <>
              <span className="mx-2 text-slate-300">|</span>Blood group <strong className="font-semibold">{d.bloodGroup}</strong>
            </>
          )}
          <span className="mx-2 text-slate-300">|</span>
          {d.location.city}, {d.location.state}
        </p>
      </div>
      <div className="text-right">
        {access.via === 'SELF' ? (
          <Badge tone="green">Your own record</Badge>
        ) : (
          <Badge tone={access.scope === 'FULL_RECORD' ? 'teal' : access.scope === 'VISIT_HISTORY' ? 'blue' : 'violet'}>
            Consent: {SCOPE[access.scope].label}
          </Badge>
        )}
        <p className="mt-1 max-w-xs text-xs text-slate-500">
          {access.via === 'SELF' ? 'You can see everything held about you.' : SCOPE[access.scope].detail}
        </p>
        {access.via === 'SELF' && (
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <ButtonLink to="/patient/card" variant="secondary" size="sm">
              <CardIcon className="h-4 w-4" />
              My CareCrypt card
            </ButtonLink>
            <ButtonLink to="/patient/access-history" variant="secondary" size="sm">
              <HistoryIcon className="h-4 w-4" />
              Who accessed it
            </ButtonLink>
          </div>
        )}
      </div>
    </section>
  )
}
