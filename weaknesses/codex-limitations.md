# Codex limitations

OpenAI Codex CLI is the most minimal of the four providers.

## Missing features

- **No hook system.** Same as OpenCode — no automation on tool use, session lifecycle, etc.
- **No skill system.** No skill discovery or progressive disclosure. Inline in `AGENTS.md` only.
- **No plugin/extension system.**
- **MCP support is experimental.**
  - Adding via `codex mcp add NAME CMD ARGS` for stdio, `codex mcp add --url URL NAME` for remote.
  - **Header auth is bearer-token only** — arbitrary headers like `CONTEXT7_API_KEY: <key>` are not supported. context7 will not authenticate via Codex's MCP client.
  - Stdio MCPs (qmd, cgc) work fine since they handle their own auth.

## Mitigations

- **For context7 in Codex:** skip remote configuration, rely on shell-level `curl` or use a different docs source. Alternatively, run a local proxy that injects the header.
- **For wiki:** use the qmd stdio MCP (works) or fall back to `qmd query` from shell.
- Keep `AGENTS.md` rich — it's the only behavior layer.
- Multi-step work: explicit step lists in prompts, no subagent delegation.

## What works well

- Reads `~/.codex/AGENTS.md` reliably as global instructions.
- stdio MCPs (qmd) integrate cleanly via `codex mcp add`.
- Open-source MCPs without auth (shadcn, sentry-OAuth) work via remote URL.
