# Route agent CLIs through the shared Headroom compression proxy
# (127.0.0.1:8787; launchd on macOS, systemd user units on Linux).
# See docs/workflows/headroom-proxy.md.
#
# Gate: on macOS only herdr panes (HERDR_ENV=1) and Orca terminals
# (ORCA_PANE_KEY) are routed, so a plain terminal keeps talking to the APIs
# directly. On Linux every shell (herdr, tmux, plain SSH) is routed, but only
# while this user's own headroom-proxy unit is active. An answer on 8787 alone
# is not trusted: on a box without the unit, any local process holding the port
# would receive the API credentials. If another process took the port first,
# the unit cannot bind, is not active, and nothing is exported.
# Fails open: when the proxy is not answering at shell start, nothing is exported.
# Bypass once: `env -u ANTHROPIC_BASE_URL claude` or `command codex`.
#
# Timeouts: a stopped proxy refuses the connection at once, so the short connect
# timeout keeps shell start fast in that case. The 2 s total gives a healthy but
# busy proxy time to answer; /livez has taken 174 ms during a pane's startup,
# which made a 0.3 s total time out and leave the pane silently unrouted.

_headroom_gate() {
  [[ ${HERDR_ENV:-} == 1 || -n ${ORCA_PANE_KEY:-} ]] && return 0
  [[ $OSTYPE == linux* ]] && (( $+commands[systemctl] )) \
    && systemctl --user is-active --quiet headroom-proxy.service
}

if _headroom_gate \
  && (( $+commands[curl] )) \
  && curl -sf --connect-timeout 0.3 -m 2 -o /dev/null http://127.0.0.1:8787/livez; then
  # Claude Code. A custom base URL turns off on-demand tool loading unless
  # ENABLE_TOOL_SEARCH is set, which would load every MCP schema up front.
  export ANTHROPIC_BASE_URL=http://127.0.0.1:8787
  export ENABLE_TOOL_SEARCH=${ENABLE_TOOL_SEARCH:-true}

  # Codex ignores OPENAI_BASE_URL; it needs the openai_base_url config key.
  # The proxy forwards ChatGPT-login traffic to chatgpt.com/backend-api/codex.
  codex() { command codex -c openai_base_url="http://127.0.0.1:8787/v1" "$@"; }
fi
unfunction _headroom_gate
