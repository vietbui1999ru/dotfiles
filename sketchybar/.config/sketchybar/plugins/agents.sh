#!/opt/homebrew/bin/bash
# Render one complete Herdr-derived label. State lives in the bridge so parallel
# Sketchybar triggers never share a state file or temporary filename.

if [[ "$SENDER" == "mouse.clicked" ]]; then
  build_workspace=$(herdr workspace list 2>/dev/null | jq -r '.result.workspaces[] | select(.label == "build") | .workspace_id' | head -1)
  build_pane=$(herdr agent list 2>/dev/null | jq -r --arg workspace "$build_workspace" '.result.agents[] | select(.workspace_id == $workspace and .agent == "pi") | .pane_id' | head -1)
  aerospace workspace T
  [[ -n "$build_pane" ]] && herdr agent focus "$build_pane"
  exit 0
fi

sketchybar --set "$NAME" label="${LABEL:-plan ? unknown │ build ? unknown}"
"$CONFIG_DIR/plugins/balance_pills.sh"
