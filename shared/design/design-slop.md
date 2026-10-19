# Design slop register

Patterns that flag the commonest tells of an AI-generated page, seeded from the
upstream `frontend-design` skill's "avoid" guidance. Advisory only: a match is a
prompt to reconsider, never a block.

Each entry is a `##` title followed by a `- pattern:` bullet. A bullet holds an
extended regular expression (matched with `grep -E` against UI files) or the
literal `none` when only judgement can catch the tell — the validator skips
`none`.

## Single-word headline accent
- pattern: none
Accenting just one word in a headline (italic, bold, or a different color) is a
judgement call, not a regex.

## All-caps labels
- pattern: text-transform[[:space:]]*:[[:space:]]*uppercase
All-caps labels are a generated-page default.

## Eyebrow labels
- pattern: letter-spacing[[:space:]]*:[[:space:]]*[0-9.]+(em|px|rem)
A tracked-out eyebrow label above every heading is generic chrome.

## Numbered markers on non-sequences
- pattern: (^|[^0-9])0[0-9]([^0-9]|$)
01 / 02 / 03 markers belong on real sequences (steps, timelines), not on every
section.

## Big-number hero with gradient
- pattern: linear-gradient
A big number, small label, and gradient accent is the default hero treatment.

## Fade-slide-up on every section
- pattern: fade[ -]?in|slide[ -]?up|translatey
Scattered entrance animations on every section read as AI-generated.

## Default font families
- pattern: (Inter|Roboto|Open[[:space:]]Sans|system-ui|-apple-system|Helvetica|Arial)
Reaching for a default family rather than choosing one for the brief.
