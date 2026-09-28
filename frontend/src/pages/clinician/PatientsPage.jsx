import { useMemo, useState } from 'react'
import { Link, useOutletContext } from 'react-router'
import { QrIcon, SearchIcon, UsersIcon } from '../../components/icons.jsx'
import ServerRefusal from '../../components/ServerRefusal.jsx'
import { Badge, Button, Card, DataTable, EmptyState, LoadingState, PageHeader } from '../../components/ui.jsx'
import { formatDate, SCOPE, titleCase } from '../../lib/format.js'
import { inputClass } from '../../lib/styles.js'
import { useApiData } from '../../lib/useApiData.js'

const SCOPE_TONE = { FULL_RECORD: 'teal', VISIT_HISTORY: 'blue', SUMMARY_ONLY: 'violet' }

// Patients with an active consent to the signed-in clinician. The server builds
// this list; search filters it in the browser.
export default function PatientsPage() {
  // Also mounted at /patients, outside the clinician area, where there is no scanner.
  const { openScanner } = useOutletContext() ?? {}
  const list = useApiData('/api/patients')
  const [search, setSearch] = useState('')

  const rows = useMemo(() => {
    const patients = list.data?.patients ?? []
    const q = search.trim().toLowerCase()
    if (!q) return patients
    return patients.filter(
      (p) =>
        p.fullName.toLowerCase().includes(q) ||
        p.mrn.toLowerCase().includes(q) ||
        p.location.district.toLowerCase().includes(q),
    )
  }, [list.data, search])

  return (
    <div>
      <PageHeader
        eyebrow="Patients"
        title={list.error ? 'Patient list' : 'My patients'}
        description={
          list.error
            ? 'For clinicians, listing patients who have given them consent. The server decides who may see it.'
            : 'Patients who have given you an active consent. Revoked or expired consents are not listed.'
        }
        actions={
          openScanner && (
            <Button onClick={openScanner}>
              <QrIcon className="h-4 w-4" />
              Scan patient QR
            </Button>
          )
        }
      />

      {list.error ? (
        <ServerRefusal error={list.error} />
      ) : !list.data ? (
        <LoadingState label="Loading patients…" />
      ) : (
        <Card
          bodyClassName="p-0"
          title={`${list.data.patients.length} patient${list.data.patients.length === 1 ? '' : 's'} with consent`}
          action={
            <label className="relative block w-full sm:w-72">
              <span className="sr-only">Search patients</span>
              <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                id="patient-search"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Name, MRN or district"
                className={`${inputClass} pl-8`}
              />
            </label>
          }
        >
          {list.data.patients.length === 0 ? (
            <EmptyState icon={UsersIcon} title="No patients yet">
              Patients appear here once they grant you access from their consent page.
            </EmptyState>
          ) : (
            <DataTable
              caption="Patients with an active consent"
              rowKey={(p) => p.id}
              rows={rows}
              empty="No patients match your search."
              columns={[
                {
                  key: 'name',
                  header: 'Patient',
                  render: (p) => (
                    <Link to={`/clinician/patients/${p.id}`} className="font-medium text-teal-800 hover:underline">
                      {p.fullName}
                    </Link>
                  ),
                },
                { key: 'mrn', header: 'MRN', render: (p) => <span className="font-mono text-xs text-slate-600">{p.mrn}</span> },
                {
                  key: 'age',
                  header: 'Age · sex',
                  render: (p) => (
                    <span className="tabular-nums text-slate-700">
                      {p.ageYears} · {titleCase(p.gender).charAt(0)}
                    </span>
                  ),
                },
                { key: 'district', header: 'District', render: (p) => p.location.district },
                {
                  key: 'access',
                  header: 'Your access',
                  render: (p) => (
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge tone={SCOPE_TONE[p.consentScope]}>{SCOPE[p.consentScope]?.label}</Badge>
                      {p.consentExpiresAt && <span className="text-xs text-slate-500">until {formatDate(p.consentExpiresAt)}</span>}
                    </span>
                  ),
                },
                {
                  key: 'last',
                  header: 'Last visit',
                  render: (p) =>
                    p.lastVisitAt ? (
                      <span className="tabular-nums">{formatDate(p.lastVisitAt)}</span>
                    ) : (
                      <span className="text-slate-400">Not shared</span>
                    ),
                },
              ]}
            />
          )}
        </Card>
      )}
    </div>
  )
}
