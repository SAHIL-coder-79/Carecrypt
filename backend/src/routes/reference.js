import { Router } from 'express'
import { query } from '../db/pool.js'
import { authenticateToken } from '../middleware/authenticate.js'
import { requireRole } from '../middleware/requireRole.js'

const router = Router()

// Reference catalogues used by the visit form. Contains no patient data.
router.get('/', authenticateToken(), requireRole('CLINICIAN', { resource: 'REFERENCE_DATA' }), async (req, res) => {
  const [symptoms, conditions, medications] = await Promise.all([
    query('SELECT code, display_name AS name, category FROM ref.symptoms ORDER BY category, display_name'),
    query('SELECT code, name, category, is_chronic AS "isChronic" FROM ref.conditions ORDER BY category, name'),
    query('SELECT code, generic_name AS name, drug_class AS "drugClass" FROM ref.medications ORDER BY generic_name'),
  ])
  res.set('Cache-Control', 'private, max-age=300')
  res.json({ symptoms: symptoms.rows, conditions: conditions.rows, medications: medications.rows })
})

export default router
