import { useState } from 'react'
import { DownloadIcon, FileTextIcon } from '../icons.jsx'
import { Button } from '../ui.jsx'

/**
 * DownloadReportButton fetches and downloads the consolidated longitudinal health report PDF.
 * Uses authenticated fetch with token and sets appropriate loading/error feedback.
 */
export function DownloadReportButton({ patientId, className = '', variant = 'secondary', size = 'sm' }) {
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState(null)

  async function handleDownload() {
    setDownloading(true)
    setError(null)
    try {
      const rawSession = sessionStorage.getItem('carecrypt.session.v1')
      const token = rawSession ? JSON.parse(rawSession).token : null

      const res = await fetch(`/api/patients/${encodeURIComponent(patientId)}/consolidated-report`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })

      if (!res.ok) {
        const errorData = await res.json().catch(() => null)
        throw new Error(errorData?.message || `Failed to download report (HTTP ${res.status})`)
      }

      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `carecrypt_report_${patientId.slice(0, 8)}_${new Date().toISOString().slice(0, 10)}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Report download error:', err)
      setError(err.message)
      setTimeout(() => setError(null), 5000)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="inline-flex flex-col items-end">
      <Button
        variant={variant}
        size={size}
        className={className}
        onClick={handleDownload}
        disabled={downloading}
      >
        {downloading ? (
          <>
            <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent mr-1" />
            Generating PDF…
          </>
        ) : (
          <>
            <DownloadIcon className="h-4 w-4 mr-1" />
            Export Health Report (PDF)
          </>
        )}
      </Button>
      {error && <span className="mt-1 text-xs text-red-600">{error}</span>}
    </div>
  )
}
