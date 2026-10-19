---
status: draft
branch: feat/design-brief
---
# SPEC: design-brief overlay skill for distinctive frontend work

## Objective
Tailor Anthropic's `frontend-design` skill to this workflow. It should work across harnesses, catch generated-design tells with code rather than prompt text alone, and keep a memory of what has been tried per project. Success: a UI write anywhere triggers a slop-register check, and `/design-brief` runs plan → genericness check → build → screenshot critique in ship mode, or the guided loop in learn mode.

Decisions from the grill (2026-10-19):
- Overlay skill in `shared/skills/design-brief/` with a pinned `upstream.md` copy and a drift check (Q1).
- PostToolUse hook: once-per-session reminder plus a regex validator on every UI write (Q2).
- Judges: opencode `deepseek-v4-pro` for the genericness baseline and text rubric; an Opus high-effort subagent for screenshot critique. No Gemini (Q3).
- Mode: `design-mode: ship|learn` in `.claude/profile.md`, argument overrides per run (Q4).
- Learn loop: user writes the token plan → critique → build → user critiques the screenshot → design-log. Drills on demand via `/design-brief drill` (Q5).
- `shared/design/taste.md` written by the user; `shared/design/design-slop.md` seeded from upstream's avoid list, with regexes (Q6).

## Acceptance Criteria
- AC-1: Skill exists with the correct name
  verify: `rg -q "^name: design-brief$" shared/skills/design-brief/SKILL.md`
- AC-2: Pinned upstream copy is present and non-empty
  verify: `test -s shared/skills/design-brief/upstream.md`
- AC-3: sync-upstream exits 0 when the pin matches and non-zero when it drifts
  verify: `bash shared/skills/design-brief/tests/sync-upstream.test.sh`
- AC-4: SKILL.md documents mode resolution (profile default, argument override) and the drill sub-command
  verify: `rg -q "design-mode:" shared/skills/design-brief/SKILL.md && rg -q "/design-brief drill" shared/skills/design-brief/SKILL.md`
- AC-5: SKILL.md wires both judges (deepseek-v4-pro text/genericness, Opus screenshot critique)
  verify: `rg -q "opencode-go/deepseek-v4-pro" shared/skills/design-brief/SKILL.md && rg -qi "opus" shared/skills/design-brief/SKILL.md`
- AC-6: SKILL.md requires screenshots at 1440px and 375px and an axe accessibility pass
  verify: `rg -q "1440" shared/skills/design-brief/SKILL.md && rg -q "375" shared/skills/design-brief/SKILL.md && rg -qi "axe" shared/skills/design-brief/SKILL.md`
- AC-7: Human use-test runs only when the user asks
  verify: `rg -qi "use-test" shared/skills/design-brief/SKILL.md`
- AC-8: SKILL.md defines the `.claude/design-log.md` entry format (date, brief, token plan, verdict, notes)
  verify: `rg -q "design-log.md" shared/skills/design-brief/SKILL.md`
- AC-9: Design slop register is seeded with at least 5 entries, each carrying a `pattern:` line
  verify: `test "$(rg -c '^\s*-?\s*pattern:' shared/design/design-slop.md)" -ge 5`
- AC-10: Taste profile template exists and its content was written by the user
  verify: manual - taste is the user's own judgement; Claude only creates headings
- AC-11: Hook reports a slop-register match when a UI file is written
  verify: `bash claude/.claude/hooks/tests/design-on-write.test.sh match`
- AC-12: Hook stays silent for non-UI files
  verify: `bash claude/.claude/hooks/tests/design-on-write.test.sh non_ui`
- AC-13: Hook injects the taste/slop reminder once per session, not on every write
  verify: `bash claude/.claude/hooks/tests/design-on-write.test.sh once_per_session`
- AC-14: Hook is registered on the Write|Edit|MultiEdit PostToolUse matcher
  verify: `jq -e '[.hooks.PostToolUse[] | select(.matcher=="Write|Edit|MultiEdit") | .hooks[].command] | any(test("design-on-write"))' claude/.claude/settings.json`
- AC-15: Existing lint-on-write hook is untouched and still parses
  verify: `bash -n claude/.claude/hooks/lint-on-write.sh`
  baseline: pass
- AC-16: Hook script passes shellcheck
  verify: `shellcheck claude/.claude/hooks/design-on-write.sh`

## Boundaries
### Always
- Run `~/dotfiles/scripts/ac-run check SPEC.md` and `~/dotfiles/scripts/floor-guard` before claiming done
- Hook exits 0 always (advisory, like lint-on-write); the validator reports, it never blocks
- Commit per coherent unit on `feat/design-brief`
### Ask first
- New dependencies (axe-core runs in the page via Playwright MCP from a pinned CDN URL, not via an npm install)
- Edits to `upstream.md` other than through sync-upstream
- Any change to the existing hooks or the global slop register
### Never
- Edit a `verify:` line or a test to make a check pass
- Write the content of `taste.md` on the user's behalf
- Use Gemini as a judge

## Open Questions
- The llm-wiki `claude-setup/settings.json:67` enables the `frontend-design` plugin, but the live config doesn't load it. Default: leave the flag, since the overlay doesn't depend on the plugin; fix the drift in the wiki repo separately.
- Wiki ingest comprehension quiz: the user chose ingest option B and didn't say skip. Default: ask 3–5 questions before the ingest runs.
- Where does the portfolio pilot live? Default: ask when that pilot starts; it's out of scope for this spec.
- Pi/Codex hook parity: this spec covers the Claude PostToolUse hook only. Default: Pi gets the skill but no hook until a Pi extension point is chosen.
- Can deepseek-v4-pro read images? Default: no, so it gets text only (token plan plus code); Opus handles every image.
