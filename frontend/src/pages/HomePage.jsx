import { Navigate } from 'react-router'
import { useAuth } from '../auth/context.js'
import { Alert, PageHeader } from '../components/ui.jsx'
import { ROLE_LABEL } from '../lib/format.js'
import { homePathFor } from '../lib/navigation.js'

// Sends each role to its first section.
export default function HomePage() {
  const { user } = useAuth()
  const home = homePathFor(user)
  if (home !== '/') return <Navigate to={home} replace />

  // Fallback for an account with no home page, for example a patient account
  // not linked to a record.
  return (
    <div className="max-w-2xl">
      <PageHeader title="Welcome" description={`Signed in as ${ROLE_LABEL[user.role] ?? user.role}.`} />
      <Alert tone="warning" title="Nothing to show for this account">
        This account is not linked to a patient record or a clinical role. Contact your administrator.
      </Alert>
    </div>
  )
}
