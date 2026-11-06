# Route agent CLIs through the shared Headroom compression proxy
# (127.0.0.1:8787; launchd on macOS, systemd user units on Linux).
# See docs/workflows/headroom-proxy.md.
#
# Gate: on macOS only herdr TUI panes (HERDR_ENV=1), Herdr app terminals
# (HC_TERMINAL_ID) and Paseo terminals (PASEO_TERMINAL_ID) are routed, so a
# plain terminal keeps talking to the APIs
# directly. On Linux every shell (herdr, tmux, plain SSH) is routed, but only
# while this user's own headroom-proxy unit is active and the 8787 listener is
# a socket owned by this user. An answer on 8787 alone is not trusted: any local
# process holding the port would receive the API credentials. See _headroom_gate.
# Fails open: when the proxy is not answering at shell start, nothing is exported.
# Bypass once: `env -u ANTHROPIC_BASE_URL claude` or `command codex`.
#
# Timeouts: a stopped proxy refuses the connection at once, so the short connect
# timeout keeps shell start fast in that case. The 2 s total gives a healthy but
# busy proxy time to answer; /livez has taken 174 ms during a pane's startup,
# which made a 0.3 s total time out and leave the pane silently unrouted.

# Linux: every shell, herdr panes included, needs both checks. A Type=simple
# unit reads active before it binds (and while restart-looping on a taken port),
# so the unit state alone is not proof. Every listener on 127.0.0.1:8787 (the
# address clients connect to) must be a socket whose exact uid:N field is this
# UID, and there must be at least one. Another user cannot fake that, and the
# kernel only lets sockets share an address (SO_REUSEPORT) under the same UID.
_headroom_gate() {
  if [[ $OSTYPE == linux* ]]; then
    (( $+commands[systemctl] && $+commands[ss] )) \
      && systemctl --user is-active --quiet headroom-proxy.service \
      && ss -Hltne 'src 127.0.0.1:8787' 2>/dev/null | awk -v want="uid:$UID" '
           { n++; mine = 0; for (i = 1; i <= NF; i++) if ($i == want) mine = 1; if (!mine) bad = 1 }
           END { exit !(n > 0 && !bad) }'
    return
  fi
  [[ ${HERDR_ENV:-} == 1 || -n ${HC_TERMINAL_ID:-} || -n ${PASEO_TERMINAL_ID:-} ]]
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
