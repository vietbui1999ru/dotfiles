export type TranscriptEntry = { kind: 'text' | 'tool' | 'error' | 'thinking' | 'output'; text: string }

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

export const emptyProgress = (): PiProgress => ({
  offset: 0,
  partial: '',
  tokens: 0,
  cost: 0,
  files: [],
  entries: [],
  models: {},
})

export const sessionDir = (cwd: string): string => `--${cwd.replace(/^\/+/, '').replaceAll('/', '-')}--`
export const sessionFileName = (id: string): RegExp => new RegExp(`_(${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\.jsonl$`)

const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined

const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

const toolPath = (arguments_: unknown): string | undefined => {
  const args = object(arguments_)
  return ['path', 'file_path', 'filePath'].map(key => args?.[key]).find((value): value is string => typeof value === 'string')
}

const entry = (kind: TranscriptEntry['kind'], text: string): TranscriptEntry | undefined => text.trim() ? { kind, text: text.trim() } : undefined

// The first 2 non-empty lines of a tool result, each stripped of `\r` and capped at 160 chars.
const outputEntry = (blocks: readonly string[]): TranscriptEntry | undefined => {
  const lines = blocks.join('\n').split('\n').map(line => line.replaceAll('\r', '')).filter(line => line.length > 0)
  const capped = lines.slice(0, 2).map(line => line.length > 160 ? `${line.slice(0, 159)}…` : line)
  return capped.length ? { kind: 'output', text: capped.join('\n') } : undefined
}

const append = (progress: PiProgress, entries: TranscriptEntry[]) => ({ ...progress, entries: [...progress.entries, ...entries].slice(-200) })

const event = (progress: PiProgress, raw: unknown): PiProgress => {
  const row = object(raw)
  if (!row) return progress
  const message = row.type === 'message' ? object(row.message) : undefined
  const parsedTimestamp = typeof row.timestamp === 'string' ? Date.parse(row.timestamp) : Number.NaN
  const dated = Number.isNaN(parsedTimestamp) || (progress.lastEventMs !== undefined && parsedTimestamp <= progress.lastEventMs)
    ? progress
    : { ...progress, lastEventMs: parsedTimestamp, lastEventAssistant: message ? message.role === 'assistant' : progress.lastEventAssistant }
  if (row.type === 'model_change') {
    const provider = typeof row.provider === 'string' ? row.provider : undefined
    const modelId = typeof row.modelId === 'string' ? row.modelId : undefined
    return provider && modelId ? { ...dated, model: `${provider}/${modelId}` } : dated
  }
  if (row.type === 'thinking_level_change' && typeof row.thinkingLevel === 'string') return { ...dated, effort: row.thinkingLevel }
  if (row.type !== 'message') return dated
  if (!message) return dated
  const role = message.role
  const content = Array.isArray(message.content) ? message.content : []
  let next = dated
  if (role === 'assistant') {
    const usage = object(message.usage)
    const tokens = typeof usage?.totalTokens === 'number' ? usage.totalTokens : 0
    const cost = typeof object(usage?.cost)?.total === 'number' ? Number(object(usage?.cost)?.total) : 0
    const model = typeof message.model === 'string' && typeof message.provider === 'string' ? `${message.provider}/${message.model}` : next.model
    const key = model ?? 'unknown'
    next = { ...next, tokens: next.tokens + tokens, cost: next.cost + cost, model, models: { ...next.models, [key]: (next.models[key] ?? 0) + cost } }
    const entries: TranscriptEntry[] = []
    const files = new Set(next.files)
    for (const block of content) {
      const item = object(block)
      if (item?.type === 'text' && typeof item.text === 'string') { const value = entry('text', item.text); if (value) entries.push(value) }
      if (item?.type === 'thinking' && typeof item.thinking === 'string') {
        const text = item.thinking.trim()
        const previous = entries.at(-1) ?? next.entries.at(-1)
        if (!(text === '' && previous?.kind === 'thinking' && previous.text === '')) entries.push({ kind: 'thinking', text })
      }
      if (item?.type === 'toolCall') {
        const name = typeof item.name === 'string' ? item.name : 'tool'
        const path = toolPath(item.arguments)
        if (path) files.add(path)
        const args = object(item.arguments)
        const command = typeof args?.command === 'string' ? args.command : undefined
        const collapsed = command ? command.replace(/\s+/g, ' ').trim() : undefined
        const text = collapsed !== undefined ? `bash ${collapsed}`.slice(0, 200) : `${name}${path ? ` ${path}` : ''}`
        const activity = collapsed !== undefined ? `bash ${collapsed.slice(0, 40)}` : text
        entries.push({ kind: 'tool', text })
        next = { ...next, lastActivity: activity }
      }
    }
    next = { ...next, files: [...files] }
    if (message.stopReason === 'error' || typeof message.errorMessage === 'string') {
      const error = typeof message.errorMessage === 'string' && message.errorMessage.trim() ? message.errorMessage.trim() : 'Pi stopped with an error'
      next = { ...next, error, lastActivity: 'error' }
      // Pi retries a failed request; the same error repeated is one transcript line.
      const last = next.entries.at(-1)
      if (last?.kind !== 'error' || last.text !== error) entries.push({ kind: 'error', text: error })
    }
    return append(next, entries)
  }
  if (role === 'toolResult') {
    const text = strings(content.map(object).map(block => block?.text)).join(' ')
    if (message.isError === true) {
      const error = text || 'Tool failed'
      const errorEntry = entry('error', error)
      return append({ ...next, error }, errorEntry ? [errorEntry] : [])
    }
    const output = outputEntry(strings(content.map(object).map(block => block?.text)))
    return output ? append(next, [output]) : next
  }
  return next
}

/** Fold a tail chunk without ever parsing an incomplete JSONL line. */
export const fold = (progress: PiProgress, chunk: string): PiProgress => {
  const combined = progress.partial + chunk
  const lines = combined.split('\n')
  const partial = lines.pop() ?? ''
  let next = { ...progress, offset: progress.offset + new TextEncoder().encode(chunk).byteLength, partial }
  for (const line of lines) {
    try { next = event(next, JSON.parse(line)) } catch { /* opaque/corrupt events are ignored */ }
  }
  return next
}
