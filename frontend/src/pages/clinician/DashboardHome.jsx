import { Link, useOutletContext } from 'react-router'
import { ClipboardIcon, KeyIcon, QrIcon, SparkIcon, UsersIcon } from '../../components/icons.jsx'
import { Alert, Button, ButtonLink, Card, EmptyState, PageHeader, StatTile } from '../../components/ui.jsx'
import { formatDate, formatDateTime, titleCase } from '../../lib/format.js'

export default function DashboardHome() {
  const { profile, openScanner } = useOutletContext()
  const { clinician: c, stats, recentPatients } = profile
  const firstName = c.name.replace(/^Dr\.\s*/, '').split(' ')[0]

  return (
    <div>
      <PageHeader
        eyebrow="Clinician dashboard"
        title={`Good to see you, Dr. ${firstName}`}
        description={`${c.specialty} · ${c.facility.name}, ${c.facility.district}${
          c.lastLoginAt ? ` · last signed in ${formatDateTime(c.lastLoginAt)}` : ''
        }`}
        actions={
          <>
            <Button onClick={openScanner}>
              <QrIcon className="h-4 w-4" />
              Scan patient QR
            </Button>
            <ButtonLink to="/clinician/patients" variant="secondary">
              <UsersIcon className="h-4 w-4" />
              Find a patient
            </ButtonLink>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile label="Patients who gave you consent" value={stats.consentedPatients} icon={KeyIcon} tone="teal" />
        <StatTile label="Visits in the last 30 days" value={stats.visitsLast30Days} icon={ClipboardIcon} />
        <StatTile label="Visits recorded in total" value={stats.visitsTotal} icon={ClipboardIcon} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card
          className="lg:col-span-2"
          title="Recently seen"
          subtitle="Your latest visits with patients whose consent is still active"
          action={
            <Link to="/clinician/visits" className="text-xs font-medium text-teal-800 hover:underline">
              All visits
            </Link>
          }
          bodyClassName="p-0"
        >
          {recentPatients.length === 0 ? (
            <EmptyState icon={UsersIcon} title="No recent visits">
              Scan a patient&apos;s card or search your patients to start.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100">
              {recentPatients.map((p) => (
                <li key={p.id}>
                  <Link
                    to={`/clinician/patients/${p.id}`}
                    className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-teal-600"
                  >
                    <span className="flex items-center gap-3">
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-teal-50 text-xs font-semibold text-teal-800">
                        {p.fullName
                          .split(' ')
                          .map((w) => w[0])
                          .join('')}
                      </span>
                      <span>
                        <span className="block text-sm font-medium text-slate-900">{p.fullName}</span>
                        <span className="block font-mono text-xs text-slate-500">{p.mrn}</span>
                      </span>
                    </span>
                    <span className="text-xs text-slate-500">Last seen {formatDate(p.lastSeenAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-6">
          <Card title="Your practice">
            <dl className="space-y-2 text-sm">
              <Row label="Registration" value={<span className="font-mono">{c.registrationNumber}</span>} />
              <Row label="Facility" value={c.facility.name} />
              <Row
                label="Type"
                value={titleCase(c.facility.type).replace(/\b(Uhc|Chc|Phc)\b/g, (m) => m.toUpperCase())}
              />
              <Row label="Location" value={`${c.facility.district}, ${c.facility.state}`} />
            </dl>
          </Card>
          <Card title="Clinical decision support">
            <p className="text-sm text-slate-600">
              SmartCare Assist runs inside a visit: open a patient, choose <strong>Add new visit</strong>, and run it after
              recording symptoms and vitals.
            </p>
            <ButtonLink to="/clinician/smartcare" variant="secondary" size="sm" className="mt-3">
              <SparkIcon className="h-4 w-4" />
              SmartCare activity
            </ButtonLink>
          </Card>
        </div>
      </div>

      <Alert tone="info" title="How access works" className="mt-6">
        <ul className="list-disc space-y-0.5 pl-5">
          <li>You can open a record only while the patient&apos;s consent to you is active; its scope decides what the server sends.</li>
          <li>A QR card identifies the patient; it never opens a record without consent.</li>
          <li>Every record you open, and every refused attempt, is written to the tamper-evident audit log.</li>
        </ul>
      </Alert>
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right text-slate-900">{value}</dd>
    </div>
  )
}
