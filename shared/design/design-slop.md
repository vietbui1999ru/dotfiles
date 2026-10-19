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
- pattern: letter-spacing[[:space:]]*:[[:space:]]*(([1-9][0-9]*(\.[0-9]+)?|0?\.[1-9][0-9]*)(em|rem)|([2-9](\.[0-9]+)?|[1-9][0-9]+(\.[0-9]+)?)px)
A tracked-out eyebrow label above every heading is generic chrome. Only positive
tracking of 0.1em or more (2px or more) counts: ordinary or tight letter-spacing
is not an eyebrow.

## Numbered markers on non-sequences
- pattern: (>|["'])[[:space:]]*0[0-9]([[:space:]]*<|["'])
01 / 02 / 03 markers belong on real sequences (steps, timelines), not on every
section. This targets visible marker text in markup or CSS `content:` (`>01<`,
`"01"`), so hex colours like `#ff0505`, times, and dimensions do not match.

## Big-number hero with gradient
- pattern: none
A big number, small label, and gradient accent is the default hero treatment.
This is a composition tell — it needs a huge numeral next to a gradient accent —
not a property, so no regex can tell it apart from an ordinary gradient and only
judgement catches it.

## Fade-slide-up on every section
- pattern: fade[ -]?in|slide[ -]?up|translatey
Scattered entrance animations on every section read as AI-generated.

## Default font families
- pattern: (^|[^[:alnum:]_-])(Inter|Roboto|Open[[:space:]]Sans|system-ui|-apple-system|Helvetica|Arial)([^[:alnum:]_-]|$)
Reaching for a default family rather than choosing one for the brief.
