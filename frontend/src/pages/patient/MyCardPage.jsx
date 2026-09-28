import QRCode from 'qrcode'
import { useState } from 'react'
import { useAuth } from '../../auth/context.js'
import ServerRefusal from '../../components/ServerRefusal.jsx'
import { Badge, Button, Card, LoadingState, PageHeader } from '../../components/ui.jsx'
import { formatDateTime } from '../../lib/format.js'
import { useApiData } from '../../lib/useApiData.js'

// The patient's CareCrypt card. The QR code holds only a random token; a
// clinician can use it only with the patient's consent. The token is shown once,
// right after issuing, because the server keeps only its hash.
export default function MyCardPage() {
  const { request, user } = useAuth()
  const cards = useApiData('/api/qr/my-card')
  const [issued, setIssued] = useState({ status: 'idle' })

  async function issue() {
    setIssued({ status: 'busy' })
    try {
      const body = await request('/api/qr/my-card', { method: 'POST', body: {} })
      const svg = await QRCode.toString(body.qrToken, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 })
      setIssued({ status: 'done', body, svg })
      cards.reload()
    } catch (error) {
      setIssued({ status: 'error', error })
    }
  }

  if (cards.error) return <ServerRefusal error={cards.error} />
  if (!cards.data) return <LoadingState label="Loading your card…" />
  const active = cards.data.cards.find((c) => c.status === 'ACTIVE')

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        back={user.patientId ? { to: `/patients/${user.patientId}`, label: 'My record' } : undefined}
        eyebrow="My card"
        title="My CareCrypt card"
        description="Show this QR code to a clinician so they can find your record quickly. It contains only a random code: no name, no health information. A clinician can open your record only if you have given them access."
      />

      {issued.status === 'done' ? (
        <Card title="Your new card" subtitle="Save or print it now. For your security it cannot be shown again.">
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            <div
              className="w-56 shrink-0 rounded-md border border-slate-200 bg-white p-2 [&>svg]:h-auto [&>svg]:w-full"
              role="img"
              aria-label="QR code for your CareCrypt card"
              // The SVG is generated locally by the qrcode library from the token.
              dangerouslySetInnerHTML={{ __html: issued.svg }}
            />
            <div className="space-y-2 text-sm">
              <p>
                Record number <span className="font-mono font-medium">{issued.body.mrn}</span>
              </p>
              <p className="text-slate-600">{issued.body.note}</p>
              <p className="text-xs text-slate-500">
                If a clinician&apos;s camera cannot read it, they can type the code:
              </p>
              <p className="break-all rounded bg-slate-100 px-2 py-1 font-mono text-xs">{issued.body.qrToken}</p>
              <Button variant="secondary" size="sm" onClick={() => window.print()}>
                Print
              </Button>
            </div>
          </div>
        </Card>
      ) : (
        <Card
          title={active ? 'You have an active card' : 'You have no active card'}
          subtitle={
            active ? `Issued ${formatDateTime(active.issuedAt)}, code ending …${active.tokenHint}` : 'Issue one to use at your next visit.'
          }
        >
          <p className="text-sm text-slate-700">
            {active
              ? 'Lost your card, or want a fresh one? Issuing a new card stops the old one from working.'
              : 'Your card will be shown once so you can save or print it.'}
          </p>
          <Button onClick={issue} disabled={issued.status === 'busy'} className="mt-3">
            {issued.status === 'busy' ? 'Issuing…' : active ? 'Issue a new card' : 'Issue my card'}
          </Button>
          {issued.status === 'error' && (
            <p className="mt-2 text-sm text-red-700" role="alert">
              {issued.error.message}
            </p>
          )}
        </Card>
      )}

      <Card title="Card history">
        <ul className="space-y-1 text-sm">
          {cards.data.cards.map((c) => (
            <li key={c.issuedAt} className="flex items-center gap-2">
              <Badge tone={c.status === 'ACTIVE' ? 'green' : 'neutral'}>{c.status === 'ACTIVE' ? 'Active' : 'Revoked'}</Badge>
              <span>
                …{c.tokenHint}, issued {formatDateTime(c.issuedAt)}
                {c.revokedAt ? `, revoked ${formatDateTime(c.revokedAt)}` : ''}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
