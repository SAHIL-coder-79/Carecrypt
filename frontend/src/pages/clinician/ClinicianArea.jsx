import { useState } from 'react'
import { Outlet } from 'react-router'
import QrScanDialog from '../../components/clinician/QrScanDialog.jsx'
import ServerRefusal from '../../components/ServerRefusal.jsx'
import { LoadingState } from '../../components/ui.jsx'
import { useApiData } from '../../lib/useApiData.js'

// Layout for every /clinician page: loads the clinician's profile once and
// offers the QR scanner. Any signed-in user can open these pages; for other
// roles the API refuses the profile and the refusal is shown as-is.
export default function ClinicianArea() {
  const profile = useApiData('/api/clinicians/me')
  const [scanning, setScanning] = useState(false)

  if (profile.error) {
    return (
      <div className="max-w-3xl">
        <ServerRefusal error={profile.error} title="The clinician workspace is not available to your account" />
      </div>
    )
  }
  if (!profile.data) return <LoadingState label="Loading your workspace…" />

  return (
    <>
      <Outlet context={{ profile: profile.data, reloadProfile: profile.reload, openScanner: () => setScanning(true) }} />
      <QrScanDialog open={scanning} onClose={() => setScanning(false)} />
    </>
  )
}
