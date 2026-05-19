# OpenCode limitations

OpenCode has skills, agents, commands, and MCP. Gaps are mostly around automation (no hooks) and marketplace (no plugin ecosystem).

## What works (parity with Claude)

- **Skills** via `skills.paths` in `opencode.json` — same SKILL.md format, points to `~/dotfiles/llm-wiki-plugin/skills` and `~/dotfiles/claude/.claude/skills`.
- **Agents** via `agent` config — named subagents with model routing (opus/sonnet/haiku tier), descriptions, custom prompts. Roster: coder, reviewer, debugger, architect, security-auditor, fast-coder.
- **Commands** via `command` config — slash commands `/wiki`, `/brainstorm`, `/tdd`, `/debug`, `/security`, `/review`, `/plan`, `/verify`.
- **Instructions** via `instructions` array — loads `communication.md` (caveman mode) and `wiki-startup.md` (auto-invoke wiki) at session start.
- **MCP** — qmd (stdio), context7, shadcn, sentry all configured. `type: "local"` for stdio (command must be array).

## Remaining gaps

- **No hook system.** Cannot auto-run commands on tool use or session events. Wiki publish-on-log-edit hook has no equivalent — must run manually (`cd ~/repos/llm-wiki && ./scripts/publish-ai-kb.sh`).
- **No plugin marketplace.** No equivalent of superpowers, caveman plugin, ralph-loop, etc. Workarounds: caveman via `instructions`; skill discipline via AGENTS.md rules; ralph-loop has no equivalent.
- **Commands are not auto-triggered.** Skills in Claude can fire automatically based on task type; OpenCode commands require explicit user invocation (e.g. `/wiki topic`). The wiki-startup rule in `instructions` nudges the agent but doesn't guarantee invocation.
- **No post-tool hooks.** Can't mirror Claude's PostToolUse Bash hook that publishes wiki on file change.

## Workaround for wiki publish hook

Add this alias to `~/.zshrc` and run after wiki edits:
```zsh
alias publish-wiki='cd ~/repos/llm-wiki && ./scripts/publish-ai-kb.sh'
```
