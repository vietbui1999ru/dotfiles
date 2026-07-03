# Session State
status: active
saved_at: 2026-07-01T00:00:00Z
updated: 2026-07-01
branch: main

## Goal
Design and build a cross-agent-harness skill/script (Claude Code, Codex, Pi, omp, OpenCode) that invokes `obsidian-cli` to create/open an Obsidian markdown note — from a template or agent-filled content — for plans/SPECs, so the user can read/edit/comment in Obsidian, with Mermaid/code-block/wikilink support.

## Completed
- Ingested the Obsidian CLI ecosystem into `~/repos/llm-wiki` (commit `c6fde58`): official CLI docs, kepano's agent-skill, Frank Anaya's full guide, developassion's REST/MCP bridge docs. Raw sources in `raw/`, wiki pages at `wiki/entities/obsidian-cli.md`, `wiki/entities/obsidian-cli-rest-mcp.md`, `wiki/entities/obsidian-claude-code-mcp.md` (stub), `wiki/concepts/cli-driven-vault-automation.md`. index.md + log.md + docs-site regenerated and committed.
- Answered example-command request for personal/professional obsidian-cli workflows (conversational, not written to disk).
- Loaded wiki-context for the new cross-harness-skill task: `entities/agents-md-format`, `comparisons/cc-to-cross-platform-migration` (per-harness skill/command mechanisms table), `entities/ponytail` (precedent: one skill, thin adapters per harness — Claude/Codex plugin marketplace, OpenCode `.opencode/plugins/*.mjs` + AGENTS.md auto-load, `pi install git:...`).
- Grill-me session started. Question 1 (integration mechanism) asked and answered.

## Decisions Made
- **Integration mechanism: raw `obsidian-cli` via a shared shell script**, not the MCP bridges (`obsidian-cli-rest-mcp` or `obsidian-claude-code-mcp`). Reason: subprocess calls to the CLI binary are the only mechanism that's trivially portable across all 5 target harnesses — MCP config/auth differs per tool and `obsidian-claude-code-mcp` is Claude-Code-only (WebSocket). Each harness gets a thin adapter (SKILL.md / `.opencode/commands/*.md` / `pi install` / TOML agent) that calls the one shared script.

## Blocked / Needs Input
- None — mid-grill, paused by user request to save and clear, not blocked.

## Open grill-me branches (not yet asked, in priority order)
1. ~~Integration mechanism~~ — RESOLVED (see Decisions Made)
2. **Vault target** — dedicated specs vault vs. reusing `llm-wiki` vault (already has `.obsidian/`) vs. per-project vault
3. **Trigger points & invocation shape** — automatic hook (uneven parity: CC has PreToolUse/PostToolUse, OpenCode has 20+ hook events, Codex "can mirror project-local shell hooks" via config.toml, Pi/omp hook support unconfirmed — needs checking) vs. manual slash command vs. both; likely two entry points: "export a finished plan" (post-writing-plans/ExitPlanMode) and "scaffold a new blank SPEC" (user-initiated)
4. **Template structure & content-fill policy** — blank template vs. agent-pre-filled vs. both; which use case gets which (plan-export likely pre-filled, new-SPEC likely starts blank or agent-assisted)
5. **Frontmatter/filename/folder convention** — reuse llm-wiki's frontmatter shape (title/type/tags/sources/created/updated) or a separate simpler convention for live project specs (status: draft/in-review/approved, project:, tags:)
6. **Round-trip** — is this one-directional (agent writes, human reads/edits, done) or does the agent need to read back human edits/comments later to continue implementation?
7. **"Commenting" mechanism** — Obsidian has no native inline comments; need to pick `%%block comments%%` vs. callout blocks (`> [!note]`) vs. a dedicated "## Review Comments" section, and confirm no extra plugin is assumed
8. **Mermaid/code-block/wikilink support specifics** — likely just a content-generation instruction to the template/agent (ensure proper fence syntax + real `[[wikilinks]]` when referencing existing notes) rather than special tooling — confirm

## Files Modified This Session
- `~/repos/llm-wiki/raw/*.md` (4 new, gitignored)
- `~/repos/llm-wiki/wiki/entities/obsidian-cli.md` (new)
- `~/repos/llm-wiki/wiki/entities/obsidian-cli-rest-mcp.md` (new)
- `~/repos/llm-wiki/wiki/entities/obsidian-claude-code-mcp.md` (new, stub)
- `~/repos/llm-wiki/wiki/concepts/cli-driven-vault-automation.md` (new)
- `~/repos/llm-wiki/index.md`, `~/repos/llm-wiki/log.md` (updated)
- `~/repos/llm-wiki/docs-site/**` (regenerated, 80 files)
- All committed as `c6fde58` in the llm-wiki repo (separate git repo from dotfiles)

## Next Session Should
1. Resume the grill-me interview at branch 2 (**vault target**) — ask one question at a time with a recommended answer, per the grill-me skill's format, before drafting any plan.
2. Continue down the remaining branches (3–8 above) in order.
3. Once all branches resolved, draft the implementation plan: the shared shell script (likely `scripts/obsidian-spec.sh` or similar in `~/dotfiles`), the SPEC/plan markdown template, and the 5 per-harness thin adapters (Claude Code SKILL.md, Codex `skills/<name>/SKILL.md` + `agents/openai.yaml`, OpenCode `.opencode/commands/*.md`, Pi `pi install` package, omp plugin).

## Active Plugins This Session
superpowers, caveman, qmd, context7, playwright, feature-dev, code-review, ralph-loop, sentry, obsidian, frontend-design, claude-md-management, claude-code-setup, agent-sdk-dev (per llm-wiki GUIDE.md plugin list; this session ran in the `nvim` dotfiles subrepo, work targeted `~/repos/llm-wiki` and will target `~/dotfiles` for the cross-harness skill).
