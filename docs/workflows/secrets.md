# Secrets: where keys live and who loads them

API keys live in one plaintext file, `~/secrets/.env` (mode 600, folder mode 700). Nothing
sources that file. A shell never exports its keys, so a new shell holds no key values, and each
tool loads only the keys it needs, at the moment it starts.

## The tools

| Tool | Command | Keys it gets |
|---|---|---|
| `secret-get NAME` | `scripts/secret-get` | Prints one key's value. Exit 1 if NAME is missing; exit 2 if the file or folder mode is too loose. |
| `with-secrets NAME... -- cmd` | `scripts/with-secrets` | Runs `cmd` with only the named keys added. Fails before running `cmd` if any key is missing. |
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
| pi-view (pueue dispatch) | `scripts/pi-view`, through `secret-get` | CONTEXT7_API_KEY only |
| firecrawl MCP (Claude, OpenCode) | `scripts/firecrawl-mcp` as the server command | FIRECRAWL_API_KEY (`FIRECRAWL_ENV_FILE` picks another file, such as send-it) |

Without a secrets file the wrappers still start the client, with those MCP keys unset.
A readable file that lacks one of the keys stops the start and names the key on stderr.

GUI-launched clients (the Claude desktop app, Orca) do not run shell aliases, so they get none
of these keys. They lose those MCP servers until a launcher exists.

## Adding a key for a new tool

1. Add `NAME=value` to `~/secrets/.env`. Do not add it to a shell rc file or to a tool's config as
   a literal.
2. Give the tool its own loader: a wrapper that calls `with-secrets NAME --` for a command, or
   `secret-get NAME` inside a script that reads it at run time.
3. Name the key in this table, so the next reader knows which tool sees it.

Keep MCP config values as `${VAR}` (Claude) or `{env:VAR}` (OpenCode), and let the loader supply
the variable.

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
