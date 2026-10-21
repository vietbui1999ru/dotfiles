#!/opt/homebrew/bin/bash
# Renders the state scripts/herdr-sketchybar-bridge pushes via agent_state
# (BLOCKED, TOTAL, TOTAL_STATUS, PI, NEXT) onto the agents.* items. All state
# lives in the bridge, so parallel triggers never share a file. Fixed-width
# items: no balance_pills.sh call.

source "$CONFIG_DIR/colors.sh"

if [[ "$SENDER" == "mouse.clicked" ]]; then
  # Jump to the Claude pane most likely to need you: blocked, then working,
  # then any.
  pane=$(herdr agent list 2>/dev/null | jq -r '
    [.result.agents[] | select(.agent == "claude")]
    | (map(select(.agent_status == "blocked")) + map(select(.agent_status == "working")) + .)
    | first | .pane_id // empty')
  aerospace workspace T
  [[ -n "$pane" ]] && herdr agent focus "$pane"
  exit 0
fi

if [[ -z "$TOTAL" ]]; then
  # Startup/forced run before the bridge has pushed anything; it re-sends
  # within 5s. Never overwrite a real count with this placeholder.
  [[ -z "$(sketchybar --query agents.total | jq -r '.label.value')" ]] &&
    sketchybar --set agents.total label="…"
  exit 0
fi

(( BLOCKED > 0 )) && blocked=$HERDR_BLOCKED || blocked=$HERDR_UNKNOWN
case "$TOTAL_STATUS" in
  working) total=$HERDR_WORKING ;;
  done)    total=$HERDR_DONE ;;
  idle)    total=$HERDR_IDLE ;;
  *)       total=$HERDR_UNKNOWN ;;
esac
(( PI > 0 )) && pi=on || pi=off
[[ -n "$NEXT" ]] && next=on || next=off

sketchybar --set agents.blocked label="$BLOCKED" icon.color="$blocked" label.color="$blocked" \
           --set agents.total label="$TOTAL" icon.color="$total" label.color="$total" \
           --set agents.pi drawing=$pi label="$PI" \
           --set agents.next drawing=$next label="$NEXT"
