export type TranscriptEntry = { kind: 'text' | 'tool' | 'error'; text: string }

export type PiProgress = {
  offset: number
  partial: string
  tokens: number
  cost: number
  model?: string
  effort?: string
  lastActivity?: string
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

const append = (progress: PiProgress, entries: TranscriptEntry[]) => ({ ...progress, entries: [...progress.entries, ...entries].slice(-200) })

const event = (progress: PiProgress, raw: unknown): PiProgress => {
  const row = object(raw)
  if (!row) return progress
  if (row.type === 'model_change') {
    const provider = typeof row.provider === 'string' ? row.provider : undefined
    const modelId = typeof row.modelId === 'string' ? row.modelId : undefined
    return provider && modelId ? { ...progress, model: `${provider}/${modelId}` } : progress
  }
  if (row.type === 'thinking_level_change' && typeof row.thinkingLevel === 'string') return { ...progress, effort: row.thinkingLevel }
  if (row.type !== 'message') return progress
  const message = object(row.message)
  if (!message) return progress
  const role = message.role
  const content = Array.isArray(message.content) ? message.content : []
  let next = progress
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
      if (item?.type === 'toolCall') {
        const name = typeof item.name === 'string' ? item.name : 'tool'
        const path = toolPath(item.arguments)
        if (path) files.add(path)
        const text = `${name}${path ? ` ${path}` : ''}`
        entries.push({ kind: 'tool', text })
        next = { ...next, lastActivity: text }
      }
    }
    next = { ...next, files: [...files] }
    if (message.stopReason === 'error' || typeof message.errorMessage === 'string') next = { ...next, error: typeof message.errorMessage === 'string' ? message.errorMessage : 'Pi stopped with an error' }
    return append(next, entries)
  }
  if (role === 'toolResult') {
    const text = strings(content.map(object).map(block => block?.text)).join(' ')
    return message.isError === true ? append({ ...next, error: text || 'Tool failed' }, entry('error', text || 'Tool failed') ? [entry('error', text || 'Tool failed')!] : []) : next
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
