export type PueueState = 'Queued' | 'Running' | 'Paused' | 'Stashed' | 'Done' | 'Failed' | 'Killed' | 'Other'

export type PueueTask = {
  id: number
  label?: string
  cwd: string
  state: PueueState
  exit?: number
  createdMs?: number
  enqueuedMs?: number
  startMs?: number
  endMs?: number
  command: string
}

export type TranscriptEntry = { kind: 'text' | 'tool' | 'error'; text: string }

export type PiProgress = {
  offset: number
  partial: string
  tokens: number
  cost: number
  model?: string
  effort?: string
  lastActivity?: string
  lastEventMs?: number
  lastEventAssistant?: boolean
  files: string[]
  entries: TranscriptEntry[]
  error?: string
  models: Record<string, number>
}

export type TrackedTask = {
  id: number
  sessionId?: string
  runId?: string
  label?: string
  cwd: string
  addedMs: number
  task?: PueueTask
  finishedMs?: number
  dismissed?: boolean
}

export type HandoffState = { tasks: TrackedTask[]; available: boolean; selectedId?: number; showThinking?: boolean; showAll?: boolean; confirm?: { action: 'kill' | 'hold'; ids: number[]; atMs: number }; queue?: string }

export type HistoryCache = {
  path?: string
  size?: number
  mtimeMs?: number
  tokens?: number
  cost?: number
  tail?: string
  loading?: boolean
  available?: boolean
}

// One worktree of the repo the session is in, with the facts the pane shows. `live` counts fresh sessions inside it.
export type WorktreeRow = { path: string; head: string; branch?: string; detached: boolean; prunable: boolean; changes: number; ahead: number; behind: number; live: number }
export type WorktreeBranch = { name: string; upstream?: string; worktree?: string; ahead?: number; behind?: number }
export type WorktreeState = { open: boolean; legend: boolean; selected?: string; data?: { rows: WorktreeRow[]; branches: WorktreeBranch[]; at: number } }

// One PR the draft PRs pane lists. `at` is when it merged (merged) or last changed (open), in ms.
export type PrState = 'draft' | 'ready' | 'merged'
export type PrChecks = 'passing' | 'failing' | 'pending' | 'none'
export type DraftPr = { number: number; title: string; branch: string; url: string; state: PrState; checks: PrChecks; at: number }
export type ForgeId = 'github' | 'gitlab'
export type DraftPrsState = { loading: boolean; selected?: number; prs?: DraftPr[]; error?: string; forge?: ForgeId }

// The validator requires this contract to be self-contained (no imports), so the types the state
// below uses live here, and the hooks that own them re-export them from '../types'.

// A bash-safety block (hooks/safety-blocks.ts). `noted` is the logger's own note (a built-in
// guard refusal); only a human's `ok` or `false-positive` clears a block.
export type SafetyVerdict = 'ok' | 'false-positive' | 'noted'
export type SafetyBlock = { id: string; ts: string; session: string; cwd: string; transcript: string; rule: string; command: string; reason: string }
/** One logged block with the human verdict it has, if any. */
export type SafetyBlockRow = SafetyBlock & { verdict?: SafetyVerdict }

// The Blocks pane: this session's bash-safety blocks, newest first, with any human verdict.
export type SafetyBlocksState = { loading: boolean; rows: SafetyBlockRow[]; selected?: string }

// The gates pane (hooks/gates.ts, gates.tsx): specs awaiting approval and Pi runs awaiting review.
export type SpecState = 'draft' | 'approved' | 'stale' | 'invalid'
export type SpecRow = { kind: 'spec'; key: string; worktree: string; branch: string; path: string; rel: string; state?: SpecState; error?: string }
export type ReviewEntry = { runId: string; owner: string | null; branch: string; name: string; startedAt: string; processing: boolean; error: boolean; landed: boolean; decided: boolean; orphan: boolean }
export type ReviewRow = { kind: 'review'; key: string; worktree: string | null; entry: ReviewEntry }
export type GateRow = SpecRow | ReviewRow
export type GatesState = { rows: GateRow[]; headers: Record<string, string>; selected?: string; detail?: string; busy: string[]; last: Record<string, string>; confirm?: string; reviewsUnavailable?: boolean; hideOrphans?: boolean }

// The focus board (hooks/focus.ts) as `scripts/focus status --json` prints it, and its pane.
// `read_only` is set only when a cwd was passed to status.
export type FocusItem = { key: string; stage: string }
export type FocusState = { work: FocusItem | null; hobby: FocusItem | null; frozen: FocusItem[]; parked: string[]; read_only?: boolean; breaches?: string[]; no_board?: boolean }
export type FocusPaneState = { loading: boolean; state?: FocusState; selected?: string; error?: string }

// The blast-radius preview of a refused command (hooks/preview.ts).
export type PreviewTarget = { path: string; bytes?: number; tracked?: boolean }
export type PreviewFacts = { command: string; reason: string; targets?: readonly PreviewTarget[]; totalBytes?: number; unexpandedGlobs?: readonly string[]; dryRun?: { label: string; output: string } }

export type HistoryState = {
  tasks: PueueTask[]
  reviews: Record<number, 'pending' | 'decided, waiting for the next Pi run in this repo' | 'approved' | 'changes requested' | undefined>
  usage: Record<string, HistoryCache | undefined>
  /** Keyed `<id>:<endMs>` (pueue reuses ids): whether that finished Failed(1) run's log shows it left a review. */
  leftReviews: Record<string, boolean>
  filter: 'all' | 'done' | 'failed' | 'killed'
  limit: number
  selectedId?: number
  open: boolean
  available: boolean
}

export type GitSnapshot = {
  branch: string
  isDirty: boolean
  ahead: number
  behind: number
  hasUpstream: boolean
  stash: number
  worktree?: string
}

// Whole percentages as the status line showed them; absent off a subscription.
export type Usage = { ctx?: number; five?: number; seven?: number }

declare module 'claude-code' {
  interface PluginState {
    'session-band': {
      usage: Usage
      // Bumped by the heartbeat timer so a band on screen redraws, and so rewrites the heartbeat, on each beat.
      tick: number
      git: GitSnapshot | null
      outputStyle: string | null
      isNotified: boolean
      edits: number
      prompts: number
      handoff: HandoffState
      progress: Record<number, PiProgress>
      history: HistoryState
      worktrees: WorktreeState
      draftPrs: DraftPrsState
      gates: GatesState
      /** This session's own turn, so a patch landing waits while it is mid-turn. */
      'review-turn': { started: boolean }
      review: {
        tabs: { key: string; agent: string; kind: 'pi' | 'claude' | 'spec'; label: string; file: string; base: string; runId?: string; specPath?: string; shared?: string[]; unread?: boolean }[]
        selected?: string
        hunk: number
        worktree?: string
        focus?: { kind: 'pi' | 'claude' | 'spec'; runId?: string; specPath?: string; worktree?: string }
        composer?: { tab: string; kind: 'comment' | 'patch'; text: string }
        answerer?: Record<string, number>
        unread?: Record<string, boolean>
        notified?: string[]
        confirm?: string
        returned?: Record<string, string[]>
        note?: string
        findings?: Record<string, string[]>
        lens?: Record<string, string[]>
        checks?: Record<string, string>
      }
      sendIt: boolean
      safetyBlocks: SafetyBlocksState
      blastFacts: PreviewFacts | null
      /** True after a failed auto-clear save: compaction is back on until a later clear succeeds. */
      autoClearSaveFailed: boolean
      focusPane: FocusPaneState
    }
  }
}
