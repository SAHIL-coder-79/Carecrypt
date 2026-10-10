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

const MESSAGES = {
  401: 'Invalid email or password.',
  423: 'This account is temporarily locked after too many failed attempts. Try again later.',
  429: 'Too many sign-in attempts from this device. Try again later.',
  403: 'This account has been disabled.',
}

export default function LoginPage() {
  const { login, isAuthenticated } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [server, setServer] = useState('checking')
  const [showPassword, setShowPassword] = useState(false)

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
      await login(email, password)
      navigate(location.state?.from ?? '/', { replace: true })
    } catch (err) {
      setError(MESSAGES[err.status] ?? err.message)
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col lg:flex-row bg-[var(--soft-pink-white)]">
      
      {/* Left Branding Panel (62%) */}
      <section className="relative flex flex-col justify-between p-10 lg:w-[62%] bg-gradient-to-br from-[var(--steel-blue)] to-[var(--shadow-blue)] overflow-hidden">
        
        {/* Subtle Dotted Background Pattern */}
        <div 
          className="absolute inset-0 opacity-10 pointer-events-none" 
          style={{ backgroundImage: 'radial-gradient(circle, var(--pure-white) 1px, transparent 1.5px)', backgroundSize: '24px 24px' }}
        />
        {/* Soft Glowing Orbs (Soft Lighting) */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-[var(--blush-pink)] rounded-full mix-blend-screen filter blur-[120px] opacity-20 pointer-events-none" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-[var(--highlight-pink)] rounded-full mix-blend-screen filter blur-[100px] opacity-15 pointer-events-none" />

        <div className="relative z-10 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/10 shadow-sm border border-white/10">
            <HeartPulseIcon className="h-6 w-6 text-[var(--highlight-pink)]" />
          </span>
          <span className="text-xl font-semibold tracking-tight text-white">CareCrypt</span>
        </div>
        
        {/* Illustration Area (Fallback for 3D) */}
        <div className="relative z-10 flex-1 flex items-center justify-center py-12">
          <div className="relative w-64 h-64 lg:w-80 lg:h-80 flex items-center justify-center group">
            {/* Orbital Rings */}
            <div className="absolute inset-0 rounded-full border border-white/10 animate-[spin_20s_linear_infinite]" />
            <div className="absolute inset-4 rounded-full border border-[var(--highlight-pink)]/20 animate-[spin_15s_linear_infinite_reverse]" />
            <div className="absolute inset-12 rounded-full border border-white/5 animate-[spin_10s_linear_infinite]" />
            
            {/* Connected Nodes */}
            <div className="absolute top-0 left-1/2 w-2 h-2 -ml-1 rounded-full bg-[var(--blush-pink)] shadow-[0_0_10px_var(--highlight-pink)]" />
            <div className="absolute bottom-1/4 right-4 w-1.5 h-1.5 rounded-full bg-white/60" />
            
            {/* Glass-like 3D Shield Fallback */}
            <div className="relative z-20 w-32 h-40 lg:w-40 lg:h-52 bg-white/5 backdrop-blur-xl rounded-2xl border border-white/20 shadow-[0_8px_32px_rgba(0,0,0,0.5)] flex items-center justify-center overflow-hidden transition-transform duration-1000 group-hover:scale-105">
              {/* Shield Highlight */}
              <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-white/50 to-transparent pointer-events-none" />
              <div className="absolute top-0 left-0 right-0 h-1/2 bg-gradient-to-b from-white/20 to-transparent pointer-events-none" />
              <ShieldCheckIcon className="w-16 h-16 lg:w-20 lg:h-20 text-[var(--highlight-pink)] opacity-90 drop-shadow-[0_0_15px_rgba(251,227,234,0.5)]" />
            </div>

            {/* Floating QR Tile */}
            <div className="absolute -bottom-4 -left-8 w-20 h-20 bg-white/80 backdrop-blur shadow-xl rounded-xl border border-[var(--soft-border)] p-2 animate-[bounce_4s_ease-in-out_infinite] flex items-center justify-center">
               <div className="w-full h-full bg-[var(--deep-slate)] rounded-sm" style={{ backgroundImage: 'linear-gradient(45deg, transparent 45%, var(--pure-white) 45%, var(--pure-white) 55%, transparent 55%)', backgroundSize: '4px 4px' }} />
            </div>

            {/* Floating Abstract Medical Card */}
            <div className="absolute -top-6 -right-10 w-24 h-16 bg-white/90 backdrop-blur shadow-xl rounded-lg border border-[var(--soft-border)] p-3 animate-[bounce_5s_ease-in-out_infinite_reverse] flex flex-col gap-1.5">
               <div className="w-3/4 h-1.5 bg-[var(--steel-blue)] rounded-full opacity-60" />
               <div className="w-1/2 h-1.5 bg-[var(--muted-blue-gray)] rounded-full opacity-40" />
               <div className="mt-auto w-full h-1 bg-[var(--blush-pink)] rounded-full opacity-50" />
            </div>
          </div>
        </div>

        <div className="relative z-10 pb-8 lg:pb-0">
          <h2 className="max-w-md text-3xl font-semibold leading-tight tracking-tight text-white mb-6">
            You decide who sees your health record.
          </h2>
          <div className="flex flex-wrap gap-3">
            {['Consent-based access', 'Private analytics', 'Tamper-evident audit'].map(chip => (
              <span key={chip} className="px-3 py-1.5 bg-white/10 backdrop-blur-sm border border-white/10 rounded-full text-sm font-medium text-white shadow-sm">
                {chip}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Right Sign-in Panel (38%) */}
      <main className="relative lg:w-[38%] flex flex-col items-center justify-center px-6 py-10 lg:-ml-12 lg:rounded-l-[40px] bg-[var(--soft-pink-white)] shadow-[-20px_0_40px_rgba(0,0,0,0.15)] z-20">
        <div className="w-full max-w-sm">
          
          <div className="mb-6 rounded-md bg-[var(--highlight-pink)] px-4 py-2 text-center text-xs font-medium text-[var(--deep-slate)] border border-[var(--blush-pink)]/30">
            Demo environment: all data is synthetic. Do not enter real health information.
          </div>

          {/* Secure Access Card Form */}
          <div className="overflow-hidden rounded-2xl border border-[var(--soft-border)] bg-white shadow-[0_10px_40px_rgba(0,0,0,0.05)]">
            
            <div className="bg-[var(--steel-blue)] p-5 relative overflow-hidden">
               <div 
                className="absolute inset-0 opacity-10 pointer-events-none" 
                style={{ backgroundImage: 'radial-gradient(circle, var(--pure-white) 1px, transparent 1px)', backgroundSize: '12px 12px' }}
               />
               <div className="relative z-10 flex items-center justify-between">
                 <div>
                   <h3 className="text-white font-semibold text-lg">CareCrypt</h3>
                   <p className="text-[var(--highlight-pink)] text-xs font-medium uppercase tracking-wider mt-0.5">Secure access card</p>
                 </div>
                 {/* Decorative QR-style graphic */}
                 <div className="w-10 h-10 bg-white/20 rounded-md p-1.5 border border-white/10 grid grid-cols-3 gap-0.5 opacity-80">
                   {[...Array(9)].map((_,i) => <div key={i} className={`w-full h-full ${i%2===0 ? 'bg-white' : 'bg-transparent'} rounded-[1px]`} />)}
                 </div>
               </div>
            </div>

            <div className="p-6">
              <h1 className="text-2xl font-bold tracking-tight text-[var(--deep-slate)]">Sign in</h1>
              <p className="mt-1 text-sm text-[var(--muted-blue-gray)] mb-6">Enter your credentials to access the secure portal.</p>

              <form onSubmit={onSubmit} className="space-y-4">
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-[var(--deep-slate)] mb-1">
                    Email
                  </label>
                  <input
                    id="email"
                    type="email"
                    autoComplete="username"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-lg border border-[var(--soft-border)] px-3 py-2 focus:border-[var(--steel-blue)] focus:outline-none focus:ring-1 focus:ring-[var(--steel-blue)] transition-colors"
                  />
                </div>
                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-[var(--deep-slate)] mb-1">
                    Password
                  </label>
                  <div className="relative">
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full rounded-lg border border-[var(--soft-border)] px-3 py-2 pr-16 focus:border-[var(--steel-blue)] focus:outline-none focus:ring-1 focus:ring-[var(--steel-blue)] transition-colors"
                    />
                    <button 
                      type="button" 
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-[var(--muted-blue-gray)] hover:text-[var(--deep-slate)]"
                    >
                      {showPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>
                
                {error && <Alert tone="danger">{error}</Alert>}
                
                <button 
                  type="submit" 
                  disabled={submitting} 
                  className="w-full mt-2 rounded-lg bg-[var(--steel-blue)] px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-[var(--shadow-blue)]/20 hover:bg-[var(--deep-slate)] focus:outline-none focus:ring-2 focus:ring-[var(--steel-blue)] focus:ring-offset-2 transition-all disabled:opacity-70"
                >
                  {submitting ? 'Signing in…' : 'Sign in'}
                </button>
              </form>
              
              <div className="mt-5 text-center text-xs text-[var(--muted-blue-gray)]">
                Protected by CareCrypt Security
              </div>
            </div>
          </div>

          <div className="mt-6 flex flex-col items-center justify-center space-y-4">
            <div className="text-sm text-[var(--muted-blue-gray)]">
              Don't have an account? <Link to="/register" className="font-semibold text-[var(--steel-blue)] hover:text-[var(--blush-pink)] transition-colors">Create an account</Link>
            </div>
            
            <p className="flex items-center gap-2 text-xs text-[var(--muted-blue-gray)]">
              <span
                className={`h-2 w-2 rounded-full ${server === 'ok' ? 'bg-green-500' : server === 'down' ? 'bg-red-500' : 'bg-slate-300'}`}
                aria-hidden="true"
              />
              Server {server === 'ok' ? 'online' : server === 'down' ? 'unreachable' : 'checking…'}
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}
