import { ROLE_LABEL } from '../lib/format.js'
import { AlertCircleIcon, LockIcon } from './icons.jsx'

const REASONS = {
  NO_ACTIVE_CONSENT: 'This patient has not given you an active consent. It may never have been granted, or it was revoked or has expired.',
  CONSENT_SCOPE_INSUFFICIENT: 'Your consent from this patient does not cover this part of the record.',
  NOT_OWN_RECORD: 'Patients can only open their own record.',
  NO_CLINICIAN_PROFILE: 'Your account has no active clinician profile.',
}

// Resource-specific explanations for a 403 FORBIDDEN body.
const RESOURCES = {
  SECURITY_CONSOLE: (role) => `Your role (${role}) cannot open the security console. Only security administrators review audit logs and security events.`,
  AGGREGATE_ANALYTICS: (role) => `Your role (${role}) cannot view population analytics. Only administrators see these aggregate figures.`,
  ACCESS_HISTORY: (role) => `Your role (${role}) cannot read a patient's access history. Only the patient can see who used their record.`,
  CLINICIAN_PROFILE: (role) => `Your role (${role}) has no clinician workspace. Clinical pages are for clinicians with patient consent.`,
  CLINICIAN_VISITS: (role) => `Your role (${role}) has no clinician visit list.`,
  SMARTCARE: (role) => `Your role (${role}) cannot use SmartCare Assist. Decision support is for clinicians with patient consent.`,
  PATIENT_QR: (role) => `Your role (${role}) cannot resolve patient QR cards.`,
  OWN_QR_CARD: (role) => `Your role (${role}) has no patient card. Cards belong to patients.`,
  CONSENT: (role) => `Your role (${role}) cannot manage patient consent.`,
}

// Shows an error returned by the API, including the exact response body, so it
// is visible that the refusal came from the server and not from the interface.
export default function ServerRefusal({ error, title = 'Access denied by the server' }) {
  const body = error?.body
  const isForbidden = error?.status === 403
  const role = ROLE_LABEL[body?.role] ?? body?.role

  let explanation
  if (isForbidden && body?.reason) {
    explanation = REASONS[body.reason] ?? body.reason
  } else if (isForbidden && RESOURCES[body?.resource]) {
    explanation = RESOURCES[body.resource](role)
  } else if (isForbidden) {
    explanation = `Your role (${role}) is not allowed to open identifiable patient records. Administrators work only with aggregate, de-identified analytics.`
  } else if (error?.status === 404) {
    explanation = 'No record was found.'
  } else if (error?.status === 0) {
    explanation = 'The CareCrypt server cannot be reached. Check that the API is running.'
  } else {
    explanation = error?.message ?? 'Something went wrong.'
  }

  const Icon = isForbidden ? LockIcon : AlertCircleIcon

  return (
    <section className="overflow-hidden rounded-xl border border-red-200 bg-white shadow-sm" role="alert">
      <div className="flex gap-4 p-5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-red-600 px-1.5 py-0.5 font-mono text-xs font-semibold text-white">
              {error?.status || 'ERR'}
            </span>
            <h1 className="text-base font-semibold text-slate-900">{isForbidden ? title : 'Could not load'}</h1>
          </div>
          <p className="mt-1.5 max-w-prose text-sm text-slate-700">{explanation}</p>
          {isForbidden && (
            <p className="mt-2 text-xs text-slate-500">
              The server refused this request and recorded the attempt in the audit log. The interface did not block it.
            </p>
          )}
        </div>
      </div>
      {body && (
        <details open className="border-t border-slate-100 bg-slate-50 px-5 py-3">
          <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-slate-500">
            Response from the server
          </summary>
          <pre className="mt-2 overflow-x-auto rounded-md bg-slate-900 p-3 font-mono text-xs text-slate-100">
            {JSON.stringify(body, null, 2)}
          </pre>
        </details>
      )}
    </section>
  )
}
