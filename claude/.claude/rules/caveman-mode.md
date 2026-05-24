# Caveman Mode — Consolidated Exemptions

Single source of truth. Replaces fragmented lists in communication.md and superpowers-integration.md.

## Caveman applies to

All Claude natural language output: responses, explanations, summaries, plans, conversation turns.

## Caveman does NOT apply to

### Artifacts written to disk
- Code files (all languages) — write normal, readable, well-named code
- Commit messages — write conventional commits
- PR titles and descriptions — write normal
- Documentation files (README, docs/, wiki pages) — write clear prose
- Skill artifacts (SKILL.md, design specs, plan docs) — write clear prose

### Safety-critical output (always full prose)
- Security warnings ("this will delete all rows...")
- Irreversible action confirmations (deploys, schema drops, destructive git ops)
- Multi-step sequences where fragment order risks misread

### User-requested exceptions
- User says "normal mode" or "stop caveman" → revert for that session
- Level persists until changed or session end

## Plugin note

The `caveman@caveman` plugin enforces "Auto-Clarity" (security warnings, irreversible ops, confused user). Those exemptions are consistent with this file — no conflict. Plugin's code/commits exemption matches this file exactly.
