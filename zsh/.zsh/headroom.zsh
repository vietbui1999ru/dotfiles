# Route agent CLIs in herdr and Orca terminals through the shared Headroom
# compression proxy (launchd: com.vietbui.headroom-proxy, 127.0.0.1:8787).
# See docs/workflows/headroom-proxy.md.
#
# Gated to herdr panes (HERDR_ENV=1) and Orca terminals (ORCA_PANE_KEY) so a
# plain terminal keeps talking to the APIs directly. Fails open: when the proxy
# is not answering at shell start, nothing is exported.
# Bypass once: `env -u ANTHROPIC_BASE_URL claude` or `command codex`.
#
# Timeouts: a stopped proxy refuses the connection at once, so the short connect
# timeout keeps shell start fast in that case. The 2 s total gives a healthy but
# busy proxy time to answer; /livez has taken 174 ms during a pane's startup,
# which made a 0.3 s total time out and leave the pane silently unrouted.

if [[ ${HERDR_ENV:-} == 1 || -n ${ORCA_PANE_KEY:-} ]] && (( $+commands[curl] )) \
  && curl -sf --connect-timeout 0.3 -m 2 -o /dev/null http://127.0.0.1:8787/livez; then
  # Claude Code. A custom base URL turns off on-demand tool loading unless
  # ENABLE_TOOL_SEARCH is set, which would load every MCP schema up front.
  export ANTHROPIC_BASE_URL=http://127.0.0.1:8787
  export ENABLE_TOOL_SEARCH=${ENABLE_TOOL_SEARCH:-true}

  # Codex ignores OPENAI_BASE_URL; it needs the openai_base_url config key.
  # The proxy forwards ChatGPT-login traffic to chatgpt.com/backend-api/codex.
  codex() { command codex -c openai_base_url="http://127.0.0.1:8787/v1" "$@"; }
fi
