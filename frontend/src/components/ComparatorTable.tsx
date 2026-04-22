import React, { useState, useMemo } from 'react'
import type { ComparisonResult, ComparisonStatus, ComparisonSummary } from '../types'

interface Props {
  results: ComparisonResult[]
  summary: ComparisonSummary | null
  loading: boolean
  selectedRows: Set<string>
  onRowSelect: (key: string, checked: boolean) => void
  onSelectAll: (checked: boolean) => void
  onRowClick: (result: ComparisonResult) => void
  activeRow: string | null
}

const STATUS_CONFIG: Record<ComparisonStatus, { label: string; color: string; dot: string; bg: string }> = {
  identical:   { label: 'Identical',    color: 'text-emerald-400', dot: 'bg-emerald-400',  bg: 'bg-emerald-900/20 border-emerald-700/40' },
  different:   { label: 'Different',    color: 'text-amber-400',   dot: 'bg-amber-400',    bg: 'bg-amber-900/20 border-amber-700/40' },
  source_only: { label: 'Source Only',  color: 'text-blue-400',    dot: 'bg-blue-400',     bg: 'bg-blue-900/20 border-blue-700/40' },
  target_only: { label: 'Target Only',  color: 'text-red-400',     dot: 'bg-red-400',      bg: 'bg-red-900/20 border-red-700/40' },
}

function StatusBadge({ status }: { status: ComparisonStatus }) {
  const cfg = STATUS_CONFIG[status]
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.bg} ${cfg.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  )
}

function SkeletonRow() {
  return (
    <tr className="border-b border-gray-700/50">
      {[...Array(6)].map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="skeleton h-4 rounded" style={{ width: `${60 + Math.random() * 40}%` }} />
        </td>
      ))}
    </tr>
  )
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '—'
  try {
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return dateStr
  }
}

const rowKey = (r: ComparisonResult) => `${r.type}::${r.name}`

export default function ComparatorTable({
  results,
  summary,
  loading,
  selectedRows,
  onRowSelect,
  onSelectAll,
  onRowClick,
  activeRow,
}: Props) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<ComparisonStatus | 'all'>('all')
  const [sortField, setSortField] = useState<'type' | 'name' | 'status' | 'sourceLastModified' | 'targetLastModified'>('status')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const filtered = useMemo(() => {
    let out = [...results]
    if (search.trim()) {
      const q = search.toLowerCase()
      out = out.filter(r => r.name.toLowerCase().includes(q) || r.type.toLowerCase().includes(q))
    }
    if (statusFilter !== 'all') {
      out = out.filter(r => r.status === statusFilter)
    }
    out.sort((a, b) => {
      let cmp = 0
      const statusOrder: Record<ComparisonStatus, number> = { different: 0, source_only: 1, target_only: 2, identical: 3 }
      if (sortField === 'status') cmp = statusOrder[a.status] - statusOrder[b.status]
      else if (sortField === 'type') cmp = a.type.localeCompare(b.type)
      else if (sortField === 'name') cmp = a.name.localeCompare(b.name)
      else if (sortField === 'sourceLastModified') cmp = a.sourceLastModified.localeCompare(b.sourceLastModified)
      else if (sortField === 'targetLastModified') cmp = a.targetLastModified.localeCompare(b.targetLastModified)
      return sortDir === 'asc' ? cmp : -cmp
    })
    return out
  }, [results, search, statusFilter, sortField, sortDir])

  const allVisibleSelected = filtered.length > 0 && filtered.every(r => selectedRows.has(rowKey(r)))
  const someSelected = filtered.some(r => selectedRows.has(rowKey(r)))

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }

  const SortIcon = ({ field }: { field: typeof sortField }) => {
    if (sortField !== field) return <span className="text-gray-600 ml-1">↕</span>
    return <span className="text-sf-blue ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Summary Bar */}
      {summary && !loading && (
        <div className="grid grid-cols-5 gap-2">
          {[
            { label: 'Total', value: summary.total, color: 'text-white', bg: 'bg-gray-700/60' },
            { label: 'Identical', value: summary.identical, color: 'text-emerald-400', bg: 'bg-emerald-900/30' },
            { label: 'Different', value: summary.different, color: 'text-amber-400', bg: 'bg-amber-900/30' },
            { label: 'Source Only', value: summary.source_only, color: 'text-blue-400', bg: 'bg-blue-900/30' },
            { label: 'Target Only', value: summary.target_only, color: 'text-red-400', bg: 'bg-red-900/30' },
          ].map(({ label, value, color, bg }) => (
            <button
              key={label}
              onClick={() => {
                const map: Record<string, ComparisonStatus | 'all'> = {
                  Total: 'all', Identical: 'identical', Different: 'different', 'Source Only': 'source_only', 'Target Only': 'target_only'
                }
                setStatusFilter(map[label] ?? 'all')
              }}
              className={`${bg} rounded-lg px-3 py-2.5 text-center hover:brightness-110 transition-all cursor-pointer border border-transparent hover:border-gray-600`}
            >
              <div className={`text-xl font-bold ${color}`}>{value}</div>
              <div className="text-xs text-gray-400 mt-0.5">{label}</div>
            </button>
          ))}
        </div>
      )}

      {/* Search + Filter bar */}
      <div className="flex gap-3 items-center">
        <div className="relative flex-1">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search components…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 text-white pl-9 pr-3 py-2 rounded-lg text-sm focus:outline-none focus:border-sf-blue focus:ring-1 focus:ring-sf-blue placeholder-gray-500"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as ComparisonStatus | 'all')}
          className="bg-gray-800 border border-gray-700 text-gray-300 px-3 py-2 rounded-lg text-sm focus:outline-none focus:border-sf-blue"
        >
          <option value="all">All Statuses</option>
          <option value="different">Different</option>
          <option value="source_only">Source Only</option>
          <option value="target_only">Target Only</option>
          <option value="identical">Identical</option>
        </select>
        {(search || statusFilter !== 'all') && (
          <span className="text-xs text-gray-400">
            {filtered.length} of {results.length} shown
          </span>
        )}
      </div>

      {/* Table */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 bg-gray-900/50">
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    ref={el => { if (el) el.indeterminate = someSelected && !allVisibleSelected }}
                    onChange={e => onSelectAll(e.target.checked)}
                    className="w-4 h-4 accent-sf-blue cursor-pointer"
                  />
                </th>
                <th
                  className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-white"
                  onClick={() => handleSort('type')}
                >
                  Type <SortIcon field="type" />
                </th>
                <th
                  className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-white"
                  onClick={() => handleSort('name')}
                >
                  Component Name <SortIcon field="name" />
                </th>
                <th
                  className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-white"
                  onClick={() => handleSort('status')}
                >
                  Status <SortIcon field="status" />
                </th>
                <th
                  className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-white"
                  onClick={() => handleSort('sourceLastModified')}
                >
                  Modified (Source) <SortIcon field="sourceLastModified" />
                </th>
                <th
                  className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-white"
                  onClick={() => handleSort('targetLastModified')}
                >
                  Modified (Target) <SortIcon field="targetLastModified" />
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/50">
              {loading
                ? [...Array(8)].map((_, i) => <SkeletonRow key={i} />)
                : filtered.length === 0
                  ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-12 text-center text-gray-500">
                        {results.length === 0
                          ? 'Run a comparison to see results'
                          : 'No components match your filters'}
                      </td>
                    </tr>
                  )
                  : filtered.map(result => {
                    const key = rowKey(result)
                    const isSelected = selectedRows.has(key)
                    const isActive = activeRow === key
                    return (
                      <tr
                        key={key}
                        onClick={() => onRowClick(result)}
                        className={`cursor-pointer transition-colors ${
                          isActive
                            ? 'bg-sf-blue/10 border-l-2 border-l-sf-blue'
                            : isSelected
                              ? 'bg-gray-700/40'
                              : 'hover:bg-gray-700/30'
                        }`}
                      >
                        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={e => onRowSelect(key, e.target.checked)}
                            className="w-4 h-4 accent-sf-blue cursor-pointer"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs font-mono text-gray-300 bg-gray-700/60 px-1.5 py-0.5 rounded">
                            {result.type}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-white font-medium">{result.name}</span>
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={result.status} />
                        </td>
                        <td className="px-4 py-3 text-gray-400 text-xs">
                          <div>{formatDate(result.sourceLastModified)}</div>
                          {result.sourceLastModifiedBy && (
                            <div className="text-gray-600 truncate max-w-32">{result.sourceLastModifiedBy}</div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-400 text-xs">
                          <div>{formatDate(result.targetLastModified)}</div>
                          {result.targetLastModifiedBy && (
                            <div className="text-gray-600 truncate max-w-32">{result.targetLastModifiedBy}</div>
                          )}
                        </td>
                        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                          <button
                            onClick={() => onRowClick(result)}
                            className="text-xs text-sf-blue hover:text-sf-blue-light border border-sf-blue/30 hover:border-sf-blue px-2 py-1 rounded transition-colors"
                          >
                            View Diff
                          </button>
                        </td>
                      </tr>
                    )
                  })
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
