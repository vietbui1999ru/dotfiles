# Agent blueprints

Draft agent blueprints written by the `build-agent` skill
(`llm-wiki-plugin/skills/build-agent/SKILL.md`, spec in
`docs/SPEC-llm-wiki-agent-builder.md`, workflow in
`docs/workflows/llm-wiki-agent-builder.md`).

- One file per agent: `<slug>.md`, frontmatter `type: agent-definition`, `status: draft`.
- These are **drafts, not installed agents**. Nothing here is loaded by Claude Code,
  Codex, OpenCode or Pi. Installing one is a separate, manual step.
- Each blueprint cites the exact `~/repos/llm-wiki` pages it was derived from.

## Shared subagents (generated)

The live subagents (`scout`, `worker`, `diagrammer`, `chronicler`) have one source:
`shared/agents/<name>.md`, in Claude frontmatter plus body.

- Edit `shared/agents/`, then run `scripts/sync-agents`. It writes the Claude symlink,
  and the Pi, OpenCode and Codex copies.
- Never edit the generated copies: `claude/.claude/agents/`, `pi/.pi/agent/agents/`,
  `opencode/.config/opencode/agents/`, `codex/.codex/agents/`. A hand edit makes
  `scripts/sync-agents` exit 1 and name the file; `--force` overwrites it.
- `scripts/sync-agents --check` reports drift without writing.
  `scripts/sync-agent-rules.sh` runs this check and prints a warning when it fails.
- Harness-specific settings (OpenCode permissions, Codex model) live in the `PRESETS`
  table in `scripts/sync-agents`.
