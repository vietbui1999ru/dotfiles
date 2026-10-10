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

In a worktree-isolated session the Bash guard refuses `git` once the rtk hook rewrites it to `rtk git`; run it as `/usr/bin/git` instead.

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

Still ask before push, force-push, merge, rebase, `reset --hard`, and deleting
branches. The review gates (`agent-review`, `:AgentReview`) apply to what is
pushed or merged, not to commits.
