// The ready marker that `spec lint` writes for a clean draft, and the text of the band's Approve/Deny prompt.
// Pure: the engine calls live in spec-ready.tsx.

export type ReadyMarker = { spec: string; rel: string; branch: string; hash: string }

const SUMMARY_LINES = 40

export const READY_DIR = (home: string): string => `${home}/.local/state/ac-run/ready`

export const parseMarker = (text: string): ReadyMarker | undefined => {
  let value: { spec?: unknown; rel?: unknown; branch?: unknown; hash?: unknown } | null
  try { value = JSON.parse(text) as typeof value } catch { return undefined }
  if (!value || typeof value !== 'object') return undefined
  const { spec, rel, branch, hash } = value
  if (typeof spec !== 'string' || typeof hash !== 'string') return undefined
  return {
    spec,
    rel: typeof rel === 'string' ? rel : spec,
    branch: typeof branch === 'string' ? branch : '',
    hash,
  }
}

export const askText = (marker: { rel: string }, summary: string): string => {
  const lines = summary.split('\n')
  const shown = lines.length > SUMMARY_LINES
    ? [...lines.slice(0, SUMMARY_LINES), `… ${lines.length - SUMMARY_LINES} more lines`]
    : lines
  return `${marker.rel}\n${shown.join('\n')}\n\nApprove this spec?`
}

export const dirOf = (path: string): string => {
  const slash = path.lastIndexOf('/')
  if (slash === -1) return '.'
  return slash === 0 ? '/' : path.slice(0, slash)
}
