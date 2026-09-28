import { Link } from 'react-router'
import { buttonClass } from '../lib/styles.js'
import { AlertCircleIcon, AlertTriangleIcon, ArrowLeftIcon, CheckCircleIcon, InfoIcon } from './icons.jsx'

// Shared building blocks. Every page uses these so cards, badges, alerts,
// tables and states look and behave the same across roles.

const TONES = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  teal: 'bg-teal-50 text-teal-800 ring-teal-200',
  red: 'bg-red-50 text-red-800 ring-red-200',
  amber: 'bg-amber-50 text-amber-900 ring-amber-200',
  blue: 'bg-sky-50 text-sky-800 ring-sky-200',
  violet: 'bg-violet-50 text-violet-800 ring-violet-200',
  green: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
}

export function Badge({ tone = 'neutral', children, className = '' }) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]} ${className}`}
    >
      {children}
    </span>
  )
}

export function Button({ variant = 'primary', size = 'md', className = '', type = 'button', ...props }) {
  return <button type={type} className={buttonClass(variant, size, className)} {...props} />
}

export function ButtonLink({ variant = 'primary', size = 'md', className = '', ...props }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />
}

// Page title block: optional back link, eyebrow, title, description and actions.
export function PageHeader({ eyebrow, title, description, actions, back, children }) {
  return (
    <header className="mb-6 space-y-3">
      {back && (
        <Link to={back.to} className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-teal-800">
          <ArrowLeftIcon className="h-4 w-4" />
          {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          {eyebrow && <p className="text-xs font-semibold uppercase tracking-wider text-teal-700">{eyebrow}</p>}
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
          {description && <p className="mt-1 max-w-3xl text-sm text-slate-600">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </header>
  )
}

export function Card({ title, subtitle, action, children, className = '', bodyClassName = 'p-4 sm:p-5' }) {
  return (
    // min-w-0 lets a card in a grid shrink, so wide tables scroll inside it instead of widening the page.
    <section className={`min-w-0 rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
      {(title || action) && (
        <header className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  )
}

const STAT_TONES = {
  neutral: 'text-slate-900',
  teal: 'text-teal-800',
  red: 'text-red-700',
  amber: 'text-amber-800',
  green: 'text-emerald-800',
}

// A single headline number.
export function StatTile({ label, value, detail, tone = 'neutral', icon: Icon }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-slate-500">{label}</p>
        {Icon && <Icon className="h-4 w-4 text-slate-400" />}
      </div>
      <p className={`mt-1.5 text-2xl font-semibold tabular-nums ${STAT_TONES[tone]}`}>
        {value === null || value === undefined ? <span className="text-base font-medium text-slate-500">Hidden</span> : value}
      </p>
      {detail && <p className="mt-0.5 text-xs text-slate-500">{detail}</p>}
    </div>
  )
}

const ALERTS = {
  info: { box: 'border-sky-200 bg-sky-50 text-sky-900', icon: InfoIcon, iconColor: 'text-sky-600' },
  success: { box: 'border-emerald-200 bg-emerald-50 text-emerald-900', icon: CheckCircleIcon, iconColor: 'text-emerald-600' },
  warning: { box: 'border-amber-200 bg-amber-50 text-amber-900', icon: AlertTriangleIcon, iconColor: 'text-amber-600' },
  danger: { box: 'border-red-200 bg-red-50 text-red-900', icon: AlertCircleIcon, iconColor: 'text-red-600' },
}

// Inline message. Danger and warning alerts are announced (role="alert"),
// success and info politely (role="status").
export function Alert({ tone = 'info', title, children, action, className = '' }) {
  const a = ALERTS[tone]
  const Icon = a.icon
  return (
    <div
      role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}
      className={`flex gap-3 rounded-lg border px-4 py-3 text-sm ${a.box} ${className}`}
    >
      <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${a.iconColor}`} />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={title ? 'mt-0.5' : ''}>{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  )
}

export function EmptyState({ icon: Icon, title, children, action }) {
  if (!title && !Icon && !action) return <p className="text-sm text-slate-500">{children}</p>
  return (
    <div className="flex flex-col items-center px-4 py-8 text-center">
      {Icon && (
        <span className="mb-3 rounded-full bg-slate-100 p-3 text-slate-500">
          <Icon className="h-6 w-6" />
        </span>
      )}
      {title && <p className="text-sm font-semibold text-slate-900">{title}</p>}
      {children && <p className="mt-1 max-w-sm text-sm text-slate-500">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Withheld({ scope }) {
  return (
    <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-600">
      Not included in your access ({scope}). The server did not send this section.
    </p>
  )
}

export function Spinner({ label = 'Loading…' }) {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-500" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-teal-600 motion-reduce:animate-none" />
      {label}
    </div>
  )
}

// Placeholder for a page or panel that is loading: grey blocks shaped like the
// content, plus an announced label.
export function LoadingState({ label = 'Loading…', rows = 3 }) {
  return (
    <div className="space-y-3" aria-busy="true">
      <Spinner label={label} />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-16 rounded-xl border border-slate-200 bg-white">
          <div className="m-4 h-3 w-1/3 rounded bg-slate-100" />
        </div>
      ))}
    </div>
  )
}

// Table with the house style. columns: [{ key, header, render(row), align, className }]
export function DataTable({ columns, rows, rowKey, caption, empty = 'Nothing to show.', minWidth = '40rem', dense = false }) {
  const pad = dense ? 'px-3 py-2' : 'px-4 py-3'
  return (
    <div className="overflow-x-auto [contain:inline-size]">
      <table className="w-full text-left text-sm" style={{ minWidth }}>
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50/80">
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={`${pad} text-xs font-semibold uppercase tracking-wide text-slate-500 ${c.align === 'right' ? 'text-right' : ''}`}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-8 text-center text-sm text-slate-500">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={rowKey(row)} className="align-top hover:bg-slate-50/70">
                {columns.map((c) => (
                  <td key={c.key} className={`${pad} ${c.align === 'right' ? 'text-right tabular-nums' : ''} ${c.className ?? ''}`}>
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
