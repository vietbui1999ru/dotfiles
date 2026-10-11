export type PendingReview = { runId: string; repo?: string; files: { file: string }[]; startedAt?: number; endedAt?: number }
export type ReviewState = 'pending' | 'decided, waiting for the next Pi run in this repo' | 'approved' | 'changes requested' | undefined

type Record = { [key: string]: unknown }
const object = (value: unknown): Record | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record : undefined

export const parsePending = (json: string): PendingReview | undefined => {
  try {
    const value = object(JSON.parse(json))
    if (!value || typeof value.runId !== 'string' || !Array.isArray(value.files)) return undefined
    const files = value.files.flatMap(row => {
      const item = object(row)
      return typeof item?.file === 'string' ? [{ file: item.file }] : []
    })
    const started = typeof value.startedAt === 'string' ? Date.parse(value.startedAt) : undefined
    const ended = typeof value.endedAt === 'string' ? Date.parse(value.endedAt) : undefined
    return {
      runId: value.runId,
      ...(typeof value.repo === 'string' ? { repo: value.repo } : {}),
      files,
      ...(started !== undefined && !Number.isNaN(started) ? { startedAt: started } : {}),
      ...(ended !== undefined && !Number.isNaN(ended) ? { endedAt: ended } : {}),
    }
  } catch {
    return undefined
  }
}

const accepted = (value: unknown) => {
  const decision = object(value)
  const files = Array.isArray(decision?.files) ? decision.files : []
  const notes = decision?.notes
  return typeof decision?.patch === 'string'
    && decision.patch.trim() === ''
    && Array.isArray(notes)
    && notes.length === 0
    && decision?.skipped === undefined
    && files.length > 0
    && files.every(file => object(file)?.status === 'accepted')
}

/** A decision beside its pending record awaits a follow-up Pi session to consume it. */
export const reviewState = (pending: PendingReview | undefined, decision: unknown | undefined): ReviewState => {
  if (pending) return decision === undefined ? 'pending' : 'decided, waiting for the next Pi run in this repo'
  if (decision === undefined) return undefined
  return accepted(decision) ? 'approved' : 'changes requested'
}
