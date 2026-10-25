import { useState, useEffect } from 'react'
import { useAuth } from '../../auth/context.js'
import { Card, Badge, EmptyState, Alert, Button } from '../ui.jsx'
import { AlertTriangleIcon, CheckCircleIcon, SparkIcon, InfoIcon, FileTextIcon, TrendIcon } from '../icons.jsx'
import { formatDate, formatDateTime, titleCase } from '../../lib/format.js'

export function ReportAnalyzerPanel({ patientId, accessScope }) {
  const { request, user } = useAuth()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activeSubTab, setActiveSubTab] = useState('summary')

  const fetchAnalysis = () => {
    setLoading(true)
    setError(null)
    request(`/api/patients/${encodeURIComponent(patientId)}/report-analysis`)
      .then((res) => {
        setData(res)
        setLoading(false)
      })
      .catch((err) => {
        setError(err.message || 'Failed to analyze reports')
        setLoading(false)
      })
  }

  useEffect(() => {
    fetchAnalysis()
  }, [patientId])

  if (loading) {
    return (
      <Card title="Intelligent Medical E-Report Analyzer">
        <div className="py-12 text-center text-sm text-slate-500">
          Analyzing structured laboratory indicators and historical trajectories…
        </div>
      </Card>
    )
  }

  if (error) {
    return (
      <Card title="Intelligent Medical E-Report Analyzer">
        <Alert tone="danger">{error}</Alert>
      </Card>
    )
  }

  if (!data || data.scopeWithheld) {
    return (
      <Card title="Intelligent Medical E-Report Analyzer">
        <EmptyState>
          {data?.message || 'Medical report analysis is withheld under the current consent scope.'}
        </EmptyState>
      </Card>
    )
  }

  const {
    patientProfile,
    individualAnomalies,
    normalObservations,
    combinationFindings,
    historicalTrends,
    missingDataNotices,
    clinicalReviewSummary,
  } = data

  const isUrgent = clinicalReviewSummary?.urgentSafetyAlert

  return (
    <div className="space-y-6">
      {/* Header Clinical Disclaimer Notice */}
      <div className={`p-4 rounded-xl border flex items-start gap-3 text-xs leading-relaxed ${
        isUrgent ? 'bg-red-50/80 border-red-200 text-red-900' : 'bg-slate-50 border-slate-200 text-slate-700'
      }`}>
        {isUrgent ? (
          <AlertTriangleIcon className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
        ) : (
          <InfoIcon className="h-5 w-5 text-teal-700 shrink-0 mt-0.5" />
        )}
        <div className="flex-1 space-y-1">
          <p className="font-semibold text-sm">
            {isUrgent ? 'Clinical Alert: Critical Laboratory Thresholds Identified' : 'Intelligent Report Analysis (Decision Support)'}
          </p>
          <p>{clinicalReviewSummary?.clinicalDisclaimer}</p>
        </div>
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="flex border-b border-slate-200 gap-2">
        {[
          ['summary', 'Review Summary'],
          ['combinations', `Concerning Combinations (${combinationFindings?.triggeredCount || 0})`],
          ['anomalies', `Abnormal Indicators (${individualAnomalies?.count || 0})`],
          ['trends', `Trends & Trajectories (${historicalTrends?.length || 0})`],
          ['all', `All Indicators (${patientProfile?.totalObservationsAnalyzed || 0})`],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveSubTab(id)}
            className={`pb-2.5 px-3 text-xs font-medium border-b-2 transition ${
              activeSubTab === id
                ? 'border-teal-700 text-teal-900 font-semibold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Sub-Tab 1: Review Summary */}
      {activeSubTab === 'summary' && (
        <div className="space-y-6">
          {/* Quick Metrics Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-3 rounded-lg border border-slate-200 bg-white">
              <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Verified Findings</span>
              <p className="text-xl font-bold text-slate-900 mt-1">{patientProfile?.verifiedObservationsCount || 0}</p>
              <span className="text-[10px] text-slate-400">Clinician-attested</span>
            </div>
            <div className="p-3 rounded-lg border border-red-200 bg-red-50/50">
              <span className="text-[11px] font-medium text-red-800 uppercase tracking-wider">Abnormal Indicators</span>
              <p className="text-xl font-bold text-red-700 mt-1">{individualAnomalies?.count || 0}</p>
              <span className="text-[10px] text-red-600">Outside laboratory range</span>
            </div>
            <div className="p-3 rounded-lg border border-amber-200 bg-amber-50/50">
              <span className="text-[11px] font-medium text-amber-900 uppercase tracking-wider">Pattern Matches</span>
              <p className="text-xl font-bold text-amber-800 mt-1">{combinationFindings?.triggeredCount || 0}</p>
              <span className="text-[10px] text-amber-700">Predefined combinations</span>
            </div>
            <div className="p-3 rounded-lg border border-slate-200 bg-white">
              <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Unverified / Pending</span>
              <p className="text-xl font-bold text-slate-700 mt-1">{patientProfile?.unverifiedObservationsCount || 0}</p>
              <span className="text-[10px] text-slate-400">Require attestation</span>
            </div>
          </div>

          {/* Recommended Clinical Next Steps */}
          <Card title="Recommended Clinical Actions">
            <ul className="space-y-2 text-xs">
              {clinicalReviewSummary?.recommendedActions.map((action, i) => (
                <li key={i} className="flex items-start gap-2 text-slate-700">
                  <span className="text-teal-700 font-bold">•</span>
                  <span>{action}</span>
                </li>
              ))}
            </ul>
          </Card>

          {/* Missing / Unverified Data Notices */}
          {missingDataNotices.length > 0 && (
            <div className="space-y-2">
              {missingDataNotices.map((n, i) => (
                <div key={i} className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2">
                  <InfoIcon className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
                  <span>{n.notice}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Sub-Tab 2: Concerning Combinations */}
      {activeSubTab === 'combinations' && (
        <div className="space-y-4">
          {combinationFindings?.findings.length === 0 ? (
            <Card title="Predefined Combination Patterns">
              <EmptyState>
                No multi-indicator clinical patterns triggered across verified observations.
              </EmptyState>
            </Card>
          ) : (
            combinationFindings?.findings.map((pattern) => (
              <div
                key={pattern.ruleId}
                className={`p-4 rounded-xl border bg-white shadow-xs space-y-3 ${
                  pattern.urgency === 'URGENT' ? 'border-red-300 ring-1 ring-red-200' : 'border-slate-200'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-900 text-sm">{pattern.title}</span>
                    <Badge tone={pattern.urgency === 'URGENT' ? 'red' : 'amber'}>
                      {pattern.urgency}
                    </Badge>
                  </div>
                  <span className="font-mono text-[10px] text-slate-400">Rule ID: {pattern.ruleId} v{pattern.ruleVersion}</span>
                </div>

                <div className="grid gap-3 md:grid-cols-2 text-xs">
                  <div>
                    <h5 className="font-medium text-slate-700 mb-1">Triggered Indicators:</h5>
                    <div className="space-y-1">
                      {pattern.triggeredValues.map((tv, idx) => (
                        <div key={idx} className="flex justify-between bg-slate-50 p-1.5 rounded border border-slate-100 font-mono text-[11px]">
                          <span className="font-medium text-slate-800">{tv.testName}</span>
                          <span className="font-semibold text-red-700">{tv.value} (Ref: {tv.referenceRange})</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div>
                      <h5 className="font-medium text-slate-700">Clinical Explanation:</h5>
                      <p className="text-slate-600 leading-relaxed mt-0.5">{pattern.explanation}</p>
                    </div>
                    <div>
                      <h5 className="font-medium text-slate-700">Review Recommendation:</h5>
                      <p className="text-teal-900 font-medium leading-relaxed mt-0.5">{pattern.recommendation}</p>
                    </div>
                    <div className="text-[10px] text-slate-400 italic">
                      Provenance: {pattern.evidence}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}

          {/* Evaluated Rules Transparency Box */}
          <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3 text-xs">
            <h5 className="font-semibold text-slate-700 mb-2">Rule Evaluation Transparency:</h5>
            <div className="divide-y divide-slate-100 text-[11px]">
              {combinationFindings?.rulesEvaluated.map((r) => (
                <div key={r.id} className="py-1 flex items-center justify-between">
                  <span className="text-slate-600">{r.id}: {r.title}</span>
                  <span className={`font-medium ${
                    r.status === 'TRIGGERED' ? 'text-red-700' : r.status === 'INSUFFICIENT_DATA' ? 'text-slate-400' : 'text-emerald-700'
                  }`}>
                    {r.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Sub-Tab 3: Individual Anomalies */}
      {activeSubTab === 'anomalies' && (
        <Card title="Individual Abnormal Indicators">
          {individualAnomalies?.items.length === 0 ? (
            <EmptyState>No individual verified laboratory values outside reference intervals.</EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-medium">
                    <th className="py-2 px-3">Test Indicator</th>
                    <th className="py-2 px-3">Result Value</th>
                    <th className="py-2 px-3">Reference Interval</th>
                    <th className="py-2 px-3">Deviation</th>
                    <th className="py-2 px-3">Urgency</th>
                    <th className="py-2 px-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {individualAnomalies?.items.map((obs) => (
                    <tr key={obs.id} className={obs.urgency === 'CRITICAL' ? 'bg-red-50/30' : ''}>
                      <td className="py-2.5 px-3">
                        <div className="font-medium text-slate-900">{obs.testName}</div>
                        {obs.standardCode && (
                          <div className="font-mono text-[10px] text-slate-400">LOINC: {obs.standardCode}</div>
                        )}
                        {obs.clinicalContext && (
                          <div className="text-[10px] text-red-700 font-medium mt-0.5">{obs.clinicalContext}</div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-red-700">
                        {obs.valueNumeric !== null ? obs.valueNumeric : obs.valueText} {obs.unit || ''}
                      </td>
                      <td className="py-2.5 px-3 text-slate-600">
                        {obs.referenceRange || 'Unknown'} {obs.unit || ''}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="font-medium text-red-800 text-[11px]">{obs.deviation}</span>
                      </td>
                      <td className="py-2.5 px-3">
                        <Badge tone={obs.urgency === 'CRITICAL' ? 'red' : 'amber'}>
                          {obs.urgency}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-3">
                        <Badge tone="green">{titleCase(obs.verificationStatus)}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* Sub-Tab 4: Trends & Trajectories */}
      {activeSubTab === 'trends' && (
        <Card title="Historical Trends & Trajectories">
          {historicalTrends?.length === 0 ? (
            <EmptyState>
              No repeated dated observations available yet to construct longitudinal trajectory curves.
            </EmptyState>
          ) : (
            <div className="space-y-4">
              {historicalTrends.map((tr) => (
                <div key={tr.testName} className="p-3 rounded-lg border border-slate-200 bg-white space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-900 text-xs">{tr.testName}</span>
                    <Badge tone={tr.direction === 'INCREASING' ? 'amber' : tr.direction === 'DECREASING' ? 'blue' : 'neutral'}>
                      {tr.direction} ({tr.percentageChange > 0 ? `+${tr.percentageChange}` : tr.percentageChange}%)
                    </Badge>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-slate-600">
                    <div>
                      <span className="text-slate-400 text-[10px]">Baseline:</span> {tr.firstRecorded.value} {tr.unit} ({formatDate(tr.firstRecorded.date)})
                    </div>
                    <div>
                      <span className="text-slate-400 text-[10px]">Latest:</span> {tr.latestRecorded.value} {tr.unit} ({formatDate(tr.latestRecorded.date)})
                    </div>
                    <div>
                      <span className="text-slate-400 text-[10px]">Change:</span> {tr.absoluteChange > 0 ? `+${tr.absoluteChange}` : tr.absoluteChange} {tr.unit}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Sub-Tab 5: All Extracted Indicators */}
      {activeSubTab === 'all' && (
        <Card title="Complete Laboratory Observations Roster">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-medium">
                  <th className="py-2 px-3">Test Name</th>
                  <th className="py-2 px-3">Observed Value</th>
                  <th className="py-2 px-3">Reference Range</th>
                  <th className="py-2 px-3">Status</th>
                  <th className="py-2 px-3">Confidence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {[
                  ...(individualAnomalies?.items || []),
                  ...(normalObservations?.items || []),
                  ...(data.missingDataNotices ? [] : []),
                ].map((obs) => (
                  <tr key={obs.id}>
                    <td className="py-2 px-3 font-medium text-slate-900">{obs.testName}</td>
                    <td className={`py-2 px-3 font-semibold ${obs.isAbnormal ? 'text-red-700' : 'text-slate-800'}`}>
                      {obs.valueNumeric !== null ? obs.valueNumeric : obs.valueText} {obs.unit || ''}
                    </td>
                    <td className="py-2 px-3 text-slate-500">{obs.referenceRange || 'Unknown'} {obs.unit || ''}</td>
                    <td className="py-2 px-3">
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
                    </td>
                    <td className="py-2 px-3 text-slate-500">{obs.extractionConfidence}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
