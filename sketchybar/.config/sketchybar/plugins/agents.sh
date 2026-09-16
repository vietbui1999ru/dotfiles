#!/opt/homebrew/bin/bash
# Render Herdr-derived plan/build agent state. The bridge is the sole writer of
# AGENT/STATUS values; this plugin keeps only the latest derived state.

STATE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/sketchybar"
STATE_FILE="$STATE_DIR/agent-state"
LOCK_DIR="$STATE_DIR/agent-state.lock"
LABEL_CACHE="$STATE_DIR/agent-label.cache"
mkdir -p "$STATE_DIR"
touch "$STATE_FILE"

if [[ "$SENDER" == "mouse.clicked" ]]; then
  build_workspace=$(herdr workspace list 2>/dev/null | jq -r '.result.workspaces[] | select(.label == "build") | .workspace_id' | head -1)
  build_pane=$(herdr agent list 2>/dev/null | jq -r --arg workspace "$build_workspace" '.result.agents[] | select(.workspace_id == $workspace and .agent == "pi") | .pane_id' | head -1)
  aerospace workspace T
  [[ -n "$build_pane" ]] && herdr agent focus "$build_pane"
  exit 0
fi

# Concurrent bridge triggers (plan + build status landing close together)
# raced on a shared, non-unique tmp filename with no locking — observed
# live as corrupted lines in STATE_FILE (e.g. "lan=working"). Serialize the
# read-modify-write below, same pattern as balance_pills.sh's lock.
age=$(( $(date +%s) - $(stat -f %m "$LOCK_DIR" 2>/dev/null || echo 0) ))
[[ -d "$LOCK_DIR" && $age -gt 2 ]] && rmdir "$LOCK_DIR" 2>/dev/null
acquired=0
for _ in 1 2 3 4 5 6 7 8 9 10; do
  mkdir "$LOCK_DIR" 2>/dev/null && acquired=1 && break
  sleep 0.05
done
# Still contended after 0.5s — bow out rather than mutate state unlocked;
# the next bridge trigger converges state eventually (same trade-off
# balance_pills.sh already makes).
(( acquired == 0 )) && exit 0
trap 'rmdir "$LOCK_DIR" 2>/dev/null' EXIT

set_state() {
  local role="$1" status="$2"
  local tmp="$STATE_FILE.$$.tmp"
  grep -v "^${role}=" "$STATE_FILE" >"$tmp" 2>/dev/null || true
  printf '%s=%s\n' "$role" "$status" >>"$tmp"
  mv "$tmp" "$STATE_FILE"
}

set_next() {
  local role="$1" value="$2"
  local path="$STATE_DIR/${role}.next"
  if [[ -z "$value" ]]; then
    rm -f "$path"
  else
    printf '%s\n' "$value" >"$path"
  fi
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
  if [[ -v NEXT && -n "$NEXT" ]]; then
    set_next "$AGENT" "$NEXT"
  elif [[ "${STATUS:-unknown}" == "working" ]]; then
    set_next "$AGENT" ""
  fi
fi

plan=$(state_for plan)
build=$(state_for build)
next=$(cat "$STATE_DIR/plan.next" "$STATE_DIR/build.next" 2>/dev/null | tail -1)
label="plan ${plan} │ build ${build}"
[[ -n "$next" ]] && label+=" │ ${next}"
sketchybar --set "$NAME" label="$label"

# Skip the balance_pills.sh dance (zero-then-remeasure flicker) when the
# label didn't actually change — same guard audio_source.sh uses.
OLD_LABEL=$(cat "$LABEL_CACHE" 2>/dev/null)
if [[ "$label" != "$OLD_LABEL" ]]; then
  printf '%s' "$label" >"$LABEL_CACHE"
  CALLER=agents "$CONFIG_DIR/plugins/balance_pills.sh"
fi
