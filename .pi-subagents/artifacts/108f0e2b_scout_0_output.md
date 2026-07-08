# Code Context

## Files Retrieved

1. `/Users/vietquocbui/.pi/agent/settings.json` (lines 1-54) - active Pi package/model/settings configuration.
2. `/Users/vietquocbui/.pi/agent/routing.env` (lines 1-14) - model routing used by delegate/council scripts.
3. `/Users/vietquocbui/dotfiles/pi/.pi/agent/extensions/pi-session.ts` (lines 1-472) - session lifecycle, templates, review/open/diff commands.
4. `/Users/vietquocbui/dotfiles/pi/.pi/agent/extensions/pi-obsidian.ts` (lines 1-120, 661-780 via grep) - Obsidian note tool/commands and auto-capture hook.
5. `/Users/vietquocbui/dotfiles/pi/.pi/agent/extensions/neovim-cockpit.ts` (lines 352-570) - Neovim/Commandr cockpit, autocomplete, and `nvim_context` tool.
6. `/Users/vietquocbui/dotfiles/pi/.pi/agent/extensions/pi-control-plane.ts` (lines 1-323) - local HTTP cockpit for Commandr/Git/Obsidian.
7. `/Users/vietquocbui/dotfiles/pi/.pi/agent/extensions/pi-gitview.ts` (lines 278-289 via grep) - `/worktrees`, `/wt`, `/git` commands.
8. `/Users/vietquocbui/dotfiles/pi/.pi/agent/extensions/pi-statusline.ts` (lines 326-353 via grep) - session/model/turn statusline hooks and `/statusline`.
9. `/Users/vietquocbui/dotfiles/pi/.pi/agent/extensions/pi-terminal-caps.ts` (lines 26-37 via grep) - terminal capability session hooks.
10. `/Users/vietquocbui/.agents/skills/delegate-pi/SKILL.md` (lines 1-180) - Claude-side Pi delegation/council/subagent instructions.
11. `/Users/vietquocbui/.agents/skills/*/SKILL.md` (first 35 lines each) - skill inventory and overlap scan.
12. `/Users/vietquocbui/dotfiles/shared/templates/{spec,plan,design,arch,pr}.md` - templates consumed by Pi session/Obsidian extensions.

## Key Code

- Active Pi loads many packages in `/Users/vietquocbui/.pi/agent/settings.json` lines 6-16:
  - `git:github.com/amosblomqvist/pi-subagents`
  - `npm:pi-mcp-adapter`, `pi-web-access`, `pi-subagents`, `pi-lens`, `context-mode`, `@upstash/context7-pi`
  - local `../../repos/DiffViewer/pi-extension`, `../../repos/pi-live-status`
- Active model defaults are `openai-codex/gpt-5.5` with high thinking, compaction disabled, one-at-a-time steering (`settings.json` lines 2-23).
- The checked-in/custom extension set is mirrored into live `~/.pi/agent/extensions`: `diff -qr` reported no content differences between `/Users/vietquocbui/dotfiles/pi/.pi/agent/extensions` and `/Users/vietquocbui/.pi/agent/extensions`.
- `pi-session.ts` registers many user-facing commands:
  - `/save-session`, `/clear-context`, `/sessions`, `/resume-session` (lines 102-249)
  - `/spec`, `/plan`, `/design`, `/arch`, `/pr` via `templateCommand` (lines 250-335)
  - `/review`, `/open`, `/diff` (lines 336-472)
- `pi-obsidian.ts` defines the `obsidian_note` tool plus `/obsidian-note`, `/obsidian-open`, `/obsidian-update`, and a `before_agent_start` auto-note hook for spec/plan/design/arch/pr/review intent (grep lines 661-780).
- `neovim-cockpit.ts` registers `/cockpit`, `/nvim-context`, `/nvim-refresh`, `nvim_context`, a `#TASK` autocomplete provider, and status refreshes on `session_start`, `turn_end`, `agent_end` (lines 352-570).
- `pi-control-plane.ts` also registers `/cockpit` as an alias for `/control-plane` (lines 307-323), creating a direct command-name collision with `neovim-cockpit.ts` (line 432).
- `pi-control-plane.ts` starts an unauthenticated localhost HTTP server exposing Commandr tasks/events, git worktrees, and Obsidian note/history/diff/open endpoints (lines 221-323).
- `.agents` skills overlap with Pi extensions:
  - `obsidian-spec` mirrors `obsidian_note` usage.
  - `clear-context` is Claude-oriented and references `.Codex/session-state.md`, while Pi has `/clear-context` backed by `scripts/agent-session` and `.agents/sessions`.
  - `delegate-pi` and installed `pi-subagents`/`git:...pi-subagents` both concern delegation/subagents.
  - `kanban-status`, `approval-workflow`, and Commandr cockpit all read/write `.agents` workflow concepts.

## Architecture

The setup has three layers:

1. **Active Pi runtime (`~/.pi/agent`)**: settings, routing, sessions, installed package list, and live extensions. The live extensions match the dotfiles copy.
2. **Dotfiles Pi extension source (`dotfiles/pi/.pi/agent/extensions`)**: TypeScript extensions loaded by Pi. They integrate local scripts (`dotfiles/scripts/agent-session`), git helpers, DiffViewer artifacts, Commandr `.agents` lanes, Obsidian vault notes, Neovim-exported context, and TUI widgets/status lines.
3. **Cross-agent skills (`~/.agents/skills`)**: markdown procedural skills mainly for other agents/Claude, some of which call Pi as a subprocess or instruct use of Pi-provided tools.

Data flow is mostly config-driven: extensions read global `~/.config/agent-workflow/config.json`, then repo-local `.agent-workflow.json` and `.agent-workflow.local.json` when present. I found no `.agent-workflow*.json` under `/Users/vietquocbui/dotfiles`, so many features are likely disabled unless global config enables them. Templates are under `dotfiles/shared/templates` and feed both session files and Obsidian notes.

## Findings: overlap/duplication

1. **Hard command collision: `/cockpit`**
   - `neovim-cockpit.ts` registers `/cockpit` for a TUI Neovim/Commandr/DiffViewer panel.
   - `pi-control-plane.ts` registers `/cockpit` for HTTP control plane alias.
   - Risk: load-order-dependent behavior; one command may shadow the other or error. Refactor: keep `/cockpit` for the smallest/local TUI panel and rename HTTP alias to `/control-plane` only or `/web-cockpit`.

2. **Two Obsidian paths for similar workflows**
   - `pi-session.ts` template commands optionally call `createObsidianNote` when `obsidianBridge` is enabled.
   - `pi-obsidian.ts` separately provides `obsidian_note` and auto-captures on `before_agent_start`.
   - `~/.agents/skills/obsidian-spec/SKILL.md` instructs the same note behavior procedurally.
   - Refactor: make `pi-obsidian.ts` the single primitive; keep `/spec` etc. as thin aliases or remove automatic before-agent creation to avoid duplicate notes.

3. **Session lifecycle split across Pi extension and Claude skill**
   - Pi `/clear-context` saves through `scripts/agent-session` into `.agents/sessions`.
   - `~/.agents/skills/clear-context/SKILL.md` describes `.Codex/session-state.md` and manual `/clear`.
   - Refactor: choose one session state convention. For Pi philosophy, prefer explicit `/save-session` + `/clear-context` commands and update/remove the older `.Codex` skill path.

4. **Delegation/subagent duplication**
   - Active packages include both `git:github.com/amosblomqvist/pi-subagents` and `npm:pi-subagents`.
   - `delegate-pi` skill implements Pi subprocess delegation; settings also load Pi subagent packages.
   - Refactor: keep one subagent implementation source. If npm is canonical, remove git package; if local fork is needed, document why and disable npm duplicate.

5. **Cockpit/control surface is too broad**
   - `pi-control-plane.ts` combines Commandr, git worktrees, Obsidian notes, history, diff, and open-note operations behind one unauthenticated local server.
   - `neovim-cockpit.ts`, `pi-gitview.ts`, `pi-statusline.ts`, and `pi-session.ts /diff` already expose narrower UI primitives.
   - Refactor: atomize into separate commands: `/tasks`, `/worktrees`, `/obsidian-open`, `/nvim-context`; keep control plane opt-in and not aliased.

## High-risk issues

- **Command collision**: `/cockpit` is the clearest operational risk.
- **Unauthenticated local HTTP actions**: `pi-control-plane.ts` binds to `127.0.0.1` by default, but if config changes host, endpoints can open Obsidian notes/history/diffs. Keep host pinned to loopback and add a random token if retained.
- **Silent config parsing failures**: multiple extensions ignore JSON/config errors. This is convenient but makes feature non-operation hard to diagnose.
- **Stale/incorrect skill references**: `delegate-pi` examples reference `$HOME/.Codex/skills/delegate-pi/pi-evaluator.sh`, while inspected skills live under `/Users/vietquocbui/.agents/skills`. Verify symlinks or update paths.
- **Working tree hygiene**: `git status --short` shows unrelated existing changes: `M docs/PLAN-obsidian-gittui.md`, untracked `.pi-subagents/`, and untracked `pi/.pi/agent/extensions/pi-control-plane.ts`. I did not modify them except writing this requested artifact.

## Concrete refactor suggestions

1. Rename one `/cockpit` command immediately. Suggested: `pi-control-plane.ts` exposes only `/control-plane`; `neovim-cockpit.ts` owns `/cockpit`.
2. Collapse Obsidian behavior around one exported primitive: `createObsidianNote`. Make commands call it explicitly; disable or gate auto-note creation behind a very explicit config flag.
3. Consolidate session state docs: replace `.Codex/session-state.md` skill flow with `.agents/sessions` or mark it Claude-only.
4. Remove duplicate subagent packages from `settings.json` after choosing npm vs git source.
5. Split “cockpit” features into Pi-style atomized commands: one command/tool per intent (`nvim_context`, `obsidian_note`, `worktrees`, `tasks`) instead of one dashboard-first flow.
6. Add a tiny `/pi-health` or config diagnostic command that reports which config files were loaded and which feature flags are enabled.
7. Keep packages minimal: start from built-ins + local extensions, then add web/context/subagent packages only when they provide a clear single capability not already implemented locally.

## Start Here

Open `/Users/vietquocbui/dotfiles/pi/.pi/agent/extensions/neovim-cockpit.ts` and `/Users/vietquocbui/dotfiles/pi/.pi/agent/extensions/pi-control-plane.ts` first to fix the `/cockpit` collision. Then inspect `/Users/vietquocbui/.pi/agent/settings.json` to remove duplicate subagent packages.