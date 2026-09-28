#!/opt/homebrew/bin/bash
# Layout profile for the bar's TARGET display. Sourced by sketchybarrc and by
# plugins that size things (aerospace.sh, balance_pills.sh).
#
# plugins/display_profile.sh picks the target — the external, when one is
# attached, regardless of which display macOS itself calls "main" — measures
# it, and caches the result; this file turns that into sizes. "compact" is
# the laptop panel (~1800pt wide, notch); "wide" is a big external
# (~2560pt+). All values are points.

PROFILE_CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/sketchybar/profile"

# Defaults if nothing has been detected yet (first launch, or osascript/
# sketchybar --query failed): assume undocked, bar on the built-in.
PROFILE=compact
SCREEN_W=1800
HAS_NOTCH=0
BAR_DISPLAY=main
MAIN_NSSCREEN_IDX=1
# shellcheck source=/dev/null
[[ -r "$PROFILE_CACHE" ]] && source "$PROFILE_CACHE"

# Bar geometry shared with sketchybarrc and balance_pills.sh's overflow clamp.
BAR_MARGIN=7
BAR_NOTCH_W=200
NOTCH_W=$(( HAS_NOTCH == 1 ? BAR_NOTCH_W : 0 ))

case "$PROFILE" in
  wide)
    MAX_ICONS=6                        # app icons per workspace before "+N"
    FRONT_APP_W=140                    # fits "Visual Studio Code" and friends
    TITLE_W=380;  TITLE_CHARS=60       # window/tab title, ~6.2pt per char
    AUDIO_W=200;  AUDIO_CHARS=32       # audio source app name
    AGENTS_W=420                       # plan/build status + a NEXT step
    ;;
  *)
    MAX_ICONS=4
    FRONT_APP_W=80
    TITLE_W=150;  TITLE_CHARS=24
    AUDIO_W=110;  AUDIO_CHARS=16
    AGENTS_W=210
    ;;
esac
