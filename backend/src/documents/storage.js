import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { env } from '../config/env.js'
import { HttpError, badRequest } from '../lib/httpError.js'

// Supported MIME types and their validated signatures
export const SUPPORTED_MIME_TYPES = Object.freeze({
  'application/pdf': { ext: '.pdf', label: 'PDF Document', safeInline: true },
  'image/jpeg': { ext: '.jpg', label: 'JPEG Image', safeInline: true },
  'image/png': { ext: '.png', label: 'PNG Image', safeInline: true },
  'image/webp': { ext: '.webp', label: 'WebP Image', safeInline: true },
  'text/plain': { ext: '.txt', label: 'Plain Text', safeInline: false },
})

export const ALLOWED_DOCUMENT_TYPES = new Set([
  'LAB_REPORT',
  'PRESCRIPTION',
  'XRAY',
  'ECG',
  'CT_SCAN',
  'MRI',
  'DISCHARGE_SUMMARY',
  'OTHER',
])

/**
 * Validates the file buffer magic bytes against expected MIME signatures.
 * Rejects executables, scripts, and spoofed extensions.
 */
export function detectMimeType(buffer) {
  if (!buffer || buffer.length < 4) {
    return null
  }

  // PDF: %PDF- (hex: 25 50 44 46)
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return 'application/pdf'
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png'
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg'
  }

  // WebP: RIFF .... WEBP
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp'
  }

  // Plain text (UTF-8 clean validation without binary control chars except CR/LF/TAB)
  if (isSafeText(buffer)) {
    return 'text/plain'
  }

  return null
}

function isSafeText(buffer) {
  // Check first 1KB
  const len = Math.min(buffer.length, 1024)
  for (let i = 0; i < len; i++) {
    const byte = buffer[i]
    // Null byte or control chars (except tab 9, LF 10, CR 13) indicate binary data
    if (byte === 0 || (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13)) {
      return false
    }
  }
  return true
}

/**
 * Ensures the private storage root directory exists.
 */
export async function ensureStorageDir() {
  await fsp.mkdir(env.storageDirectory, { recursive: true })
}

/**
 * Resolves a storage key to an absolute path within env.storageDirectory.
 * Strictly prevents path traversal attacks.
 */
export function resolveStoragePath(storageKey) {
  if (!storageKey || typeof storageKey !== 'string') {
    throw new HttpError(400, 'BAD_REQUEST', 'Invalid storage key.')
  }

  // Reject directory traversal sequences immediately
  if (storageKey.includes('..') || path.isAbsolute(storageKey)) {
    throw new HttpError(400, 'BAD_REQUEST', 'Path traversal attempt detected.')
  }

  const normalized = path.normalize(storageKey)
  const absolutePath = path.resolve(env.storageDirectory, normalized)

  // Verify that the resolved path is strictly inside the storage directory
  if (!absolutePath.startsWith(path.resolve(env.storageDirectory) + path.sep)) {
    throw new HttpError(400, 'BAD_REQUEST', 'Path traversal attempt detected.')
  }

  return absolutePath
}

/**
 * Writes file buffer to private storage with a unique server-side storage key.
 * Returns { storageKey, sha256Checksum, sizeBytes }.
 */
export async function writeDocumentFile({ patientId, buffer, mimeType }) {
  await ensureStorageDir()

  const sha256Checksum = crypto.createHash('sha256').update(buffer).digest('hex')
  const ext = SUPPORTED_MIME_TYPES[mimeType]?.ext || '.bin'
  const fileId = crypto.randomUUID()
  // Store partitioned by patientId subdirectories for filesystem hygiene
  const subDir = path.join(env.storageDirectory, patientId)
  await fsp.mkdir(subDir, { recursive: true })

  const storageKey = path.join(patientId, `${fileId}${ext}`).replace(/\\/g, '/')
  const filePath = path.join(subDir, `${fileId}${ext}`)

  await fsp.writeFile(filePath, buffer, { flag: 'wx' })

  return {
    storageKey,
    sha256Checksum,
    sizeBytes: buffer.length,
  }
}

/**
 * Reads file buffer from private storage and verifies SHA-256 integrity.
 * If checksum mismatch is detected, throws 500 INTEGRITY_ERROR.
 */
export async function readDocumentFile(storageKey, expectedSha256) {
  const filePath = resolveStoragePath(storageKey)

  try {
    const buffer = await fsp.readFile(filePath)
    const actualSha256 = crypto.createHash('sha256').update(buffer).digest('hex')

    if (expectedSha256 && actualSha256 !== expectedSha256) {
      throw new HttpError(
        500,
        'INTEGRITY_ERROR',
        'Document integrity verification failed: checksum mismatch.',
      )
    }

    return buffer
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new HttpError(404, 'NOT_FOUND', 'Stored document file not found.')
    }
    throw err
  }
}

/**
 * Deletes a stored document file if it exists.
 */
export async function deleteDocumentFile(storageKey) {
  try {
    const filePath = resolveStoragePath(storageKey)
    await fsp.unlink(filePath)
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`Failed to delete document file ${storageKey}:`, err.message)
    }
  }
}
