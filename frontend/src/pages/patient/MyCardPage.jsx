  import QRCode from 'qrcode'
  import { useEffect, useState, useRef } from 'react'
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

    const active = cards.data?.cards?.find((c) => c.status === 'ACTIVE')

    useEffect(() => {
      function checkCache() {
        const cached = localStorage.getItem('carecrypt_qr_cache')
        if (active && cached) {
          try {
            const parsed = JSON.parse(cached)
            if (parsed.qrToken.endsWith(active.tokenHint)) {
              QRCode.toString(parsed.qrToken, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 }).then(svg => {
                setIssued({ status: 'done', body: parsed, svg })
              })
            } else {
              localStorage.removeItem('carecrypt_qr_cache')
              setIssued({ status: 'idle' })
            }
          } catch (e) {
            localStorage.removeItem('carecrypt_qr_cache')
            setIssued({ status: 'idle' })
          }
        } else {
          setIssued({ status: 'idle' })
        }
      }

      checkCache()
      window.addEventListener('storage', checkCache)
      return () => window.removeEventListener('storage', checkCache)
    }, [active])

    async function issue() {
      setIssued({ status: 'busy' })
      try {
        const body = await request('/api/qr/my-card', { method: 'POST', body: {} })
        const svg = await QRCode.toString(body.qrToken, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 })
        localStorage.setItem('carecrypt_qr_cache', JSON.stringify(body))
        setIssued({ status: 'done', body, svg })
        cards.reload()
      } catch (error) {
        setIssued({ status: 'error', error })
      }
    }

  function downloadSvg() {
    if (!issued.svg) return
    const blob = new Blob([issued.svg], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `carecrypt-card-${issued.body.mrn}.svg`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  if (cards.error) return <ServerRefusal error={cards.error} />
  if (!cards.data) return <LoadingState label="Loading your card…" />

  return (
    <div className="max-w-3xl space-y-6">
      <div className="print:hidden">
        <PageHeader
          back={user.patientId ? { to: `/patients/${user.patientId}`, label: 'My record' } : undefined}
          eyebrow="My card"
          title="My CareCrypt card"
          description="Show this QR code to a clinician so they can find your record quickly. It contains only a random code: no name, no health information. A clinician can open your record only if you have given them access."
        />
      </div>

      {issued.status === 'done' ? (
        <Card title="Your new card" subtitle="Save or print it now." className="print:shadow-none print:border-none print:m-0 print:p-0">
          <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start print:flex-col print:items-center">
            <TiltCard className="w-64 shrink-0 p-3 print:w-96 print:p-0">
              <div className="relative bg-slate-900 rounded-t border-b-4 border-slate-800 p-3 flex items-center justify-between">
                <div className="flex items-center gap-2 text-white">
                  <svg className="w-5 h-5 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                  <span className="font-semibold text-sm tracking-wide">CareCrypt</span>
                </div>
              </div>
              <div
                className="w-full bg-white p-2 [&>svg]:h-auto [&>svg]:w-full print:p-0 print:m-0"
                role="img"
                aria-label="QR code for your CareCrypt card"
                // The SVG is generated locally by the qrcode library from the token.
                dangerouslySetInnerHTML={{ __html: issued.svg }}
              />
            </TiltCard>
            <div className="space-y-2 text-sm print:hidden">
              <p>
                Patient: <span className="font-medium">{user.displayName}</span>
              </p>
              <p>
                Record number: <span className="font-mono font-medium">{issued.body.mrn}</span>
              </p>
              <p className="text-slate-600">{issued.body.note}</p>
              <p className="text-xs text-slate-500">
                If a clinician&apos;s camera cannot read it, they can type the code:
              </p>
              <p className="break-all rounded bg-slate-100 px-2 py-1 font-mono text-xs">{issued.body.qrToken}</p>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => window.print()}>
                  Print
                </Button>
                <Button variant="secondary" size="sm" onClick={downloadSvg}>
                  Download
                </Button>
                <Button variant="secondary" size="sm" onClick={issue} disabled={issued.status === 'busy'}>
                  {issued.status === 'busy' ? 'Issuing…' : 'Issue a new card'}
                </Button>
              </div>
            </div>
          </div>
        </Card>
      ) : (
        <div className="print:hidden">
          <Card
            title={active ? 'No QR image available' : 'You have no active card'}
            subtitle={
              active ? `You have an active card ending in …${active.tokenHint}, but the image is not saved on this device.` : 'Issue one to use at your next visit.'
            }
          >
            <p className="text-sm text-slate-700">
              {active
                ? 'Because the server does not store the full QR code, it cannot be shown. Issue a new card to securely view and save a new QR code.'
                : 'Your card will be shown once so you can save or print it.'}
            </p>
            <div className="mt-3 flex gap-3">
              <Button onClick={issue} disabled={issued.status === 'busy'}>
                {issued.status === 'busy' ? 'Issuing…' : active ? 'Issue a new card' : 'Issue my card'}
              </Button>
            </div>
            {issued.status === 'error' && (
              <p className="mt-2 text-sm text-red-700" role="alert">
                {issued.error.message}
              </p>
            )}
          </Card>
        </div>
      )}

      <div className="print:hidden">
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
    </div>
  )
}

function TiltCard({ children, className = '' }) {
  const [style, setStyle] = useState({ transform: 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)', transition: 'transform 0.5s ease-out' })
  const [glareStyle, setGlareStyle] = useState({ opacity: 0 })

  function handleMouseMove(e) {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const centerX = rect.width / 2
    const centerY = rect.height / 2
    
    const rotateX = ((y - centerY) / centerY) * -15
    const rotateY = ((x - centerX) / centerX) * 15
    
    setStyle({
      transform: `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.02, 1.02, 1.02)`,
      transition: 'transform 0.1s ease-out'
    })

    const shineX = (x / rect.width) * 100
    const shineY = (y / rect.height) * 100
    setGlareStyle({
      background: `radial-gradient(circle at ${shineX}% ${shineY}%, rgba(255, 255, 255, 0.4) 0%, rgba(255, 255, 255, 0) 60%)`,
      opacity: 1,
      transition: 'opacity 0.1s ease-out'
    })
  }

  function handleMouseLeave() {
    setStyle({
      transform: 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)',
      transition: 'transform 0.5s ease-out'
    })
    setGlareStyle({
      opacity: 0,
      transition: 'opacity 0.5s ease-out'
    })
  }

  return (
    <div 
      className={`relative rounded-md ${className}`} 
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{ ...style, transformStyle: 'preserve-3d' }}
    >
      <div className="relative z-10 w-full h-full overflow-hidden rounded-md shadow-lg border border-slate-200 bg-white" style={{ transform: 'translateZ(20px)' }}>
        {children}
        {/* Glare overlay */}
        <div className="pointer-events-none absolute inset-0 z-20" style={glareStyle} />
      </div>
    </div>
  )
}
