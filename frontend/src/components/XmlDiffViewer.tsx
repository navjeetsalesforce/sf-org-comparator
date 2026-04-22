import React, { useState, useRef, useEffect } from 'react'
import type { ComparisonResult, DiffLine } from '../types'

interface Props {
  result: ComparisonResult | null
  onClose: () => void
  sourceOrgAlias: string
  targetOrgAlias: string
}

type ViewMode = 'split' | 'unified'

export default function XmlDiffViewer({ result, onClose, sourceOrgAlias, targetOrgAlias }: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>('split')
  const panelRef = useRef<HTMLDivElement>(null)

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  if (!result) return null

  const statusColors: Record<string, string> = {
    identical: 'text-emerald-400',
    different: 'text-amber-400',
    source_only: 'text-blue-400',
    target_only: 'text-red-400',
  }

  // ─── Split view renderer ─────────────────────────────────────────────────

  function renderSplit() {
    const diff = result!.diff

    // Reconstruct side-by-side lines
    type SideLine = { text: string; lineNum: number | null; type: 'equal' | 'added' | 'removed' | 'changed' | 'empty' }
    const leftLines: SideLine[] = []
    const rightLines: SideLine[] = []

    for (const d of diff) {
      if (d.type === 'equal') {
        leftLines.push({ text: d.line ?? '', lineNum: d.sourceLineNum ?? null, type: 'equal' })
        rightLines.push({ text: d.line ?? '', lineNum: d.targetLineNum ?? null, type: 'equal' })
      } else if (d.type === 'changed') {
        leftLines.push({ text: d.sourceLine ?? '', lineNum: d.sourceLineNum ?? null, type: 'changed' })
        rightLines.push({ text: d.targetLine ?? '', lineNum: d.targetLineNum ?? null, type: 'changed' })
      } else if (d.type === 'removed') {
        leftLines.push({ text: d.line ?? '', lineNum: d.sourceLineNum ?? null, type: 'removed' })
        rightLines.push({ text: '', lineNum: null, type: 'empty' })
      } else if (d.type === 'added') {
        leftLines.push({ text: '', lineNum: null, type: 'empty' })
        rightLines.push({ text: d.line ?? '', lineNum: d.targetLineNum ?? null, type: 'added' })
      }
    }

    // If source/target only — show full XML on one side
    if (diff.length === 0 || result!.status === 'identical') {
      const xmlLines = result!.sourceXml ? result!.sourceXml.split('\n') : result!.targetXml.split('\n')
      const side: SideLine[] = xmlLines.map((t, i) => ({ text: t, lineNum: i + 1, type: 'equal' }))
      return renderTwoColumns(side, side)
    }

    return renderTwoColumns(leftLines, rightLines)
  }

  function lineClass(type: string): string {
    switch (type) {
      case 'added':   return 'bg-emerald-900/40 text-emerald-300'
      case 'removed': return 'bg-red-900/40 text-red-300'
      case 'changed': return 'bg-amber-900/40 text-amber-200'
      case 'empty':   return 'bg-gray-900/50 text-transparent select-none'
      default:        return 'text-gray-300'
    }
  }

  function linePrefix(type: string): string {
    switch (type) {
      case 'added':   return '+'
      case 'removed': return '-'
      case 'changed': return '~'
      default:        return ' '
    }
  }

  type SideLine = { text: string; lineNum: number | null; type: string }

  function renderTwoColumns(left: SideLine[], right: SideLine[]) {
    return (
      <div className="grid grid-cols-2 gap-0 border border-gray-700 rounded-lg overflow-hidden text-xs font-mono">
        {/* Source panel */}
        <div className="border-r border-gray-700">
          <div className="bg-gray-900 px-3 py-2 border-b border-gray-700 text-gray-400 text-xs flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-400 inline-block" />
            {sourceOrgAlias} (source)
          </div>
          <div className="overflow-auto max-h-[55vh] bg-gray-900/50">
            {left.map((line, i) => (
              <div key={i} className={`flex min-w-0 ${lineClass(line.type)}`}>
                <span className="w-8 text-right pr-2 text-gray-600 select-none flex-shrink-0 border-r border-gray-700/50 py-0.5 pl-1">
                  {line.lineNum ?? ''}
                </span>
                <span className="w-4 text-center flex-shrink-0 py-0.5">{line.type !== 'empty' ? linePrefix(line.type) : ''}</span>
                <span className="px-2 py-0.5 whitespace-pre break-all flex-1 min-w-0">{line.text || ' '}</span>
              </div>
            ))}
          </div>
        </div>
        {/* Target panel */}
        <div>
          <div className="bg-gray-900 px-3 py-2 border-b border-gray-700 text-gray-400 text-xs flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-400 inline-block" />
            {targetOrgAlias} (target)
          </div>
          <div className="overflow-auto max-h-[55vh] bg-gray-900/50">
            {right.map((line, i) => (
              <div key={i} className={`flex min-w-0 ${lineClass(line.type)}`}>
                <span className="w-8 text-right pr-2 text-gray-600 select-none flex-shrink-0 border-r border-gray-700/50 py-0.5 pl-1">
                  {line.lineNum ?? ''}
                </span>
                <span className="w-4 text-center flex-shrink-0 py-0.5">{line.type !== 'empty' ? linePrefix(line.type) : ''}</span>
                <span className="px-2 py-0.5 whitespace-pre break-all flex-1 min-w-0">{line.text || ' '}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // ─── Unified view renderer ────────────────────────────────────────────────

  function renderUnified() {
    const diff = result!.diff
    if (!diff.length || result!.status === 'identical') {
      const xmlLines = (result!.sourceXml || result!.targetXml).split('\n')
      return (
        <div className="border border-gray-700 rounded-lg overflow-hidden text-xs font-mono bg-gray-900/50">
          {xmlLines.map((line, i) => (
            <div key={i} className="flex text-gray-300">
              <span className="w-10 text-right pr-2 text-gray-600 select-none border-r border-gray-700/50 py-0.5 flex-shrink-0">{i + 1}</span>
              <span className="px-2 py-0.5 whitespace-pre">{line || ' '}</span>
            </div>
          ))}
        </div>
      )
    }

    return (
      <div className="border border-gray-700 rounded-lg overflow-auto max-h-[60vh] text-xs font-mono bg-gray-900/50">
        {diff.map((d: DiffLine, i: number) => {
          if (d.type === 'equal') {
            return (
              <div key={i} className="flex text-gray-300">
                <span className="w-10 text-right pr-2 text-gray-600 select-none border-r border-gray-700/50 py-0.5 flex-shrink-0">{d.sourceLineNum}</span>
                <span className="w-4 text-center flex-shrink-0 py-0.5 text-gray-600"> </span>
                <span className="px-2 py-0.5 whitespace-pre">{d.line || ' '}</span>
              </div>
            )
          }
          if (d.type === 'removed') {
            return (
              <div key={i} className="flex bg-red-900/40 text-red-300">
                <span className="w-10 text-right pr-2 text-red-700 select-none border-r border-red-700/30 py-0.5 flex-shrink-0">{d.sourceLineNum}</span>
                <span className="w-4 text-center flex-shrink-0 py-0.5">-</span>
                <span className="px-2 py-0.5 whitespace-pre">{d.line || ' '}</span>
              </div>
            )
          }
          if (d.type === 'added') {
            return (
              <div key={i} className="flex bg-emerald-900/40 text-emerald-300">
                <span className="w-10 text-right pr-2 text-emerald-700 select-none border-r border-emerald-700/30 py-0.5 flex-shrink-0">{d.targetLineNum}</span>
                <span className="w-4 text-center flex-shrink-0 py-0.5">+</span>
                <span className="px-2 py-0.5 whitespace-pre">{d.line || ' '}</span>
              </div>
            )
          }
          if (d.type === 'changed') {
            return (
              <React.Fragment key={i}>
                <div className="flex bg-red-900/40 text-red-300">
                  <span className="w-10 text-right pr-2 text-red-700 select-none border-r border-red-700/30 py-0.5 flex-shrink-0">{d.sourceLineNum}</span>
                  <span className="w-4 text-center flex-shrink-0 py-0.5">-</span>
                  <span className="px-2 py-0.5 whitespace-pre">{d.sourceLine || ' '}</span>
                </div>
                <div className="flex bg-emerald-900/40 text-emerald-300">
                  <span className="w-10 text-right pr-2 text-emerald-700 select-none border-r border-emerald-700/30 py-0.5 flex-shrink-0">{d.targetLineNum}</span>
                  <span className="w-4 text-center flex-shrink-0 py-0.5">+</span>
                  <span className="px-2 py-0.5 whitespace-pre">{d.targetLine || ' '}</span>
                </div>
              </React.Fragment>
            )
          }
          return null
        })}
      </div>
    )
  }

  const diffStats = result.diff.reduce(
    (acc, d) => {
      if (d.type === 'added') acc.added++
      else if (d.type === 'removed') acc.removed++
      else if (d.type === 'changed') acc.changed++
      return acc
    },
    { added: 0, removed: 0, changed: 0 }
  )

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
        onClick={onClose}
      />

      {/* Slide-in panel */}
      <div
        ref={panelRef}
        className="fixed right-0 top-0 bottom-0 w-full max-w-5xl bg-gray-900 border-l border-gray-700 z-50 flex flex-col shadow-2xl"
        style={{ animation: 'slideIn 0.2s ease-out' }}
      >
        <style>{`
          @keyframes slideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
          }
        `}</style>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 bg-gray-800/80">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-xs font-mono text-gray-400 bg-gray-700 px-2 py-0.5 rounded flex-shrink-0">
              {result.type}
            </span>
            <span className="text-white font-semibold truncate">{result.name}</span>
            <span className={`text-xs font-medium flex-shrink-0 ${statusColors[result.status]}`}>
              {result.status.replace('_', ' ')}
            </span>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            {/* Diff stats */}
            {result.status === 'different' && (
              <div className="flex items-center gap-2 text-xs">
                {diffStats.added > 0 && <span className="text-emerald-400">+{diffStats.added}</span>}
                {diffStats.removed > 0 && <span className="text-red-400">-{diffStats.removed}</span>}
                {diffStats.changed > 0 && <span className="text-amber-400">~{diffStats.changed}</span>}
              </div>
            )}
            {/* View mode toggle */}
            <div className="flex bg-gray-700 rounded-lg p-0.5 text-xs">
              {(['split', 'unified'] as ViewMode[]).map(mode => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={`px-3 py-1 rounded-md transition-colors capitalize ${
                    viewMode === mode ? 'bg-sf-blue text-white' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
            {/* Close */}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Meta info */}
        <div className="px-5 py-2.5 bg-gray-800/40 border-b border-gray-700/50 flex items-center gap-6 text-xs text-gray-400">
          {result.sourceLastModified && (
            <span>
              <span className="text-gray-500">Source modified:</span>{' '}
              {new Date(result.sourceLastModified).toLocaleString()}
              {result.sourceLastModifiedBy && ` by ${result.sourceLastModifiedBy}`}
            </span>
          )}
          {result.targetLastModified && (
            <span>
              <span className="text-gray-500">Target modified:</span>{' '}
              {new Date(result.targetLastModified).toLocaleString()}
              {result.targetLastModifiedBy && ` by ${result.targetLastModifiedBy}`}
            </span>
          )}
        </div>

        {/* Diff content */}
        <div className="flex-1 overflow-auto p-5">
          {viewMode === 'split' ? renderSplit() : renderUnified()}
        </div>

        {/* Legend */}
        <div className="px-5 py-3 border-t border-gray-700 bg-gray-800/40 flex items-center gap-4 text-xs text-gray-400">
          <span className="font-medium">Legend:</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-emerald-900/60 border border-emerald-700/60" /> Added</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-red-900/60 border border-red-700/60" /> Removed</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-amber-900/60 border border-amber-700/60" /> Changed</span>
        </div>
      </div>
    </>
  )
}
