# Plan: one capability map for every harness's subagent tools

**For:** Pi (implementer). **Repo:** `~/dotfiles`, branch `feat/sh-agents`, after
`docs/plans/2026-11-04-shared-agents.md` is complete. **Approved:** 2026-11-05.

## Problem

`scripts/sync-agents` renders `shared/agents/<name>.md` (Claude tool names in `tools:`, Claude
wording in the body) for Pi, OpenCode and Codex. Two things go wrong:

- The body names Claude tools ("read with the Read tool"). Codex has no Read tool, so its copy
  tells the model to use a tool that does not exist.
- Each harness enforces limits differently, and the generator only half knows it.
  `PI_TOOL_MAP` is hard-coded; OpenCode permissions come from a per-agent preset or a blanket
  deny; Codex gets no limits at all.

## How each harness enforces tools (from official docs)

| Capability | Claude | Pi | OpenCode permission key | Codex |
|---|---|---|---|---|
| read | `Read` | `read` | `read` | shell (`sed -n`, `bat`) |
| search | `Grep` | `grep` | `grep` | shell `rg` |
| find | `Glob` | `find`, `ls` | `glob`, `list` | shell `fd` |
| edit | `Edit` | `edit` | `edit` (covers write, edit, apply_patch) | `apply_patch` |
| write | `Write` | `write` | `edit` | `apply_patch` |
| shell | `Bash` | `bash` | `bash` (glob map) | `exec_command` |

- Claude and Pi: the `tools:` list is an allowlist.
- OpenCode: `permission:` keys set to `allow`, `ask` or `deny`
  (opencode docs, `agents.mdx` and `permissions.mdx`).
- Codex: a custom agent file needs only `name`, `description` and `developer_instructions`. It
  has no tool list. It can only switch features off (`features.shell_tool = false` and others).
  `sandbox_mode` and `approval_policy` in an agent file do not override the parent session, and
  `apply_patch` cannot be disabled per agent (OpenAI Codex docs, "Custom agents"; `openai/codex`
  `core/src/tools/spec_plan.rs`). So for Codex a limit is enforced by its instructions only.

## Deliverables

### 1. `shared/agents/tools.toml`, the capability map

One table per capability (`read`, `search`, `find`, `edit`, `write`, `shell`). Each table
holds:

- `claude`: the Claude tool name, the key that `tools:` in the canonical file uses.
- `pi`: a list of Pi tool names.
- `opencode`: the OpenCode permission key.
- `codex`: what Codex uses.
- `phrase.<harness>`: the words that stand in for a placeholder in the body. For example, read
  becomes "the Read tool" for Claude, "the `read` tool" for Pi and OpenCode, and "`sed -n` or
  `bat` in the shell" for Codex.

Data only, read with `tomllib`. It replaces `PI_TOOL_MAP` and `PI_TOOL_EXTRA` in
`scripts/sync-agents`.

### 2. Body placeholders

Canonical bodies may contain `{{tool:<capability>}}`. The generator replaces each one with that
harness's `phrase`. An unknown capability makes the generator exit 1 and name the file.

The Claude copy is a symlink to the canonical file and is not rendered. So the canonical text
must read correctly as written. Use the placeholders only in a sentence that still makes sense
to Claude unrendered, or do this instead: when any placeholder is present, the Claude output
becomes a rendered file rather than a symlink. **Choose the rendered file.** It keeps the
canonical file the only one edited by hand, and `--check` still catches drift. Update the module
docstring and `docs/agents/README.md` to match.

Convert the existing bodies: the scout's "read with the Read tool" and any other mention of a
Claude tool name in `shared/agents/*.md`.

### 3. Limits come from `tools:`

- **Pi:** `tools:` mapped through the map, as now.
- **OpenCode:** each capability the agent lacks gets `deny`. `edit` is denied unless the agent
  has Edit or Write. `bash` is denied unless it has Bash. A preset's `oc_permission` still
  overrides: the diagrammer's bash glob map stays.
- **Codex:**
  - An agent without Edit and Write gets this fixed paragraph appended to
    `developer_instructions`: "You are read-only. Do not edit, create or delete files, and never
    call apply_patch. Report what should change instead."
  - An agent without Bash gets `[features]` with `shell_tool = false`.
- An optional preset key `codex_effort` overrides `model_reasoning_effort` for Codex. Set it to
  `low` for `scout` and `worker`, their Codex effort before this branch.

### 4. Tests

Add `scripts/tests/test_sync_agents.py` (stdlib `unittest`, run the script on a temp copy of
`shared/agents/` plus `tools.toml`; follow `scripts/tests/test_commit_funnel.py` for style):

1. A placeholder renders to each harness's phrase.
2. An unknown placeholder exits 1 and names the file.
3. A read-only agent's Codex file contains the read-only paragraph, and its OpenCode file has
   `edit: deny`.
4. An agent without Bash gets `shell_tool = false` in Codex.
5. A second run writes nothing.

## Boundaries

- Do not edit `claude/.claude/settings.json`, hooks, agent-review, pi-lens or any guard.
- Do not change the canonical agents' meaning, only how they name tools.
- Commit only through `$HOME/dotfiles/scripts/commit-funnel`. Symlinks commit correctly since
  #253.

## Commits

1. `feat(agents): capability map for harness tool names and limits`: `tools.toml`, generator.
2. `feat(agents): tool placeholders in shared agents`: bodies, regenerated outputs.
3. `test(agents): sync-agents rendering and limits`.

## Verification (paste real output)

1. `uv run --with pytest python -m pytest -q scripts/tests/test_sync_agents.py`.
2. `scripts/sync-agents --check` exits 0, and a second `scripts/sync-agents` writes nothing.
3. `rg -n 'Read tool|Grep tool|Glob tool' codex/.codex/agents pi/.pi/agent/agents opencode/.config/opencode/agents` returns nothing.
4. `python3 -c 'import tomllib,glob; [tomllib.load(open(f,"rb")) for f in glob.glob("codex/.codex/agents/*.toml")]'`.
5. `rg -n 'apply_patch' codex/.codex/agents/scout.toml` shows the read-only paragraph.
