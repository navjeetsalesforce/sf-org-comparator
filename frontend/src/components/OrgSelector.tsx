import React, { useEffect, useState } from 'react'
import type { SalesforceOrg } from '../types'

interface SessionState {
  checking: boolean
  valid: boolean | null
  message: string
}

interface Props {
  sourceOrg: string
  targetOrg: string
  onSourceChange: (alias: string) => void
  onTargetChange: (alias: string) => void
  onCompare: () => void
  loading: boolean
  useMock: boolean
  onMockToggle: (v: boolean) => void
}

export default function OrgSelector({
  sourceOrg, targetOrg, onSourceChange, onTargetChange,
  onCompare, loading, useMock, onMockToggle,
}: Props) {
  const [orgs, setOrgs] = useState<SalesforceOrg[]>([])
  const [fetching, setFetching] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [srcSession, setSrcSession] = useState<SessionState>({ checking: false, valid: null, message: '' })
  const [tgtSession, setTgtSession] = useState<SessionState>({ checking: false, valid: null, message: '' })

  useEffect(() => {
    const fetchOrgs = async () => {
      setFetching(true)
      setLoadError(null)
      try {
        const res = await fetch('/api/orgs')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data: SalesforceOrg[] = await res.json()
        setOrgs(data)
        if (data.length >= 1 && !sourceOrg) onSourceChange(data[0].alias)
        if (data.length >= 2 && !targetOrg) onTargetChange(data[data.length - 1].alias)
      } catch {
        setLoadError('Could not load orgs — showing mock orgs. Enable Demo Mode or authenticate orgs via: sf org login web')
        const mockOrgs: SalesforceOrg[] = [
          { alias: 'dev-sandbox', username: 'dev@myorg.com.sandbox', instanceUrl: 'https://myorg--dev.sandbox.my.salesforce.com', isDefault: true },
          { alias: 'staging', username: 'dev@myorg.com.staging', instanceUrl: 'https://myorg--staging.sandbox.my.salesforce.com', isDefault: false },
          { alias: 'production', username: 'admin@myorg.com', instanceUrl: 'https://myorg.my.salesforce.com', isDefault: false },
        ]
        setOrgs(mockOrgs)
        if (!sourceOrg) onSourceChange(mockOrgs[0].alias)
        if (!targetOrg) onTargetChange(mockOrgs[mockOrgs.length - 1].alias)
      } finally {
        setFetching(false)
      }
    }
    fetchOrgs()
  }, [])

  const checkSession = async (alias: string, setter: React.Dispatch<React.SetStateAction<SessionState>>) => {
    if (!alias || useMock) return
    setter({ checking: true, valid: null, message: '' })
    try {
      const res = await fetch(`/api/orgs/check?alias=${encodeURIComponent(alias)}`)
      const data = await res.json()
      setter({ checking: false, valid: data.valid, message: data.message })
    } catch {
      setter({ checking: false, valid: false, message: 'Could not reach backend' })
    }
  }

  const handleSourceChange = (alias: string) => {
    onSourceChange(alias)
    setSrcSession({ checking: false, valid: null, message: '' })
  }

  const handleTargetChange = (alias: string) => {
    onTargetChange(alias)
    setTgtSession({ checking: false, valid: null, message: '' })
  }

  const handleVerifyAndCompare = async () => {
    if (useMock) { onCompare(); return }
    // Check both sessions before triggering comparison
    await Promise.all([
      checkSession(sourceOrg, setSrcSession),
      checkSession(targetOrg, setTgtSession),
    ])
    // Re-read state via a small delay then proceed — React batches state updates
    // so we proceed optimistically and rely on error display if it fails
    onCompare()
  }

  const sessionBadge = (s: SessionState) => {
    if (s.checking) return <span className="text-xs text-gray-400 flex items-center gap-1"><span className="inline-block w-3 h-3 border border-gray-500 border-t-transparent rounded-full animate-spin" />Checking…</span>
    if (s.valid === true) return <span className="text-xs text-emerald-400 flex items-center gap-1">✓ Session active</span>
    if (s.valid === false) return <span className="text-xs text-red-400 flex items-center gap-1">✗ {s.message}</span>
    return null
  }

  const selectedSource = orgs.find(o => o.alias === sourceOrg)
  const selectedTarget = orgs.find(o => o.alias === targetOrg)
  const canCompare = !loading && !fetching && sourceOrg && targetOrg && sourceOrg !== targetOrg

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-white font-semibold text-base flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-sf-blue inline-block" />
          Select Orgs to Compare
        </h2>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <span className="text-xs text-gray-400">Demo mode</span>
          <div
            onClick={() => { onMockToggle(!useMock); setSrcSession({ checking: false, valid: null, message: '' }); setTgtSession({ checking: false, valid: null, message: '' }) }}
            className={`relative w-9 h-5 rounded-full transition-colors duration-200 ${useMock ? 'bg-sf-blue' : 'bg-gray-600'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${useMock ? 'translate-x-4' : ''}`} />
          </div>
        </label>
      </div>

      {loadError && (
        <div className="mb-3 px-3 py-2 bg-yellow-900/30 border border-yellow-700/50 rounded-lg text-yellow-400 text-xs">
          ⚠ {loadError}
        </div>
      )}

      {!useMock && (srcSession.valid === false || tgtSession.valid === false) && (
        <div className="mb-3 px-3 py-2 bg-red-900/30 border border-red-700/50 rounded-lg text-red-400 text-xs space-y-1">
          <p className="font-semibold">Session issue detected — re-authenticate the org then try again:</p>
          <code className="block bg-gray-900 px-2 py-1 rounded text-red-300">sf org login web --alias {srcSession.valid === false ? sourceOrg : targetOrg}</code>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Source Org */}
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1.5 uppercase tracking-wider">Source Org</label>
          <select
            value={sourceOrg}
            onChange={e => handleSourceChange(e.target.value)}
            disabled={fetching || loading}
            className="w-full bg-gray-900 border border-gray-600 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sf-blue focus:ring-1 focus:ring-sf-blue disabled:opacity-50"
          >
            {fetching ? <option>Loading orgs…</option> : orgs.map(o => (
              <option key={o.alias} value={o.alias}>{o.alias} — {o.username}</option>
            ))}
          </select>
          <div className="mt-1.5 flex items-center justify-between gap-2">
            {selectedSource && <span className="text-xs text-gray-500 truncate"><span className="text-gray-400">URL:</span> {selectedSource.instanceUrl}</span>}
            {!useMock && sourceOrg && <button onClick={() => checkSession(sourceOrg, setSrcSession)} className="text-xs text-sf-blue hover:underline whitespace-nowrap flex-shrink-0">Verify session</button>}
          </div>
          <div className="mt-1">{sessionBadge(srcSession)}</div>
        </div>

        {/* Target Org */}
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1.5 uppercase tracking-wider">Target Org</label>
          <select
            value={targetOrg}
            onChange={e => handleTargetChange(e.target.value)}
            disabled={fetching || loading}
            className="w-full bg-gray-900 border border-gray-600 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sf-blue focus:ring-1 focus:ring-sf-blue disabled:opacity-50"
          >
            {fetching ? <option>Loading orgs…</option> : orgs.map(o => (
              <option key={o.alias} value={o.alias}>{o.alias} — {o.username}</option>
            ))}
          </select>
          <div className="mt-1.5 flex items-center justify-between gap-2">
            {selectedTarget && <span className="text-xs text-gray-500 truncate"><span className="text-gray-400">URL:</span> {selectedTarget.instanceUrl}</span>}
            {!useMock && targetOrg && <button onClick={() => checkSession(targetOrg, setTgtSession)} className="text-xs text-sf-blue hover:underline whitespace-nowrap flex-shrink-0">Verify session</button>}
          </div>
          <div className="mt-1">{sessionBadge(tgtSession)}</div>
        </div>
      </div>

      {/* Instruction banner for real orgs */}
      {!useMock && (
        <div className="mt-3 px-3 py-2 bg-gray-900/60 border border-gray-700 rounded-lg text-xs text-gray-500">
          <span className="text-gray-400 font-medium">Before comparing:</span> Authenticate each sandbox with{' '}
          <code className="text-sf-blue bg-gray-800 px-1 rounded">sf org login web --alias &lt;name&gt;</code>
          {' '}then click <span className="text-gray-300">Verify session</span> above.
        </div>
      )}

      <div className="mt-4 flex items-center gap-3 flex-wrap">
        <button
          onClick={handleVerifyAndCompare}
          disabled={!canCompare}
          className="flex items-center gap-2 px-5 py-2.5 bg-sf-blue hover:bg-sf-blue-dark text-white font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
        >
          {loading ? (
            <><svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>Comparing…</>
          ) : (
            <><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>Compare Orgs</>
          )}
        </button>

        {sourceOrg === targetOrg && sourceOrg && (
          <span className="text-xs text-red-400">Source and target must be different orgs</span>
        )}
        {useMock && (
          <span className="text-xs text-sf-blue bg-sf-blue/10 border border-sf-blue/30 px-2 py-1 rounded">
            Demo mode — no Salesforce auth required
          </span>
        )}
      </div>
    </div>
  )
}
