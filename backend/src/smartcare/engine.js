import { createRequire } from 'node:module'

// SmartCare Assist lives in /smartcare as a CommonJS package (copied engines).
// It runs in-process: it is JavaScript, so no separate service is needed.
const require = createRequire(import.meta.url)
const smartcare = require('../../../smartcare/index.js')

export const { assess, label, ENGINE } = smartcare
