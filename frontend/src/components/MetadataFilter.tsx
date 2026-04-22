import React from 'react'

const ALL_TYPES = [
  'ApexClass',
  'ApexTrigger',
  'LightningComponentBundle',
  'AuraDefinitionBundle',
  'Flow',
  'CustomObject',
  'CustomField',
  'Profile',
  'PermissionSet',
  'Layout',
  'CustomTab',
  'CustomApplication',
  'ValidationRule',
  'WorkflowRule',
]

const TYPE_ICONS: Record<string, string> = {
  ApexClass: '☁️',
  ApexTrigger: '⚡',
  LightningComponentBundle: '🔵',
  AuraDefinitionBundle: '🔆',
  Flow: '🔀',
  CustomObject: '📦',
  CustomField: '🏷️',
  Profile: '👤',
  PermissionSet: '🔐',
  Layout: '📐',
  CustomTab: '📑',
  CustomApplication: '📱',
  ValidationRule: '✅',
  WorkflowRule: '⚙️',
}

interface Props {
  selected: string[]
  onChange: (types: string[]) => void
  collapsed: boolean
  onToggle: () => void
}

export default function MetadataFilter({ selected, onChange, collapsed, onToggle }: Props) {
  const toggle = (type: string) => {
    if (selected.includes(type)) {
      onChange(selected.filter(t => t !== type))
    } else {
      onChange([...selected, type])
    }
  }

  const selectAll = () => onChange([...ALL_TYPES])
  const clearAll = () => onChange([])

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-750 transition-colors"
      >
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-sf-blue" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
          </svg>
          <span className="text-white font-semibold text-sm">Metadata Types</span>
          <span className="text-xs bg-sf-blue/20 text-sf-blue px-1.5 py-0.5 rounded font-medium">
            {selected.length}/{ALL_TYPES.length}
          </span>
        </div>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${collapsed ? '' : 'rotate-180'}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Body */}
      {!collapsed && (
        <div className="px-4 pb-4">
          {/* Select All / Clear */}
          <div className="flex gap-2 mb-3">
            <button
              onClick={selectAll}
              className="text-xs text-sf-blue hover:text-sf-blue-light transition-colors underline underline-offset-2"
            >
              Select All
            </button>
            <span className="text-gray-600">·</span>
            <button
              onClick={clearAll}
              className="text-xs text-gray-400 hover:text-gray-200 transition-colors underline underline-offset-2"
            >
              Clear
            </button>
          </div>

          {/* Checkboxes */}
          <div className="space-y-1">
            {ALL_TYPES.map(type => {
              const checked = selected.includes(type)
              return (
                <label
                  key={type}
                  className={`flex items-center gap-2.5 px-2 py-1.5 rounded-lg cursor-pointer transition-colors select-none ${
                    checked ? 'bg-sf-blue/10 hover:bg-sf-blue/15' : 'hover:bg-gray-700/50'
                  }`}
                >
                  <div
                    onClick={() => toggle(type)}
                    className={`flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                      checked
                        ? 'bg-sf-blue border-sf-blue'
                        : 'border-gray-500 bg-transparent'
                    }`}
                  >
                    {checked && (
                      <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                  <input type="checkbox" className="sr-only" checked={checked} onChange={() => toggle(type)} />
                  <span className="text-sm leading-none">
                    {TYPE_ICONS[type] && <span className="mr-1 text-xs">{TYPE_ICONS[type]}</span>}
                    <span className={checked ? 'text-white' : 'text-gray-400'}>{type}</span>
                  </span>
                </label>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
