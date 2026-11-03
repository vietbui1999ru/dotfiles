---
status: draft
branch: feat/lean-kit
---
# SPEC: Lean personal skills replace third-party plugins

## Objective
Keep the harness lean. Vendor the six superpowers skills that are actually used, together with the Matt Pocock forks, into `shared/skills/`. Each gets a verbatim upstream pin and a drift check. Disable the plugins that cost context every session without being used.

Success:
- Each session starts with under 1 KB of plugin-injected text, down from about 8.6 KB.
- The skills list keeps every skill used in the last 47 days.
- `skill-vendor check` reports upstream drift.
- `skill-vendor audit --json` gives the planned automation miner a lean detector.

## Acceptance Criteria
- AC-1: The six used superpowers skills are vendored, each with an adapted SKILL.md and a verbatim upstream.md. The six are systematic-debugging, writing-plans, brainstorming, verification-before-completion, finishing-a-development-branch and subagent-driven-development.
  verify: `for s in systematic-debugging writing-plans brainstorming verification-before-completion finishing-a-development-branch subagent-driven-development; do test -s shared/skills/$s/SKILL.md && test -s shared/skills/$s/upstream.md || exit 1; done`
- AC-2: The adapted SKILL.md files contain no superpowers paths, no `superpowers:` skill names and no "1% chance" invocation language.
  verify: `! rg -q "docs/superpowers|superpowers:|1% chance" shared/skills/systematic-debugging/SKILL.md shared/skills/writing-plans/SKILL.md shared/skills/brainstorming/SKILL.md shared/skills/verification-before-completion/SKILL.md shared/skills/finishing-a-development-branch/SKILL.md shared/skills/subagent-driven-development/SKILL.md`
- AC-3: writing-plans saves plans under docs/plans/.
  verify: `rg -q "docs/plans/" shared/skills/writing-plans/SKILL.md`
- AC-4: shared/skills/vendor.json lists every vendored or forked skill, each with an upstream repo, path, pinned sha and local-diff note. The skills are the six above plus grill-me, improve-codebase-architecture, zoom-out, design-brief and gh-stack.
  verify: `jq -e '[ "systematic-debugging","writing-plans","brainstorming","verification-before-completion","finishing-a-development-branch","subagent-driven-development","grill-me","improve-codebase-architecture","zoom-out","design-brief","gh-stack" ] - [.skills[] | select(.upstream.repo and .upstream.path and .upstream.sha and .notes) | .name] | length == 0' shared/skills/vendor.json`
- AC-5: improve-codebase-architecture and zoom-out live in shared/skills. Their old llm-wiki folders are replaced by a MOVED.md pointer, as was done for grill-me.
  verify: `test -s shared/skills/improve-codebase-architecture/SKILL.md && test -s shared/skills/zoom-out/SKILL.md && test -f /Users/vietquocbui/repos/llm-wiki/claude-setup/skills/improve-codebase-architecture/MOVED.md && test -f /Users/vietquocbui/repos/llm-wiki/claude-setup/skills/zoom-out/MOVED.md`
- AC-6: setup-matt-pocock-skills is no longer linked into Claude.
  verify: `! test -e "$HOME/.claude/skills/setup-matt-pocock-skills"`
- AC-7: `scripts/skill-vendor check` exits 0 when a pin matches upstream, 1 with a diff when upstream drifted, and 2 when the pin is missing. Upstream is fetched with `gh`, which the tests stub.
  verify: `bash scripts/tests/skill-vendor.test.sh check`
- AC-8: `scripts/skill-vendor audit --json` prints a document with `unused_skills` (no Skill-tool use in 60+ days), `session_start_bytes` (per enabled plugin) and `hooks` (per plugin hook event count). The test runs it against fixture transcripts.
  verify: `bash scripts/tests/skill-vendor.test.sh audit`
- AC-9: The global Claude settings disable superpowers, caveman, ralph-loop, learning-output-style, explanatory-output-style and obsidian, and keep security-guidance enabled.
  verify: `jq -e '.enabledPlugins as $p | (["superpowers@claude-plugins-official","caveman@caveman","ralph-loop@claude-plugins-official","learning-output-style@claude-plugins-official","explanatory-output-style@claude-plugins-official","obsidian@obsidian-skills"] | all($p[.] != true)) and $p["security-guidance@claude-plugins-official"] == true' claude/.claude/settings.json`
- AC-10: The Obsidian vault enables the obsidian plugin in its project settings.
  verify: `jq -e '.enabledPlugins["obsidian@obsidian-skills"] == true' /Users/vietquocbui/repos/Obsidian/.claude/settings.json`
- AC-11: Only the base firecrawl skill is linked into Claude. The other 14 move to `~/.agents/skills-disabled`.
  verify: `test "$(ls "$HOME/.claude/skills" | rg -c '^firecrawl')" = 1 && test -e "$HOME/.claude/skills/firecrawl"`
- AC-12: core.md has a short "Explain" section. It asks for ★ Insight boxes on codebase-specific points and no requests for the user to write code.
  verify: `rg -q "★ Insight" /Users/vietquocbui/repos/llm-wiki/claude-setup/rules/core.md && ! rg -qi "write 5-10 lines|request.*contribution" /Users/vietquocbui/repos/llm-wiki/claude-setup/rules/core.md`
- AC-13: earn-it holds the "write 5-10 lines yourself" contribution flow.
  verify: `rg -q "5-10 lines" /Users/vietquocbui/repos/llm-wiki/claude-setup/skills/earn-it/SKILL.md`
- AC-14: No `superpowers:` skill reference remains in the rules or the personal skills. Verbatim upstream.md pins are exempt.
  verify: `! rg -q -g '!upstream.md' "superpowers:" claude/.claude/rules claude/.claude/CLAUDE.md shared/skills /Users/vietquocbui/repos/llm-wiki/claude-setup/rules`
- AC-15: The CLAUDE.md priority list no longer names the superpowers plugin.
  verify: `! rg -qi "superpowers plugin" claude/.claude/CLAUDE.md`
- AC-16: design-brief's existing upstream sync test still passes.
  verify: `bash shared/skills/design-brief/tests/sync-upstream.test.sh`
  baseline: pass
- AC-17: After a restart, a new session gets under 1 KB of plugin SessionStart text, and the skills list shows the vendored names without a `superpowers:` prefix.
  verify: manual - needs a fresh Claude Code session

## Boundaries
### Always
- Copy upstream.md byte for byte from the pinned sha. Make adaptations only in SKILL.md.
- Run `~/dotfiles/scripts/spec check SPEC.md` and `~/dotfiles/scripts/floor-guard` before claiming done.
- Commit llm-wiki and Obsidian changes on a `feat/lean-kit` branch in each repo, never on main.
### Ask first
- Running `claude plugin uninstall` or deleting plugin caches. This spec only disables plugins.
- Deleting any skill folder. Moves leave a MOVED.md pointer.
- Disabling security-guidance.
### Never
- Edit a `verify:` line or a test to make a check pass.
- Let Pi edit the review gate (agent-review, post-run-verifier, pi-lens).

## Open Questions
- Who builds what. Default: Claude writes the adapted SKILL.md text, which takes judgment, and the rule edits. Pi (high tier) builds `scripts/skill-vendor` and its tests from AC-7 and AC-8.
- Where `skill-vendor check` gets upstream from. Default: `gh api repos/<repo>/contents/<path>?ref=<sha-or-branch>`, so it does not depend on plugin caches surviving.
- The upstream for the Matt Pocock forks. Default: `mattpocock/skills`, path `skills/<category>/<name>/SKILL.md`, confirmed for improve-codebase-architecture.
- The firecrawl links are machine state outside any repo. Default: move them by hand once and record it in the PR; skills.sh owns them.
- verify-spec still mentions `superpowers:`. Default: rewrite it to the vendored name.
