import { useState, useRef } from 'react'
import { Link, NavLink, useNavigate } from 'react-router'
import { useAuth } from '../../auth/context.js'
import { useTheme } from '../../context/ThemeContext.jsx'
import { navigationFor } from '../../lib/navigation.js'
import {
  BellIcon,
  CloseIcon,
  HeartPulseIcon,
  LogOutIcon,
  MenuIcon,
  MoonIcon,
  SearchIcon,
  SunIcon,
  UsersIcon,
  QrIcon,
} from '../icons.jsx'

export function ReferenceTopHeader({ onOpenMobileMenu, onOpenScanner }) {
  const { user, logout } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const navigate = useNavigate()
  const [searchQuery, setSearchQuery] = useState('')
  const themeBtnRef = useRef(null)

  function handleThemeClick(e) {
    toggleTheme(themeBtnRef.current || e.currentTarget)
  }

  function handleSearch(e) {
    e.preventDefault()
    if (searchQuery.trim()) {
      navigate(`/clinician/patients?search=${encodeURIComponent(searchQuery.trim())}`)
    }
  }

  function handleSignOut() {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <header className="sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b border-[var(--border-color)] bg-[var(--bg-card)] px-4 sm:px-6 backdrop-blur-xl">
      {/* Left: Brand Logo & Title */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          className="rounded-xl p-2 text-[var(--text-secondary)] hover:bg-black/5 hover:text-[var(--text-primary)] lg:hidden"
          aria-label="Toggle menu"
        >
          <MenuIcon className="h-5 w-5" />
        </button>

        <Link to="/" className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500 text-white shadow-sm shadow-emerald-500/20">
            <HeartPulseIcon className="h-5 w-5" />
          </div>
          <div>
            <span className="block text-base font-semibold leading-none tracking-tight text-[var(--text-primary)]">
              CareCrypt
            </span>
            <span className="text-[10px] font-medium tracking-wider text-[var(--text-muted)] uppercase">
              Clinical Hub
            </span>
          </div>
        </Link>
      </div>

      {/* Middle: Floating Quick Search Bar & Patient Finder */}
      <div className="hidden md:flex flex-1 max-w-md mx-6">
        <form onSubmit={handleSearch} className="relative w-full">
          <SearchIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)]" />
          <input
            type="search"
            placeholder="Search patients, MRN, lab reports... (⌘K)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-full border border-[var(--border-color)] bg-black/[0.02] dark:bg-white/[0.04] py-1.5 pl-9 pr-4 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] transition-all focus:border-emerald-500/60 focus:bg-[var(--bg-card-hover)] focus:outline-none focus:ring-2 focus:ring-emerald-500/10"
          />
        </form>
      </div>

      {/* Right: Actions, Theme Switcher & User Profile pill */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Quick QR scan trigger for clinicians */}
        {user?.role === 'CLINICIAN' && (
          <button
            type="button"
            onClick={onOpenScanner}
            title="Scan Patient QR Card"
            className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 dark:bg-emerald-400/10 px-3 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20 transition-colors"
          >
            <QrIcon className="h-3.5 w-3.5" />
            <span>Scan QR</span>
          </button>
        )}

        {/* Circular Theme Wipe Switcher */}
        <button
          ref={themeBtnRef}
          type="button"
          onClick={handleThemeClick}
          title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} mode`}
          className="relative flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border-color)] bg-black/[0.02] dark:bg-white/[0.04] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-emerald-500/40 transition-colors"
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? (
            <SunIcon className="h-4 w-4 text-amber-400 transition-transform hover:rotate-45" />
          ) : (
            <MoonIcon className="h-4 w-4 text-emerald-600 transition-transform hover:-rotate-12" />
          )}
        </button>

        {/* Notifications / Alerts icon */}
        <button
          type="button"
          className="relative flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border-color)] bg-black/[0.02] dark:bg-white/[0.04] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          aria-label="Notifications"
        >
          <BellIcon className="h-4 w-4" />
          <span className="absolute top-2 right-2 h-1.5 w-1.5 rounded-full bg-emerald-500" />
        </button>

        {/* User Profile Pill matching reference video right corner */}
        <div className="flex items-center gap-2 rounded-full border border-[var(--border-color)] bg-black/[0.02] dark:bg-white/[0.04] p-1 pl-1.5 pr-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/20 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
            {user?.displayName ? user.displayName.slice(0, 2).toUpperCase() : 'CC'}
          </div>
          <div className="hidden sm:block text-left">
            <span className="block text-xs font-medium leading-none text-[var(--text-primary)]">
              {user?.displayName?.split(' ')[0] || user?.role}
            </span>
            <span className="text-[10px] text-[var(--text-muted)] leading-tight">
              {user?.role}
            </span>
          </div>

          <button
            type="button"
            onClick={handleSignOut}
            title="Sign out"
            className="ml-1 rounded-full p-1 text-[var(--text-muted)] hover:text-red-500 transition-colors"
          >
            <LogOutIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </header>
  )
}

export function CompactNavigationRail({ items, onClose }) {
  return (
    <aside className="fixed left-4 top-20 bottom-4 z-20 hidden lg:flex w-16 flex-col items-center justify-between rounded-2xl nav-rail py-5 px-2">
      {/* Top action / brand mark */}
      <div className="flex flex-col items-center gap-4">
        <div className="h-2 w-2 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/50" />

        {/* Navigation Rail items with rounded tooltip-like active state */}
        <nav className="flex flex-col items-center gap-2" aria-label="Main Navigation">
          {items.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              title={label}
              className={({ isActive }) =>
                `group relative flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-200 ${
                  isActive
                    ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/25 scale-105'
                    : 'text-[var(--text-secondary)] hover:bg-black/5 dark:hover:bg-white/5 hover:text-[var(--text-primary)]'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className="h-5 w-5" />
                  {/* Floating tooltip label on hover */}
                  <span className="pointer-events-none absolute left-14 hidden whitespace-nowrap rounded-lg bg-[var(--accent-pill)] px-2.5 py-1 text-xs font-medium text-[var(--accent-pill-text)] shadow-lg group-hover:block z-50">
                    {label}
                  </span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
      </div>

      {/* Bottom status indicator */}
      <div className="flex flex-col items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-black/[0.03] dark:bg-white/[0.05] text-[var(--text-muted)] text-[10px] font-mono">
          CC
        </div>
      </div>
    </aside>
  )
}
