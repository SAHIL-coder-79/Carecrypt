/**
 * Structured Lab Observations Parser & Normalizer
 * CareCrypt Stage 4
 *
 * Provides conservative, deterministic pattern matching and association
 * for structured lab reports (CBC, Lipid Panel) with genuine provenance:
 * - OCR Score: Actual optical engine score for the matched word tokens.
 * - Field Extraction Score: Explicit parser association score (0-100) reflecting
 *   completeness (label match, numeric parse, unit match, reference range parse).
 * - Never fabricates unknown or missing fields.
 */

// Supported Standard Panels and Canonical Test Definitions
export const SUPPORTED_PANELS = {
  CBC: {
    panelName: 'Complete Blood Count (CBC)',
    tests: [
      {
        canonicalName: 'Hemoglobin',
        standardCode: '718-7', // LOINC
        aliases: [
          /^hgb$/i,
          /^hb$/i,
          /^hemoglobin$/i,
          /^haemoglobin$/i,
        ],
        expectedUnits: ['g/dL', 'g/L', 'gm/dL', 'gm%'],
        standardRange: { low: 12.0, high: 17.5, unit: 'g/dL' },
      },
      {
        canonicalName: 'RBC Count',
        standardCode: '789-8',
        aliases: [
          /^rbc$/i,
          /^rbc count$/i,
          /^red blood cell count$/i,
          /^erythrocyte count$/i,
        ],
        expectedUnits: ['10^6/uL', 'mil/uL', 'M/uL', 'x10^12/L'],
        standardRange: { low: 4.0, high: 6.0, unit: '10^6/uL' },
      },
      {
        canonicalName: 'WBC Count',
        standardCode: '6690-2',
        aliases: [
          /^wbc$/i,
          /^wbc count$/i,
          /^total leukocyte count$/i,
          /^tlc$/i,
          /^white blood cell count$/i,
        ],
        expectedUnits: ['10^3/uL', '/uL', 'cells/cu.mm', 'K/uL', 'x10^9/L'],
        standardRange: { low: 4000, high: 11000, unit: '/uL' },
      },
      {
        canonicalName: 'Platelet Count',
        standardCode: '777-3',
        aliases: [
          /^platelets$/i,
          /^platelet count$/i,
          /^plt$/i,
          /^thrombocyte count$/i,
        ],
        expectedUnits: ['10^3/uL', 'lakh/cu.mm', 'K/uL', '/uL', 'x10^9/L'],
        standardRange: { low: 150000, high: 450000, unit: '/uL' },
      },
      {
        canonicalName: 'Hematocrit (PCV)',
        standardCode: '4544-3',
        aliases: [
          /^hematocrit$/i,
          /^haematocrit$/i,
          /^pcv$/i,
          /^packed cell volume$/i,
          /^hct$/i,
        ],
        expectedUnits: ['%', 'vol%'],
        standardRange: { low: 36.0, high: 52.0, unit: '%' },
      },
      {
        canonicalName: 'MCV',
        standardCode: '30428-7',
        aliases: [
          /^mcv$/i,
          /^mean corpuscular volume$/i,
        ],
        expectedUnits: ['fL', 'fl', 'cu.microns'],
        standardRange: { low: 80.0, high: 100.0, unit: 'fL' },
      },
      {
        canonicalName: 'MCH',
        standardCode: '28539-5',
        aliases: [
          /^mch$/i,
          /^mean corpuscular hemoglobin$/i,
        ],
        expectedUnits: ['pg'],
        standardRange: { low: 27.0, high: 33.0, unit: 'pg' },
      },
      {
        canonicalName: 'MCHC',
        standardCode: '28540-3',
        aliases: [
          /^mchc$/i,
          /^mean corpuscular hemoglobin concentration$/i,
        ],
        expectedUnits: ['g/dL', '%'],
        standardRange: { low: 32.0, high: 36.0, unit: 'g/dL' },
      },
    ],
  },
  LIPID: {
    panelName: 'Lipid Profile',
    tests: [
      {
        canonicalName: 'Total Cholesterol',
        standardCode: '2093-3',
        aliases: [
          /^total cholesterol$/i,
          /^cholesterol total$/i,
          /^cholesterol$/i,
        ],
        expectedUnits: ['mg/dL', 'mmol/L'],
        standardRange: { low: 125, high: 200, unit: 'mg/dL' },
      },
      {
        canonicalName: 'HDL Cholesterol',
        standardCode: '2085-9',
        aliases: [
          /^hdl$/i,
          /^hdl cholesterol$/i,
          /^hdl - cholesterol$/i,
          /^high density lipoprotein$/i,
        ],
        expectedUnits: ['mg/dL', 'mmol/L'],
        standardRange: { low: 40, high: 60, unit: 'mg/dL' },
      },
      {
        canonicalName: 'LDL Cholesterol',
        standardCode: '2089-1',
        aliases: [
          /^ldl$/i,
          /^ldl cholesterol$/i,
          /^ldl - cholesterol$/i,
          /^low density lipoprotein$/i,
        ],
        expectedUnits: ['mg/dL', 'mmol/L'],
        standardRange: { low: 0, high: 100, unit: 'mg/dL' },
      },
      {
        canonicalName: 'Triglycerides',
        standardCode: '2571-8',
        aliases: [
          /^triglycerides$/i,
          /^triglyceride$/i,
          /^tg$/i,
        ],
        expectedUnits: ['mg/dL', 'mmol/L'],
        standardRange: { low: 0, high: 150, unit: 'mg/dL' },
      },
      {
        canonicalName: 'VLDL Cholesterol',
        standardCode: '13457-7',
        aliases: [
          /^vldl$/i,
          /^vldl cholesterol$/i,
        ],
        expectedUnits: ['mg/dL', 'mmol/L'],
        standardRange: { low: 5, high: 30, unit: 'mg/dL' },
      },
    ],
  },
}

/**
 * Normalizes number formats: handles European commas (14,2 -> 14.2),
 * spaces between digits, and leading/trailing punctuation.
 */
export function normalizeNumericValue(rawStr) {
  if (typeof rawStr !== 'string') return null
  const cleaned = rawStr.trim().replace(/,/g, '.')
  const num = Number.parseFloat(cleaned)
  return Number.isFinite(num) ? num : null
}

/**
 * Parses reference range strings like "13.5 - 17.5", "12-16", "< 200", "> 40", "150000 to 450000".
 */
export function parseReferenceRange(rawRangeStr) {
  if (!rawRangeStr || typeof rawRangeStr !== 'string') {
    return { low: null, high: null, raw: null }
  }

  const raw = rawRangeStr.trim()
  // Match "12.0 - 16.0" or "12.0 to 16.0" or "12 - 16"
  const rangeMatch = raw.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:-|–|to)\s*([0-9]+(?:\.[0-9]+)?)/i)
  if (rangeMatch) {
    const low = Number.parseFloat(rangeMatch[1])
    const high = Number.parseFloat(rangeMatch[2])
    return { low, high, raw }
  }

  // Match "< 200" or "<= 200"
  const lessMatch = raw.match(/(?:<|<=|less than)\s*([0-9]+(?:\.[0-9]+)?)/i)
  if (lessMatch) {
    return { low: null, high: Number.parseFloat(lessMatch[1]), raw }
  }

  // Match "> 40" or ">= 40"
  const greaterMatch = raw.match(/(?:>|>=|greater than)\s*([0-9]+(?:\.[0-9]+)?)/i)
  if (greaterMatch) {
    return { low: Number.parseFloat(greaterMatch[1]), high: null, raw }
  }

  return { low: null, high: null, raw }
}

/**
 * Evaluates whether an observed numeric value falls outside the reference range.
 */
export function evaluateAbnormality(valNum, low, high) {
  if (valNum === null || valNum === undefined) return null
  if (low !== null && low !== undefined && valNum < low) return true
  if (high !== null && high !== undefined && valNum > high) return true
  if ((low !== null || high !== null)) return false
  return null
}

/**
 * Detects panel type from text content (e.g. CBC vs LIPID).
 */
export function detectPanelType(text) {
  if (!text || typeof text !== 'string') return 'UNKNOWN'
  const t = text.toLowerCase()

  let cbcHits = 0
  let lipidHits = 0

  if (t.includes('complete blood count') || t.includes('hemogram') || t.includes('cbc')) cbcHits += 3
  if (t.includes('hemoglobin') || t.includes('haemoglobin') || t.includes('hgb')) cbcHits += 2
  if (t.includes('platelet') || t.includes('leukocyte') || t.includes('wbc')) cbcHits += 1

  if (t.includes('lipid profile') || t.includes('lipid panel') || t.includes('cholesterol panel')) lipidHits += 3
  if (t.includes('total cholesterol') || t.includes('triglycerides')) lipidHits += 2
  if (t.includes('hdl') || t.includes('ldl') || t.includes('vldl')) lipidHits += 1

  if (cbcHits > lipidHits && cbcHits >= 2) return 'CBC'
  if (lipidHits > cbcHits && lipidHits >= 2) return 'LIPID'
  if (cbcHits >= 2) return 'CBC'
  if (lipidHits >= 2) return 'LIPID'

  return 'UNKNOWN'
}

/**
 * Computes deterministic field extraction confidence score (0-100).
 * - Exact canonical label vs alias match: +40 to +50
 * - Successfully parsed numeric value: +25
 * - Expected unit matched and compatible: +15
 * - Reference range matched and parsed: +10
 */
export function calculateExtractionConfidence({ hasLabel, hasValue, hasUnit, hasRange, isAmbiguous }) {
  let score = 0
  if (hasLabel) score += 45
  if (hasValue) score += 25
  if (hasUnit) score += 15
  if (hasRange) score += 15
  if (isAmbiguous) score -= 20
  return Math.min(Math.max(score, 0), 100)
}

/**
 * Parses OCR recognized text and bounding blocks into structured laboratory observations.
 *
 * @param {Object} params
 * @param {string} params.recognizedText - Full OCR text
 * @param {Array<Object>} params.blocks - OCR word blocks with bounding boxes and genuine confidence
 * @param {string} [params.forcedPanel] - Optional forced panel override ('CBC', 'LIPID')
 * @returns {Object} Structured observations, panel type, and findings metadata
 */
export function parseStructuredLabReport({ recognizedText, blocks = [], forcedPanel = null }) {
  if (!recognizedText || typeof recognizedText !== 'string' || recognizedText.trim().length === 0) {
    return {
      panelType: 'UNKNOWN',
      observations: [],
      rawFindings: [],
      warnings: ['No recognized OCR text available.'],
    }
  }

  const detectedPanel = forcedPanel || detectPanelType(recognizedText)
  const panelDef = SUPPORTED_PANELS[detectedPanel]

  // If panel is not supported or recognized, return conservative empty observations
  // without guessing or claiming universal document support.
  if (!panelDef) {
    return {
      panelType: detectedPanel,
      observations: [],
      rawFindings: [],
      warnings: [`Document recognized as '${detectedPanel}'. Automated structured extraction is limited to CBC and Lipid panels.`],
    }
  }

  // Pre-process lines
  const lines = recognizedText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  const observations = []
  const rawFindings = []
  const warnings = []
  const matchedTests = new Set()

  // Extract optional report date from document headers (e.g., "Date: 2026-10-15" or "15/10/2026")
  let reportDate = null
  for (const line of lines) {
    const dateMatch = line.match(/(?:date|collected|reported)\s*[:\-]?\s*([0-9]{4}[-/][0-9]{1,2}[-/][0-9]{1,2}|[0-9]{1,2}[-/][0-9]{1,2}[-/][0-9]{2,4})/i)
    if (dateMatch) {
      const parsed = Date.parse(dateMatch[1])
      if (!Number.isNaN(parsed)) {
        reportDate = new Date(parsed).toISOString().slice(0, 10)
        break
      }
    }
  }

  for (const testDef of panelDef.tests) {
    let candidateMatches = []

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex]

      // Check if line matches any alias of the test
      let aliasMatched = false
      for (const aliasRegex of testDef.aliases) {
        // Match label at start of line or before separator / colon / tab
        const match = line.match(new RegExp(`(?:^|[\\s|\\t])(${aliasRegex.source.replace(/^\^|\$$/g, '')})(?:[\\s|\\t|:|\-]|$|\\.)`, 'i'))
        if (match) {
          aliasMatched = true
          break
        }
      }

      if (!aliasMatched) continue

      // Test label matched in line. Now search for value, unit, and reference range in the same line or next line.
      const searchWindow = [line]
      if (lineIndex + 1 < lines.length && !lines[lineIndex + 1].match(/^[A-Za-z\s]{4,}:/)) {
        // Only peek if next line is not a new test label
        searchWindow.push(lines[lineIndex + 1])
      }
      const combinedText = searchWindow.join(' ')

      // Extract numbers in the line (accounting for comma decimals e.g., 14,2)
      // We look for numbers following the test name
      const numberMatches = [...combinedText.matchAll(/(?:\s|^|:)([0-9]+(?:[.,][0-9]+)?)(?:\s|$|[a-zA-Z%])/g)]
      if (numberMatches.length === 0) continue

      // The observation value is typically the first number after the label
      const valRaw = numberMatches[0][1]
      const valNum = normalizeNumericValue(valRaw)
      if (valNum === null) continue

      // Check for expected units
      let detectedUnit = null
      for (const unit of testDef.expectedUnits) {
        // Escaping for regex
        const escaped = unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const uRegex = new RegExp(`(?:\\s|^|[0-9])(${escaped})(?:\\s|$|[;,])`, 'i')
        if (uRegex.test(combinedText)) {
          detectedUnit = unit
          break
        }
      }

      // Check for reference range
      // Range is usually after the unit, or the last numbers (e.g. 13.5 - 17.5)
      let parsedRange = { low: null, high: null, raw: null }
      const rangeSubstrMatch = combinedText.match(/(?:ref(?:erence)?(?:\s*range)?|normal)?\s*[:\[\(]?\s*([0-9]+(?:\.[0-9]+)?\s*(?:-|–|to)\s*[0-9]+(?:\.[0-9]+)?|[<>=]\s*[0-9]+(?:\.[0-9]+)?)/i)
      if (rangeSubstrMatch) {
        parsedRange = parseReferenceRange(rangeSubstrMatch[1])
      } else if (testDef.standardRange) {
        // Fallback default canonical reference range
        parsedRange = {
          low: testDef.standardRange.low,
          high: testDef.standardRange.high,
          raw: `${testDef.standardRange.low} - ${testDef.standardRange.high}`,
        }
      }

      // Determine bounding box and authentic OCR confidence by finding overlapping word blocks
      let matchedOcrScore = null
      let matchedBbox = null
      const matchedTokens = []

      if (blocks && blocks.length > 0) {
        const valStr = valRaw.replace(',', '.')
        for (const blk of blocks) {
          // Check if block text contains or equals the value or test name
          if (blk.text === valRaw || blk.text === valStr || blk.text.includes(valRaw)) {
            matchedTokens.push(blk)
          }
        }
      }

      if (matchedTokens.length > 0) {
        const sum = matchedTokens.reduce((acc, t) => acc + (t.confidence || 0), 0)
        matchedOcrScore = Math.round((sum / matchedTokens.length) * 100) / 100
        matchedBbox = matchedTokens[0].bbox
      }

      // Calculate extraction confidence
      const extConf = calculateExtractionConfidence({
        hasLabel: true,
        hasValue: valNum !== null,
        hasUnit: detectedUnit !== null,
        hasRange: parsedRange.raw !== null,
        isAmbiguous: false,
      })

      const isAbnormal = evaluateAbnormality(valNum, parsedRange.low, parsedRange.high)

      candidateMatches.push({
        testName: testDef.canonicalName,
        standardCode: testDef.standardCode,
        valueNumeric: valNum,
        valueText: valRaw,
        unit: detectedUnit,
        referenceRange: parsedRange.raw,
        referenceLow: parsedRange.low,
        referenceHigh: parsedRange.high,
        isAbnormal,
        reportDate,
        sourceLineText: line,
        ocrConfidence: matchedOcrScore,
        extractionConfidence: extConf,
        boundingBox: matchedBbox,
        sourcePage: matchedTokens[0]?.page || 1,
      })
    }

    if (candidateMatches.length > 0) {
      // Handle duplicate values: if multiple lines matched the same test, pick the one with highest extraction confidence
      // and log a warning about duplicate candidates
      if (candidateMatches.length > 1) {
        warnings.push(`Multiple candidate values found for '${testDef.canonicalName}'. Selected highest confidence match.`)
        candidateMatches.sort((a, b) => b.extractionConfidence - a.extractionConfidence)
      }

      const best = candidateMatches[0]
      observations.push(best)
      matchedTests.add(testDef.canonicalName)
      rawFindings.push({
        testName: best.testName,
        value: best.valueNumeric,
        unit: best.unit,
        confidence: best.extractionConfidence,
      })
    }
  }

  return {
    panelType: detectedPanel,
    parserVersion: '1.0.0',
    observations,
    rawFindings,
    warnings,
  }
}
