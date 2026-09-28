// Issues a fresh QR card for every seeded demo patient (CC-*) and writes a printable
// sheet. The generated analytics volume patients (SYN-*) get no cards.
//
//   npm run qr:cards
//
// Each card encodes only a random 192-bit token (no identifiers or health data).
// The database keeps only the token hash; the raw tokens exist only in the
// generated sheet, which is git-ignored. Running this again revokes the previous
// cards. CC-000003 also gets a revoked card, to demonstrate a lost card.
//
// Development only: refuses to run when NODE_ENV=production.

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import QRCode from 'qrcode'
import { isProduction } from '../src/config/env.js'
import { closePool, query } from '../src/db/pool.js'
import { issueQrToken } from '../src/qr/tokens.js'

if (isProduction) {
  console.error('Refusing to generate demo QR cards with NODE_ENV=production.')
  process.exit(1)
}

const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'demo-qr-cards')
const REVOKED_DEMO_MRN = 'CC-000003'

const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

try {
  const { rows: patients } = await query(
    `SELECT id, mrn, first_name, last_name FROM clinical.patients WHERE is_active AND mrn LIKE 'CC-%' ORDER BY mrn`,
  )
  if (patients.length === 0) throw new Error('No patients found. Load database/seed.sql first.')

  const cards = []
  for (const p of patients) {
    if (p.mrn === REVOKED_DEMO_MRN) {
      // Issue a card, then replace it: the first one becomes the "lost" revoked card.
      const lost = await issueQrToken(p.id)
      const current = await issueQrToken(p.id, { revokeReason: 'Card reported lost (demo)' })
      cards.push({ ...p, token: current, revoked: false }, { ...p, token: lost, revoked: true })
    } else {
      cards.push({ ...p, token: await issueQrToken(p.id), revoked: false })
    }
  }

  const rendered = await Promise.all(
    cards.map(async (c) => ({
      ...c,
      svg: await QRCode.toString(c.token, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }),
    })),
  )

  mkdirSync(OUT_DIR, { recursive: true })
  const file = path.join(OUT_DIR, 'index.html')
  writeFileSync(file, sheet(rendered), 'utf8')

  console.log(`Issued ${cards.filter((c) => !c.revoked).length} active cards (+1 revoked demo card).`)
  console.log(`Printable sheet: ${file}`)
  console.log('Previous cards for these patients are now revoked.')
} catch (err) {
  console.error(`Could not generate QR cards: ${err.message}`)
  process.exitCode = 1
} finally {
  await closePool()
}

function sheet(cards) {
  const generated = new Date().toISOString().replace('T', ' ').slice(0, 16)
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CareCrypt demo QR cards</title>
<style>
  body { font: 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0; padding: 24px 16px; background: #f8fafc; color: #0f172a; }
  header { max-width: 1100px; margin: 0 auto 20px; }
  h1 { font-size: 20px; margin: 0 0 6px; }
  .warn { background: #fef3c7; color: #78350f; padding: 8px 12px; border-radius: 6px; font-size: 13px; }
  ul { list-style: none; padding: 0; margin: 0 auto; max-width: 1100px; display: grid; gap: 14px; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); }
  li { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px; text-align: center; break-inside: avoid; }
  li.revoked { border-color: #fca5a5; }
  .brand { font-size: 11px; font-weight: 700; letter-spacing: .06em; color: #115e59; text-transform: uppercase; }
  .qr svg { width: 140px; height: 140px; margin: 8px auto 4px; display: block; }
  .name { font-weight: 600; }
  .mrn { font-family: ui-monospace, Consolas, monospace; font-size: 12px; color: #475569; }
  .token { font-family: ui-monospace, Consolas, monospace; font-size: 10px; color: #64748b; word-break: break-all; margin-top: 6px; user-select: all; }
  .flag { color: #b91c1c; font-weight: 600; font-size: 12px; margin-top: 4px; }
  @media print { body { background: #fff; } .warn { display: none; } }
</style>
</head>
<body>
<header>
  <h1>CareCrypt demo patient QR cards</h1>
  <p class="warn">Synthetic patients, development only. Each QR encodes only a random token. Anyone holding a token can present it, but a record opens only for a clinician the patient has given consent to. Generated ${generated}. Running <code>npm run qr:cards</code> again revokes these cards.</p>
</header>
<ul>
${cards
  .map(
    (c) => `  <li class="${c.revoked ? 'revoked' : ''}">
    <div class="brand">CareCrypt · synthetic demo</div>
    <div class="qr">${c.svg}</div>
    <div class="name">${escape(c.first_name)} ${escape(c.last_name)}</div>
    <div class="mrn">${escape(c.mrn)}</div>
    ${c.revoked ? '<div class="flag">Revoked card (reported lost)</div>' : ''}
    <div class="token" title="Paste into “Enter code”">${escape(c.token)}</div>
  </li>`,
  )
  .join('\n')}
</ul>
</body>
</html>
`
}
