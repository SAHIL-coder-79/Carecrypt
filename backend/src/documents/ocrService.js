import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createWorker } from 'tesseract.js'
import { HttpError } from '../lib/httpError.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PYTHON_PDF_HELPER = path.join(__dirname, 'pdfToImages.py')

export const OCR_ENGINE = Object.freeze({
  name: 'Tesseract.js OCR (LSTM)',
  version: '7.0.0',
})

// Safe execution limits
const MAX_PAGES = 10
const PROCESS_TIMEOUT_MS = 60000 // 60s hard timeout

/**
 * Converts a PDF buffer into rendered PNG buffers using isolated Python pypdfium2 helper.
 */
export async function renderPdfPages(pdfBuffer, maxPages = MAX_PAGES) {
  return new Promise((resolve, reject) => {
    const py = spawn('python', [PYTHON_PDF_HELPER], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let timer = setTimeout(() => {
      py.kill('SIGKILL')
      reject(new HttpError(504, 'TIMEOUT', 'PDF page rendering timed out.'))
    }, PROCESS_TIMEOUT_MS)

    py.stdout.on('data', (chunk) => (stdout += chunk))
    py.stderr.on('data', (chunk) => (stderr += chunk))

    py.on('error', (err) => {
      clearTimeout(timer)
      reject(new HttpError(500, 'RENDER_ERROR', `Failed to start PDF renderer: ${err.message}`))
    })

    py.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        return reject(
          new HttpError(500, 'RENDER_ERROR', `PDF render process exited with code ${code}: ${stderr}`),
        )
      }

      try {
        const result = JSON.parse(stdout)
        if (!result.success) {
          return reject(
            new HttpError(400, 'MALFORMED_PDF', result.error || 'Failed to render PDF pages.'),
          )
        }

        const pages = result.pages.map((p) => ({
          page: p.page,
          width: p.width,
          height: p.height,
          pngBuffer: Buffer.from(p.png_base64, 'hex'),
        }))
        resolve({
          totalPages: result.totalPages,
          processedPages: result.processedPages,
          pages,
        })
      } catch (parseErr) {
        reject(new HttpError(500, 'PARSE_ERROR', `Failed to parse render output: ${parseErr.message}`))
      }
    })

    // Write hex string to avoid binary pipe encoding corruption
    py.stdin.write(pdfBuffer.toString('hex'))
    py.stdin.end()
  })
}

/**
 * Parses TSV string produced by Tesseract to extract blocks, lines, words,
 * bounding boxes, and genuine recognition confidence scores.
 */
function parseTsvBlocks(tsv) {
  if (!tsv || typeof tsv !== 'string') return []

  const lines = tsv.trim().split('\n')
  const blocks = []

  // Skip header: level, page_num, block_num, par_num, line_num, word_num, left, top, width, height, conf, text
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split('\t')
    if (parts.length < 12) continue

    const level = Number.parseInt(parts[0], 10)
    const left = Number.parseInt(parts[6], 10)
    const top = Number.parseInt(parts[7], 10)
    const width = Number.parseInt(parts[8], 10)
    const height = Number.parseInt(parts[9], 10)
    const conf = Number.parseFloat(parts[10])
    const text = parts.slice(11).join('\t').trim()

    // Level 5 corresponds to recognized words
    if (level === 5 && text.length > 0) {
      blocks.push({
        text,
        confidence: conf >= 0 ? conf : 0,
        bbox: { x: left, y: top, width, height },
      })
    }
  }

  return blocks
}

/**
 * Core OCR execution pipeline for images and PDFs.
 * Computes actual word-level and page-level engine recognition confidences.
 * 
 * @param {Object} options
 * @param {Buffer} options.fileBuffer - Raw file binary
 * @param {string} options.mimeType - File MIME type
 * @returns {Promise<Object>} Recognized text, authentic confidence, and word blocks
 */
export async function processDocumentOcr({ fileBuffer, mimeType }) {
  const startTime = Date.now()

  // 1. Prepare image buffers to process
  let imagePages = []
  if (mimeType === 'application/pdf') {
    const rendered = await renderPdfPages(fileBuffer)
    imagePages = rendered.pages
  } else {
    // Single image (PNG, JPEG, WebP)
    imagePages = [{ page: 1, pngBuffer: fileBuffer }]
  }

  if (imagePages.length === 0) {
    throw new HttpError(400, 'EMPTY_DOCUMENT', 'Document contains no renderable pages.')
  }

  // 2. Initialize OCR Worker
  let worker
  try {
    worker = await createWorker('eng')
  } catch (err) {
    throw new HttpError(500, 'OCR_WORKER_ERROR', `Failed to initialize OCR worker: ${err.message}`)
  }

  try {
    const fullTextParts = []
    const allBlocks = []
    let totalConfidenceSum = 0
    let totalWordCount = 0

    for (const page of imagePages) {
      const ret = await worker.recognize(
        page.pngBuffer,
        {},
        { text: true, tsv: true }
      )

      const pageText = (ret.data.text || '').trim()
      if (pageText.length > 0) {
        fullTextParts.push(pageText)
      }

      const pageWords = parseTsvBlocks(ret.data.tsv)
      for (const w of pageWords) {
        allBlocks.push({
          page: page.page,
          text: w.text,
          confidence: w.confidence, // Authentic 0-100 float
          bbox: w.bbox,
        })
        totalConfidenceSum += w.confidence
        totalWordCount++
      }
    }

    // Authentic confidence: mean word recognition probability across recognized words.
    // If no words recognized, confidence is null (never fabricated).
    const averageConfidence =
      totalWordCount > 0
        ? Math.round((totalConfidenceSum / totalWordCount) * 100) / 100
        : null

    const processingMs = Date.now() - startTime

    return {
      engineName: OCR_ENGINE.name,
      engineVersion: OCR_ENGINE.version,
      status: 'READY',
      pageCount: imagePages.length,
      recognizedText: fullTextParts.join('\n\n'),
      confidenceScore: averageConfidence,
      blocks: allBlocks,
      processingMs,
    }
  } finally {
    if (worker) {
      await worker.terminate().catch(() => {})
    }
  }
}
