# Headroom proxy for agent panes

Agent CLIs started in a herdr pane or an Orca terminal send their model traffic
through [Headroom](https://github.com/chopratejas/headroom), a local proxy that
compresses tool output and other context before it reaches the provider.

## Pieces

| Piece | What it does |
|---|---|
| `launchd/.../com.vietbui.headroom-proxy.plist` | Proxy on `127.0.0.1:8787` for Claude Code (Anthropic) and Codex. Codex traffic from a ChatGPT login is detected and forwarded to `chatgpt.com/backend-api/codex`. |
| `launchd/.../com.vietbui.headroom-zen.plist` | Proxy on `127.0.0.1:8788` for the OpenCode Go subscription (`opencode-go`). Both the OpenAI-style and the Anthropic-style upstreams point at Zen Go, because one proxy has a single upstream per API style. |
| `zsh/.zsh/headroom.zsh` | In herdr panes (`HERDR_ENV=1`) and Orca terminals (`ORCA_PANE_KEY` set), when 8787 answers `/livez` at shell start: exports `ANTHROPIC_BASE_URL` and `ENABLE_TOOL_SEARCH=true`, and wraps `codex` with `-c openai_base_url=...`. Plain terminals are untouched. |
| `scripts/pi-headroom-models` | Writes the `opencode-go` entry of Pi's machine-local `~/.pi/agent/models.json` so Pi uses 8788. `off` removes it. |

Both services run in `cache` mode, which keeps earlier turns frozen so provider
prompt caching still hits. `HEADROOM_BEACON=off` stops the anonymous usage
upload. `HEADROOM_TELEMETRY=off` is avoided because it also turns off the local
`/stats` endpoint.

## Why each tool is wired differently

- **Claude Code** reads `ANTHROPIC_BASE_URL`, and this works with subscription
  OAuth. A custom base URL turns off on-demand tool loading unless
  `ENABLE_TOOL_SEARCH` is set, which would put every MCP tool schema in context.
- **Codex** ignores `OPENAI_BASE_URL`; only the `openai_base_url` config key
  works, so the shell function passes it with `-c` instead of editing the stowed
  `~/.codex/config.toml`.
- **Pi** has no env override for a provider's base URL, so the routing lives in
  `models.json`. `opencode-go` mixes OpenAI-style models, whose client posts to
  `<baseUrl>/chat/completions`, and Anthropic-style models (Claude, MiniMax,
  Qwen), whose client posts to `<baseUrl>/v1/messages`. `modelOverrides` cannot
  set `baseUrl`, so the script copies the Anthropic-style models from Pi's own
  catalog with the proxy URL. Rerun it after a Pi update changes the catalog.
  The file is global for this machine, so Pi uses the proxy in every terminal,
  including pueue tasks; if 8788 is down, `opencode-go` calls fail until launchd
  restarts it. It is not stowed, so other machines keep the direct route.
- **OpenCode** is not wired yet. OpenCode v2 runs a shared background service
  that does not see a pane's environment, so an `OPENCODE_CONFIG_CONTENT`
  override in the shell never reaches it. Routing it means editing the global
  `opencode.json` (stowed to every machine) or using `headroom wrap opencode`.
- **`hclaude`** (`headroom wrap claude`) still works and reuses the running
  proxy on 8787.

## Install (macOS)

```sh
cd ~/dotfiles && stow -R launchd     # links the two plists into ~/Library/LaunchAgents
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.vietbui.headroom-proxy.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.vietbui.headroom-zen.plist
~/dotfiles/scripts/pi-headroom-models
```

Only one process can own port 8787. Quit any `hclaude` session started before
the install, because its own proxy holds the port.

## Check and bypass

```sh
curl -s http://127.0.0.1:8787/livez                 # health
curl -s http://127.0.0.1:8787/stats | jq .summary   # requests and savings
launchctl print gui/$(id -u)/com.vietbui.headroom-proxy | grep -E 'state|pid'
tail -f /tmp/headroom-proxy.err.log /tmp/headroom-zen.err.log
env -u ANTHROPIC_BASE_URL claude     # one Claude session without the proxy
command codex                        # one Codex session without the proxy
~/dotfiles/scripts/pi-headroom-models off   # Pi back to direct
```

New panes pick the routing up at shell start; panes opened while the proxy was
down stay direct until reopened.

## Known limits

- Headroom's ML text compressor (Kompress) needs PyTorch, which the default uv
  install does not include. JSON, code and log compression work without it.
