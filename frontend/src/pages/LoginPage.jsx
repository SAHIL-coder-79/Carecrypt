import { useEffect, useRef, useState, useMemo } from 'react'
import { Navigate, useLocation, useNavigate, Link } from 'react-router'
import * as THREE from 'three'
import { useAuth } from '../auth/context.js'
import { getHealth } from '../lib/api.js'
import './login.css'

const MESSAGES = {
  401: 'Invalid email or password.',
  423: 'This account is temporarily locked after too many failed attempts. Try again later.',
  429: 'Too many sign-in attempts from this device. Try again later.',
  403: 'This account has been disabled.',
}

function ThreeScene() {
  const containerRef = useRef(null)
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const host = containerRef.current
    if (!canvas || !host) return

    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    const small = matchMedia('(max-width:860px)').matches

    let renderer
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: !small, alpha: true, powerPreference: 'low-power' })
    } catch (err) {
      host.classList.add('nogl')
      return
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75))
    renderer.outputEncoding = THREE.sRGBEncoding

    const scene = new THREE.Scene()
    const cam = new THREE.PerspectiveCamera(38, 1, 0.1, 50)
    cam.position.set(0, 0, 8)

    const BLUSH = 0xE6A7B8, PALE = 0xF4C8D4, STEEL = 0x34495E, STEEL_L = 0x4f6b88, SHADOW = 0x233747, SOFT = 0xFFF4F6
    const disposables = []
    const keep = (o) => { disposables.push(o); return o; }

    scene.add(new THREE.AmbientLight(0xfff1f4, 0.6))
    const key = new THREE.DirectionalLight(0xffffff, 1.1)
    key.position.set(3, 4, 6)
    scene.add(key)
    const rim = new THREE.PointLight(PALE, 1.4, 16)
    rim.position.set(-4, -1, 3)
    scene.add(rim)

    const root = new THREE.Group()
    scene.add(root)

    const sh = new THREE.Shape()
    sh.moveTo(0, 1.3)
    sh.bezierCurveTo(0.35, 1.15, 0.8, 1.05, 1.05, 1.05)
    sh.lineTo(1.05, 0.1)
    sh.bezierCurveTo(1.05, -0.6, 0.6, -1.1, 0, -1.4)
    sh.bezierCurveTo(-0.6, -1.1, -1.05, -0.6, -1.05, 0.1)
    sh.lineTo(-1.05, 1.05)
    sh.bezierCurveTo(-0.8, 1.05, -0.35, 1.15, 0, 1.3)
    
    const shG = keep(new THREE.ExtrudeGeometry(sh, { depth: 0.22, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.07, bevelSegments: 3, curveSegments: 14 }))
    shG.center()
    const shM = keep(new THREE.MeshPhysicalMaterial({ color: STEEL_L, transparent: true, opacity: 0.62, roughness: 0.15, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.1, side: THREE.DoubleSide }))
    const shield = new THREE.Mesh(shG, shM)
    shield.scale.setScalar(1.25)
    root.add(shield)
    shield.add(new THREE.LineSegments(
      keep(new THREE.EdgesGeometry(shG, 40)),
      keep(new THREE.LineBasicMaterial({ color: BLUSH, transparent: true, opacity: 0.6 }))
    ))

    const hp = []
    for (let i = 0; i < 64; i++) {
      const t = (i / 64) * Math.PI * 2
      hp.push(new THREE.Vector3(
        16 * Math.pow(Math.sin(t), 3) * 0.032,
        (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) * 0.032 + 0.08, 0
      ))
    }
    const glow = keep(new THREE.MeshStandardMaterial({ color: PALE, emissive: BLUSH, emissiveIntensity: 0.45, roughness: 0.3 }))
    const heart = new THREE.Mesh(keep(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(hp, true), 120, 0.028, 8, true)), glow)
    heart.position.z = 0.52
    root.add(heart)

    const pc = new THREE.CatmullRomCurve3(
      [[-0.75, -0.02], [-0.38, -0.02], [-0.24, -0.02], [-0.13, 0.36], [0.02, -0.42], [0.15, 0.2], [0.25, -0.02], [0.75, -0.02]]
        .map(a => new THREE.Vector3(a[0], a[1] + 0.05, 0)), false, 'catmullrom', 0.2)
    const pulse = new THREE.Mesh(keep(new THREE.TubeGeometry(pc, 90, 0.03, 8)), glow)
    pulse.position.z = 0.58
    root.add(pulse)

    function roundRect(w, h, r) {
      const s = new THREE.Shape(), x = -w / 2, y = -h / 2
      s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r)
      s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
      s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r)
      s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y)
      return s
    }
    const bevel = { depth: 0.06, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2, curveSegments: 6 }

    const card = new THREE.Group()
    card.add(new THREE.Mesh(keep(new THREE.ExtrudeGeometry(roundRect(1.7, 1.15, 0.12), bevel)), keep(new THREE.MeshStandardMaterial({ color: SOFT, roughness: 0.45 }))))
    const barMat = keep(new THREE.MeshStandardMaterial({ color: 0xcdd5df, roughness: 0.6 }))
    const steelMat = keep(new THREE.MeshStandardMaterial({ color: STEEL, roughness: 0.5 }))
    
    [[1.0, 0.2], [0.8, 0], [0.9, -0.2]].forEach(b => {
      const bar = new THREE.Mesh(keep(new THREE.BoxGeometry(b[0], 0.07, 0.02)), barMat)
      bar.position.set(0.18 - (1 - b[0]) * 0.5, b[1], 0.1)
      card.add(bar)
    })
    
    const avatar = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.14, 0.14, 0.03, 24)), steelMat)
    avatar.rotation.x = Math.PI / 2
    avatar.position.set(-0.55, 0.22, 0.1)
    card.add(avatar)
    const tag = new THREE.Mesh(keep(new THREE.BoxGeometry(0.45, 0.09, 0.02)), keep(new THREE.MeshStandardMaterial({ color: BLUSH, emissive: BLUSH, emissiveIntensity: 0.2 })))
    tag.position.set(0.45, -0.43, 0.1)
    card.add(tag)
    card.position.set(-2.55, -1.15, 0.9)
    card.rotation.set(-0.08, 0.45, 0.1)
    root.add(card)

    const qr = new THREE.Group()
    qr.add(new THREE.Mesh(keep(new THREE.ExtrudeGeometry(roundRect(1.05, 1.05, 0.1), bevel)), keep(new THREE.MeshStandardMaterial({ color: SHADOW, roughness: 0.4, metalness: 0.2 }))))
    const pat = ['1110011', '1010101', '1110110', '0001011', '1101001', '0110111', '1011101']
    const qrMat = keep(new THREE.MeshStandardMaterial({ color: PALE, emissive: BLUSH, emissiveIntensity: 0.25 }))
    const modules = new THREE.InstancedMesh(keep(new THREE.BoxGeometry(0.1, 0.1, 0.04)), qrMat, 49)
    let n = 0
    const dummy = new THREE.Object3D()
    pat.forEach((row, y) => {
      row.split('').forEach((c, x) => {
        if (c === '1') {
          dummy.position.set((x - 3) * 0.125, (3 - y) * 0.125, 0.09)
          dummy.updateMatrix()
          modules.setMatrixAt(n++, dummy.matrix)
        }
      })
    })
    modules.count = n
    qr.add(modules)
    qr.position.set(2.55, 1.2, 0.7)
    qr.rotation.set(0.1, -0.5, -0.12)
    root.add(qr)

    const rings = []
    ;[{ r: 2.7, rx: 1.25, rz: 0.35, sp: 0.18, n: 3 }, { r: 3.25, rx: 0.95, rz: -0.7, sp: -0.12, n: 2 }].forEach(o => {
      const g = new THREE.Group()
      g.rotation.set(o.rx, 0, o.rz)
      g.add(new THREE.Mesh(keep(new THREE.TorusGeometry(o.r, 0.012, 6, 140)), keep(new THREE.MeshBasicMaterial({ color: BLUSH, transparent: true, opacity: 0.4 }))))
      const pivots = []
      for (let i = 0; i < o.n; i++) {
        const pv = new THREE.Object3D()
        pv.rotation.z = i / o.n * Math.PI * 2 + 0.6
        const node = new THREE.Mesh(keep(new THREE.SphereGeometry(0.07, 12, 12)), keep(new THREE.MeshBasicMaterial({ color: SOFT })))
        node.position.x = o.r
        pv.add(node)
        g.add(pv)
        pivots.push(pv)
      }
      root.add(g)
      rings.push({ pivots, sp: o.sp })
    })

    const PN = small ? 50 : 110
    const pp = new Float32Array(PN * 3)
    for (let i = 0; i < PN; i++) {
      const a = Math.random() * 6.283
      const b = Math.acos(2 * Math.random() - 1)
      const r = 3 + Math.random() * 3
      pp[i * 3] = r * Math.sin(b) * Math.cos(a) * 1.3
      pp[i * 3 + 1] = r * Math.sin(b) * Math.sin(a) * 0.8
      pp[i * 3 + 2] = r * Math.cos(b) - 1
    }
    const pg = keep(new THREE.BufferGeometry())
    pg.setAttribute('position', new THREE.BufferAttribute(pp, 3))
    const pts = new THREE.Points(pg, keep(new THREE.PointsMaterial({ color: PALE, size: 0.045, transparent: true, opacity: 0.5, sizeAttenuation: true, depthWrite: false })))
    scene.add(pts)

    function size() {
      const w = host.clientWidth, h = host.clientHeight
      if (!w || !h) return
      renderer.setSize(w, h, false)
      cam.aspect = w / h
      cam.position.z = (w / h < 1.1) ? 10.5 : (small ? 9 : 8)
      cam.updateProjectionMatrix()
      if (reduce) draw(0)
    }

    let ro = new ResizeObserver(size)
    ro.observe(host)

    let px = 0, py = 0, tx = 0, ty = 0, raf = 0, running = false
    const clock = new THREE.Clock()
    let io = null

    function onMove(e) {
      const r = host.getBoundingClientRect()
      tx = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width - 0.5) * 2))
      ty = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height - 0.5) * 2))
    }

    function draw(t) {
      px += (tx - px) * 0.05
      py += (ty - py) * 0.05
      root.position.y = Math.sin(t * 0.6) * 0.07
      shield.rotation.y = Math.sin(t * 0.35) * 0.22 + px * 0.28
      shield.rotation.x = -py * 0.14
      heart.rotation.y = pulse.rotation.y = shield.rotation.y * 0.9
      heart.rotation.x = pulse.rotation.x = shield.rotation.x
      glow.emissiveIntensity = 0.45 + Math.sin(t * 2.2) * 0.1
      card.position.x = -2.55 + px * 0.25
      card.position.y = -1.15 + Math.sin(t * 0.7 + 1) * 0.06 - py * 0.12
      qr.position.x = 2.55 - px * 0.2
      qr.position.y = 1.2 + Math.sin(t * 0.8) * 0.06 + py * 0.1
      rings.forEach(o => { o.pivots.forEach(p => { p.rotation.z += o.sp * 0.01 * (reduce ? 0 : 1) }) })
      pts.rotation.y = t * 0.01 + px * 0.04
      renderer.render(scene, cam)
    }

    function loop() {
      raf = requestAnimationFrame(loop)
      draw(clock.getElapsedTime())
    }

    function start() {
      if (running || reduce) return
      running = true
      clock.start()
      loop()
    }

    function stop() {
      running = false
      cancelAnimationFrame(raf)
    }

    if (!reduce) {
      window.addEventListener('pointermove', onMove, { passive: true })
      io = new IntersectionObserver(en => { (en[0].isIntersecting && !document.hidden) ? start() : stop() })
      io.observe(host)
      document.addEventListener('visibilitychange', () => { document.hidden ? stop() : start() })
    }

    size()
    draw(0)
    start()

    return () => {
      stop()
      ro.disconnect()
      if (io) io.disconnect()
      window.removeEventListener('pointermove', onMove)
      disposables.forEach(o => { o.dispose && o.dispose() })
      renderer.dispose()
    }
  }, [])

  return (
    <div className="scene" aria-hidden="true" ref={containerRef}>
      <svg className="nodes" width="150" height="110" viewBox="0 0 150 110" fill="none" stroke="#E6A7B8" strokeWidth="1">
        <path d="M10 80L50 40L90 60L140 15M50 40L60 95M90 60L130 90"/>
        <g fill="#E6A7B8">
          <circle cx="10" cy="80" r="3"/><circle cx="50" cy="40" r="3.5"/><circle cx="90" cy="60" r="3"/>
          <circle cx="140" cy="15" r="3"/><circle cx="60" cy="95" r="2.5"/><circle cx="130" cy="90" r="2.5"/>
        </g>
      </svg>
      <svg className="ecg" viewBox="0 0 800 60" preserveAspectRatio="none" height="50" fill="none">
        <path d="M0 32H260l12-22 18 46 16-34 10 10H800" stroke="#E6A7B8" strokeWidth="1.4" vectorEffect="non-scaling-stroke"/>
      </svg>
      <canvas id="gl" ref={canvasRef}></canvas>
      <div className="fallback">
        <svg width="200" height="230" viewBox="0 0 24 28" fill="none" stroke="#E6A7B8" strokeWidth="0.6">
          <path d="M12 2l9 3v8c0 6-5 10-9 12-4-2-9-6-9-12V5z" fill="rgba(230,167,184,.12)"/>
          <path d="M6 13h3l1.5-3 3 6 1.5-3h3"/>
        </svg>
      </div>
    </div>
  )
}

function QRGraphic() {
  const pathData = useMemo(() => {
    const P = ['1110011', '1010101', '1110110', '0001011', '1101001', '0110111', '1011101']
    let d = ''
    P.forEach((row, y) => {
      row.split('').forEach((c, x) => {
        if (c === '1') d += `M${x + 1} ${y + 1}h1v1h-1z`
      })
    })
    return d
  }, [])

  return (
    <svg className="qrs" viewBox="0 0 9 9" width="64" height="64">
      <rect width="9" height="9" rx="1.2" fill="#fff" />
      <path fill="#233747" d={pathData} />
    </svg>
  )
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

    // Simple shape check matching the prototype
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setError('Enter a valid email, like name@example.com.')
      setSubmitting(false)
      return
    }
    if (!password) {
      setError('Enter your password.')
      setSubmitting(false)
      return
    }

    try {
      await login(email, password)
      navigate(location.state?.from ?? '/', { replace: true })
    } catch (err) {
      setError(MESSAGES[err.status] ?? err.message)
      setSubmitting(false)
    }
  }

  return (
    <div className="login-page">
      <section className="stage" aria-label="CareCrypt">
        <div className="logo">
          <i>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 21s-8-5-8-11a4.5 4.5 0 0 1 8-2.5A4.5 4.5 0 0 1 20 10c0 6-8 11-8 11z"/>
              <path d="M6 12h3l1.5-3 3 6 1.5-3h3"/>
            </svg>
          </i>
          CareCrypt
        </div>

        <ThreeScene />

        <div className="copy">
          <h1>You decide who sees your health record.</h1>
          <ul className="chips">
            <li>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="8" cy="15" r="4"/><path d="M11 12l8-8M16 7l2 2"/>
              </svg>
              Consent-based access
            </li>
            <li>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z"/>
              </svg>
              Private analytics
            </li>
            <li>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M6 3h9l3 3v15H6zM9 12h6M9 16h6"/>
              </svg>
              Tamper-evident audit
            </li>
          </ul>
        </div>
      </section>

      <main className="panel">
        <div className="blob" aria-hidden="true"></div>
        <div className="inner">
          <div className="note" role="note">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" style={{ flex: 'none', mt: '1px' }}>
              <circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>
            </svg>
            <span>Demo environment: all data is synthetic. Do not enter real health information.</span>
          </div>

          <div className="card">
            <div className="ch" aria-hidden="true">
              <span className="slot"></span>
              <div>
                <div className="cn">CareCrypt</div>
                <div className="ct">Secure access card</div>
              </div>
              <QRGraphic />
            </div>

            <div className="cb">
              <h2>Sign in</h2>
              <p className="sub">Use the email and password for your CareCrypt account.</p>

              <form onSubmit={onSubmit} noValidate>
                <div className="f">
                  <label htmlFor="email">Email</label>
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    inputMode="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    aria-invalid={error && error.includes('email') ? 'true' : 'false'}
                  />
                  {error && error.includes('email') && <p className="err">{error}</p>}
                </div>

                <div className="f">
                  <label htmlFor="password">Password</label>
                  <div className="in">
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      aria-invalid={error && !error.includes('email') ? 'true' : 'false'}
                    />
                    <button
                      type="button"
                      className="eye"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      aria-pressed={showPassword}
                    >
                      {showPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  {error && !error.includes('email') && <p className="err">{error}</p>}
                </div>

                <button className="go" type="submit" disabled={submitting}>
                  {submitting ? 'Signing in...' : 'Sign in'}
                </button>
                <p className="priv">Your records stay private. Only clinicians you consent to can open them.</p>
                <div className="status" role="status" hidden={server === 'checking'}>
                  Server {server === 'ok' ? 'online' : server === 'down' ? 'unreachable' : 'checking...'}
                </div>
              </form>
            </div>
          </div>

          <p className="alt">New to CareCrypt? <Link to="/register">Create an account</Link></p>
        </div>
      </main>
    </div>
  )
}
