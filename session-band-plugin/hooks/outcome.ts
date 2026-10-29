/** The one set of outcome rules: pueue, the review gate, Pi's log and the saved check record. */

export type CheckRecord = {
  phase: 'checking' | 'done'
  commit: string
  diffHash: string
  specStatus: 'approved' | 'none' | 'manual-only'
  passed?: boolean
  round: number
  steered: boolean
}

export type OutcomeInputs = {
  pueue: { state: 'Queued' | 'Running' | 'Paused' | 'Done' | 'Failed' | 'Killed' | 'Other'; exit?: number }
  /** herdr agent_status; undefined when there is no pane. */
  agentStatus?: string
  /** now minus the session log's last write. */
  logAgeMs?: number
  reviewPending: boolean
  check?: CheckRecord
  head?: { commit: string; diffHash: string }
}

export type Outcome = 'queued' | 'running' | 'stuck' | 'killed' | 'failed' | 'checking' | 'fixing'
  | 'checks failed' | 'checks stale' | 'checks passed' | 'finished, manual checks only' | 'finished, no spec' | 'finished'

export type OutcomeTone = 'green' | 'red' | 'yellow' | 'muted'

export type DerivedOutcome = {
  outcome: Outcome
  round?: number
  tone: OutcomeTone
  reviewWaiting: boolean
}

/** Ten minutes without a session-log write. */
export const STUCK_MS = 600_000

const toneOf = (outcome: Outcome): OutcomeTone => {
  if (outcome === 'checks passed') return 'green'
  if (outcome === 'failed' || outcome === 'checks failed' || outcome === 'stuck') return 'red'
  if (outcome === 'checking' || outcome === 'fixing' || outcome === 'checks stale') return 'yellow'
  return 'muted'
}

const current = (check: CheckRecord, head: OutcomeInputs['head']): boolean =>
  head !== undefined && check.commit === head.commit && check.diffHash === head.diffHash

export const deriveOutcome = (input: OutcomeInputs): DerivedOutcome => {
  const { pueue, check } = input
  const derive = (outcome: Outcome, round?: number): DerivedOutcome => ({
    outcome,
    ...(round !== undefined ? { round } : {}),
    tone: toneOf(outcome),
    reviewWaiting: input.reviewPending,
  })
  // 1. pueue's own non-run states.
  if (pueue.state === 'Queued' || pueue.state === 'Paused') return derive('queued')
  if (pueue.state === 'Killed') return derive('killed')
  // 2. A crash, but exit 3 is the review gate asking for a person, and old runs used 1.
  if (pueue.state === 'Failed' && !(pueue.exit === 3 || (pueue.exit === 1 && input.reviewPending))) return derive('failed')
  // 3. The automatic check is running.
  if (check?.phase === 'checking') return derive('checking')
  // 4. A saved result for exactly this worktree state.
  if (check && current(check, input.head)) {
    if (check.specStatus === 'none') return derive('finished, no spec')
    if (check.specStatus === 'manual-only') return derive('finished, manual checks only')
    if (check.passed) return derive('checks passed')
    // Steered means failures went back into Pi, so Pi is still working them.
    if (check.steered) return derive('fixing', check.round)
    return derive('checks failed')
  }
  // 5. Still running: silent for ten minutes while Pi works, or no herdr pane to ask.
  if (pueue.state === 'Running') {
    const silent = input.logAgeMs !== undefined && input.logAgeMs >= STUCK_MS
    const working = input.agentStatus === undefined || input.agentStatus === 'working'
    return derive(silent && working ? 'stuck' : 'running')
  }
  // 6. A result exists, but the worktree has moved on since.
  if (check) return derive('checks stale')
  // 7. Finished with no record yet, for example a run from before this change.
  return derive('finished')
}
