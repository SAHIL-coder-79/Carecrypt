import { Router } from 'express'
import { authenticateToken } from '../middleware/authenticate.js'
import { requireRole } from '../middleware/requireRole.js'

// Endpoints that exist only to demonstrate that role checks run on the server.
// Each one returns no data beyond the caller's own role.
const router = Router()

const PROTECTED = [
  { path: '/clinician-only', role: 'CLINICIAN', resource: 'CLINICIAN_ONLY' },
  { path: '/admin-only', role: 'ADMIN', resource: 'ADMIN_ONLY' },
  { path: '/security-only', role: 'SECURITY_ADMIN', resource: 'SECURITY_ONLY' },
]

for (const { path, role, resource } of PROTECTED) {
  router.get(path, authenticateToken(), requireRole(role, { resource }), (req, res) => {
    res.set('Cache-Control', 'no-store')
    res.json({ access: 'GRANTED', role: req.user.role, resource })
  })
}

export default router
