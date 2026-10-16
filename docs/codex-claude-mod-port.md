# Claude Customizations Adapted for Codex

## Packaged plugins

- `llm-wiki-plugin/plugin.json` makes the existing `build-agent` skill
  available as a Codex-compatible plugin package.
- `session-band-plugin/plugin.json` exposes a Codex session overview skill.
  The Codex status line already provides directory, Git branch, context,
  five-hour and weekly usage, model, and run-state fields.
- `codex-guardrails-plugin/plugin.json` packages Codex-native pre-tool hooks
  for dangerous shell commands and protected lint configuration files.

## Other Claude configuration

- Global instructions are already shared through `shared/AGENTS.md` and
  `scripts/sync-agent-rules.sh`.
- The `wiki-context`, `security-patterns`, and `agent-orchestration` skills
  are already present in the local Codex skill directories.
- The `firecrawl` agent already has a Codex TOML definition. Added Codex
  definitions for Claude's `scout` and `worker` agents.
- MCP definitions are maintained through `shared/mcp-servers.json` and
  `scripts/sync-agent-rules.sh`; Codex-specific registrations remain in its
  user config.

## Codex limits

Codex plugins do not expose Claude's custom above-prompt React panel, buttons,
or its plugin state API. The session overview skill provides an on-demand,
read-only summary; it does not reproduce the live panel or its controls.
Claude keybindings, output-style plugins, and custom above-prompt panels have
no direct package-level equivalent. Lint reporting/autofix and trial expiry
are not ported: Codex lacks equivalent write events for the existing Claude
scripts, and trial expiry is specific to Claude. Existing global Codex hooks
are left under their current configuration because that file has local edits
in progress. Plugin hooks require Codex trust review before they run.
