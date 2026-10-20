#!/opt/homebrew/bin/bash
# Renders the label scripts/herdr-sketchybar-bridge pushes via agent_state
# (Claude pane counts, running Pi tasks, latest NEXT step). All state lives
# in the bridge, so parallel triggers never share a file. Fixed-width item:
# no balance_pills.sh call.

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

if [[ -n "$LABEL" ]]; then
  sketchybar --set "$NAME" label="$LABEL"
elif [[ -z "$(sketchybar --query "$NAME" | jq -r '.label.value')" ]]; then
  # Startup/forced run before the bridge has pushed anything; it re-sends
  # within 5s. Never overwrite a real label with this placeholder.
  sketchybar --set "$NAME" label="󱚡 …"
fi
