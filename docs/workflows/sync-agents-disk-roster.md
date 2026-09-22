# Work Order — make sync-agents.py disk-driven, keep the roster as presets

**For:** Pi (implementer). **Repo:** `~/repos/llm-wiki`. **Written:** 2026-09-22.
**Status:** ready to build, not started.

`scripts/sync-agents.py` generates `.opencode/agents/<name>.md` from canonical bodies in
`claude-setup/agents/<name>.md`. Commit `d9794e4` (2026-09-16) deleted the custom agent roster —
18 canonical files and their 22 generated counterparts — as part of a deliberate harness
minimization. Both directories are empty today.

The generator still iterates a hardcoded dict of those 18 names, so every run prints 18
`canonical missing` skips. Nothing is broken; the script skips rather than fails. But the roster
now describes agents that do not exist instead of the agents that do.

The owner intends to reintroduce agents later. Make the script ready for that.

**Before you start:** `agent-review` is live. Every run of yours that changes a file produces a
pending review and blocks your next input until resolved. Resolve with `:AgentReview` in Neovim,
or set the gate's mode off for the duration and back on when done.

---

## Established facts — verified, do not re-derive

- `CANON = ROOT / "claude-setup" / "agents"`, `OC = ROOT / ".opencode" / "agents"` (lines 32-33).
  Both contain 0 files.
- The loop at line 122 is `for name in sorted(OC_FRONTMATTER)`; line 124 emits the skip.
- `OC_FRONTMATTER` holds 18 entries of `{model, color, permission{edit,websearch,bash}}`, some
  with `temperature`. `description` is deliberately not stored — it is read from the canonical
  file's frontmatter.
- `OC_ONLY = {"plan-writer"}` is a passthrough set for OpenCode-only agents.
- `project_health_monitor_reconcile(canon_body)` is applied to **every** body at line 134.
- A `.opencode/agents/<name>.md.overrides-body` file, when present, replaces the body for the
  OpenCode emit only.
- Drift detection (lines 144-151) compares the existing `.opencode` body against canonical and
  refuses to overwrite without `--force`.
- The caller is `~/dotfiles/scripts/sync-agent-rules.sh:109-112`, which invokes this script with
  `--check`. **That path is correct. Do not change it, and do not edit that file.**

---

## Part 1 — iterate the directory, not the dict

Drive the loop from `sorted(CANON.glob("*.md"))`, taking `name` from each path's stem. A canonical
file that exists gets emitted; a name with no file simply does not appear.

Keep every existing behavior inside the loop: the description lookup and its skip when absent, the
body override, drift detection, `--force` and `--check`.

When `CANON` holds no `*.md` files at all, print one line saying the canonical directory is empty
and that adding `claude-setup/agents/<name>.md` is what registers an agent, then exit 0. Do not
print a skip per remembered name.

## Part 2 — the roster becomes presets

Rename `OC_FRONTMATTER` to `OC_PRESETS` and keep all 18 entries. Re-document it: these are
remembered OpenCode settings for agents that used to exist, applied automatically if a canonical
file of that name reappears. They are not a list of agents that must exist.

For a canonical file whose name has no preset, build frontmatter from defaults:

- `mode: subagent` — unchanged from today's behavior
- `model` — read a `model:` field from the canonical frontmatter if present; otherwise use the
  medium tier default. Put the default in one named constant, not inline.
- `permission` — `{"edit": "deny", "websearch": "deny", "bash": "deny"}`. Conservative on purpose:
  a newly added agent must not acquire write or shell access merely because nobody specified it.
  A preset that grants more still wins for its own name.
- `color` — omit when there is no preset rather than inventing one.

Print which agents were emitted from a preset and which from defaults, so the distinction is
visible in a run.

## Part 3 — scope the agent-specific transform

`project_health_monitor_reconcile()` applies to every body but is written for one agent that no
longer exists. Gate it on `name == "project-health-monitor"` so a future agent cannot be silently
rewritten by it. Keep the function and its behavior; only its trigger changes.

## Part 4 — docstring

Update the module docstring to describe the new contract: the canonical directory is the roster,
presets are remembered settings keyed by name, and defaults are conservative. Keep the existing
Usage block accurate. It already names `scripts/sync-agents.py` correctly.

---

## Verification

Run from `~/repos/llm-wiki`.

| What | Command | Expected |
|---|---|---|
| Empty state | `python3 scripts/sync-agents.py` | exit 0, one line about the empty canonical dir, no per-name skips |
| Check mode still clean | `python3 scripts/sync-agents.py --check` | exit 0 |
| Preset path | create `claude-setup/agents/code-reviewer.md` with frontmatter `description:` and a short body, then run | emits `.opencode/agents/code-reviewer.md` with the preset's model `opencode-go/deepseek-v4-pro` and color `#EF5350`; run labels it as preset-sourced |
| Default path | same with a new name such as `scratch-probe` | emits with the medium-tier default model and all three permissions `deny`; run labels it as default-sourced |
| Idempotent | run twice | second run byte-identical, no drift reported |
| Drift still detected | edit the emitted `.opencode` body by hand, run `--check` | non-zero exit, drift reported |
| No description | canonical file without a `description:` field | that agent is skipped with the existing message |
| Cleanup | remove both scratch canonical files and their emitted output | `git status --short` clean |

Note: this shell's rtk wrapper discards exit codes at the top level and can alter text in filtered
output. Check a status with `sh -c '<cmd> >/dev/null 2>&1; echo $?'`, and read file contents with
`sed`/`cat` rather than trusting a filtered grep when the exact text matters.

## Commit

One commit in `~/repos/llm-wiki`. Explain that the canonical directory is now the roster and that
the 18 former entries are retained as presets for reintroduction, not as required agents. Do not
commit the scratch files from verification.
