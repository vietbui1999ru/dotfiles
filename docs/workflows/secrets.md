# Secrets: where keys live and who loads them

API keys live in one plaintext file, `~/secrets/.env` (mode 600, folder mode 700). Nothing
sources that file. A shell never exports its keys, so a new shell holds no key values, and each
tool loads only the keys it needs, at the moment it starts.

## The tools

| Tool | Command | Keys it gets |
|---|---|---|
| `secret-get NAME` | `scripts/secret-get` | Prints one key's value. Exit 1 if NAME is missing; exit 2 if the file or folder mode is too loose. |
| `with-secrets NAME... -- cmd` | `scripts/with-secrets` | Runs `cmd` with only the named keys added. Fails before running `cmd` if any key is missing. |
| `with-secrets --optional NAME... -- cmd` | `scripts/with-secrets` | Same, but a NAME the file does not hold is skipped instead of stopping `cmd`. A mode that is too loose still fails. |
| `redact` | `scripts/redact` | Cleans text (stdin to stdout) before it is logged or pushed: literal `.env` values, token shapes, auth headers, URL credentials. |
| `secret-scan` | `scripts/secret-scan` | Exits 1 on a file or stdin that holds a key, printing file:line and the pattern name, never the value. |

A line containing `secret-scan: allow` is skipped, for a deliberate fake key in a fixture.
The pre-commit hook (`scripts/link-git-hooks`) runs `secret-scan` on staged content and refuses
the commit on a hit. `mistake-sync` runs it before commit and push.

## Which tool loads which key

| Tool | How it starts | Keys |
|---|---|---|
| claude | `claude` function in `zsh/.zsh/aliases.zsh`, through `with-secrets` | CONTEXT7_API_KEY, EXCALIDRAW_API_KEY |
| opencode | `opencode` function, same wrapper | CONTEXT7_API_KEY, EXCALIDRAW_API_KEY |
| codex | `codex` function, same wrapper | CONTEXT7_API_KEY, EXCALIDRAW_API_KEY |
| hclaude | alias, Headroom with `HEADROOM_TELEMETRY=off`, through `with-secrets` | CONTEXT7_API_KEY, EXCALIDRAW_API_KEY |
| pi | no wrapper: the `context7` header in `~/.pi/agent/mcp.json` is a `!` command, `$HOME/dotfiles/scripts/secret-get CONTEXT7_API_KEY`, run once when Pi connects | CONTEXT7_API_KEY |
| pi-view (pueue dispatch) | `scripts/pi-view`, through `secret-get` | CONTEXT7_API_KEY only |
| firecrawl MCP (Claude, OpenCode) | `scripts/firecrawl-mcp` as the server command | FIRECRAWL_API_KEY (`FIRECRAWL_ENV_FILE` picks another file, such as send-it) |
| wiki-chat | `~/.local/bin/wiki-chat`, through `secret-get` (only with `--backend opencode`) | OPENCODE_GO_API_KEY_LIGHTRAG |
| wiki-index | `~/.local/bin/wiki-index`, through `secret-get` | OPENCODE_GO_API_KEY_LIGHTRAG |
| wiki-mcp | `~/.local/bin/wiki-mcp` as an MCP server command, through `secret-get` | OPENCODE_GO_API_KEY_LIGHTRAG |

Without a secrets file the wrappers still start the client, with those MCP keys unset.
The wrappers ask for both MCP keys with `--optional`, so a readable file that lacks one still
starts the client: that MCP server alone goes unauthenticated, and `secret-get` names the missing
key on stderr once at start. A missing key must not cost the launch — an MCP server that cannot
authenticate is a smaller failure than a client that cannot start. Add the key to
`~/secrets/.env` to bring its server back.

GUI-launched clients (the Claude desktop app, Orca) do not run shell aliases, so they get none
of these keys. They lose those MCP servers until a launcher exists.

## Adding a key for a new tool

1. Add `NAME=value` to `~/secrets/.env`. Do not add it to a shell rc file or to a tool's config as
   a literal.
2. Give the tool its own loader: a wrapper that calls `with-secrets NAME --` for a command, or
   `secret-get NAME` inside a script that reads it at run time.
3. Name the key in this table, so the next reader knows which tool sees it.

Keep MCP config values as `${VAR}` (Claude) or `{env:VAR}` (OpenCode), and let the loader supply
the variable. Pi has no wrapper to supply it, so `scripts/sync-agent-rules.sh` writes a `!` command
instead: Pi runs a header value that starts with `!` as a shell command and sends its stdout, so the
key is read at connect time and never lands in a config or an exported environment.

## At-rest checklist (human, not automated)

- Rotate GITHUB_PAT, SHADCN_API_KEY (found in opencode.db and one Pi session file) and FIRECRAWL_API_KEY (shell history).
- Delete that Pi session file and the history line.
- `~/.claude.json`: literal context7/github headers to `${VAR}`; `chmod 600` it, `~/.mcphub/servers.json`, `nvim/.config/nvim/.env`.
- Orca (`*:6768`) and Bartender (`*:7823`): bind to localhost in their settings if offered.
- Remove unused keys (OPENCODE_GO_API_KEY_PI_QUEUES, LITELLM_MASTER_KEY) from `.env` if truly unused.
- Kill the orphaned `headroom mcp serve` processes (each holds the full exported environment until the `.zshrc` cutover) and find which client leaves them behind.

## Never

- Read, print, copy or commit `~/secrets/.env`, not even to list its names. Use `secret-get` for one value.
- Log or push text that may hold a key without passing it through `redact` first.
- Print a key's value in a report, a test or a commit message. Print names and counts only.

## The guards

`shared/AGENTS.md` states the rule; three harnesses now enforce it. Each matches the same three
spellings of the directory (`~/secrets`, `$HOME/secrets`, `${HOME}/secrets`) plus this machine's
literal path, after dropping quotes and backslashes, so `~/"sec"rets/.env` is caught and
`~/secrets-backup` is not. A bare relative `secrets/.env` is left alone: that could be any
project's directory.

| Where | What it does |
|---|---|
| `claude/.claude/hooks/enforce-bash-safety.sh` | Refuses a bash command that names the directory, ahead of its destructive-command rules, and logs the block as rule `secrets-read` with the command redacted. Test: `claude/.claude/hooks/tests/enforce-bash-safety.test.sh`. |
| `codex-guardrails-plugin/hooks/block-dangerous-shell.sh` | Same rule for Codex's PreToolUse Bash hook, as a fourth `reason` beside the rm/force-push/reset rules. |
| `pi/.pi/agent/extensions/secrets-guard.ts` | Refuses any tool call that names the directory — bash, `read`/`grep`/`find`/`ls`, MCP tools, codemode scripts — and sends a text result that mentions a key-shaped name or token through `redact` before the model sees it. An `edit` or `write` is judged by its target path, never its text, so documentation and the guard's own source can quote `~/secrets`. Logic: `lib/secrets-guard-core.ts`, tests: `bun test ./pi/.pi/agent/extensions/lib/secrets-guard.test.ts`. |

OpenCode has no equivalent yet: `opencode/.config/opencode/plugins/cc-compat.js` deliberately only
logs dangerous commands and leaves the decision to OpenCode's permission system, and whether a
`permission.bash` glob matches anywhere in a command or only its start is still unchecked. Until
that is settled, OpenCode relies on the instruction.

Best effort, by design, in all three: a path assembled at run time (`S=~/s; cat "$S/.env"`) is not
caught, and a bare key value with no name beside it does not trigger the redact pass.
