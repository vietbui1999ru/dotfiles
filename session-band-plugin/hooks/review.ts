export type PendingReview = { runId: string; repo?: string; files: { file: string }[]; endedAt?: number }
export type ReviewState = 'pending' | 'approved' | 'changes requested' | undefined

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
    const ended = typeof value.endedAt === 'string' ? Date.parse(value.endedAt) : undefined
    return { runId: value.runId, ...(typeof value.repo === 'string' ? { repo: value.repo } : {}), files, ...(ended && !Number.isNaN(ended) ? { endedAt: ended } : {}) }
  } catch {
    return undefined
  }
}

const accepted = (value: unknown) => {
  const decision = object(value)
  const files = Array.isArray(decision?.files) ? decision.files : []
  return !decision?.patch && !decision?.notes && !decision?.skipped && files.length > 0 && files.every(file => object(file)?.accepted === true)
}

/** A pending record wins. A decision is meaningful only after its pending record vanished. */
export const reviewState = (pendingFiles: readonly PendingReview[], decisionFiles: readonly unknown[]): ReviewState => {
  if (pendingFiles.length > 0) return 'pending'
  if (decisionFiles.length === 0) return undefined
  return decisionFiles.every(accepted) ? 'approved' : 'changes requested'
}
