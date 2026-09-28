import { useState } from 'react'
import { Link, useLocation, useOutletContext, useParams, useSearchParams } from 'react-router'
import AddVisitDialog from '../../components/clinician/AddVisitDialog.jsx'
import DiagnosisHistory from '../../components/clinician/DiagnosisHistory.jsx'
import Timeline from '../../components/clinician/Timeline.jsx'
import {
  AllergiesCard,
  ConditionsCard,
  DemographicsCard,
  MedicationsCard,
  RecentActivity,
  VisitHistory,
} from '../../components/record/sections.jsx'
import { ArrowLeftIcon, PlusIcon, SparkIcon } from '../../components/icons.jsx'
import ServerRefusal from '../../components/ServerRefusal.jsx'
import { Alert, Badge, Button, ButtonLink, Card, LoadingState, Withheld } from '../../components/ui.jsx'
import { formatDate, SCOPE, titleCase } from '../../lib/format.js'
import { useApiData } from '../../lib/useApiData.js'

const TABS = [
  ['timeline', 'Timeline'],
  ['visits', 'Visits'],
  ['diagnoses', 'Diagnoses'],
  ['medications', 'Medications'],
  ['allergies', 'Allergies & conditions'],
  ['profile', 'Profile & activity'],
]
const SCOPE_TONE = { FULL_RECORD: 'teal', VISIT_HISTORY: 'blue', SUMMARY_ONLY: 'violet' }

export default function PatientWorkspace() {
  const { patientId } = useParams()
  const { reloadProfile } = useOutletContext()
  const [params, setParams] = useSearchParams()
  const tab = TABS.some(([id]) => id === params.get('tab')) ? params.get('tab') : 'timeline'
  const record = useApiData(`/api/patients/${encodeURIComponent(patientId)}`)
  // ?newVisit=1 (from the SmartCare workspace) opens the visit workflow straight away,
  // pre-filled with the workspace's symptoms, vitals and analysis when it passed them.
  const location = useLocation()
  const [adding, setAdding] = useState(params.get('newVisit') === '1')
  const [prefill, setPrefill] = useState(() =>
    location.state?.visitPrefill?.patientId === patientId ? location.state.visitPrefill : null,
  )
  const [justAdded, setJustAdded] = useState(null)

  if (record.loading && !record.data) return <LoadingState label="Loading patient record…" />
  if (record.error) {
    return (
      <div className="max-w-3xl space-y-4">
        <BackLink />
        <ServerRefusal error={record.error} />
      </div>
    )
  }

  const { patient, access } = record.data
  const scopeLabel = SCOPE[access.scope].label.toLowerCase()
  const canAddVisit = access.sections.visitHistory
  const newVisitId = justAdded?.patientId === patientId ? justAdded.visit.id : null

  function selectTab(id) {
    setParams(id === 'timeline' ? {} : { tab: id }, { replace: true })
  }

  function onCreated(visit) {
    setAdding(false)
    setPrefill(null)
    setJustAdded({ patientId, visit })
    record.reload()
    reloadProfile()
    selectTab('timeline')
  }

  return (
    <div className="space-y-4">
      <BackLink />
      <PatientHeader
        patient={patient}
        access={access}
        canAddVisit={canAddVisit}
        onAddVisit={() => setAdding(true)}
        refreshing={record.loading}
      />

      {newVisitId && (
        <Alert tone="success">Visit of {formatDate(justAdded.visit.date)} saved to the record and the audit log.</Alert>
      )}

      <div role="tablist" aria-label="Record sections" className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-slate-200">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => selectTab(id)}
            className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm ${
              tab === id
                ? 'border-teal-700 font-medium text-teal-900'
                : 'border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === 'timeline' &&
          (patient.visitHistory ? (
            <Timeline visits={patient.visitHistory} highlightVisitId={newVisitId} />
          ) : (
            <Withheld scope={scopeLabel} />
          ))}
        {tab === 'visits' && <VisitHistory visits={patient.visitHistory} scopeLabel={scopeLabel} openVisitId={newVisitId} />}
        {tab === 'diagnoses' &&
          (patient.visitHistory ? <DiagnosisHistory visits={patient.visitHistory} /> : <Withheld scope={scopeLabel} />)}
        {tab === 'medications' && <MedicationsCard medications={patient.medications} scopeLabel={scopeLabel} />}
        {tab === 'allergies' && (
          <div className="grid gap-4 md:grid-cols-2">
            <AllergiesCard allergies={patient.allergies} />
            <ConditionsCard conditions={patient.chronicConditions} />
          </div>
        )}
        {tab === 'profile' && (
          <div className="grid gap-4 md:grid-cols-2">
            <DemographicsCard demographics={patient.demographics} access={access} scopeLabel={scopeLabel} />
            <RecentActivity events={patient.recentActivity} isSelf={false} />
          </div>
        )}
      </div>

      {canAddVisit && (
        <AddVisitDialog
          open={adding}
          onClose={() => {
            setAdding(false)
            setPrefill(null)
          }}
          patient={patient}
          onCreated={onCreated}
          initial={prefill}
        />
      )}
    </div>
  )
}

function BackLink() {
  return (
    <Link to="/clinician/patients" className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-teal-800">
      <ArrowLeftIcon className="h-4 w-4" />
      My patients
    </Link>
  )
}

function PatientHeader({ patient, access, canAddVisit, onAddVisit, refreshing }) {
  const d = patient.demographics
  const drugAllergies = patient.allergies
  const activeConditions = patient.chronicConditions.filter((c) => c.status === 'ACTIVE')

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{d.fullName}</h1>
            <Badge tone={SCOPE_TONE[access.scope]}>Consent: {SCOPE[access.scope].label}</Badge>
            {refreshing && <span className="text-xs text-slate-400">Refreshing…</span>}
          </div>
          <p className="mt-1 text-sm text-slate-600">
            <span className="font-mono">{patient.mrn}</span> · {d.ageYears} years · {titleCase(d.gender)}
            {d.bloodGroup && ` · Blood group ${d.bloodGroup}`} · {d.location.district}, {d.location.state}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex flex-wrap justify-end gap-2">
            <ButtonLink to={`/clinician/smartcare?patient=${patient.id}`} variant="secondary">
              <SparkIcon className="h-4 w-4" />
              SmartCare workspace
            </ButtonLink>
            <Button onClick={onAddVisit} disabled={!canAddVisit}>
              <PlusIcon className="h-4 w-4" />
              Add new visit
            </Button>
          </div>
          {!canAddVisit && <span className="text-xs text-slate-500">Needs visit-history consent</span>}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-sm">
        {drugAllergies.length > 0 ? (
          drugAllergies.map((a) => (
            <span key={a.allergen} className="rounded-md bg-red-50 px-2 py-1 font-medium text-red-800 ring-1 ring-inset ring-red-200">
              Allergy: {a.allergen} ({titleCase(a.severity).toLowerCase()})
            </span>
          ))
        ) : (
          <span className="rounded-md bg-slate-50 px-2 py-1 text-slate-600">No known allergies</span>
        )}
        {activeConditions.map((c) => (
          <span key={c.code} className="rounded-md bg-slate-50 px-2 py-1 text-slate-700 ring-1 ring-inset ring-slate-200">
            {c.name}
          </span>
        ))}
      </div>
    </Card>
  )
}
