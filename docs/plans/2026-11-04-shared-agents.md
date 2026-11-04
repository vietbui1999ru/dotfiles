# Shared agents: one source, generated per harness

Branch: `feat/sh-agents`. Worktree: `/home/vietbq/dotfiles/.claude/worktrees/sh-agents`.

## Context

Subagent definitions are copied by hand into each harness's own directory and format:

| Harness | Directory | Format |
|---|---|---|
| Claude | `claude/.claude/agents/*.md` | YAML frontmatter (`name`, `description`, `model`, `effort`, `tools` as `Read, Grep`, `permissionMode`, `maxTurns`, `omitClaudeMd`, `skills`, `color`) + markdown body |
| Pi | `pi/.pi/agent/agents/*.md` | YAML frontmatter (`name`, `description`, `tools` as lowercase `read, bash, grep, find, ls, write, edit`) + same body |
| OpenCode | `opencode/.config/opencode/agents/*.md` | YAML frontmatter (`description`, `mode: subagent`, `permission` with `edit` and `bash` glob map) + same body |
| Codex | `codex/.codex/agents/*.toml` | `name`, `description`, `model_reasoning_effort`, body in `developer_instructions = '''...'''` |

`diagrammer` exists in all four (hand-written, bodies identical, #171). `scout` and `worker` exist in Claude and Codex only. They drift. The user wants one canonical copy in `shared/agents/` and a generator that writes the rest.

Precedent to port, not reinvent: `~/repos/llm-wiki/scripts/sync-agents.py` (238 lines). It reads canonical Claude-format files and emits OpenCode files with per-agent presets, `--check` and `--force` modes, and drift detection. Its canonical folder was deleted, so it is dead. Read it first and reuse its structure (frontmatter parse, preset table, idempotent emit, drift check). Do not edit llm-wiki.

## Deliverables

### 1. `shared/agents/<name>.md` — canonical source

One file per agent, Claude frontmatter plus body. Create them by moving content:

- `scout.md`, `worker.md`, `diagrammer.md`: copy from `claude/.claude/agents/<name>.md` unchanged.
- `chronicler.md`: new; see deliverable 4.

Do not include `firecrawl` (out of scope; leave all four firecrawl agent files alone).

### 2. `scripts/sync-agents` — generator (Python 3, stdlib only, executable, `#!/usr/bin/env python3`)

The canonical directory is the roster: iterate `shared/agents/*.md`, never a hard-coded name list.

For each canonical file emit:

- **Claude**: a relative symlink `claude/.claude/agents/<name>.md -> ../../../shared/agents/<name>.md`. Replace the existing regular file. The link must resolve from inside the repo (`test -e claude/.claude/agents/<name>.md`), independent of how stow links `~/.claude`.
- **Pi**: `pi/.pi/agent/agents/<name>.md` with frontmatter `name`, `description`, `tools` (Claude tool names mapped: Read→read, Grep→grep, Glob→find, ls, Bash→bash, Write→write, Edit→edit; drop names with no mapping) and the body.
- **OpenCode**: `opencode/.config/opencode/agents/<name>.md` with `description`, `mode: subagent`, `permission` from a per-agent preset table; an agent with no preset gets `edit: deny` and `bash: {"*": deny}` (never grant access by default).
- **Codex**: `codex/.codex/agents/<name>.toml` with `name`, `description`, `model_reasoning_effort` (from canonical `effort`, default `medium`) and `developer_instructions` holding the body in a `'''` literal string. Fail loudly if the body contains `'''`.

Each generated file starts with a one-line comment that it is generated from `shared/agents/<name>.md` by `scripts/sync-agents` (HTML comment after the frontmatter for `.md`, `#` comment for `.toml`), unless that breaks a harness's parser; check how each harness reads its files and skip the comment where it would.

Presets: a dict keyed by agent name holding the harness-specific extras that cannot be derived (OpenCode `permission`, Codex extras). Seed them from the existing hand-written files, so regenerating `diagrammer`, `scout` and `worker` reproduces today's OpenCode/Codex/Pi content.

Modes, like the llm-wiki script:
- no flag: write everything; fail (exit 1, list files) if a generated file was edited by hand and differs from what would be written.
- `--force`: write and overwrite drift.
- `--check`: write nothing; exit 1 and list files that are missing or would change.

Idempotent: a second run changes nothing.

### 3. Wire it in

`scripts/sync-agent-rules.sh` lines ~178–185 call the dead `~/repos/llm-wiki/scripts/sync-agents.py --check`. Replace that block with a call to `"$HOME/dotfiles/scripts/sync-agents" --check` that prints a `✓` / `⚠ run scripts/sync-agents --force` line in the same style. Leave the Codex copy loop (lines ~33–39) as it is: it copies the generated `.toml` into `~/.codex/agents`.

Add a short section to `docs/` (pick the existing doc that covers agents or harness setup; `rg -l 'diagrammer' docs` to find it) saying: edit `shared/agents/`, run `scripts/sync-agents`, never edit the generated copies.

### 4. `shared/agents/chronicler.md` — generalized from ai-gateway

Source to generalize: `/home/vietbq/repos/ai-gateway/.claude/agents/chronicler.md` (read-only; do not edit ai-gateway). It is tied to that repo (`specs/STATUS.md`, `glab`, gateway diagrams, `mise run check`). Keep its contract and discipline; drop every gateway-specific path and diagram.

Keep:
- Role: records, never decides or designs; every fact must point to a source; unconfirmed things go under Open items.
- `docs/progress/YYYY-MM-DD.md`, one per working day (date from commits), append-only, sections in order: Built, Decisions, Key code (excerpts ≤25 lines with `path:line (sha)` heading, merged tree only), Open items / blockers, Next.
- `docs/progress/README.md` index, newest first.
- Diagram rules: one question per diagram stated above it, validate with `pele-render` (stop and report if missing), ~9 nodes max, built vs planned (`-.->` + `(planned)`), no `%%{init}%%`.
- Secrets rule: never print, copy or infer a secret, token, key or `.env` value.
- Commit only through `$HOME/dotfiles/scripts/commit-funnel --worktree "$PWD" -F <msg file outside repo> <paths>`, never push; stop and report if the funnel refuses.
- The Report format (Files written, Diagrams, Not recorded, Checks).

Generalize:
- Sources are discovered, not assumed: `SPEC.md` and `docs/specs/`, `docs/plans/`, `docs/adr/` (respect proposed vs accepted), `CONTEXT.md` (use its terms exactly when present), `README.md`, `git log`/`git show` against the default branch, and merged PRs read-only via `gh pr list --state merged` or `glab mr list --merged`, whichever the remote uses. List what was found in the report.
- System map: optional `docs/system-map.md`, written only when the parent asks for it; the parent names the questions the diagrams answer. No fixed list of diagrams.
- Validation: run the repo's own check if one exists (`mise run check`, a `Makefile` `check` target), otherwise say none exists.
- Writes only under `docs/progress/` and `docs/system-map.md`; everything else is read-only.
- Frontmatter: `name: chronicler`, a description in the style of the others, `model: sonnet`, `effort: medium`, `tools: Read, Grep, Glob, Bash, Write, Edit`, `maxTurns: 30`, `color: green`. Add an OpenCode preset allowing `edit` and bash only for `git *`, `gh *`, `glab *`, `pele-render *`, `rg *`, `fd *`, `ls *`, `date *`, `mise run check*` and the commit-funnel path.
- Note in the body that a project's own `.claude/agents/chronicler.md` overrides this one (ai-gateway keeps its specific version).

Keep the body under ~120 lines.

## Boundaries

- Do not touch: `firecrawl` agent files, `~/repos/llm-wiki`, `~/repos/ai-gateway`, `claude/.claude/skills/`, any file outside this worktree.
- Do not change the behaviour of `scout`, `worker` or `diagrammer`: their Claude bodies and frontmatter move to `shared/agents/` byte for byte.
- No new dependencies.

## Commits (through the funnel, on `feat/sh-agents`, do not push)

`$HOME/dotfiles/scripts/commit-funnel --worktree /home/vietbq/dotfiles/.claude/worktrees/sh-agents -F <msg> <paths>`

1. `feat(agents): canonical shared/agents with scout, worker, diagrammer`
2. `feat(agents): scripts/sync-agents generates per-harness agent files` (script, generated files, symlinks)
3. `chore(agents): sync-agent-rules checks shared agents; document the flow`
4. `feat(agents): repo-agnostic chronicler agent` (canonical + its generated copies)

## Verification (paste real output in the final report)

1. `scripts/sync-agents --check` exits 0 right after a run; a second run of `scripts/sync-agents` changes nothing (`git status --short` clean).
2. For `diagrammer`: `git diff origin/main -- pi/.pi/agent/agents/diagrammer.md opencode/.config/opencode/agents/diagrammer.md codex/.codex/agents/diagrammer.toml` shows only the generated-file comment line (or nothing). Same for Codex `scout.toml` and `worker.toml`. Report any other difference and why.
3. `for f in claude/.claude/agents/{scout,worker,diagrammer,chronicler}.md; do test -L "$f" && test -e "$f" && echo "ok $f"; done` prints four `ok` lines.
4. Hand-edit a generated Pi file, run `scripts/sync-agents`: exits 1 naming it; `--force` restores it. Revert the hand edit.
5. `python3 -c 'import tomllib,glob; [tomllib.load(open(f,"rb")) for f in glob.glob("codex/.codex/agents/*.toml")]'` succeeds.
6. `bash -n scripts/sync-agent-rules.sh`.
7. `rg -n 'STATUS.md|glab mr|gateway|litellm|sops' shared/agents/chronicler.md` returns only the generic `glab mr list --merged` mention.
