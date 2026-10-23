import type { ReviewFocus } from './review-sources'

// `/gates` cannot write the review pane's atom (the engine's scan reads state only where the
// atom is made), so it leaves the row it wants selected here; the pane takes it on reload.
let pending: ReviewFocus | undefined

export const requestReviewFocus = (focus: ReviewFocus): void => {
  pending = focus
}

export const takeReviewFocus = (): ReviewFocus | undefined => {
  const focus = pending
  pending = undefined
  return focus
}
