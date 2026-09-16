#!/opt/homebrew/bin/bash
# Render Herdr-derived plan/build agent state. The bridge is the sole writer of
# AGENT/STATUS values; this plugin keeps only the latest derived state.

STATE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/sketchybar"
STATE_FILE="$STATE_DIR/agent-state"
mkdir -p "$STATE_DIR"

touch "$STATE_FILE"

if [[ "$SENDER" == "mouse.clicked" ]]; then
  build_workspace=$(herdr workspace list 2>/dev/null | jq -r '.result.workspaces[] | select(.label == "build") | .workspace_id' | head -1)
  build_pane=$(herdr agent list 2>/dev/null | jq -r --arg workspace "$build_workspace" '.result.agents[] | select(.workspace_id == $workspace and .agent == "pi") | .pane_id' | head -1)
  aerospace workspace T
  [[ -n "$build_pane" ]] && herdr agent focus "$build_pane"
  exit 0
fi

set_state() {
  local role="$1" status="$2"
  grep -v "^${role}=" "$STATE_FILE" >"${STATE_FILE}.tmp" 2>/dev/null || true
  printf '%s=%s\n' "$role" "$status" >>"${STATE_FILE}.tmp"
  mv "${STATE_FILE}.tmp" "$STATE_FILE"
}

state_for() {
  local role="$1"
  local status
  status=$(sed -n "s/^${role}=//p" "$STATE_FILE" | tail -1)
  case "$status" in
    working) printf '● working' ;;
    blocked) printf '! blocked' ;;
    done) printf '✓ done' ;;
    idle) printf '○ idle' ;;
    *) printf '? unknown' ;;
  esac
}

if [[ "$SENDER" == "agent_state" && -n "${AGENT:-}" ]]; then
  set_state "$AGENT" "${STATUS:-unknown}"
fi

plan=$(state_for plan)
build=$(state_for build)
sketchybar --set "$NAME" label="plan ${plan} │ build ${build}"
"$CONFIG_DIR/plugins/balance_pills.sh"
