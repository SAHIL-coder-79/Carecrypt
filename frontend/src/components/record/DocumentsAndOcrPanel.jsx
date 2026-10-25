import { useState, useEffect } from 'react'
import { useAuth } from '../../auth/context.js'
import { Card, Badge, Button, EmptyState, Alert } from '../ui.jsx'
import { FileTextIcon, SparkIcon, CheckCircleIcon, EditIcon, AlertTriangleIcon, InfoIcon } from '../icons.jsx'
import { formatDate, formatDateTime, titleCase } from '../../lib/format.js'

export function DocumentsAndOcrPanel({ patientId, accessScope }) {
  const { request, user } = useAuth()
  const [documents, setDocuments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedDocId, setSelectedDocId] = useState(null)
  const [ocrData, setOcrData] = useState(null)
  const [ocrLoading, setOcrLoading] = useState(false)
  const [ocrProcessing, setOcrProcessing] = useState(false)
  const [ocrError, setOcrError] = useState(null)

  // Observations state
  const [observations, setObservations] = useState([])
  const [obsLoading, setObsLoading] = useState(false)
  const [actionInProgressId, setActionInProgressId] = useState(null)

  // Correction Modal State
  const [editingObs, setEditingObs] = useState(null)
  const [editForm, setEditForm] = useState({
    correctedValue: '',
    correctedUnit: '',
    correctedReferenceRange: '',
    note: '',
  })
  const [editSubmitting, setEditSubmitting] = useState(false)
  const [editError, setEditError] = useState(null)

  const canViewDocuments = accessScope === 'FULL_RECORD' || accessScope === 'VISIT_HISTORY' || accessScope === undefined
  const canVerify = user?.role === 'CLINICIAN' && (accessScope === 'FULL_RECORD' || accessScope === undefined)

  const fetchObservations = (docId) => {
    if (!docId) return
    setObsLoading(true)
    request(`/api/patients/${encodeURIComponent(patientId)}/lab-observations?documentId=${docId}`)
      .then((data) => {
        setObservations(data.observations || [])
        setObsLoading(false)
      })
      .catch(() => {
        setObservations([])
        setObsLoading(false)
      })
  }

  useEffect(() => {
    if (!canViewDocuments) {
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    request(`/api/patients/${encodeURIComponent(patientId)}/documents`)
      .then((data) => {
        if (!cancelled) {
          setDocuments(data.documents || [])
          if (data.documents && data.documents.length > 0) {
            setSelectedDocId(data.documents[0].id)
          }
          setLoading(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message || 'Failed to load documents')
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [patientId, canViewDocuments, request])

  useEffect(() => {
    if (!selectedDocId) {
      setOcrData(null)
      setObservations([])
      return
    }

    let cancelled = false
    setOcrLoading(true)
    setOcrError(null)

    request(`/api/patients/${encodeURIComponent(patientId)}/documents/${selectedDocId}/ocr`)
      .then((data) => {
        if (!cancelled) {
          setOcrData(data.ocrRun)
          setOcrLoading(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          if (err.status === 404 || err.message?.includes('404')) {
            setOcrData(null)
          } else {
            setOcrError(err.message || 'Failed to fetch OCR details')
          }
          setOcrLoading(false)
        }
      })

    fetchObservations(selectedDocId)

    return () => {
      cancelled = true
    }
  }, [patientId, selectedDocId, request])

  const handleRunOcr = async (docId) => {
    setOcrProcessing(true)
    setOcrError(null)
    try {
      const res = await request(
        `/api/patients/${encodeURIComponent(patientId)}/documents/${docId}/process-ocr`,
        { method: 'POST' },
      )
      setOcrData(res.ocrRun)
      fetchObservations(docId)
    } catch (err) {
      setOcrError(err.message || 'OCR processing failed.')
    } finally {
      setOcrProcessing(false)
    }
  }

  const handleVerifyObservation = async (obs, newStatus) => {
    setActionInProgressId(obs.id)
    try {
      await request(
        `/api/patients/${encodeURIComponent(patientId)}/lab-observations/${obs.id}/verification`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            status: newStatus,
            expectedVersion: obs.version,
          }),
        },
      )
      fetchObservations(selectedDocId)
    } catch (err) {
      alert(`Verification update failed: ${err.message}`)
    } finally {
      setActionInProgressId(null)
    }
  }

  const openCorrectionModal = (obs) => {
    setEditingObs(obs)
    setEditForm({
      correctedValue: obs.valueNumeric !== null ? String(obs.valueNumeric) : (obs.valueText || ''),
      correctedUnit: obs.unit || '',
      correctedReferenceRange: obs.referenceRange || '',
      note: obs.verificationNote || '',
    })
    setEditError(null)
  }

  const handleSaveCorrection = async (e) => {
    e.preventDefault()
    if (!editingObs) return
    setEditSubmitting(true)
    setEditError(null)

    try {
      await request(
        `/api/patients/${encodeURIComponent(patientId)}/lab-observations/${editingObs.id}/verification`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            status: 'CORRECTED',
            correctedValue: editForm.correctedValue,
            correctedUnit: editForm.correctedUnit,
            correctedReferenceRange: editForm.correctedReferenceRange,
            note: editForm.note,
            expectedVersion: editingObs.version,
          }),
        },
      )
      setEditingObs(null)
      fetchObservations(selectedDocId)
    } catch (err) {
      setEditError(err.message || 'Correction failed.')
    } finally {
      setEditSubmitting(false)
    }
  }

  if (!canViewDocuments) {
    return (
      <Card title="Laboratory Reports & Medical Documents">
        <EmptyState>
          Medical documents, OCR data, and structured observations require at least <strong>Visit History</strong> consent. Under your current scope, document contents are withheld.
        </EmptyState>
      </Card>
    )
  }

  if (loading) {
    return (
      <Card title="Laboratory Reports & Medical Documents">
        <div className="py-6 text-center text-sm text-slate-500">Loading documents…</div>
      </Card>
    )
  }

  if (error) {
    return (
      <Card title="Laboratory Reports & Medical Documents">
        <Alert tone="danger">{error}</Alert>
      </Card>
    )
  }

  if (documents.length === 0) {
    return (
      <Card title="Laboratory Reports & Medical Documents">
        <EmptyState>No medical documents or laboratory reports uploaded for this patient yet.</EmptyState>
      </Card>
    )
  }

  const selectedDoc = documents.find((d) => d.id === selectedDocId) || documents[0]

  return (
    <div className="space-y-6">
      <Card title="Laboratory Reports & Medical Documents">
        <div className="grid gap-6 lg:grid-cols-12">
          {/* Document List */}
          <div className="lg:col-span-4 border-r border-slate-100 pr-0 lg:pr-4 space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Available Reports</h4>
            <div className="space-y-1.5 max-h-[500px] overflow-y-auto">
              {documents.map((doc) => {
                const isSelected = doc.id === selectedDoc.id
                return (
                  <button
                    key={doc.id}
                    type="button"
                    onClick={() => setSelectedDocId(doc.id)}
                    className={`w-full text-left p-3 rounded-lg border transition ${
                      isSelected
                        ? 'border-teal-500 bg-teal-50/50 shadow-xs'
                        : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase text-slate-500">{doc.documentType.replace('_', ' ')}</span>
                      <span className="text-[11px] text-slate-400">{formatDate(doc.createdAt)}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 font-medium text-sm text-slate-900 truncate">
                      <FileTextIcon className="h-4 w-4 shrink-0 text-slate-400" />
                      <span className="truncate">{doc.originalFileName}</span>
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {(doc.fileSizeBytes / 1024).toFixed(1)} KB · {doc.mimeType}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Document & OCR Inspection Workspace */}
          <div className="lg:col-span-8 space-y-4">
            {selectedDoc && (
              <>
                {/* Header & Actions */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                  <div>
                    <h3 className="font-semibold text-slate-900 text-base flex items-center gap-2">
                      {selectedDoc.originalFileName}
                      <Badge tone={selectedDoc.documentType === 'LAB_REPORT' ? 'teal' : 'neutral'}>
                        {titleCase(selectedDoc.documentType)}
                      </Badge>
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Uploaded on {formatDateTime(selectedDoc.createdAt)} · SHA-256: <code className="font-mono text-[11px]">{selectedDoc.sha256Checksum.slice(0, 12)}…</code>
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <a
                      href={`/api/patients/${encodeURIComponent(patientId)}/documents/${selectedDoc.id}/file?disposition=inline`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-xs hover:bg-slate-50"
                    >
                      View Original Document
                    </a>
                    <Button
                      size="sm"
                      onClick={() => handleRunOcr(selectedDoc.id)}
                      disabled={ocrProcessing}
                    >
                      <SparkIcon className="h-3.5 w-3.5" />
                      {ocrProcessing ? 'Processing OCR…' : ocrData ? 'Re-run OCR & Extract' : 'Extract OCR & Observations'}
                    </Button>
                  </div>
                </div>

                {ocrError && <Alert tone="danger">{ocrError}</Alert>}

                {/* Side-by-side: Source Document Preview & OCR Text */}
                <div className="grid gap-4 md:grid-cols-2">
                  {/* Source Document Preview */}
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                      <span className="text-xs font-semibold uppercase text-slate-600">Source Document Preview</span>
                      <span className="text-xs text-slate-500">{selectedDoc.mimeType}</span>
                    </div>
                    <div className="mt-3 flex items-center justify-center min-h-[280px] max-h-[420px] overflow-hidden bg-white rounded border border-slate-200">
                      {selectedDoc.mimeType.startsWith('image/') ? (
                        <img
                          src={`/api/patients/${encodeURIComponent(patientId)}/documents/${selectedDoc.id}/file?disposition=inline`}
                          alt="Source Document Preview"
                          className="max-h-[400px] object-contain w-auto mx-auto"
                        />
                      ) : selectedDoc.mimeType === 'application/pdf' ? (
                        <iframe
                          src={`/api/patients/${encodeURIComponent(patientId)}/documents/${selectedDoc.id}/file?disposition=inline`}
                          title="PDF Preview"
                          className="w-full h-[400px] border-none"
                        />
                      ) : (
                        <div className="p-6 text-center text-xs text-slate-500">
                          Preview not directly embeddable for {selectedDoc.mimeType}. Use View Original Document above.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* OCR Recognition & Scores */}
                  <div className="rounded-lg border border-slate-200 bg-white p-3 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                        <span className="text-xs font-semibold uppercase text-slate-600">Extracted OCR Text</span>
                        {ocrData && (
                          <div className="flex items-center gap-1.5">
                            {ocrData.confidenceScore !== null ? (
                              <Badge tone={ocrData.confidenceScore >= 70 ? 'green' : ocrData.confidenceScore >= 40 ? 'amber' : 'red'}>
                                OCR Confidence: {ocrData.confidenceScore}%
                              </Badge>
                            ) : (
                              <Badge tone="neutral">No Legible Text</Badge>
                            )}
                          </div>
                        )}
                      </div>

                      {ocrLoading ? (
                        <div className="py-20 text-center text-xs text-slate-400">Loading OCR details…</div>
                      ) : ocrData ? (
                        <div className="mt-3 space-y-3">
                          {/* Provenance Box */}
                          <div className="rounded bg-slate-50 p-2 text-xs space-y-1 border border-slate-200">
                            <div className="flex justify-between">
                              <span className="text-slate-500">Engine:</span>
                              <span className="font-medium text-slate-800">{ocrData.engineName} v{ocrData.engineVersion}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-500">Processed At:</span>
                              <span className="text-slate-700">{formatDateTime(ocrData.processedAt)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-slate-500">Pages Processed:</span>
                              <span className="text-slate-700">{ocrData.pageCount} page(s)</span>
                            </div>
                          </div>

                          {/* Recognized Text Display */}
                          <div>
                            <div className="rounded border border-slate-200 bg-slate-50 p-2.5 font-mono text-xs text-slate-800 whitespace-pre-wrap max-h-[180px] overflow-y-auto leading-relaxed">
                              {ocrData.recognizedText || 'No text recognized.'}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="py-20 text-center space-y-3">
                          <p className="text-xs text-slate-500">
                            OCR text has not been extracted for this report yet.
                          </p>
                          <Button size="sm" onClick={() => handleRunOcr(selectedDoc.id)} disabled={ocrProcessing}>
                            <SparkIcon className="h-3.5 w-3.5" />
                            {ocrProcessing ? 'Processing OCR…' : 'Extract OCR & Observations'}
                          </Button>
                        </div>
                      )}
                    </div>

                    <div className="mt-4 pt-2 border-t border-slate-100 text-[11px] text-slate-400">
                      OCR confidence represents optical engine clarity. It is not clinical truth.
                    </div>
                  </div>
                </div>

                {/* Structured Laboratory Observations Table */}
                <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
                    <div>
                      <h4 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                        Structured Laboratory Observations
                        <Badge tone="teal">{observations.length} Extracted</Badge>
                      </h4>
                      <p className="text-xs text-slate-500">
                        Extracted values require authorized clinician attestation before diagnostic or treatment reliance.
                      </p>
                    </div>
                    {!canVerify && user?.role === 'PATIENT' && (
                      <div className="text-xs text-amber-800 bg-amber-50 px-2.5 py-1 rounded border border-amber-200 flex items-center gap-1.5">
                        <InfoIcon className="h-3.5 w-3.5" />
                        Patient view: Unverified observations are preliminary. Consult your doctor for attested results.
                      </div>
                    )}
                  </div>

                  {obsLoading ? (
                    <div className="py-8 text-center text-xs text-slate-400">Loading structured observations…</div>
                  ) : observations.length === 0 ? (
                    <div className="py-8 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded">
                      No structured test values parsed yet. Click <strong>Extract OCR & Observations</strong> to run the parser.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-medium">
                            <th className="py-2 px-3">Test Name (LOINC)</th>
                            <th className="py-2 px-3">Observed / Corrected Value</th>
                            <th className="py-2 px-3">Reference Range</th>
                            <th className="py-2 px-3">Extraction Conf.</th>
                            <th className="py-2 px-3">OCR Score</th>
                            <th className="py-2 px-3">Status</th>
                            {canVerify && <th className="py-2 px-3 text-right">Clinician Actions</th>}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {observations.map((obs) => {
                            const isCorrected = obs.isCorrected || obs.verificationStatus === 'CORRECTED'
                            const originalVal = obs.originalValueNumeric !== null && obs.originalValueNumeric !== undefined 
                              ? `${obs.originalValueNumeric} ${obs.originalUnit || ''}` 
                              : (obs.originalValueText ? `${obs.originalValueText} ${obs.originalUnit || ''}` : null)
                            
                            return (
                              <tr key={obs.id} className="hover:bg-slate-50/50">
                                <td className="py-2.5 px-3">
                                  <div className="font-medium text-slate-900">{obs.testName}</div>
                                  {obs.standardCode && (
                                    <div className="font-mono text-[10px] text-slate-400">LOINC: {obs.standardCode}</div>
                                  )}
                                  {obs.sourceLineText && (
                                    <div className="text-[10px] text-slate-400 truncate max-w-xs mt-0.5" title={obs.sourceLineText}>
                                      Src: &quot;{obs.sourceLineText}&quot; {obs.sourcePage ? `(p.${obs.sourcePage})` : ''}
                                    </div>
                                  )}
                                </td>
                                <td className="py-2.5 px-3">
                                  <div>
                                    <span className={`font-semibold ${obs.isAbnormal ? 'text-red-700' : 'text-slate-900'}`}>
                                      {obs.valueNumeric !== null ? obs.valueNumeric : obs.valueText} {obs.unit || ''}
                                    </span>
                                    {obs.isAbnormal && (
                                      <span className="ml-1.5 inline-flex items-center px-1 py-0.2 rounded text-[10px] font-semibold bg-red-100 text-red-800">
                                        Abnormal
                                      </span>
                                    )}
                                  </div>
                                  {isCorrected && originalVal && (
                                    <div className="mt-0.5 text-[10px] text-slate-400">
                                      <span className="line-through text-slate-400">OCR: {originalVal}</span>
                                      <span className="ml-1 text-teal-700 font-medium">(Clinician Corrected)</span>
                                    </div>
                                  )}
                                </td>
                                <td className="py-2.5 px-3 text-slate-600">
                                  <div>{obs.referenceRange || 'Unknown'} {obs.unit || ''}</div>
                                  {isCorrected && obs.originalReferenceRange && obs.originalReferenceRange !== obs.referenceRange && (
                                    <div className="text-[10px] text-slate-400 line-through">
                                      Orig: {obs.originalReferenceRange}
                                    </div>
                                  )}
                                </td>
                                <td className="py-2.5 px-3">
                                  <Badge tone={obs.extractionConfidence >= 80 ? 'green' : obs.extractionConfidence >= 50 ? 'amber' : 'red'}>
                                    {obs.extractionConfidence}%
                                  </Badge>
                                </td>
                                <td className="py-2.5 px-3">
                                  {obs.ocrConfidence !== null ? (
                                    <span className="text-slate-600 font-mono text-[11px]">{obs.ocrConfidence}%</span>
                                  ) : (
                                    <span className="text-slate-400 italic text-[11px]">N/A</span>
                                  )}
                                </td>
                                <td className="py-2.5 px-3">
                                  <div className="space-y-0.5">
                                    <Badge
                                      tone={
                                        obs.verificationStatus === 'VERIFIED'
                                          ? 'green'
                                          : obs.verificationStatus === 'CORRECTED'
                                          ? 'teal'
                                          : obs.verificationStatus === 'REJECTED'
                                          ? 'red'
                                          : 'neutral'
                                      }
                                    >
                                      {titleCase(obs.verificationStatus)}
                                    </Badge>
                                    {obs.verificationNote && (
                                      <p className="text-[10px] text-slate-500 italic max-w-[140px] truncate" title={obs.verificationNote}>
                                        &quot;{obs.verificationNote}&quot;
                                      </p>
                                    )}
                                  </div>
                                </td>
                                {canVerify && (
                                  <td className="py-2.5 px-3 text-right">
                                    <div className="flex items-center justify-end gap-1.5">
                                      {obs.verificationStatus !== 'VERIFIED' && (
                                        <button
                                          type="button"
                                          disabled={actionInProgressId === obs.id}
                                          onClick={() => handleVerifyObservation(obs, 'VERIFIED')}
                                          className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 transition"
                                          title="Verify as extracted"
                                        >
                                          <CheckCircleIcon className="h-3 w-3" />
                                          Verify
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        disabled={actionInProgressId === obs.id}
                                        onClick={() => openCorrectionModal(obs)}
                                        className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium bg-teal-50 text-teal-700 hover:bg-teal-100 border border-teal-200 transition"
                                        title="Correct value or reference range"
                                      >
                                        <EditIcon className="h-3 w-3" />
                                        Correct
                                      </button>
                                      {obs.verificationStatus !== 'REJECTED' && (
                                        <button
                                          type="button"
                                          disabled={actionInProgressId === obs.id}
                                          onClick={() => handleVerifyObservation(obs, 'REJECTED')}
                                          className="px-2 py-1 rounded text-[11px] font-medium text-slate-500 hover:text-red-700 hover:bg-red-50 transition border border-transparent hover:border-red-200"
                                          title="Reject observation"
                                        >
                                          Reject
                                        </button>
                                      )}
                                    </div>
                                  </td>
                                )}
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </Card>

      {/* Clinician Correction & Attestation Modal */}
      {editingObs && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Correct & Attest Observation</h3>
                <p className="text-xs text-slate-500 mt-0.5">{editingObs.testName} (LOINC: {editingObs.standardCode || 'N/A'})</p>
              </div>
              <button
                type="button"
                onClick={() => setEditingObs(null)}
                className="text-slate-400 hover:text-slate-600 text-lg"
              >
                ✕
              </button>
            </div>

            {editError && <Alert tone="danger">{editError}</Alert>}

            {/* Original OCR values context */}
            <div className="rounded-lg bg-slate-50 p-3 border border-slate-200 text-xs space-y-1">
              <div className="font-medium text-slate-700 uppercase tracking-wider text-[10px]">Original Extraction Provenance</div>
              <div className="flex justify-between text-slate-600">
                <span>Original Value:</span>
                <span className="font-mono font-medium">{editingObs.originalValueNumeric ?? editingObs.originalValueText} {editingObs.originalUnit || ''}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Original Range:</span>
                <span className="font-mono">{editingObs.originalReferenceRange || 'N/A'}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Source Line:</span>
                <span className="italic truncate max-w-[200px]">{editingObs.sourceLineText || 'N/A'}</span>
              </div>
            </div>

            <form onSubmit={handleSaveCorrection} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Corrected Value *
                </label>
                <input
                  type="text"
                  required
                  value={editForm.correctedValue}
                  onChange={(e) => setEditForm({ ...editForm, correctedValue: e.target.value })}
                  placeholder="e.g. 14.2"
                  className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium focus:border-teal-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Unit
                  </label>
                  <input
                    type="text"
                    value={editForm.correctedUnit}
                    onChange={(e) => setEditForm({ ...editForm, correctedUnit: e.target.value })}
                    placeholder="e.g. g/dL"
                    className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-teal-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Reference Range
                  </label>
                  <input
                    type="text"
                    value={editForm.correctedReferenceRange}
                    onChange={(e) => setEditForm({ ...editForm, correctedReferenceRange: e.target.value })}
                    placeholder="e.g. 13.0 - 17.5"
                    className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-teal-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Clinical Attestation Note / Justification
                </label>
                <textarea
                  rows={2}
                  value={editForm.note}
                  onChange={(e) => setEditForm({ ...editForm, note: e.target.value })}
                  placeholder="e.g. Corrected decimal point misread by OCR (142 -> 14.2 g/dL)."
                  className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs focus:border-teal-500 focus:outline-none"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
                <Button variant="secondary" size="sm" onClick={() => setEditingObs(null)}>
                  Cancel
                </Button>
                <Button size="sm" type="submit" disabled={editSubmitting}>
                  {editSubmitting ? 'Attesting…' : 'Save & Attest'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
