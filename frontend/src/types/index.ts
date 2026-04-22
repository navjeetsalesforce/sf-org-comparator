// ─── Org ───────────────────────────────────────────────────────────────────

export interface SalesforceOrg {
  alias: string
  username: string
  instanceUrl: string
  isDefault: boolean
  orgId?: string
}

// ─── Comparison ────────────────────────────────────────────────────────────

export type ComparisonStatus = 'identical' | 'different' | 'source_only' | 'target_only'

export interface DiffLine {
  type: 'equal' | 'added' | 'removed' | 'changed'
  line?: string        // for equal / added / removed
  sourceLine?: string  // for changed
  targetLine?: string  // for changed
  sourceLineNum?: number | null
  targetLineNum?: number | null
}

export interface ComparisonResult {
  type: string
  name: string
  status: ComparisonStatus
  sourceLastModified: string
  targetLastModified: string
  sourceLastModifiedBy: string
  targetLastModifiedBy: string
  sourceXml: string
  targetXml: string
  diff: DiffLine[]
}

export interface ComparisonSummary {
  total: number
  identical: number
  different: number
  source_only: number
  target_only: number
}

export interface CompareResponse {
  results: ComparisonResult[]
  summary: ComparisonSummary
  mock: boolean
}

// ─── Validation ────────────────────────────────────────────────────────────

export interface ComponentRef {
  type: string
  name: string
}

export interface ValidationComponentResult {
  type: string
  name: string
  status: 'passed' | 'failed' | 'unknown'
  error: string | null
}

export interface ValidationResponse {
  success: boolean
  components: ValidationComponentResult[]
  error?: string
  mock?: boolean
}

// ─── PR ────────────────────────────────────────────────────────────────────

export interface PRResponse {
  success: boolean
  prUrl: string
  prNumber: number
  branch: string
}

// ─── Conflict Resolution ───────────────────────────────────────────────────

export type ConfidenceLevel = 'high' | 'medium' | 'low'
export type ResolutionStatus = 'pending' | 'approved' | 'rejected'

export interface ConflictLine {
  lineNumber: number | null
  type: 'conflict' | 'addition' | 'deletion' | 'ordering'
  sourceValue: string
  targetValue: string
  description: string
}

export interface ConflictResolution {
  type: string
  name: string
  sourceXml: string
  targetXml: string
  proposedXml: string
  explanation: string
  confidence: ConfidenceLevel
  autoResolvable: boolean
  conflictLines: ConflictLine[]
  status: ResolutionStatus
  demoMode?: boolean
}

export interface AnalyseConflictsRequest {
  components: Array<{
    type: string
    name: string
    sourceXml: string
    targetXml: string
  }>
  conflictContext: string
}

export interface AnalyseConflictsResponse {
  resolutions: ConflictResolution[]
  demoMode: boolean
  totalCount: number
}

export interface ApplyResolutionsRequest {
  approvedResolutions: Array<{
    type: string
    name: string
    proposedXml: string
  }>
  branch: string
  repo: string
}

export interface ApplyResolutionsResponse {
  success: boolean
  committedFiles: string[]
  errors: string[]
  message: string
}
