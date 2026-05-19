# Gemini CLI limitations

Gemini CLI has strong feature parity with Claude Code. Gaps are mostly ecosystem-shaped, not capability-shaped.

## What works (parity with Claude)

- **Skills** at `.gemini/skills/` — `activate_skill` tool loads skill content into context; same progressive disclosure principle as CC's Skill tool.
- **Custom commands** in `.gemini/commands/` — TOML format; same idea as CC's `.claude/commands/`; supports `{{args}}`, `!{shell}`, `@{file}` injection and namespacing via subdirs.
- **`@file.md` imports in GEMINI.md** — same syntax as CC's `@~/.claude/rules/foo.md`; relative paths; fully supported.
- **Hooks** in `settings.json` — analogous to CC hooks; some migration friction.
- **Extensions** (`gemini extensions`) — analogous to Claude plugins.
- **MCP servers** — both stdio (`command` + `args`) and remote (`url` + `headers`) in `settings.json` under `mcpServers`.
- **Auth** — `security.auth.selectedType: "oauth-personal"` for personal Google account.
- **Subagents** — experimental; not production-ready yet.
- **Headless mode** — `--headless` flag.
- **Plan mode** — `enter_plan_mode` / `exit_plan_mode` tools.
- **`context.fileName`** — `settings.json` can include `["AGENTS.md", "GEMINI.md"]` so Gemini natively reads `AGENTS.md`.

## Gaps

- **No plugin marketplace equivalent.** Claude's plugin ecosystem (superpowers, caveman, ralph-loop, etc.) has no Gemini equivalent. Skills must be ported manually.
- **Skill location unclear for user-global scope.** Official docs say `.gemini/skills/` (project-level). No documented `~/.gemini/skills/` equivalent yet — may need to maintain a project-level `.gemini/skills/` symlink in each project.
- **Subagents are experimental.** No stable subagent system; agent teams not available.
- **Hook migration from Claude is unreliable.** `gemini hooks migrate --from-claude` claims success but may not write correctly to `settings.json`. Verify after running.
- **No PostToolUse hook equivalent.** CC's PostToolUse Bash hook (e.g., auto-publish wiki) has no Gemini equivalent. Must run manually.

## ~~Corrected~~ Prior Wrong Claims

- ~~"GEMINI.md does not support `@include` syntax"~~ → WRONG. GEMINI.md supports `@file.md` imports with relative paths, identical to CC.
- ~~"Skill location: `~/.agents/skills/`"~~ → WRONG. Official path is `.gemini/skills/` (project-level). `~/.agents/skills/` is not a documented Gemini path.

## Mitigations

- Add `context.fileName: ["AGENTS.md", "GEMINI.md"]` to `settings.json` so Gemini reads shared `AGENTS.md`.
- Port key skills to `.gemini/skills/` in relevant projects.
- Use `.gemini/commands/*.toml` for workflow automation (wiki lookup, plan, review) — equivalent to CC commands.
- For wiki publish hook: use alias `alias publish-wiki='cd ~/repos/llm-wiki && ./scripts/publish-ai-kb.sh'`.
- For settings format conflicts (Claude's `tools.alwaysAllow`, `disabled` fields rejected by Gemini): keep complex stdio servers in Claude settings only.
