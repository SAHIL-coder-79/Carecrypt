import { useEffect, useState } from 'react'
import { Navigate, useLocation, useNavigate, Link } from 'react-router'
import { useAuth } from '../auth/context.js'
import { HeartPulseIcon, KeyIcon, ShieldCheckIcon, SparkIcon, FileTextIcon } from '../components/icons.jsx'
import { Alert, Button } from '../components/ui.jsx'
import { getHealth } from '../lib/api.js'
import { inputClass } from '../lib/styles.js'

const FEATURES = [
  [KeyIcon, 'Patient-controlled access', 'Clinicians open a record only with the patient’s active consent, scanned from a QR card that holds no data.'],
  [SparkIcon, 'Clinical decision support', 'SmartCare Assist uses the longitudinal record; the clinician always makes the final call.'],
  [ShieldCheckIcon, 'Privacy-preserving analytics', 'Administrators see population trends only, with small groups suppressed and inference detected.'],
  [FileTextIcon, 'Tamper-evident audit', 'Every access and refusal is written to a hash-chained log for security review.'],
]

export default function RegisterPage() {
  const { register, isAuthenticated } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [role, setRole] = useState('PATIENT')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [server, setServer] = useState('checking')

  useEffect(() => {
    getHealth()
      .then(() => setServer('ok'))
      .catch(() => setServer('down'))
  }, [])

  if (isAuthenticated) return <Navigate to="/" replace />

  async function onSubmit(e) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await register({ firstName, lastName, role, email, password })
      navigate('/login', { replace: true, state: { successMessage: 'Registration successful! Please sign in.' } })
    } catch (err) {
      setError(err.message)
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <div className="bg-amber-50 px-4 py-1.5 text-center text-xs font-medium text-amber-900">
        Synthetic demonstration data. These are not real patients. Not for clinical use.
      </div>
      <div className="grid flex-1 lg:grid-cols-2">
        <section className="hidden flex-col justify-between bg-teal-800 p-10 text-teal-50 lg:flex">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/10">
              <HeartPulseIcon className="h-6 w-6" />
            </span>
            <span className="text-xl font-semibold tracking-tight text-white">CareCrypt</span>
          </div>
          <div>
            <h2 className="max-w-md text-3xl font-semibold leading-tight tracking-tight text-white">
              Join CareCrypt today.
            </h2>
            <ul className="mt-8 max-w-md space-y-4 text-sm">
              {FEATURES.map(([Icon, title, text]) => (
                <li key={title} className="flex gap-3">
                  <Icon className="mt-0.5 h-5 w-5 shrink-0 text-teal-200" />
                  <span>
                    <strong className="block font-semibold text-white">{title}</strong>
                    {text}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <p className="text-xs text-teal-200">HLTH-01 · Patient health records and disease trend monitoring</p>
        </section>

        <main className="flex items-center justify-center px-4 py-10">
          <div className="w-full max-w-sm">
            <div className="flex items-center gap-2.5 lg:hidden">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-700 text-white">
                <HeartPulseIcon className="h-5 w-5" />
              </span>
              <span className="text-xl font-semibold tracking-tight">CareCrypt</span>
            </div>
            <h1 className="mt-6 text-2xl font-semibold tracking-tight text-slate-900 lg:mt-0">Sign up</h1>
            <p className="mt-1 text-sm text-slate-500">Create a new account as a patient or clinician.</p>

            <form onSubmit={onSubmit} className="mt-6 space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex gap-4">
                <div className="flex-1">
                  <label htmlFor="firstName" className="block text-sm font-medium text-slate-700">First Name</label>
                  <input
                    id="firstName"
                    type="text"
                    required
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className={`mt-1 ${inputClass}`}
                  />
                </div>
                <div className="flex-1">
                  <label htmlFor="lastName" className="block text-sm font-medium text-slate-700">Last Name</label>
                  <input
                    id="lastName"
                    type="text"
                    required
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className={`mt-1 ${inputClass}`}
                  />
                </div>
              </div>
              
              <div>
                <label htmlFor="role" className="block text-sm font-medium text-slate-700">I am a...</label>
                <select
                  id="role"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className={`mt-1 ${inputClass}`}
                >
                  <option value="PATIENT">Patient</option>
                  <option value="CLINICIAN">Clinician</option>
                </select>
              </div>

              <div>
                <label htmlFor="email" className="block text-sm font-medium text-slate-700">Email</label>
                <input
                  id="email"
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={`mt-1 ${inputClass}`}
                />
              </div>
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-slate-700">Password</label>
                <input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`mt-1 ${inputClass}`}
                />
              </div>
              
              {error && <Alert tone="danger">{error}</Alert>}
              
              <Button type="submit" disabled={submitting} className="w-full">
                {submitting ? 'Signing up…' : 'Sign up'}
              </Button>

              <div className="mt-4 text-center text-sm text-slate-600">
                Already have an account? <Link to="/login" className="font-semibold text-teal-700 hover:underline">Sign in</Link>
              </div>
            </form>

            <p className="mt-4 flex items-center justify-center gap-2 text-xs text-slate-500">
              <span
                className={`h-2 w-2 rounded-full ${server === 'ok' ? 'bg-emerald-500' : server === 'down' ? 'bg-red-500' : 'bg-slate-300'}`}
                aria-hidden="true"
              />
              Server {server === 'ok' ? 'online' : server === 'down' ? 'unreachable' : 'checking…'}
            </p>
          </div>
        </main>
      </div>
    </div>
  )
}
