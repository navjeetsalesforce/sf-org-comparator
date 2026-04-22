import React, { useState, useCallback } from 'react'
import OrgSelector from './components/OrgSelector'
import MetadataFilter from './components/MetadataFilter'
import ComparatorTable from './components/ComparatorTable'
import XmlDiffViewer from './components/XmlDiffViewer'
import ActionPanel from './components/ActionPanel'
import type {
  ComparisonResult,
  ComparisonSummary,
} from './types'

const ALL_TYPES = [
  'ApexClass', 'ApexTrigger', 'LightningComponentBundle', 'AuraDefinitionBundle',
  'Flow', 'CustomObject', 'CustomField', 'Profile', 'PermissionSet',
  'Layout', 'CustomTab', 'CustomApplication', 'ValidationRule', 'WorkflowRule',
]

export default function App() {
  // ─── Org state ──────────────────────────────────────────────────────────
  const [sourceOrg, setSourceOrg] = useState('')
  const [targetOrg, setTargetOrg] = useState('')
  const [useMock, setUseMock] = useState(true)

  // ─── Filter state ────────────────────────────────────────────────────────
  const [selectedTypes, setSelectedTypes] = useState<string[]>([...ALL_TYPES])
  const [filterCollapsed, setFilterCollapsed] = useState(false)

  // ─── Comparison state ────────────────────────────────────────────────────
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<ComparisonResult[]>([])
  const [summary, setSummary] = useState<ComparisonSummary | null>(null)
  const [isMockData, setIsMockData] = useState(false)
  const [compareError, setCompareError] = useState<string | null>(null)
  const [hasCompared, setHasCompared] = useState(false)

  // ─── Selection state ────────────────────────────────────────────────────
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set())

  // ─── Diff viewer state ───────────────────────────────────────────────────
  const [activeResult, setActiveResult] = useState<ComparisonResult | null>(null)

  // ─── Sidebar state ────────────────────────────────────────────────────────
  const [actionPanelOpen, setActionPanelOpen] = useState(false)

  const rowKey = (r: ComparisonResult) => `${r.type}::${r.name}`

  // ─── Handlers ────────────────────────────────────────────────────────────

  const handleCompare = useCallback(async () => {
    if (!sourceOrg || !targetOrg) return
    setLoading(true)
    setCompareError(null)
    setResults([])
    setSummary(null)
    setSelectedRows(new Set())
    setActiveResult(null)
    setHasCompared(true)

    const params = useMock ? '?mock=true' : ''
    try {
      const res = await fetch(`/api/compare${params}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceOrg,
          targetOrg,
          metadataTypes: selectedTypes,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`)
      setResults(data.results || [])
      setSummary(data.summary || null)
      setIsMockData(data.mock ?? false)
    } catch (err) {
      setCompareError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [sourceOrg, targetOrg, selectedTypes, useMock])

  const handleRowSelect = useCallback((key: string, checked: boolean) => {
    setSelectedRows(prev => {
      const next = new Set(prev)
      if (checked) next.add(key)
      else next.delete(key)
      return next
    })
  }, [])

  const handleSelectAll = useCallback((checked: boolean) => {
    if (checked) {
      setSelectedRows(new Set(results.map(rowKey)))
    } else {
      setSelectedRows(new Set())
    }
  }, [results])

  const handleRowClick = useCallback((result: ComparisonResult) => {
    setActiveResult(result)
  }, [])

  const selectedResults = results.filter(r => selectedRows.has(rowKey(r)))

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col">
      {/* ─── Top bar ─────────────────────────────────────────────────────── */}
      <header className="flex-shrink-0 bg-gray-800 border-b border-gray-700 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="sf-gradient w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
          </div>
          <div>
            <h1 className="text-white font-bold text-base leading-tight">SF Org Comparator</h1>
            <p className="text-gray-500 text-xs leading-tight">Salesforce GDC Team</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {isMockData && (
            <span className="text-xs text-amber-400 bg-amber-900/30 border border-amber-700/40 px-2 py-1 rounded-full">
              Demo data
            </span>
          )}
          {hasCompared && !loading && results.length > 0 && (
            <button
              onClick={() => setActionPanelOpen(v => !v)}
              className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border transition-colors ${
                selectedRows.size > 0
                  ? 'bg-sf-blue/10 border-sf-blue text-sf-blue hover:bg-sf-blue/20'
                  : 'border-gray-600 text-gray-400 hover:border-gray-500 hover:text-gray-200'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Actions
              {selectedRows.size > 0 && (
                <span className="bg-sf-blue text-white text-xs w-5 h-5 rounded-full flex items-center justify-center font-bold">
                  {selectedRows.size}
                </span>
              )}
            </button>
          )}
          <a
            href="https://github.com/navjeetshekhawat/sf-org-comparator"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
            </svg>
            GitHub
          </a>
        </div>
      </header>

      {/* ─── Main layout ──────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar */}
        <aside className="w-64 flex-shrink-0 border-r border-gray-700 bg-gray-900 overflow-y-auto p-4 flex flex-col gap-4">
          <MetadataFilter
            selected={selectedTypes}
            onChange={setSelectedTypes}
            collapsed={filterCollapsed}
            onToggle={() => setFilterCollapsed(v => !v)}
          />

          {/* Action panel in sidebar when open */}
          {actionPanelOpen && hasCompared && (
            <ActionPanel
              selectedResults={selectedResults}
              sourceOrg={sourceOrg}
              targetOrg={targetOrg}
              useMock={useMock}
            />
          )}
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto p-6 flex flex-col gap-5">
          {/* Org selector */}
          <OrgSelector
            sourceOrg={sourceOrg}
            targetOrg={targetOrg}
            onSourceChange={setSourceOrg}
            onTargetChange={setTargetOrg}
            onCompare={handleCompare}
            loading={loading}
            useMock={useMock}
            onMockToggle={setUseMock}
          />

          {/* Error */}
          {compareError && (
            <div className="px-4 py-3 bg-red-900/30 border border-red-700/50 rounded-xl text-red-400 text-sm flex items-center gap-2">
              <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {compareError}
            </div>
          )}

          {/* Empty state */}
          {!hasCompared && !loading && (
            <div className="flex-1 flex flex-col items-center justify-center py-24 text-center">
              <div className="sf-gradient w-16 h-16 rounded-2xl flex items-center justify-center mb-4 opacity-80">
                <svg className="w-9 h-9 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                </svg>
              </div>
              <h2 className="text-white text-xl font-semibold mb-2">Compare Salesforce Orgs</h2>
              <p className="text-gray-500 text-sm max-w-sm">
                Select a source and target org above, choose the metadata types you want to compare, then click <strong className="text-gray-300">Compare Orgs</strong>.
              </p>
              <div className="mt-6 flex gap-3 text-xs text-gray-600">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" /> Identical
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-amber-500" /> Different
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-blue-500" /> Source Only
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-red-500" /> Target Only
                </span>
              </div>
            </div>
          )}

          {/* Results table */}
          {(hasCompared || loading) && (
            <ComparatorTable
              results={results}
              summary={summary}
              loading={loading}
              selectedRows={selectedRows}
              onRowSelect={handleRowSelect}
              onSelectAll={handleSelectAll}
              onRowClick={handleRowClick}
              activeRow={activeResult ? rowKey(activeResult) : null}
            />
          )}
        </main>
      </div>

      {/* ─── XML Diff Viewer (slide-in panel) ─────────────────────────────── */}
      {activeResult && (
        <XmlDiffViewer
          result={activeResult}
          onClose={() => setActiveResult(null)}
          sourceOrgAlias={sourceOrg}
          targetOrgAlias={targetOrg}
        />
      )}
    </div>
  )
}
