# Research Tool Routing

Use one primary research tool per question. Do not query all three by default.

| Need | Primary tool | Boundary |
|---|---|---|
| Official library, framework, SDK, CLI, or cloud-service documentation | **Context7** | API syntax, configuration, migrations, version-specific behavior, and official examples |
| Real implementation examples from public repositories | **Ketch** (`ketch code` only) | Cross-repo source search, idioms, and how projects call an API in practice |
| General web research or page extraction | **Firecrawl** | URLs, articles, news, current events, broad search, site maps, crawling, and JavaScript-rendered pages |

## Decision order

1. Named package or API documentation question → Context7.
2. Request for real code usage or public-repository examples → `ketch code`.
3. URL, current event, comparison, product research, or general web question → Firecrawl.

Use a second tool only when the primary tool cannot answer, or when the user asks
for corroboration. State the fallback reason instead of silently duplicating work.

## Fallbacks

- Context7 has no matching library or lacks the needed topic → Firecrawl official docs.
- Ketch returns no useful source examples → Firecrawl GitHub/web search.
- Firecrawl finds a package whose API details matter → Context7 before implementation.

Do not use `ketch search`, `ketch scrape`, or `ketch docs`. Those surfaces overlap
with Firecrawl and Context7; `ketch code` is the only approved Ketch command.

## Post-run Verification

- Leave LSP tools available for explicit use, but do not proactively call
  `lsp_diagnostics`. Use `lens_diagnostics` only at turn/final boundaries or
  when explicitly requested.
- Let the post-run verifier own formatting, linting, checking, and focused tests
  after a run settles; never verify inline with a write/edit.
- Run tests only for changed behavioral/output/return/result contracts when
  nearby existing coverage is present. Do not scaffold tests just because a
  file changed.
- Make at most three automatic repair loops, then stop and report the exact
  failing commands and bounded output. Report unavailable tools, skipped stages,
  timeouts, and other degradation honestly.
- Pi-lens project `.pi-lens.json` mutation controls can override the global
  format/autofix defaults. Treat a trusted repo override as explicit project
  policy; otherwise the boundary verifier owns all mutations.

## Shell Tools — prefer the modern CLI

Use these instead of the GNU/POSIX defaults when running commands or writing scripts:

| Instead of | Use | Notes |
|---|---|---|
| `ls` | `eza`, `eza -al` for long+hidden | `--git` annotates status; `--tree --level=N` for trees |
| `grep` | `rg` | Recursive by default; no `-r` needed |
| `cat` | `bat` | Add `-p --paging=never` when piping or reading output back |
| `find` | `fd` | Pattern is a **regex**, not a glob; `-e ts` filters by extension |

These are aliased in `zsh/.zsh/aliases.zsh`, but aliases apply only to interactive
shells. A command run by an agent gets `/bin/ls` and `/usr/bin/grep`, so the modern
name has to be typed explicitly — the alias will not do it for you.

In a worktree-isolated session the Bash guard refuses git commands it cannot verify. Until the
fixes in `docs/workflows/worktree-guard-bandaid.md` land: use `$HOME` or absolute paths, never `~`;
call `/usr/bin/git` if anything rewrites git to `rtk git`; never aim git (`-C`, `cd &&`, `GIT_DIR`)
outside your own worktree; never `source` or `eval`; pass message text with `-F`/`--body-file`.

**The default that will mislead you:** `rg` and `fd` both skip hidden files and
anything matched by `.gitignore`. When looking for generated or ignored state —
`.pi/`, `node_modules/`, build output, an agent's own scratch files — pass
`--no-ignore --hidden` (`rg -uu`, `fd -HI`) or you will get an empty result that
looks like "the file does not exist" rather than "the file is ignored".

**Portability.** In a script committed for other machines, prefer the modern tool
and fall back rather than assuming:

```sh
if command -v rg >/dev/null; then rg "$pattern" "$dir"; else grep -r "$pattern" "$dir"; fi
```

Installed here: `eza`, `rg`, `bat`, `fd`, `delta`. Not installed: `sd`, `dust` — use
`sed` and `du` for those.

<!-- spec-loop:start -->
## Spec loop

1. If SPEC.md exists at the repo root and its `branch:` matches the current branch, read it before writing code. Work only toward its AC ids. Obey its Boundaries.
2. Never run `~/dotfiles/scripts/ac-run approve`. Only the human approves a spec. (Approval can be forged by anyone with a shell; this rule is the defence.)
3. When you are asked to write a spec in an unattended or pueue run, stop at a lint-clean SPEC.md with `status: draft`. Implementation is a separate run after approval. A run asked to implement an approved spec proceeds normally. A spec lives only on its feature branch: commit and push the draft there, but never merge a spec-only PR into `main`. The spec reaches `main` only as the rule 7 archive.
4. Never edit a `verify:` line or a test to make a check pass. Report the failure.
5. When rule 1 applies, before saying "done", run `~/dotfiles/scripts/ac-run check SPEC.md` and `~/dotfiles/scripts/floor-guard`. Paste both outputs.
6. When rule 1 applies, if a check fails, fix and rerun. Stop after 3 tries and report the failing output.
7. When rule 1 applies, after the rule 5 checks pass and before the PR is marked ready or merged, archive the spec as the branch's last commit: `git mv SPEC.md docs/specs/<YYYY-MM-DD>-<slug>.md`. `<YYYY-MM-DD>` is the date SPEC.md was first committed; `<slug>` is the branch name without its type prefix (`feat/multi-provider-usage` becomes `2026-10-20-multi-provider-usage.md`). Commit message: `docs(specs): archive the <slug> spec under docs/specs`. Approval records live outside the repo and are unaffected.
<!-- spec-loop:end -->

## Code discipline: YAGNI

Build only what the current request needs. Do not add features, parameters,
flags, config, hooks, abstractions or extension points for a future nobody asked
for. Before adding generality, imagine the refactoring it would take to add it
later; if that looks cheap, defer it. If you think a future need is likely, say
so in one line instead of building it.

YAGNI covers presumptive capability only. It never justifies skipping tests,
verification, error handling the current requirement needs, or refactoring that
keeps code easy to change. Something cheap that adds no complexity (a lookup
table instead of inline literals) is fine. An abstraction that makes the current
code harder to understand needs a current reason; without one, leave it out.

## Git history

Commit as you go. After each coherent unit of work, stage the files you changed
by path (not `git add -A`, which sweeps in probe and scratch directories) and
commit with a clear message, without asking first. The history is the trace of
the work. Do this on a branch or worktree, never directly on `main` or `master`.
In a `gh stack`, commit each layer as you go, on that layer's branch.

Keep branch and worktree names to 16 characters or fewer, type prefix included
(`feat/pi-live`, `docs/name-limit`): longer names get cut off or crowd the
panes, bars and lists that show them. A dispatch slug is a name of at most 11
characters plus a 4-hex suffix (`openssl rand -hex 2`), so `pi-live-a3f9` fits.
Claude Code's EnterWorktree adds `worktree-` to the branch name, so give it at
most 7 characters, or create the worktree with `git worktree add -b <branch>`.

Still ask before push, force-push, merge, rebase, `reset --hard`, and deleting
branches. The review gates (`agent-review`, `:AgentReview`) apply to what is
pushed or merged, not to commits.

jj is the default VCS for agent sessions, colocated with git so the git-based
gates keep working. Use jj for local history work. A new worktree is colocated
once with `jj git init --colocate`: in Claude Code a hook does it on the first
Bash call, because the worktree guard refuses every typed `jj git` command; Pi
runs it itself.
Agents commit only through the funnel, in git and jj mode alike:
`$HOME/dotfiles/scripts/commit-funnel --worktree <session worktree> -F <message
file> <path>...`, with the session worktree spelled out literally. It tracks and
commits only the listed paths, refuses `main`/`master` and a foreign checkout,
and in jj mode moves the branch bookmark and reattaches git HEAD (`git switch`)
for `ac-run` and the other git-based tools. In a `.claude/worktrees/` checkout a
plain `git commit` or `jj commit` is blocked, and git refuses any other move of
an existing branch (reset, rebase, merge, `update-ref`, branch deletion); those
are the user's call, so ask. Do not run `jj bookmark move`, `jj tug` or other
jj history rewrites yourself: jj runs no git hooks, so the branch guard cannot
see them. Push with `jj git push -b <branch>` or `git push origin <branch>`, and
fetch with `jj git fetch` or `git fetch`; in a Claude Code worktree only the git
forms pass the guard. Never move or push
`main`/`master`, never pass `--ignore-immutable`, and never rewrite a branch that
another worktree has checked out.

## Repo tooling: mise

mise is the default for a repo's tools, environment, tasks and pins. Before
installing or running anything, look for `mise.toml` (or `.mise.toml`,
`.tool-versions`) and work through it:

- Tools and pinning: `mise use <tool>@<version>` installs a tool and writes the
  pin to the repo's `mise.toml`; `mise install` installs what the config pins;
  `mise ls` and `mise outdated` show what is active and what is behind. Do not
  install a repo's tools with `brew`, `npm -g`, `pip install --user`, `nvm`,
  `pyenv` or `rbenv`.
- Running and testing: use `mise run <task>` when the repo defines mise tasks
  (`mise tasks` lists them), otherwise the repo's own runner. `mise x -- <cmd>`
  runs a command with the pinned tools when the shell has no mise activation.
- Environment: repo variables go in `[env]` in `mise.toml` (`mise set KEY=value`).
  Secrets never go in `mise.toml`; use a gitignored `mise.local.toml`.
- Updating: `mise upgrade` stays inside the pinned range and `mise upgrade --bump`
  moves the pins. Run either only when the task is an update; otherwise ask.

Never run `mise trust` (trust lets a config run code), `mise use -g`/`--global`,
`mise settings`, `mise self-update`, `mise implode`, `mise token` or `mise ssh`.
They change the whole machine or expose credentials, so they are the human's
call. Add a mise config to a repo that has none only when the task asks for it.
