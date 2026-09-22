# Work Order — retire Graphify from llm-wiki, ignore agent runtime state

**For:** Pi (implementer). **Repo:** `~/repos/llm-wiki`. **Written:** 2026-09-22.
**Status:** ready to build, not started.

Graphify has already been uninstalled: `graphify` is not on `PATH` and `graphify-out/` no longer
exists on disk. Seven tracked files still instruct agents to use it. The untracked note
`AGENT-UPDATE-2026-09-16-graphify-removed.md` is the original work order for this; it names five
files and misses two.

## Hard constraint — do not touch `.codex/config.toml`

That file has uncommitted changes holding two live credentials. The user is handling it manually.
Do not read it into a commit, do not revert it, do not `git add -A` or `git add .` anywhere in this
repo. Stage every change by explicit path.

## Part 1 — strip Graphify from agent instructions

Delete the whole `## graphify` section from each of these, including its heading and bullets:

- `AGENTS.md` — lines 1-12 (8 matches)
- `CLAUDE.md` — lines 152-160 (6 matches)
- `GEMINI.md` — lines 1-9 (6 matches)

These three sections are near-identical copies of the same block. `AGENTS.md:5` also tells agents to
invoke a `graphify` skill; `skills/graphify/` does not exist, so the instruction is already dead.

Replacement guidance: do not substitute a new retrieval section. `CLAUDE.md` already documents
`qmd query "<topic>"` as the lookup path — check each file for an existing qmd instruction and add a
one-line pointer to it only where none survives the deletion.

## Part 2 — the two files the note missed

- `.cursor/rules/graphify.mdc` — an entire Cursor rule file for the removed tool (3 matches).
  Delete the file with `git rm`.
- `.gitignore` lines 14-15 — the `graphify-out/` ignore entry and its comment. Remove both.

## Part 3 — wiki content, then regenerate

Edit the wiki source only, never the `.mdx` mirror by hand:

- `wiki/concepts/compound-engineering.md:28` — drop `Graphify/` from the capability list, leaving the
  qmd query pattern.
- `wiki/concepts/compound-engineering.md:64` — remove the Graphify bullet.

Then run `node claude-setup/scripts/build-docs-site.mjs` to regenerate
`docs-site/concepts/compound-engineering.mdx`. CI job `docs-site-sync` in
`.github/workflows/quality.yml` regenerates and fails if `docs-site/` is stale, so a hand-edited
`.mdx` will be caught.

## Part 4 — ignore agent runtime state

Untracked runtime artifacts are accumulating in the repo root: `.agents/approvals/*.approved` (three
agent-review approval tokens) and `.pi/status/*.json` (two Pi session status files). These are
machine state, not content. Add `.agents/` and `.pi/` to `.gitignore` near the existing `.claude`
entry on line 42.

## Part 5 — trim the Codex hook file

`.codex/hooks.json` is untracked and holds three hooks. Keep one, drop two:

- **Keep** the `PostToolUse` → `capture-bash-error.sh` hook. The script exists at
  `scripts/capture-bash-error.sh` and feeds `mistakes/raw-log.md`; nothing else wires it up.
- **Drop** the `publish-ai-kb.sh` hook in the same block. It already exists in the machine-global
  `~/.codex/hooks.json` and in `.codex/config.toml`, so this is a third copy.
- **Drop** the `UserPromptSubmit` docling pre-parse hook. The `pdf-ingest` skill already runs Docling
  as part of the ingest workflow, and a prompt-triggered shell pipeline is the more fragile path to
  the same result.

Leave the trimmed file untracked unless you can confirm from Codex's own documentation that a
project-local `.codex/hooks.json` is read and merged with the global one. State which way you
confirmed it.

## Verification

Run from `~/repos/llm-wiki`:

| What | Command | Expected |
|---|---|---|
| No Graphify left | `git grep -ril graphify` | no output |
| docs-site fresh | `node claude-setup/scripts/build-docs-site.mjs && git diff --stat docs-site/` | no diff after regeneration |
| Runtime state ignored | `git status --short` | no `.agents/` or `.pi/` entries |
| Secrets untouched | `git status --short .codex/config.toml` | still ` M`, unstaged |
| Rules cap | `bash claude-setup/scripts/check-gpr-cap.sh` | passes at or under 45 lines |
| Markdown lint | the `quality.yml` lint job's command | passes |

Note: this shell's rtk wrapper discards exit codes at the top level. Wrap a status check as
`sh -c '<cmd> >/dev/null 2>&1; echo $?'` or a failing command will look like it passed.

## Commit

One commit, message explaining that Graphify was uninstalled and the instructions followed it out.
Delete `AGENT-UPDATE-2026-09-16-graphify-removed.md` in the same commit — it is the work order for
this change, and completing the change retires it. Do not commit `.codex/config.toml`.
