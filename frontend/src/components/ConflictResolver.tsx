import React, { useState, useCallback } from 'react'
import type {
  ComparisonResult,
  ConflictResolution,
  ConfidenceLevel,
  ResolutionStatus,
  AnalyseConflictsResponse,
  ApplyResolutionsResponse,
} from '../types'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  conflictedComponents: ComparisonResult[]
  sourceOrg: string
  targetOrg: string
  onClose: () => void
}

// ---------------------------------------------------------------------------
// View steps
// ---------------------------------------------------------------------------

type ViewStep = 'list' | 'review' | 'summary' | 'committed'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ConfidenceBadge({ level }: { level: ConfidenceLevel }) {
  const cfg = {
    high:   { bg: 'bg-emerald-900/40 border-emerald-600/50', text: 'text-emerald-300', label: 'High Confidence' },
    medium: { bg: 'bg-amber-900/40 border-amber-600/50',   text: 'text-amber-300',   label: 'Medium Confidence' },
    low:    { bg: 'bg-red-900/40 border-red-600/50',       text: 'text-red-300',     label: 'Low Confidence' },
  }[level]

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-semibold ${cfg.bg} ${cfg.text}`}>
      <span className={`w-2 h-2 rounded-full ${level === 'high' ? 'bg-emerald-400' : level === 'medium' ? 'bg-amber-400' : 'bg-red-400'}`} />
      {cfg.label}
    </span>
  )
}

function StatusBadge({ status }: { status: ResolutionStatus }) {
  if (status === 'approved') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-900/40 border border-emerald-600/50 text-emerald-300 text-xs font-semibold">
        Approved
      </span>
    )
  }
  if (status === 'rejected') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-900/40 border border-red-600/50 text-red-300 text-xs font-semibold">
        Rejected
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-700/60 border border-gray-600/50 text-gray-400 text-xs font-semibold">
      Pending
    </span>
  )
}

function XmlPanel({
  label,
  xml,
  colorClass,
  labelClass,
}: {
  label: string
  xml: string
  colorClass: string
  labelClass: string
}) {
  const lines = xml ? xml.split('\n') : ['(empty)']
  return (
    <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
      <div className={`text-xs font-semibold px-3 py-2 border-b border-gray-700 ${labelClass}`}>
        {label}
      </div>
      <pre className={`flex-1 overflow-auto text-xs font-mono p-3 leading-relaxed whitespace-pre-wrap break-all ${colorClass}`}>
        {lines.map((line, i) => (
          <div key={i} className="flex gap-2">
            <span className="select-none text-gray-600 w-8 text-right flex-shrink-0 text-[10px] leading-5">{i + 1}</span>
            <span>{line}</span>
          </div>
        ))}
      </pre>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ConflictResolver({ conflictedComponents, sourceOrg, targetOrg, onClose }: Props) {
  // ─── State ────────────────────────────────────────────────────────────────
  const [step, setStep] = useState<ViewStep>('list')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [demoMode, setDemoMode] = useState(false)

  const [resolutions, setResolutions] = useState<ConflictResolution[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)

  // For Apply step
  const [githubRepo, setGithubRepo] = useState('navjeetshekhawat/sf-org-comparator')
  const [branch, setBranch] = useState('')
  const [applying, setApplying] = useState(false)
  const [applyResult, setApplyResult] = useState<ApplyResolutionsResponse | null>(null)

  // ─── Derived ─────────────────────────────────────────────────────────────
  const approvedCount = resolutions.filter(r => r.status === 'approved').length
  const rejectedCount = resolutions.filter(r => r.status === 'rejected').length
  const pendingCount  = resolutions.filter(r => r.status === 'pending').length
  const reviewedCount = approvedCount + rejectedCount
  const allReviewed   = pendingCount === 0 && resolutions.length > 0
  const current       = resolutions[currentIndex] ?? null

  // ─── Handlers ─────────────────────────────────────────────────────────────

  const handleAnalyse = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/conflicts/analyse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          components: conflictedComponents.map(c => ({
            type: c.type,
            name: c.name,
            sourceXml: c.sourceXml,
            targetXml: c.targetXml,
          })),
          conflictContext: `Back-promotion from ${sourceOrg} to ${targetOrg}`,
        }),
      })
      const data: AnalyseConflictsResponse = await res.json()
      if (!res.ok) throw new Error((data as any).detail || 'Analysis failed')
      setResolutions(data.resolutions)
      setDemoMode(data.demoMode)
      setCurrentIndex(0)
      setStep('review')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [conflictedComponents, sourceOrg, targetOrg])

  const handleDecision = useCallback((status: 'approved' | 'rejected') => {
    setResolutions(prev =>
      prev.map((r, i) => i === currentIndex ? { ...r, status } : r)
    )
    // Auto-advance to next pending
    const nextPendingIndex = resolutions.findIndex(
      (r, i) => i > currentIndex && r.status === 'pending'
    )
    if (nextPendingIndex !== -1) {
      setCurrentIndex(nextPendingIndex)
    }
    // Check if all reviewed after this decision
    const afterDecision = resolutions.map((r, i) => i === currentIndex ? { ...r, status } : r)
    const stillPending = afterDecision.filter(r => r.status === 'pending').length
    if (stillPending === 0) {
      // All done — go to summary after a brief moment
      setTimeout(() => setStep('summary'), 300)
    }
  }, [currentIndex, resolutions])

  const handleApply = useCallback(async () => {
    setApplying(true)
    setError(null)
    try {
      const approved = resolutions
        .filter(r => r.status === 'approved')
        .map(r => ({ type: r.type, name: r.name, proposedXml: r.proposedXml }))

      const res = await fetch('/api/conflicts/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approvedResolutions: approved,
          branch,
          repo: githubRepo,
        }),
      })
      const data: ApplyResolutionsResponse = await res.json()
      if (!res.ok) throw new Error((data as any).detail || 'Commit failed')
      setApplyResult(data)
      setStep('committed')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setApplying(false)
    }
  }, [resolutions, branch, githubRepo])

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-stretch justify-stretch">
      <div className="relative flex flex-col w-full h-full bg-gray-900 overflow-hidden">

        {/* ── Global header ───────────────────────────────────────────────── */}
        <div className="flex-shrink-0 flex items-center justify-between px-6 py-4 bg-gray-800 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-purple-600/30 border border-purple-500/50 flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-purple-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" />
              </svg>
            </div>
            <div>
              <h2 className="text-white font-bold text-base leading-tight">AI Conflict Resolver</h2>
              <p className="text-gray-500 text-xs leading-tight">
                {sourceOrg} → {targetOrg}
              </p>
            </div>
          </div>

          {/* Warning banner */}
          <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-900/30 border border-amber-600/40 rounded-lg">
            <svg className="w-4 h-4 text-amber-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span className="text-amber-300 text-xs font-medium">
              AI suggestions require your review — nothing is committed until you approve
            </span>
          </div>

          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors p-1.5 rounded hover:bg-gray-700"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* ── Demo mode banner ────────────────────────────────────────────── */}
        {demoMode && (
          <div className="flex-shrink-0 flex items-center gap-2 px-6 py-2 bg-blue-900/30 border-b border-blue-700/40">
            <svg className="w-4 h-4 text-blue-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-blue-300 text-xs">
              Demo mode — ANTHROPIC_API_KEY not set. Showing realistic mock resolutions.
              Set the env var to use real AI analysis.
            </span>
          </div>
        )}

        {/* ── Error banner ────────────────────────────────────────────────── */}
        {error && (
          <div className="flex-shrink-0 flex items-center gap-2 px-6 py-2 bg-red-900/30 border-b border-red-700/40">
            <svg className="w-4 h-4 text-red-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-red-300 text-xs">{error}</span>
            <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-200 text-xs underline">dismiss</button>
          </div>
        )}

        {/* ── Content area ────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-hidden flex flex-col">

          {/* ================================================================
              STEP 1: Conflict List
              ================================================================ */}
          {step === 'list' && (
            <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-5">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-white font-semibold text-lg">
                    {conflictedComponents.length} Conflicted Component{conflictedComponents.length !== 1 ? 's' : ''}
                  </h3>
                  <p className="text-gray-400 text-sm mt-0.5">
                    Review each conflict individually. AI will propose a resolution for each one.
                  </p>
                </div>
                <button
                  onClick={handleAnalyse}
                  disabled={loading}
                  className="flex items-center gap-2 px-5 py-2.5 bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                >
                  {loading ? (
                    <>
                      <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Analysing with AI…
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                      </svg>
                      Analyse with AI
                    </>
                  )}
                </button>
              </div>

              {/* Component list */}
              <div className="space-y-2">
                {conflictedComponents.map(comp => (
                  <div
                    key={`${comp.type}::${comp.name}`}
                    className="flex items-center gap-4 px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg"
                  >
                    <div className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-gray-500 font-mono">{comp.type}</span>
                        <span className="text-white font-medium text-sm truncate">{comp.name}</span>
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500">
                        <span>Source: <span className="text-gray-400">{comp.sourceLastModifiedBy || 'unknown'}</span></span>
                        <span>Target: <span className="text-gray-400">{comp.targetLastModifiedBy || 'unknown'}</span></span>
                      </div>
                    </div>
                    <span className="text-xs bg-amber-900/30 border border-amber-700/40 text-amber-300 px-2 py-0.5 rounded-full flex-shrink-0">
                      Conflict
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ================================================================
              STEP 2: Review (one at a time)
              ================================================================ */}
          {step === 'review' && current && (
            <div className="flex-1 overflow-hidden flex flex-col">
              {/* Review header bar */}
              <div className="flex-shrink-0 flex items-center gap-4 px-6 py-3 bg-gray-800/60 border-b border-gray-700">
                {/* Navigation */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCurrentIndex(i => Math.max(0, i - 1))}
                    disabled={currentIndex === 0}
                    className="p-1.5 rounded hover:bg-gray-700 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    aria-label="Previous"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  <span className="text-sm text-gray-300 font-medium whitespace-nowrap">
                    File {currentIndex + 1} of {resolutions.length}
                  </span>
                  <button
                    onClick={() => setCurrentIndex(i => Math.min(resolutions.length - 1, i + 1))}
                    disabled={currentIndex === resolutions.length - 1}
                    className="p-1.5 rounded hover:bg-gray-700 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    aria-label="Next"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>

                {/* Component name */}
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="text-xs text-gray-500 font-mono flex-shrink-0">{current.type}</span>
                  <span className="text-white font-semibold truncate">{current.name}</span>
                  <ConfidenceBadge level={current.confidence} />
                  {current.autoResolvable && (
                    <span className="text-xs bg-emerald-900/30 border border-emerald-600/40 text-emerald-300 px-2 py-0.5 rounded-full flex-shrink-0">
                      Auto-resolvable
                    </span>
                  )}
                  <StatusBadge status={current.status} />
                </div>

                {/* Progress bar */}
                <div className="flex items-center gap-3 flex-shrink-0">
                  <div className="text-xs text-gray-400">
                    {reviewedCount} of {resolutions.length} reviewed
                  </div>
                  <div className="w-32 h-2 bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-purple-500 transition-all"
                      style={{ width: `${resolutions.length > 0 ? (reviewedCount / resolutions.length) * 100 : 0}%` }}
                    />
                  </div>
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="text-emerald-400">{approvedCount} approved</span>
                    <span className="text-gray-600">·</span>
                    <span className="text-red-400">{rejectedCount} rejected</span>
                    <span className="text-gray-600">·</span>
                    <span className="text-gray-400">{pendingCount} pending</span>
                  </div>
                </div>

                {/* Go to summary */}
                <button
                  onClick={() => setStep('summary')}
                  className="flex-shrink-0 text-xs text-gray-400 hover:text-white transition-colors underline"
                >
                  Go to summary
                </button>
              </div>

              {/* Low confidence extra warning */}
              {current.confidence === 'low' && (
                <div className="flex-shrink-0 flex items-center gap-2 px-6 py-2.5 bg-red-900/25 border-b border-red-700/40">
                  <svg className="w-4 h-4 text-red-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <span className="text-red-300 text-xs font-semibold">
                    LOW CONFIDENCE — This conflict could not be resolved automatically.
                    Manual review is strongly recommended before approving.
                  </span>
                </div>
              )}

              {/* Three-panel XML viewer */}
              <div className="flex-1 overflow-hidden flex">
                {/* Left: Source */}
                <div className="flex-1 min-w-0 flex flex-col border-r border-gray-700">
                  <XmlPanel
                    label={`Source: ${sourceOrg}`}
                    xml={current.sourceXml}
                    colorClass="bg-red-950/20 text-gray-300"
                    labelClass="bg-red-900/20 text-red-300"
                  />
                </div>

                {/* Middle: AI Proposed */}
                <div className="flex-1 min-w-0 flex flex-col border-r border-gray-700">
                  <XmlPanel
                    label="AI Proposed Resolution"
                    xml={current.proposedXml}
                    colorClass="bg-emerald-950/20 text-gray-300"
                    labelClass="bg-emerald-900/20 text-emerald-300"
                  />
                </div>

                {/* Right: Target */}
                <div className="flex-1 min-w-0 flex flex-col">
                  <XmlPanel
                    label={`Target: ${targetOrg}`}
                    xml={current.targetXml}
                    colorClass="bg-blue-950/20 text-gray-300"
                    labelClass="bg-blue-900/20 text-blue-300"
                  />
                </div>
              </div>

              {/* Bottom panel: explanation + conflict details + action buttons */}
              <div className="flex-shrink-0 border-t border-gray-700 bg-gray-800/50 px-6 py-4 flex flex-col gap-4">
                {/* Explanation */}
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-600/30 border border-purple-500/40 flex items-center justify-center mt-0.5">
                    <svg className="w-3.5 h-3.5 text-purple-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-semibold text-purple-300">AI Explanation</span>
                      <ConfidenceBadge level={current.confidence} />
                    </div>
                    <p className="text-gray-300 text-sm leading-relaxed">{current.explanation}</p>
                  </div>
                </div>

                {/* Conflict details */}
                {current.conflictLines.length > 0 && (
                  <div className="rounded-lg border border-gray-700 overflow-hidden">
                    <div className="px-3 py-2 bg-gray-700/50 text-xs font-semibold text-gray-400">
                      Detected Changes ({current.conflictLines.length})
                    </div>
                    <div className="divide-y divide-gray-700/50 max-h-32 overflow-y-auto">
                      {current.conflictLines.map((cl, i) => (
                        <div key={i} className="flex items-start gap-3 px-3 py-2 text-xs">
                          <span className={`flex-shrink-0 w-16 text-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                            cl.type === 'conflict'  ? 'bg-red-900/50 text-red-300' :
                            cl.type === 'addition'  ? 'bg-emerald-900/50 text-emerald-300' :
                            cl.type === 'deletion'  ? 'bg-orange-900/50 text-orange-300' :
                            'bg-blue-900/50 text-blue-300'
                          }`}>
                            {cl.type}
                          </span>
                          <span className="text-gray-400 flex-1">{cl.description}</span>
                          {cl.lineNumber && (
                            <span className="text-gray-600 flex-shrink-0">line {cl.lineNumber}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Approve / Reject buttons */}
                <div className="flex items-center gap-4">
                  <button
                    onClick={() => handleDecision('approved')}
                    className={`flex-1 flex items-center justify-center gap-2 px-6 py-3 rounded-lg font-bold text-sm transition-colors ${
                      current.status === 'approved'
                        ? 'bg-emerald-600 text-white ring-2 ring-emerald-400'
                        : 'bg-emerald-700 hover:bg-emerald-600 text-white'
                    }`}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                    APPROVE THIS RESOLUTION
                  </button>
                  <button
                    onClick={() => handleDecision('rejected')}
                    className={`flex-1 flex items-center justify-center gap-2 px-6 py-3 rounded-lg font-bold text-sm transition-colors ${
                      current.status === 'rejected'
                        ? 'bg-red-600 text-white ring-2 ring-red-400'
                        : 'bg-gray-700 hover:bg-gray-600 text-white border border-gray-600'
                    }`}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    REJECT (keep as manual conflict)
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ================================================================
              STEP 3: Summary
              ================================================================ */}
          {step === 'summary' && (
            <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-5">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-white font-semibold text-lg">Resolution Summary</h3>
                  <p className="text-gray-400 text-sm mt-0.5">
                    Review your decisions. Only approved resolutions will be committed.
                  </p>
                </div>
                {pendingCount > 0 && (
                  <button
                    onClick={() => {
                      const firstPending = resolutions.findIndex(r => r.status === 'pending')
                      if (firstPending !== -1) {
                        setCurrentIndex(firstPending)
                        setStep('review')
                      }
                    }}
                    className="flex items-center gap-2 px-4 py-2 bg-amber-700/40 hover:bg-amber-700/60 border border-amber-600/50 text-amber-300 rounded-lg text-sm font-medium transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                    Back to Review ({pendingCount} pending)
                  </button>
                )}
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-emerald-900/20 border border-emerald-700/40 rounded-lg p-4 text-center">
                  <div className="text-3xl font-bold text-emerald-400">{approvedCount}</div>
                  <div className="text-sm text-emerald-300 mt-1">Approved</div>
                  <div className="text-xs text-gray-500 mt-0.5">will be committed</div>
                </div>
                <div className="bg-red-900/20 border border-red-700/40 rounded-lg p-4 text-center">
                  <div className="text-3xl font-bold text-red-400">{rejectedCount}</div>
                  <div className="text-sm text-red-300 mt-1">Rejected</div>
                  <div className="text-xs text-gray-500 mt-0.5">kept as manual conflicts</div>
                </div>
                <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 text-center">
                  <div className="text-3xl font-bold text-gray-400">{pendingCount}</div>
                  <div className="text-sm text-gray-300 mt-1">Pending</div>
                  <div className="text-xs text-gray-500 mt-0.5">not yet reviewed</div>
                </div>
              </div>

              {/* Approval gate warning */}
              {!allReviewed && (
                <div className="flex items-center gap-3 px-4 py-3 bg-amber-900/25 border border-amber-600/40 rounded-lg">
                  <svg className="w-5 h-5 text-amber-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <span className="text-amber-300 text-sm">
                    <strong>{pendingCount} file{pendingCount !== 1 ? 's' : ''} still pending.</strong>{' '}
                    You must review every file before committing. The commit button will unlock when all {resolutions.length} are reviewed.
                  </span>
                </div>
              )}

              {/* Summary table */}
              <div className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-700 bg-gray-700/40">
                      <th className="text-left px-4 py-3 text-gray-400 font-semibold text-xs uppercase tracking-wide">Component</th>
                      <th className="text-left px-4 py-3 text-gray-400 font-semibold text-xs uppercase tracking-wide">AI Resolution</th>
                      <th className="text-left px-4 py-3 text-gray-400 font-semibold text-xs uppercase tracking-wide">Confidence</th>
                      <th className="text-left px-4 py-3 text-gray-400 font-semibold text-xs uppercase tracking-wide">Your Decision</th>
                      <th className="text-left px-4 py-3 text-gray-400 font-semibold text-xs uppercase tracking-wide w-16">Edit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700/50">
                    {resolutions.map((r, i) => (
                      <tr key={`${r.type}::${r.name}`} className="hover:bg-gray-700/20 transition-colors">
                        <td className="px-4 py-3">
                          <div className="text-xs text-gray-500 font-mono">{r.type}</div>
                          <div className="text-white font-medium">{r.name}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-gray-300 text-xs leading-relaxed line-clamp-2">{r.explanation}</div>
                        </td>
                        <td className="px-4 py-3">
                          <ConfidenceBadge level={r.confidence} />
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={r.status} />
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => { setCurrentIndex(i); setStep('review') }}
                            className="text-gray-500 hover:text-white transition-colors"
                            aria-label="Edit decision"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Commit settings */}
              {approvedCount > 0 && (
                <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 space-y-3">
                  <h4 className="text-white font-semibold text-sm">Commit Settings</h4>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1.5">GitHub Repository</label>
                      <input
                        type="text"
                        value={githubRepo}
                        onChange={e => setGithubRepo(e.target.value)}
                        placeholder="owner/repo"
                        className="w-full bg-gray-900 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1.5">Target Branch</label>
                      <input
                        type="text"
                        value={branch}
                        onChange={e => setBranch(e.target.value)}
                        placeholder="e.g. back-promote/dev-to-staging"
                        className="w-full bg-gray-900 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Warning box */}
              <div className="flex items-start gap-3 px-4 py-3 bg-gray-800 border border-gray-600 rounded-lg">
                <svg className="w-5 h-5 text-gray-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-gray-400 text-sm">
                  This commits to the PR branch only. You must still{' '}
                  <strong className="text-white">merge the PR on GitHub</strong> after review.
                  No deployment will occur from this action.
                </p>
              </div>

              {/* Commit button */}
              <button
                onClick={handleApply}
                disabled={!allReviewed || approvedCount === 0 || applying || !branch.trim() || !githubRepo.includes('/')}
                className={`w-full flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-xl font-bold text-base transition-colors ${
                  allReviewed && approvedCount > 0 && branch.trim() && githubRepo.includes('/')
                    ? 'bg-purple-600 hover:bg-purple-500 text-white'
                    : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                }`}
              >
                {applying ? (
                  <>
                    <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Committing to PR branch…
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 16 16">
                      <path d="M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122V6A2.5 2.5 0 0110 8.5H6a1 1 0 00-1 1v1.128a2.251 2.251 0 11-1.5 0V5.372a2.25 2.25 0 111.5 0v1.836A2.492 2.492 0 016 7h4a1 1 0 001-1v-.628A2.25 2.25 0 019.5 3.25z" />
                    </svg>
                    {!allReviewed
                      ? `Commit Approved Resolutions (review ${pendingCount} more first)`
                      : approvedCount === 0
                        ? 'No Approved Resolutions to Commit'
                        : !branch.trim()
                          ? 'Enter a branch name to continue'
                          : `Commit ${approvedCount} Approved Resolution${approvedCount !== 1 ? 's' : ''} to PR Branch`}
                  </>
                )}
              </button>

              {error && (
                <div className="px-4 py-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-400 text-sm">
                  {error}
                </div>
              )}
            </div>
          )}

          {/* ================================================================
              STEP 4: Committed
              ================================================================ */}
          {step === 'committed' && applyResult && (
            <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-5 items-center justify-center">
              <div className="w-16 h-16 rounded-full bg-emerald-600/20 border-2 border-emerald-500/40 flex items-center justify-center">
                <svg className="w-9 h-9 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>

              <div className="text-center max-w-lg">
                <h3 className="text-white font-bold text-xl mb-2">Committed to PR Branch</h3>
                <p className="text-gray-400 text-sm leading-relaxed">{applyResult.message}</p>
              </div>

              {/* Committed files list */}
              <div className="w-full max-w-lg bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-700 text-xs font-semibold text-gray-400 uppercase tracking-wide">
                  Committed Files ({applyResult.committedFiles.length})
                </div>
                <div className="divide-y divide-gray-700/50 max-h-48 overflow-y-auto">
                  {applyResult.committedFiles.map((f, i) => (
                    <div key={i} className="flex items-center gap-2 px-4 py-2.5 text-xs">
                      <svg className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <span className="text-gray-300 font-mono">{f}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Errors if any */}
              {applyResult.errors.length > 0 && (
                <div className="w-full max-w-lg bg-red-900/20 border border-red-700/40 rounded-lg p-4">
                  <div className="text-xs font-semibold text-red-300 mb-2">
                    {applyResult.errors.length} file(s) failed to commit:
                  </div>
                  {applyResult.errors.map((e, i) => (
                    <div key={i} className="text-xs text-red-400">{e}</div>
                  ))}
                </div>
              )}

              {/* Next steps */}
              <div className="w-full max-w-lg bg-blue-900/20 border border-blue-700/40 rounded-lg p-4 space-y-2">
                <h4 className="text-blue-300 font-semibold text-sm">Next Steps</h4>
                <ol className="list-decimal list-inside space-y-1.5 text-sm text-gray-300">
                  <li>Open the PR on GitHub and review the committed changes</li>
                  <li>Request code review from your team</li>
                  <li>Ensure CI / validation checks pass</li>
                  <li>Merge the PR on GitHub when ready — this does not deploy automatically</li>
                </ol>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  className="px-6 py-2.5 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-semibold text-sm transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
