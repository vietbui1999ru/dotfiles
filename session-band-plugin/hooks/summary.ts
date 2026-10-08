// Pure logic for the /clear auto-save flow. No engine imports: every `$` call
// (`$.process`, `$.fs`, `$.model`, `$.ui`) stays in clear.tsx.

export const REAL_WORK_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
export const MIN_PROMPTS_FOR_REAL_WORK = 4
export const RECENT_SAVE_MS = 5 * 60 * 1000

export const DIGEST_LAST_MESSAGES = 30
export const DIGEST_MESSAGE_CHARS = 600
export const DIGEST_CAP = 30_000
// Latest failures only: the oldest add the least and, uncapped, crowd the
// recent messages out of the final cut.
export const DIGEST_MAX_FAILURES = 10

export const HEADINGS = [
  'Completed',
  'In Progress',
  'Decisions Made',
  'Blocked / Needs Input',
  'Files Modified This Session',
  'Next Session Should',
] as const

export type Counters = { edits: number; prompts: number }

export type DigestToolUse = {
  tool: string
  input: Record<string, unknown>
  isError?: true
  text?: string
}

export type DigestToolResult = {
  isError?: boolean
  text: string
}

export type DigestMessage = {
  role: 'user' | 'assistant'
  text: string
  toolUses: readonly DigestToolUse[]
  toolResults?: readonly DigestToolResult[]
}

export type ParsedSummary = { goal: string; body: string }

const cut = (text: string, limit: number): string =>
  text.length <= limit ? text : `${text.slice(0, limit - 1)}…`

// Real work is one successful edit tool, or a handful of prompts; counted by
// clear.tsx's own counters, never the transcript (it may already be wiped).
export const isRealWork = (counters: Counters): boolean =>
  counters.edits >= 1 || counters.prompts >= MIN_PROMPTS_FOR_REAL_WORK

// A bounded digest of the transcript for the summariser: the first user
// prompt, the edited files, the failing tool results, and the last few
// messages, each cut and the whole capped near DIGEST_CAP characters.
export const buildDigest = (messages: readonly DigestMessage[]): string => {
  const firstPrompt = messages.find(m => m.role === 'user' && m.text.trim() !== '')?.text ?? ''

  const files = new Set<string>()
  const failures: string[] = []

  for (const message of messages) {
    for (const use of message.toolUses) {
      if (REAL_WORK_TOOLS.has(use.tool)) {
        const filePath = use.input.file_path
        if (typeof filePath === 'string' && filePath.trim() !== '') files.add(filePath)
      }
      if (use.isError) failures.push(cut(use.text ?? '', DIGEST_MESSAGE_CHARS))
    }
    for (const result of message.toolResults ?? []) {
      if (result.isError) failures.push(cut(result.text, DIGEST_MESSAGE_CHARS))
    }
  }

  const shownFailures = failures.slice(-DIGEST_MAX_FAILURES)

  const recent = messages
    .slice(-DIGEST_LAST_MESSAGES)
    .map(m => `[${m.role}] ${cut(m.text, DIGEST_MESSAGE_CHARS)}`)

  const parts = [
    `First user prompt: ${cut(firstPrompt, DIGEST_MESSAGE_CHARS)}`,
    files.size === 0
      ? 'Files edited: (none)'
      : `Files edited:\n${[...files].sort().map(f => `- ${f}`).join('\n')}`,
    shownFailures.length === 0
      ? 'Failing tool results: (none)'
      : `Failing tool results:\n${shownFailures.map(f => `- ${f}`).join('\n')}`,
    `Recent messages (${recent.length}):\n${recent.join('\n')}`,
  ]

  return cut(parts.join('\n\n'), DIGEST_CAP)
}

// Parses the model's reply: a `GOAL:` line then the six headings, in any
// order. Returns undefined when the goal line or any heading is missing, so
// a broken reply is never saved.
export const parseReply = (text: string): ParsedSummary | undefined => {
  const lines = text.split('\n')
  const first = lines.find(line => line.trim() !== '')
  if (first === undefined) return undefined

  const match = /^GOAL:\s*(.+)$/i.exec(first.trim())
  if (match === null) return undefined
  const goal = (match[1] ?? '').trim()
  if (goal === '') return undefined

  const body = lines.slice(lines.indexOf(first) + 1).join('\n').trim()
  if (body === '') return undefined

  const missing = HEADINGS.find(heading => !body.includes(`## ${heading}`))
  if (missing !== undefined) return undefined

  return { goal, body }
}

// A task worktree's state file: frontmatter first (startup rules read it),
// then the summary body.
export const taskStateFile = (taskId: string, body: string): string =>
  `---\nstatus: active\nagent_task: ${taskId}\n---\n\n${body}\n`

// `agent-session save` prints "✓ Saved: <path>"; this picks the path back out.
export const extractSavedPath = (stdout: string): string | undefined =>
  /\.agents\/sessions\/[^\s]*\.md/.exec(stdout)?.[0]

export const SYSTEM_PROMPT = `You summarise a finished Claude Code session into a handoff document.
You see only a bounded digest of the transcript; never invent facts it does not contain.

Reply in exactly this shape. The first line is the goal, then the six headings,
in this order, each with bullet lines (write "nothing" under a heading that has no content):

GOAL: <one sentence describing what the session set out to do>

## Completed
## In Progress
## Decisions Made
## Blocked / Needs Input
## Files Modified This Session
## Next Session Should

Every one of the six headings must appear exactly once, spelled exactly as above.
Add no other top-level heading, preamble or trailing text.`

export const summaryPrompt = (digest: string): string =>
  `Summarise this session from the digest below, in the format the system prompt specifies.\n\n${digest}`
