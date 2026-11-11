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
2. Never run `~/dotfiles/scripts/spec approve`. Only the human approves a spec. (Approval can be forged by anyone with a shell; this rule is the defence.)
3. When you are asked to write a spec in an unattended or pueue run, stop at a lint-clean SPEC.md with `status: draft`. Implementation is a separate run after approval. A run asked to implement an approved spec proceeds normally. A spec lives only on its feature branch: commit and push the draft there, but never merge a spec-only PR into `main`. The spec reaches `main` only as the rule 7 archive.
4. Never edit a `verify:` line or a test to make a check pass. Report the failure.
5. When rule 1 applies, before saying "done", run `~/dotfiles/scripts/spec check SPEC.md` and `~/dotfiles/scripts/floor-guard`. Paste both outputs.
6. When rule 1 applies, if a check fails, fix and rerun. Stop after 3 tries and report the failing output.
7. When rule 1 applies, after the rule 5 checks pass and before the PR is marked ready or merged, archive the spec as the branch's last commit: `git mv SPEC.md docs/specs/<YYYY-MM-DD>-<slug>.md`. `<YYYY-MM-DD>` is the date SPEC.md was first committed; `<slug>` is the branch name without its type prefix (`feat/multi-provider-usage` becomes `2026-10-20-multi-provider-usage.md`). Commit message: `docs(specs): archive the <slug> spec under docs/specs`. Approval records live outside the repo and are unaffected.
<!-- spec-loop:end -->

## Focus slots

One person supervises many worktrees, so the board caps open work. The board is
`~/repos/Obsidian/Focus.md`; `scripts/focus status` reads it.

- **Caps.** One work item and one hobby item are open at a time; at most three items sit in
  Frozen. A breach shows in `focus status` and must be cleared before new work starts.
- **Refuse, park or switch.** When asked for work outside the focus item, say so and offer
  `scripts/focus park <key>` or `scripts/focus switch <key>`. Never just start it.
- **Blocker exception.** `scripts/focus allow <worktree> --session <sid> --blocker "<reason>"`
  is the person's command, for when the focus item is blocked by that other worktree. An agent
  proposes it with the filled-in command and never runs it to keep working (see Gates).
- **NEXT names the focus item.** Every `NEXT:` line names the focus item it moves forward.

## Gates

<!-- gates:start -->
Gates are the focus scripts and focus guard, `agent-review`, the worktree and workspace guard,
diff review, and every approval prompt (spec approve, permission prompts, approval dialogs).
They exist so the person decides.

- **One refusal means stop.** When a gate refuses, do not get the same effect another way: no
  other tool, no copy, no hand edit, no env override, no `scripts/focus allow`, no checkout of
  a guarded file. Do not suggest such workarounds to the person either.
- **Hand over the unblock.** Report what was blocked (quote the gate's message), why, and the
  exact commands the person can run, in the order they run them. Then wait.
- **The documented workflow is not a bypass.** Taking the next documented step (commit through
  the funnel, `scripts/focus switch` for a follow-up branch of the current focus item,
  `jw new`) is allowed; say so in one line.

When the focus item is done and the session should keep working:

- **Follow-up of the same item: do it.** Once the item's PR is merged, run
  `scripts/focus drop <done key>` (never `--yes`). Then run
  `scripts/focus switch <repo>:<branch>` and `jw new <branch>`, say so in one line, and tell
  the person to continue in a session started there (`jwc <branch>`): a session can write only
  where it started.
- **Anything else: hand it over.** New work outside the item, or any step a gate refuses, goes to
  the person as exact commands, for example `scripts/focus switch <new key>`, `jwc <branch>`.
<!-- gates:end -->

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

Check a pull request's live state before you name it to the user or push more
commits to its branch: `gh pr view <n>` or `gh pr list --state all`. The user
merges pull requests mid-session, and a squash merge takes the branch as it was
at that moment. If the pull request is already merged, put late commits on a
fresh branch from `origin/main` and open a new pull request; never push to the
merged branch or ask the user to act on the merged one. Archive SPEC.md (spec
loop rule 7) before the final push a merge could pick up, so a draft spec never
lands on `main`.

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
for `spec` and the other git-based tools. In a `.claude/worktrees/` checkout a
plain `git commit` or `jj commit` is blocked, and git refuses any other move of
an existing branch (reset, rebase, merge, `update-ref`, branch deletion); those
are the user's call, so ask. Do not run `jj bookmark move`, `jj tug`, `jj
abandon` or other jj history rewrites yourself: jj runs no git hooks, so the
branch guard cannot see them. The exceptions are `jj squash` and `jj rebase`, to
consolidate and reorder your own commits before you push them; jj's
`immutable_heads()` refuses to rewrite pushed commits and `main`/`master`.
Before each push, squash fixup and WIP commits into the coherent commits they
belong to: once pushed, they are immutable. Push with `jj git push -b <branch>` or `git push origin <branch>`, and
fetch with `jj git fetch` or `git fetch`; in a Claude Code worktree only the git
forms pass the guard. Never move or push
`main`/`master`, never pass `--ignore-immutable`, and never rewrite a branch that
another worktree has checked out.

New sessions start through `jw`, not `EnterWorktree`: `jwc <branch>` opens an interactive
`claude` in a fresh colocated jj workspace under `.claude/worktrees/`, and `jwb <branch> <prompt>`
starts a background job there. Such a session has no worktree marker, so the guard does not apply:
`jj git fetch` and `jj git push -b <branch>` pass there, and git aimed at the primary checkout is
still refused by the Bash hook. Remove a finished workspace with `jw rm <name>`; it refuses one
holding uncommitted or gitignored content. A session that did enter a worktree through
`EnterWorktree` or `isolation: "worktree"` is still guarded, and keeps the rules above.

Agent provenance is recorded by tools, never by the model. Each agent write is logged
to a local ledger outside the repo (`scripts/provenance`), and `commit-funnel` appends one
`Agent:` and one `Agent-Paths:` trailer per model that wrote the committed paths, so
`scripts/provenance-report` can compare model quality over time. Do not write these
trailers yourself and do not add model or effort stamps to files. `Co-Authored-By` lines
stay for GitHub display but are not authoritative: the `Agent:` trailers are the record.

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

## Other machines: pve2 over herdr and Paseo

The Mac and pve2 (Tailscale node `pve-2-1`) are linked both ways in Paseo and
one way (Mac to pve2) in herdr. Setup and limits: `docs/workflows/herdr-paseo-mesh.md`.

- Agents reach herdr only through `$HOME/dotfiles/scripts/herdr-safe hc <sub> …`
  and `$HOME/dotfiles/scripts/herdr-safe app <command> …`. Spell the absolute path
  as the whole Bash command, with no env prefix and no `;`, `|` or `$(…)`:
  anything else runs sandboxed and fails on the herdr sockets.
  - `hc ls`, `get`, `read`, `wait`, `templates`, `events` work locally and on
    `pve2/t7` addresses. `send`, `keys`, `interrupt` and `put` reach only a live
    claude or pi terminal. A message may not start with `!`, `/` or `-`. `keys`
    takes named keys only, and `put` takes a non-ignored file in the repository.
  - `hc run [--name n] [--cwd <worktree>] claude [task]` or `hc run pi --model <m>`
    starts an agent in the background, locally, in a linked worktree.
  - `app`: `ls`, `status`, `commands`, `shot`, `feedback`, navigation through
    `do <command> ['<json>']`, and `space.new`/`tab.new`/`terminal.open` with
    argv `["claude"]` or `["pi", "--model", "<m>"]` plus a worktree `folder`.
  - Nothing runs on pve2: it is for messaging agents there. Bare `hc`,
    `herdr-app do`, `hc exec`, `hc run --on` and `herdr --machine` are the
    person's commands. When herdr-safe refuses, stop and hand over.
- Paseo: from the Mac, `p2 ls|send|wait` (a zsh function that reads the pve2
  password from the Keychain). To start an agent on the other host through the
  Paseo MCP tools, pass that host's `serverId` (from `paseo host ls --json`).
- Never print or log a daemon password. They live in the Mac Keychain
  (`paseo-mac`, `paseo-pve2`).

## Claude/Codex planner continuity

Claude Code, Codex, and OpenCode are not parallel workflow targets.

Explicit continuity exception: Claude and Codex may act as successive planners
for the same task/worktree when Claude usage is exhausted, using the
context-switch skill and agent-session handoff/takeover. Stop the previous
writer before takeover; preserve existing review and approval state. Pi/pueue
remains the implementation dispatch lane. This is not automatic provider
fallback or permission to run two writers in one checkout.
