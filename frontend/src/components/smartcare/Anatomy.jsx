import { useState } from 'react'
import { guidance, SYMPTOMS, t } from '../../lib/smartcareWorkspace.js'

// The SmartCare Assist body map (same SVG geometry as the original), its
// Clinical Assistant guidance panel and the Symptom → Condition reference table.

const REGIONS = [
  ['head', 'path', { d: 'M100,20 Q125,20 125,50 Q125,80 100,80 Q75,80 75,50 Q75,20 100,20 Z' }],
  ['neck', 'rect', { x: 91, y: 75, width: 18, height: 15 }],
  ['chest', 'path', { d: 'M70,90 L130,90 L125,160 L75,160 Z' }],
  ['abdomen', 'path', { d: 'M75,165 L125,165 L120,240 L80,240 Z' }],
  ['rightArm', 'rect', { x: 45, y: 90, width: 20, height: 130, rx: 10 }],
  ['leftArm', 'rect', { x: 135, y: 90, width: 20, height: 130, rx: 10 }],
  ['rightLeg', 'rect', { x: 75, y: 245, width: 22, height: 180, rx: 11 }],
  ['leftLeg', 'rect', { x: 103, y: 245, width: 22, height: 180, rx: 11 }],
  ['systemic', 'circle', { cx: 100, cy: 430, r: 15 }],
]

// activeRegions: regions with a selected symptom (shown in red).
// focus: region to emphasise (hovered, selected, or picked from the table).
export function BodyMap({ lang, activeRegions, focus, onHover, onSelect }) {
  return (
    <div>
      <svg
        viewBox="0 0 200 450"
        className="mx-auto block h-auto w-full max-w-[13rem]"
        role="group"
        aria-label="Body map. Choose a region to see guidance and pick symptoms."
        onMouseLeave={() => onHover(null)}
      >
        {REGIONS.map(([id, Tag, attrs]) => {
          const active = activeRegions.has(id)
          const focused = focus === id
          const label = guidance(lang, id).region.replace(/^\S+\s/, '')
          return (
            <Tag
              key={id}
              {...attrs}
              role="button"
              tabIndex={0}
              aria-label={`${label}${active ? ' (has selected symptoms)' : ''}`}
              aria-pressed={focused}
              className="cursor-pointer outline-none transition-colors focus-visible:stroke-[3]"
              fill={active ? '#fecaca' : focused ? '#c7d2fe' : '#e2e8f0'}
              stroke={active ? '#dc2626' : focused ? '#4f46e5' : '#cbd5e1'}
              strokeWidth={active || focused ? 2 : 1.5}
              onMouseEnter={() => onHover(id)}
              onFocus={() => onHover(id)}
              onClick={() => onSelect(id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelect(id)
                }
              }}
            />
          )
        })}
        <text x="100" y="434" textAnchor="middle" fontSize="8" fontWeight="bold" fill="#64748b" pointerEvents="none">
          GEN
        </text>
      </svg>
      <div className="mt-3 grid grid-cols-2 gap-1.5">
        {['CRANIAL', 'THORACIC', 'ABDOMINAL', 'SYSTEMIC'].map((z) => (
          <span key={z} className="rounded bg-slate-100 py-1 text-center text-[10px] font-bold tracking-wide text-slate-500">
            {z}
          </span>
        ))}
      </div>
      <p className="mt-2 flex items-center justify-center gap-3 text-[11px] text-slate-500">
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-sm border border-red-600 bg-red-200" /> Symptom selected
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-sm border border-indigo-600 bg-indigo-200" /> In focus
        </span>
      </p>
    </div>
  )
}

// Clinical Assistant: guidance and red-flag tip for the region in focus.
export function GuidancePanel({ lang, region }) {
  const g = guidance(lang, region ?? 'idle')
  return (
    <section
      aria-live="polite"
      className={`rounded-xl border bg-slate-900 p-4 text-slate-100 shadow-sm ${g.tip ? 'border-red-500/40' : 'border-indigo-500/30'}`}
    >
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="text-lg">
          {g.icon}
        </span>
        <span className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-indigo-400">{t(lang, 'ws.guide_header')}</span>
        <span className="ml-auto h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
      </div>
      <p className="mt-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">{g.region}</p>
      <p className="mt-1 text-sm leading-relaxed text-slate-200">{g.text}</p>
      {g.tip && (
        <p className="mt-3 rounded-md border-l-4 border-red-500 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-200">{g.tip}</p>
      )}
    </section>
  )
}

// Symptom → Condition quick-reference table. Clicking a row ticks the symptom.
export function SymptomRefTable({ lang, selected, focusRegion, onPick }) {
  const [open, setOpen] = useState(true)
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 bg-slate-900 px-4 py-2.5 text-left text-[11px] font-extrabold uppercase tracking-wider text-slate-300 focus-visible:outline-2 focus-visible:outline-teal-500"
      >
        <span>📋 {t(lang, 'reftable.title', 'Symptom → Condition Table')}</span>
        <span aria-hidden="true" className="text-indigo-400">
          {open ? '▲' : '▼'}
        </span>
      </button>
      {open && (
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full table-fixed text-left text-[11px] [overflow-wrap:anywhere]">
            <colgroup>
              <col className="w-[38%]" />
              <col className="w-[28%]" />
              <col className="w-[34%]" />
            </colgroup>
            <thead className="sticky top-0 bg-slate-800 text-[10px] uppercase tracking-wide">
              <tr>
                <th scope="col" className="px-2.5 py-2 font-extrabold text-indigo-300">
                  🩺 {t(lang, 'reftable.col.symptom', 'Symptom')}
                </th>
                <th scope="col" className="px-2 py-2 font-extrabold text-slate-300">
                  📍 {t(lang, 'reftable.col.bodypart', 'Body Part')}
                </th>
                <th scope="col" className="px-2 py-2 font-extrabold text-amber-300">
                  ⚠️ {t(lang, 'reftable.col.cancause', 'Can Cause')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {SYMPTOMS.map((s) => {
                const risk = t(lang, `reftable.risk.${s.code}`, '—')
                const critical = risk.includes('⚡')
                const inFocus = focusRegion && s.region === focusRegion
                const isSelected = selected.has(s.code)
                return (
                  <tr
                    key={s.code}
                    className={`cursor-pointer align-top hover:bg-indigo-50 ${inFocus ? 'bg-indigo-50 outline outline-2 -outline-offset-2 outline-indigo-400' : ''} ${
                      isSelected ? 'bg-teal-50/60' : ''
                    }`}
                    onClick={() => onPick(s.code)}
                  >
                    <td className="px-2.5 py-2 font-semibold text-slate-900">
                      <button
                        type="button"
                        className="text-left focus-visible:outline-2 focus-visible:outline-teal-600"
                        aria-pressed={isSelected}
                        onClick={(e) => {
                          e.stopPropagation()
                          onPick(s.code)
                        }}
                      >
                        {s.emoji} {t(lang, `symptom.${s.code}`, s.code)}
                        {isSelected && <span className="ml-1 text-teal-700">✓</span>}
                      </button>
                    </td>
                    <td className="px-2 py-2">
                      <span className="inline-block rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">
                        {t(lang, s.regionKey, s.region)}
                      </span>
                    </td>
                    <td className={`px-2 py-2 leading-snug ${critical ? 'font-bold text-red-700' : 'text-slate-600'}`}>{risk}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
