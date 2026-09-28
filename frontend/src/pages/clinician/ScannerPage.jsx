import { ScanPanel } from '../../components/clinician/QrScanDialog.jsx'
import { Card, PageHeader } from '../../components/ui.jsx'

const STEPS = [
  ['The card', 'holds only a random code. No name, no record number, no health information.'],
  ['The server', 'looks the code up by its hash and checks that the patient has given you an active consent.'],
  ['Only then', 'does it return the patient id. The record is fetched by a second, separately authorised request.'],
  ['Every scan', 'is audited, including refused, revoked and unknown cards.'],
]

export default function ScannerPage() {
  return (
    <div>
      <PageHeader
        eyebrow="QR scanner"
        title="Scan a patient card"
        description="Use the camera, a photo of the card, or the code printed under the QR. Only patients who have given you consent will open."
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Scanner">
          <ScanPanel />
        </Card>
        <Card title="What happens when you scan">
          <ol className="space-y-3 text-sm">
            {STEPS.map(([lead, text], i) => (
              <li key={lead} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal-50 text-xs font-semibold text-teal-800">
                  {i + 1}
                </span>
                <span className="text-slate-600">
                  <strong className="font-semibold text-slate-900">{lead}</strong> {text}
                </span>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </div>
  )
}
