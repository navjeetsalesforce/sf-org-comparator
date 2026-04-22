import React, { useState } from 'react'
import type { ComparisonResult, ValidationResponse, PRResponse } from '../types'
import ConflictResolver from './ConflictResolver'

interface Props {
  selectedResults: ComparisonResult[]
  sourceOrg: string
  targetOrg: string
  useMock: boolean
}

type PanelTab = 'validate' | 'pr' | 'export'

export default function ActionPanel({ selectedResults, sourceOrg, targetOrg, useMock }: Props) {
  const [showConflictResolver, setShowConflictResolver] = useState(false)
  const [activeTab, setActiveTab] = useState<PanelTab>('validate')
  const [githubRepo, setGithubRepo] = useState('navjeetshekhawat/sf-org-comparator')
  const [validationResult, setValidationResult] = useState<ValidationResponse | null>(null)
  const [prResult, setPrResult] = useState<PRResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const components = selectedResults.map(r => ({ type: r.type, name: r.name }))
  const count = selectedResults.length
  const conflictedComponents = selectedResults.filter(r => r.status === 'different')

  if (count === 0) {
    return (
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-5">
        <h3 className="text-white font-semibold text-sm mb-1 flex items-center gap-2">
          <svg className="w-4 h-4 text-sf-blue" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          Actions
        </h3>
        <p className="text-gray-500 text-xs">Select components from the table to enable actions.</p>
      </div>
    )
  }

  const handleValidate = async () => {
    setLoading(true)
    setError(null)
    setValidationResult(null)
    try {
      const res = await fetch(`/api/validate${useMock ? '?mock=true' : ''}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetOrg, components }),
      })
      const data: ValidationResponse = await res.json()
      if (!res.ok) throw new Error((data as any).detail || 'Validation failed')
      setValidationResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  const handleCreatePR = async () => {
    setLoading(true)
    setError(null)
    setPrResult(null)
    try {
      const res = await fetch('/api/pr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ components, sourceOrg, targetOrg, githubRepo }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'PR creation failed')
      setPrResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  const handleExportPackageXml = () => {
    // Build package.xml in the browser
    type TypeGroups = Record<string, string[]>
    const typeGroups: TypeGroups = {}
    for (const c of components) {
      if (!typeGroups[c.type]) typeGroups[c.type] = []
      typeGroups[c.type].push(c.name)
    }

    const lines = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Package xmlns="http://soap.sforce.com/2006/04/metadata">',
    ]
    for (const mtype of Object.keys(typeGroups).sort()) {
      lines.push('    <types>')
      for (const member of typeGroups[mtype].sort()) {
        lines.push(`        <members>${member}</members>`)
      }
      lines.push(`        <name>${mtype}</name>`)
      lines.push('    </types>')
    }
    lines.push('    <version>60.0</version>')
    lines.push('</Package>')

    const xml = lines.join('\n')
    const blob = new Blob([xml], { type: 'application/xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'package.xml'
    a.click()
    URL.revokeObjectURL(url)
  }

  const tabs: { key: PanelTab; label: string; icon: React.ReactNode }[] = [
    {
      key: 'validate',
      label: 'Validate',
      icon: (
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      key: 'pr',
      label: 'Create PR',
      icon: (
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
        </svg>
      ),
    },
    {
      key: 'export',
      label: 'Export XML',
      icon: (
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      ),
    },
  ]

  return (
    <>
      {/* ConflictResolver modal — rendered at root level of this component */}
      {showConflictResolver && conflictedComponents.length > 0 && (
        <ConflictResolver
          conflictedComponents={conflictedComponents}
          sourceOrg={sourceOrg}
          targetOrg={targetOrg}
          onClose={() => setShowConflictResolver(false)}
        />
      )}

    <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-700 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-sf-blue" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <span className="text-white font-semibold text-sm">Actions</span>
        </div>
        <span className="text-xs bg-sf-blue/20 text-sf-blue px-2 py-0.5 rounded font-medium">
          {count} selected
        </span>
      </div>

      {/* AI Conflict Resolution button — shown when conflicted components are selected */}
      {conflictedComponents.length > 0 && (
        <div className="px-5 py-3 border-b border-gray-700/50 bg-purple-900/10">
          <button
            onClick={() => setShowConflictResolver(true)}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-purple-700 hover:bg-purple-600 text-white font-semibold rounded-lg transition-colors text-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            Resolve Conflicts with AI
            <span className="bg-purple-500/40 text-purple-200 text-xs px-1.5 py-0.5 rounded-full font-bold">
              {conflictedComponents.length}
            </span>
          </button>
          <p className="mt-1.5 text-xs text-gray-600 text-center">
            AI suggests resolutions — you approve each one individually
          </p>
        </div>
      )}

      {/* Selected components summary */}
      <div className="px-5 py-3 border-b border-gray-700/50 bg-gray-900/30">
        <div className="flex flex-wrap gap-1.5">
          {selectedResults.slice(0, 5).map(r => (
            <span key={`${r.type}::${r.name}`} className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded-full truncate max-w-32">
              {r.name}
            </span>
          ))}
          {count > 5 && (
            <span className="text-xs text-gray-500">+{count - 5} more</span>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-gray-700">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => { setActiveTab(tab.key); setError(null) }}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors flex-1 justify-center ${
              activeTab === tab.key
                ? 'text-sf-blue border-b-2 border-sf-blue bg-sf-blue/5'
                : 'text-gray-400 hover:text-white border-b-2 border-transparent'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="p-5">
        {error && (
          <div className="mb-4 px-3 py-2.5 bg-red-900/30 border border-red-700/50 rounded-lg text-red-400 text-xs flex items-start gap-2">
            <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {error}
          </div>
        )}

        {/* Validate tab */}
        {activeTab === 'validate' && (
          <div>
            <p className="text-gray-400 text-xs mb-4">
              Run a checkonly deploy of the selected {count} component{count !== 1 ? 's' : ''} to{' '}
              <span className="text-white font-medium">{targetOrg}</span> to verify deploy readiness.
            </p>
            <button
              onClick={handleValidate}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-700 hover:bg-emerald-600 text-white font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
            >
              {loading ? (
                <>
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Validating…
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Validate on Target
                </>
              )}
            </button>

            {validationResult && (
              <div className="mt-4">
                <div className={`flex items-center gap-2 mb-3 px-3 py-2 rounded-lg text-sm font-medium ${
                  validationResult.success
                    ? 'bg-emerald-900/30 text-emerald-400 border border-emerald-700/40'
                    : 'bg-red-900/30 text-red-400 border border-red-700/40'
                }`}>
                  {validationResult.success ? (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      All components passed validation
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                      Validation failed
                    </>
                  )}
                  {validationResult.mock && <span className="ml-auto text-xs opacity-60">(mock)</span>}
                </div>
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {validationResult.components.map((c, i) => (
                    <div key={i} className={`flex items-start gap-2 px-2.5 py-2 rounded-lg text-xs ${
                      c.status === 'passed' ? 'bg-emerald-900/20' : 'bg-red-900/20'
                    }`}>
                      <span className={c.status === 'passed' ? 'text-emerald-400' : 'text-red-400'}>
                        {c.status === 'passed' ? '✓' : '✗'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className={c.status === 'passed' ? 'text-gray-300' : 'text-red-300'}>
                          <span className="text-gray-500">{c.type}/</span>{c.name}
                        </div>
                        {c.error && <div className="text-red-400 mt-0.5 text-xs">{c.error}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* PR tab */}
        {activeTab === 'pr' && (
          <div>
            <p className="text-gray-400 text-xs mb-4">
              Create a GitHub pull request to back-promote {count} component{count !== 1 ? 's' : ''} from{' '}
              <span className="text-white font-medium">{sourceOrg}</span> to{' '}
              <span className="text-white font-medium">{targetOrg}</span>.
            </p>
            <div className="mb-4">
              <label className="block text-xs text-gray-400 mb-1.5">GitHub Repository</label>
              <input
                type="text"
                value={githubRepo}
                onChange={e => setGithubRepo(e.target.value)}
                placeholder="owner/repo"
                className="w-full bg-gray-900 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sf-blue"
              />
              <p className="mt-1 text-xs text-gray-600">
                Requires GITHUB_TOKEN env var on the backend
              </p>
            </div>
            <button
              onClick={handleCreatePR}
              disabled={loading || !githubRepo.includes('/')}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-purple-700 hover:bg-purple-600 text-white font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
            >
              {loading ? (
                <>
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Creating PR…
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 16 16">
                    <path d="M1 2.828c.885-.37 2.154-.769 3.388-.893 1.33-.134 2.458.063 3.112.752v9.746c-.935-.53-2.12-.603-3.213-.493-1.18.12-2.37.461-3.287.811zm7.5-.141c.654-.689 1.782-.886 3.112-.752 1.234.124 2.503.523 3.388.893v9.923c-.918-.35-2.107-.692-3.287-.81-1.094-.111-2.278-.039-3.213.492zM8 1.783C7.015.936 5.587.81 4.287.94c-1.514.153-3.042.672-3.994 1.105A.5.5 0 000 2.5v11a.5.5 0 00.707.455c.882-.4 2.303-.881 3.68-1.02 1.409-.142 2.59.087 3.223.877a.5.5 0 00.78 0c.633-.79 1.814-1.019 3.222-.877 1.378.139 2.8.62 3.681 1.02A.5.5 0 0016 13.5v-11a.5.5 0 00-.293-.455c-.952-.433-2.48-.952-3.994-1.105C10.413.809 8.985.936 8 1.783z" />
                  </svg>
                  Create Back-Promotion PR
                </>
              )}
            </button>

            {prResult && (
              <div className="mt-4 px-3 py-3 bg-purple-900/30 border border-purple-700/40 rounded-lg">
                <div className="flex items-center gap-2 text-purple-300 text-sm font-medium mb-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  PR #{prResult.prNumber} created!
                </div>
                <a
                  href={prResult.prUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sf-blue hover:text-sf-blue-light text-xs underline break-all"
                >
                  {prResult.prUrl}
                </a>
                <div className="mt-1.5 text-xs text-gray-500">Branch: {prResult.branch}</div>
              </div>
            )}
          </div>
        )}

        {/* Export tab */}
        {activeTab === 'export' && (
          <div>
            <p className="text-gray-400 text-xs mb-4">
              Download a <code className="text-sf-blue">package.xml</code> file for the {count} selected component{count !== 1 ? 's' : ''}.
              Import it with <code className="text-gray-300">sf project deploy start --manifest package.xml</code>.
            </p>

            {/* Preview */}
            <div className="mb-4 bg-gray-900 border border-gray-700 rounded-lg p-3 text-xs font-mono text-gray-400 max-h-40 overflow-auto">
              <div className="text-gray-600">{`<?xml version="1.0" encoding="UTF-8"?>`}</div>
              <div className="text-gray-600">{`<Package xmlns="http://soap.sforce.com/2006/04/metadata">`}</div>
              {Object.entries(
                selectedResults.reduce((acc, r) => { (acc[r.type] = acc[r.type] || []).push(r.name); return acc }, {} as Record<string, string[]>)
              ).sort(([a], [b]) => a.localeCompare(b)).map(([type, names]) => (
                <div key={type}>
                  <div className="pl-4 text-gray-600">{'<types>'}</div>
                  {names.sort().map(n => (
                    <div key={n} className="pl-8 text-emerald-400">{`<members>${n}</members>`}</div>
                  ))}
                  <div className="pl-8 text-sf-blue">{`<name>${type}</name>`}</div>
                  <div className="pl-4 text-gray-600">{'</types>'}</div>
                </div>
              ))}
              <div className="pl-4 text-gray-500">{'<version>60.0</version>'}</div>
              <div className="text-gray-600">{'</Package>'}</div>
            </div>

            <button
              onClick={handleExportPackageXml}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-sf-blue hover:bg-sf-blue-dark text-white font-semibold rounded-lg transition-colors text-sm"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Download package.xml
            </button>
          </div>
        )}
      </div>
    </div>
    </>
  )
}
