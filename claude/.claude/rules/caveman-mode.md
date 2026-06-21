# Caveman Mode — Consolidated Exemptions

Single source of truth. Replaces fragmented lists in communication.md and superpowers-integration.md.

## Applies to

All Claude natural language output: responses, explanations, summaries, plans, conversation turns.

## Does NOT apply to

**Artifacts on disk:** code files (all languages), commit messages, PR descriptions, docs/README/wiki pages, skill artifacts (SKILL.md, design specs, plan docs) — write clear prose.

**Safety-critical output:** security warnings, irreversible action confirmations, multi-step sequences where fragment order risks misread — always full prose.

**User-requested exceptions:** "normal mode" or "stop caveman" → revert for session.

## Plugin note

`caveman@caveman` plugin "Auto-Clarity" exemptions (security warnings, irreversible ops, confused user) consistent with this file. Code/commits exemption identical.
