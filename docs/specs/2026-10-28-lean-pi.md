---
status: draft
branch: chore/lean-pi
---
# SPEC: Lean Pi harness, stronger council

## Objective
Make Pi a lean coding agent: it implements Claude's dispatched plans and does fast local retrieval (codebase and docs reading, exploring, short reports). Claude owns research and web search.

The dispatch-to-workflow path stays intact: pueue, `pi-view` (plain, `--live`, `--tui`), session-band, and the agent-review gate. So do the pieces used to read and steer Pi: herdr state, and the TUI with its built-in syntax highlighting.

Everything general-purpose is stripped. Sentry and shadcn are removed from every harness. The council gains a security and correctness veto voice, with effort kept at medium to high.

Success: Pi loads only the resources below; dispatch, monitoring and review behave as before; the council runs four voices with no `xhigh` or `max` effort.

Decisions (grilled with the person on 2026-10-28):
- **Q1, research tools:** Pi keeps its file tools, qmd and context7. Web search and fetch belong to Claude.
- **Q2:** remove pi-subagents.
- **Q3:** keep context-mode's tools and load none of its skills.
- **Q4:** Pi's MCP servers are context7 and qmd only.
- **Q5:** Pi gets a lean, generated AGENTS.md.
- **Q6:** of the skills, Pi keeps only pi-lens's ast-grep and lsp-navigation.
- **Q7 and Q9:** add a security and correctness voice on glm-5.3 as a separate veto gate. Effort stays medium to high, never xhigh or max.
- **Q8:** no new verification loop. Pi's post-run-verifier and Claude's verify-spec already loop.
- **Later requests:** remove sentry and shadcn everywhere; close a `--tui` pane once the person confirms the run is finished.

## Acceptance Criteria
- AC-1: Pi no longer loads pi-web-access or pi-subagents
  verify: `jq -e '[.packages[] | if type == "object" then .source else . end] | (index("npm:pi-web-access") == null) and (index("npm:pi-subagents") == null)' /Users/vietquocbui/.pi/agent/settings.json`
- AC-2: context-mode stays loaded with none of its skills
  verify: `jq -e '[.packages[] | select(type == "object" and .source == "npm:context-mode") | .skills == []] == [true]' /Users/vietquocbui/.pi/agent/settings.json`
- AC-3: pi-lens stays loaded without its write-ast-grep-rule and write-tree-sitter-rule skills
  verify: `jq -e '[.packages[] | select(type == "object" and .source == "npm:pi-lens") | (.skills | tostring) | test("write-ast-grep-rule") and test("write-tree-sitter-rule")] == [true]' /Users/vietquocbui/.pi/agent/settings.json`
- AC-4: Pi's starting resources list pi-lens and context-mode and neither removed package
  verify: `pi list > /tmp/lean-pi-list.txt 2>&1; rg -q pi-lens /tmp/lean-pi-list.txt && rg -q context-mode /tmp/lean-pi-list.txt && ! rg -q "pi-web-access|pi-subagents" /tmp/lean-pi-list.txt`
- AC-5: The review gate, rtk and herdr's Pi integration are still installed
  verify: `test -e /Users/vietquocbui/.pi/agent/extensions/agent-review && test -e /Users/vietquocbui/.pi/agent/extensions/post-run-verifier.ts && test -e /Users/vietquocbui/.pi/agent/extensions/rtk.ts && test -e /Users/vietquocbui/.pi/agent/extensions/herdr-agent-state.ts`
  baseline: pass
- AC-6: Pi no longer has the gh-stack skill
  verify: `test ! -e /Users/vietquocbui/.pi/agent/skills/gh-stack`
- AC-7: After a sync, Pi's MCP servers are exactly context7 and qmd
  verify: `zsh /Users/vietquocbui/dotfiles/scripts/sync-agent-rules.sh > /dev/null 2>&1; jq -e '(.mcpServers | keys) == ["context7", "qmd"]' /Users/vietquocbui/.pi/agent/mcp.json`
- AC-8: Sentry and shadcn are gone from the shared list, the sync script, and the Codex, OpenCode and Pi configs
  verify: `! rg -qi "sentry|shadcn" shared/mcp-servers.json scripts/sync-agent-rules.sh /Users/vietquocbui/.codex/config.toml /Users/vietquocbui/.config/opencode/opencode.json /Users/vietquocbui/.pi/agent/mcp.json`
- AC-9: Claude's own config has no sentry or shadcn MCP server
  verify: `jq -e '[(.mcpServers // {}), (.projects[]?.mcpServers // {})] | map(has("sentry") or has("shadcn")) | any | not' /Users/vietquocbui/.claude.json`
- AC-10: Pi's AGENTS.md states Pi's role and tools, keeps the commit funnel and spec loop, and has no Ketch or Firecrawl routing
  verify: `rg -q "commit-funnel" pi/.pi/agent/AGENTS.md && rg -q "Spec loop" pi/.pi/agent/AGENTS.md && rg -qi "ask Claude" pi/.pi/agent/AGENTS.md && ! rg -qi "ketch|firecrawl" pi/.pi/agent/AGENTS.md`
- AC-11: Pi's AGENTS.md is generated from one source, so its shared sections cannot drift
  verify: `zsh scripts/build-pi-agents --check`
- AC-12: The council has a security and correctness voice on glm-5.3 at medium or high effort
  verify: `rg -q '^PI_COUNCIL_SECURITY_MODEL="opencode-go/glm-5\.3:(medium|high)"' /Users/vietquocbui/.pi/agent/routing.env`
- AC-13: No council voice runs at xhigh or max effort
  verify: `! rg -q '^PI_COUNCIL_[A-Z_]*MODEL=".*:(xhigh|max)"' /Users/vietquocbui/.pi/agent/routing.env`
- AC-14: A FAIL from the security voice vetoes a council that would otherwise pass, and a PASS leaves the verdict to the three voices
  verify: `bash shared/skills/delegate-pi/council-veto.test.sh`
- AC-15: The council's models and efforts are documented the same way in model-routing.md and delegate-pi
  verify: `rg -q "glm-5.3" claude/.claude/rules/model-routing.md && rg -q "glm-5.3" shared/skills/delegate-pi/SKILL.md && ! rg -q "xhigh" shared/skills/delegate-pi/SKILL.md`
- AC-16: delegate-pi says Pi has no web access (ask Claude) and that Claude runs verify-spec when a Pi run settles, sending failures back into the same `--tui` Pi
  verify: `rg -qi "no web" shared/skills/delegate-pi/SKILL.md && rg -q "verify-spec" shared/skills/delegate-pi/SKILL.md`
- AC-17: A `--tui` pane closes after the person quits Pi, so its slot frees up for the next queued dispatch
  verify: manual - needs a live herdr session: dispatch with `--tui`, quit Pi with Ctrl+D, and the pane is gone
- AC-18: session-band's tests still pass
  verify: `claude plugin test /Users/vietquocbui/dotfiles/session-band-plugin`
  baseline: pass
- AC-19: The pi-view scripts' tests still pass
  verify: `node --test scripts/pi-tail.test.mjs scripts/pi-live.test.mjs`
  baseline: pass

## Boundaries
### Always
- Run `~/dotfiles/scripts/ac-run check SPEC.md` and `~/dotfiles/scripts/floor-guard` before claiming done
- Change Pi's packages through `~/.pi/agent/settings.json` package filters (object form, `"skills": []`, `-path`), not by deleting files under `~/.pi/agent/npm`
- Keep a backup of every live config file before editing it (`settings.json`, `mcp.json`, `routing.env`, `~/.claude.json`, `~/.codex/config.toml`, `opencode.json`)
### Ask first
- Any change to the Commandr repo or `bin/council` (the veto stays in dotfiles)
- Removing context-mode, pi-lens or any review-gate piece
- Changing Pi's enabled models or scoped model list
### Never
- Edit `agent-review`, `post-run-verifier` or `pi-lens` code
- Remove herdr's Pi integration (`--tui` and pane mode need it) or `keybindings.json`
- Edit a `verify:` line or a test to make a check pass

## Open Questions
- Style voice: keep `opencode-go/deepseek-v4-pro:high`, or use a third vendor? Default: keep it.
- Security voice effort: medium or high? Default: high.
- `--tui` pane after quit: close it, or reuse it for the next queued run? Default: close it; the next queued run opens a fresh pane through the layout templates.
- How AGENTS.md is generated: Default: `scripts/build-pi-agents` writes `pi/.pi/agent/AGENTS.md` (a committed, stowed file) from `shared/pi-role.md` plus named sections of `shared/research-tool-routing.md`; `--check` fails when the committed file is stale.
- `routing.env` lives outside the repo: should it be stowed from dotfiles? Default: no; edit the live file and keep a backup.
- Codex and OpenCode harnesses: anything beyond removing sentry and shadcn? Default: no other change.
