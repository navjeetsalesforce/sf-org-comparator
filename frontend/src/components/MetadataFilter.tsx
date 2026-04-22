import React, { useState } from 'react'

interface Category {
  label: string
  icon: string
  types: string[]
}

const CATEGORIES: Category[] = [
  {
    label: 'Apex',
    icon: '☁️',
    types: [
      'ApexClass',
      'ApexTrigger',
      'ApexPage',
      'ApexComponent',
      'ApexEmailNotifications',
    ],
  },
  {
    label: 'Lightning & UI',
    icon: '🔵',
    types: [
      'LightningComponentBundle',
      'AuraDefinitionBundle',
      'FlexiPage',
      'Layout',
      'CompactLayout',
      'CustomTab',
      'CustomApplication',
      'AppMenu',
      'GlobalValueSet',
      'StandardValueSet',
      'CustomPageWebLink',
    ],
  },
  {
    label: 'Automation',
    icon: '🔀',
    types: [
      'Flow',
      'FlowDefinition',
      'WorkflowRule',
      'WorkflowAlert',
      'WorkflowFieldUpdate',
      'WorkflowTask',
      'WorkflowOutboundMessage',
      'AutoResponseRule',
      'AssignmentRule',
      'EscalationRule',
      'MilestoneType',
    ],
  },
  {
    label: 'Objects & Fields',
    icon: '📦',
    types: [
      'CustomObject',
      'CustomField',
      'ValidationRule',
      'CustomMetadata',
      'CustomSetting',
      'ExternalObject',
      'PlatformEvent',
      'CustomIndex',
      'FieldSet',
      'RecordType',
      'SharingReason',
      'ListView',
      'WebLink',
    ],
  },
  {
    label: 'Security & Access',
    icon: '🔐',
    types: [
      'Profile',
      'PermissionSet',
      'PermissionSetGroup',
      'MutingPermissionSet',
      'CustomPermission',
      'Role',
      'Group',
      'Queue',
      'SharingRules',
      'SharingCriteriaRule',
      'SharingOwnerRule',
      'Territory2',
      'Territory2Model',
      'Territory2Rule',
      'Territory2Type',
    ],
  },
  {
    label: 'Integrations',
    icon: '🔌',
    types: [
      'ConnectedApp',
      'NamedCredential',
      'ExternalCredential',
      'RemoteSiteSetting',
      'CspTrustedSite',
      'CustomNotificationType',
      'PlatformEventChannel',
      'PlatformEventChannelMember',
      'ExternalDataSource',
    ],
  },
  {
    label: 'Experience Cloud',
    icon: '🌐',
    types: [
      'ExperienceBundle',
      'Network',
      'CustomSite',
      'SiteDotCom',
      'NavigationMenu',
      'ManagedContentType',
    ],
  },
  {
    label: 'Reports & Dashboards',
    icon: '📊',
    types: ['Report', 'Dashboard', 'ReportType'],
  },
  {
    label: 'Config & Labels',
    icon: '⚙️',
    types: [
      'CustomLabel',
      'CustomLabels',
      'Settings',
      'OrgPreferenceSettings',
      'LeadConvertSettings',
      'CaseSettings',
      'EmailServicesFunction',
      'HomePageLayout',
      'HomePageComponent',
    ],
  },
  {
    label: 'Matching & Duplicates',
    icon: '🔍',
    types: ['MatchingRule', 'DuplicateRule'],
  },
  {
    label: 'Packages',
    icon: '📦',
    types: ['InstalledPackage'],
  },
]

const ALL_TYPES = CATEGORIES.flatMap(c => c.types)

interface Props {
  selected: string[]
  onChange: (types: string[]) => void
  collapsed: boolean
  onToggle: () => void
}

export default function MetadataFilter({ selected, onChange, collapsed, onToggle }: Props) {
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>(
    Object.fromEntries(CATEGORIES.map(c => [c.label, true]))
  )

  const toggleType = (type: string) => {
    onChange(selected.includes(type) ? selected.filter(t => t !== type) : [...selected, type])
  }

  const toggleCategory = (cat: Category) => {
    const allSelected = cat.types.every(t => selected.includes(t))
    if (allSelected) {
      onChange(selected.filter(t => !cat.types.includes(t)))
    } else {
      const newSelected = [...new Set([...selected, ...cat.types])]
      onChange(newSelected)
    }
  }

  const toggleCategoryExpand = (label: string) => {
    setExpandedCategories(prev => ({ ...prev, [label]: !prev[label] }))
  }

  const selectAll = () => onChange([...ALL_TYPES])
  const clearAll = () => onChange([])

  const getCategoryState = (cat: Category): 'all' | 'some' | 'none' => {
    const count = cat.types.filter(t => selected.includes(t)).length
    if (count === cat.types.length) return 'all'
    if (count > 0) return 'some'
    return 'none'
  }

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-700/50 transition-colors"
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

      {!collapsed && (
        <div className="px-4 pb-4">
          {/* Global controls */}
          <div className="flex items-center gap-3 mb-3 pb-3 border-b border-gray-700">
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
              Clear All
            </button>
            <span className="text-gray-600 ml-auto text-xs">{CATEGORIES.length} categories</span>
          </div>

          {/* Categories */}
          <div className="space-y-1">
            {CATEGORIES.map(cat => {
              const state = getCategoryState(cat)
              const isExpanded = expandedCategories[cat.label]
              const selectedCount = cat.types.filter(t => selected.includes(t)).length

              return (
                <div key={cat.label} className="rounded-lg overflow-hidden">
                  {/* Category header row */}
                  <div className="flex items-center gap-1">
                    {/* Category checkbox */}
                    <div
                      onClick={() => toggleCategory(cat)}
                      className={`flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center cursor-pointer transition-colors ${
                        state === 'all'
                          ? 'bg-sf-blue border-sf-blue'
                          : state === 'some'
                          ? 'bg-sf-blue/30 border-sf-blue'
                          : 'border-gray-500 bg-transparent'
                      }`}
                    >
                      {state === 'all' && (
                        <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                      {state === 'some' && (
                        <div className="w-2 h-0.5 bg-sf-blue" />
                      )}
                    </div>

                    {/* Category label + expand toggle */}
                    <button
                      onClick={() => toggleCategoryExpand(cat.label)}
                      className="flex-1 flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-gray-700/50 transition-colors text-left"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs">{cat.icon}</span>
                        <span className={`text-xs font-semibold ${state !== 'none' ? 'text-white' : 'text-gray-400'}`}>
                          {cat.label}
                        </span>
                        <span className="text-xs text-gray-600">
                          {selectedCount > 0 ? `${selectedCount}/${cat.types.length}` : `${cat.types.length}`}
                        </span>
                      </div>
                      <svg
                        className={`w-3 h-3 text-gray-500 transition-transform duration-150 ${isExpanded ? 'rotate-180' : ''}`}
                        fill="none" stroke="currentColor" viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  </div>

                  {/* Individual types */}
                  {isExpanded && (
                    <div className="ml-5 mt-0.5 space-y-0.5 pb-1">
                      {cat.types.map(type => {
                        const checked = selected.includes(type)
                        return (
                          <label
                            key={type}
                            className={`flex items-center gap-2 px-2 py-1 rounded-md cursor-pointer transition-colors select-none ${
                              checked ? 'bg-sf-blue/10 hover:bg-sf-blue/15' : 'hover:bg-gray-700/40'
                            }`}
                          >
                            <div
                              onClick={() => toggleType(type)}
                              className={`flex-shrink-0 w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors ${
                                checked ? 'bg-sf-blue border-sf-blue' : 'border-gray-600 bg-transparent'
                              }`}
                            >
                              {checked && (
                                <svg className="w-2 h-2 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                </svg>
                              )}
                            </div>
                            <input type="checkbox" className="sr-only" checked={checked} onChange={() => toggleType(type)} />
                            <span className={`text-xs leading-none font-mono ${checked ? 'text-gray-200' : 'text-gray-500'}`}>
                              {type}
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
