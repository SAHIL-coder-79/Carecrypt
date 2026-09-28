import { useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { useAuth } from '../auth/context.js'
import { ROLE_LABEL } from '../lib/format.js'
import { navigationFor, OTHER_ROLE_PAGES } from '../lib/navigation.js'
import { CloseIcon, HeartPulseIcon, LockIcon, LogOutIcon, MenuIcon } from './icons.jsx'

const ROLE_TONE = {
  CLINICIAN: 'bg-teal-50 text-teal-800 ring-teal-200',
  PATIENT: 'bg-sky-50 text-sky-800 ring-sky-200',
  ADMIN: 'bg-violet-50 text-violet-800 ring-violet-200',
  SECURITY_ADMIN: 'bg-amber-50 text-amber-900 ring-amber-200',
}

// App shell: a sidebar with the signed-in role's sections (a drawer on small
// screens) and the page. The menu follows the role for convenience only.
export default function Layout() {
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()
  const [lastPath, setLastPath] = useState(location.pathname)
  // Close the drawer after navigating.
  if (lastPath !== location.pathname) {
    setLastPath(location.pathname)
    if (menuOpen) setMenuOpen(false)
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2"
      >
        Skip to content
      </a>

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-slate-200 bg-white lg:block print:hidden">
        <Sidebar />
      </aside>

      {menuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/40"
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-slate-200 bg-white shadow-xl">
            <Sidebar onClose={() => setMenuOpen(false)} />
          </div>
        </div>
      )}

      <div className="lg:pl-64 print:pl-0">
        <div className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2.5 lg:hidden print:hidden">
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="rounded-md p-1.5 text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-teal-600"
            aria-label="Open menu"
          >
            <MenuIcon />
          </button>
          <Brand compact />
          <RoleBadge />
        </div>

        <div className="border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-center text-xs font-medium text-amber-900">
          Synthetic demonstration data. These are not real patients. Not for clinical use.
        </div>

        <main id="main" className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

function Brand({ compact = false }) {
  return (
    <Link to="/" className="flex items-center gap-2.5 rounded-md focus-visible:outline-2 focus-visible:outline-teal-600">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-700 text-white">
        <HeartPulseIcon className="h-5 w-5" />
      </span>
      <span>
        <span className="block text-base font-semibold leading-tight tracking-tight text-slate-900">CareCrypt</span>
        {!compact && <span className="block text-[11px] leading-tight text-slate-500">Secure records · Smarter care</span>}
      </span>
    </Link>
  )
}

function RoleBadge() {
  const { user } = useAuth()
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${ROLE_TONE[user?.role] ?? ''}`}
    >
      {ROLE_LABEL[user?.role] ?? user?.role}
    </span>
  )
}

function Sidebar({ onClose }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const items = navigationFor(user)
  const others = OTHER_ROLE_PAGES.filter((p) => p.role !== user?.role)

  function signOut() {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-5 py-5">
        <Brand />
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"
            aria-label="Close menu"
          >
            <CloseIcon />
          </button>
        )}
      </div>

      <nav aria-label="Main" className="flex-1 overflow-y-auto px-3">
        <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          {ROLE_LABEL[user?.role] ?? 'Menu'}
        </p>
        <ul className="space-y-0.5">
          {items.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                className={({ isActive }) =>
                  `group flex items-center gap-3 rounded-md px-2.5 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-teal-600 ${
                    isActive ? 'bg-teal-50 text-teal-900' : 'text-slate-700 hover:bg-slate-50 hover:text-slate-900'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon className={`h-5 w-5 ${isActive ? 'text-teal-700' : 'text-slate-400 group-hover:text-slate-600'}`} />
                    {label}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>

        <details className="mt-6 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2 text-xs text-slate-600">
          <summary className="flex cursor-pointer list-none items-center gap-2 font-medium text-slate-700">
            <LockIcon className="h-4 w-4 text-slate-500" />
            Access is enforced by the server
          </summary>
          <p className="mt-2">
            This menu shows your role&apos;s sections. Nothing is protected by hiding it: open another role&apos;s page
            and the server refuses.
          </p>
          <ul className="mt-2 space-y-1">
            {others.map((p) => (
              <li key={p.to}>
                <Link to={p.to} className="text-teal-800 underline-offset-2 hover:underline">
                  {p.label}
                </Link>
              </li>
            ))}
          </ul>
        </details>
      </nav>

      <div className="border-t border-slate-200 px-4 py-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-600">
            {initials(user?.displayName)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-slate-900">{user?.displayName}</p>
            <RoleBadge />
          </div>
          <button
            type="button"
            onClick={signOut}
            className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-teal-600"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOutIcon className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  )
}

function initials(name = '') {
  return name
    .replace(/^Dr\.?\s*/, '')
    .replace(/\(.*\)/, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('')
}
