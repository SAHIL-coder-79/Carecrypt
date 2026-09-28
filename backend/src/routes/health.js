import { Router } from 'express'

const router = Router()

router.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'carecrypt-backend' })
})

export default router
