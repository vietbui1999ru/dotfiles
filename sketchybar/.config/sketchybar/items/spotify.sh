#!/opt/homebrew/bin/bash

source "$CONFIG_DIR/colors.sh"

# ── Spotify Popup Configuration ─────────────────────
FONT="SF Pro"
SPOTIFY_DISPLAY_CONTROLS=true

# Popup chrome
POPUP_BG=0xF032302f          # gruvbox background, slightly transparent
POPUP_BORDER=0xFF7daea3      # gruvbox blue

# Content colors
ACCENT_COLOR=$SAGE           # slider highlight, play icon
SECONDARY_COLOR=$MUTED_TEAL  # artist text
TERTIARY_COLOR=0xff89b482    # gruvbox cyan -- album text
DISABLED_COLOR=$MUTED_TEAL   # disabled shuffle/repeat
TITLE_COLOR=$ICE             # track title on dark popup
CONTROL_COLOR=$ICE           # transport control icons

POPUP_SCRIPT="sketchybar --set spotify.anchor popup.drawing=toggle"

# ── Custom Event ────────────────────────────────────
spotify_change="com.spotify.client.PlaybackStateChanged"
sketchybar --add event spotify_change "$spotify_change"

# ── Anchor (bar item + popup container) ─────────────
spotify_anchor=(
  icon=":spotify:"
  icon.font="sketchybar-app-font:Regular:18.0"
  icon.color=$SAGE
  icon.y_offset=1
  label.drawing=off
  drawing=off
  popup.horizontal=on
  popup.align=center
  popup.height=120
  popup.background.color=$POPUP_BG
  popup.background.border_color=$POPUP_BORDER
  popup.background.border_width=2
  popup.background.corner_radius=12
  popup.background.drawing=on
  script="$PLUGIN_DIR/spotify.sh $SPOTIFY_DISPLAY_CONTROLS"
  click_script="$POPUP_SCRIPT"
)

sketchybar --add item spotify.anchor center \
           --set spotify.anchor "${spotify_anchor[@]}" \
           --subscribe spotify.anchor mouse.entered mouse.exited \
                       mouse.exited.global spotify_change

# ── Album Art ───────────────────────────────────────
spotify_cover=(
  background.image.scale=0.12
  background.image.drawing=on
  background.drawing=on
  background.color=0x00000000
  background.image.corner_radius=8
  icon.drawing=off
  label.drawing=off
  padding_left=12
  padding_right=0
)

sketchybar --add item spotify.cover popup.spotify.anchor \
           --set spotify.cover "${spotify_cover[@]}"

# ── Track Info ──────────────────────────────────────
spotify_title=(
  icon.drawing=off
  label.font="$FONT:Heavy:13.0"
  label.color=$TITLE_COLOR
  label.max_chars=25
  label.padding_left=0
  label.padding_right=0
  y_offset=27
  width=0
)

spotify_artist=(
  icon.drawing=off
  label.font="$FONT:Regular:12.0"
  label.color=$SECONDARY_COLOR
  label.max_chars=30
  label.padding_left=0
  label.padding_right=0
  y_offset=7
  width=0
)

spotify_album=(
  icon.drawing=off
  label.font="$FONT:Italic:11.0"
  label.color=$TERTIARY_COLOR
  label.max_chars=30
  label.padding_left=0
  label.padding_right=0
  y_offset=-10
  width=0
)

sketchybar --add item spotify.title popup.spotify.anchor \
           --set spotify.title "${spotify_title[@]}" \
           --add item spotify.artist popup.spotify.anchor \
           --set spotify.artist "${spotify_artist[@]}" \
           --add item spotify.album popup.spotify.anchor \
           --set spotify.album "${spotify_album[@]}"

# ── Progress Slider ─────────────────────────────────
spotify_state=(
  icon.font="$FONT:Regular:10.0"
  icon.color=$SECONDARY_COLOR
  icon.padding_left=0
  label.font="$FONT:Regular:10.0"
  label.color=$SECONDARY_COLOR
  label.padding_right=0
  slider.width=115
  slider.highlight_color=$ACCENT_COLOR
  slider.background.height=4
  slider.background.corner_radius=2
  slider.background.color=$DISABLED_COLOR
  slider.knob=
  slider.knob.drawing=off
  y_offset=-25
  width=0
  update_freq=1
  updates=when_shown
  script="$PLUGIN_DIR/spotify.sh"
)

sketchybar --add slider spotify.state popup.spotify.anchor \
           --set spotify.state "${spotify_state[@]}" \
           --subscribe spotify.state mouse.clicked

# ── Transport Controls (conditional) ────────────────
if [ "$SPOTIFY_DISPLAY_CONTROLS" = "true" ]; then

  spotify_controls_anchor=(
    icon.drawing=off
    label.drawing=off
    background.drawing=off
    padding_left=0
    padding_right=0
    width=0
    y_offset=-45
  )

  spotify_shuffle=(
    icon=􀊝
    icon.font="SF Pro:Regular:16.0"
    icon.color=$CONTROL_COLOR
    icon.highlight_color=$ACCENT_COLOR
    icon.padding_left=5
    icon.padding_right=5
    label.drawing=off
    script="$PLUGIN_DIR/spotify.sh"
    width=30
    y_offset=-45
  )

  spotify_back=(
    icon=􀊉
    icon.font="SF Pro:Regular:16.0"
    icon.color=$CONTROL_COLOR
    icon.padding_left=5
    icon.padding_right=5
    label.drawing=off
    script="$PLUGIN_DIR/spotify.sh"
    width=30
    y_offset=-45
  )

  spotify_play=(
    icon=􀊄
    icon.font="SF Pro:Regular:20.0"
    icon.color=$ACCENT_COLOR
    icon.padding_left=5
    icon.padding_right=5
    background.color=$POPUP_BG
    background.corner_radius=20
    background.height=34
    background.drawing=on
    label.drawing=off
    script="$PLUGIN_DIR/spotify.sh"
    width=40
    y_offset=-45
  )

  spotify_next=(
    icon=􀊋
    icon.font="SF Pro:Regular:16.0"
    icon.color=$CONTROL_COLOR
    icon.padding_left=5
    icon.padding_right=5
    label.drawing=off
    script="$PLUGIN_DIR/spotify.sh"
    width=30
    y_offset=-45
  )

  spotify_repeat=(
    icon=􀊟
    icon.font="SF Pro:Regular:16.0"
    icon.color=$CONTROL_COLOR
    icon.highlight_color=$ACCENT_COLOR
    icon.padding_left=5
    icon.padding_right=5
    label.drawing=off
    script="$PLUGIN_DIR/spotify.sh"
    width=30
    y_offset=-45
  )

  sketchybar --add item spotify.controls_anchor popup.spotify.anchor \
             --set spotify.controls_anchor "${spotify_controls_anchor[@]}" \
             --add item spotify.shuffle popup.spotify.anchor \
             --set spotify.shuffle "${spotify_shuffle[@]}" \
             --subscribe spotify.shuffle mouse.clicked \
             --add item spotify.back popup.spotify.anchor \
             --set spotify.back "${spotify_back[@]}" \
             --subscribe spotify.back mouse.clicked \
             --add item spotify.play popup.spotify.anchor \
             --set spotify.play "${spotify_play[@]}" \
             --subscribe spotify.play mouse.clicked \
             --add item spotify.next popup.spotify.anchor \
             --set spotify.next "${spotify_next[@]}" \
             --subscribe spotify.next mouse.clicked \
             --add item spotify.repeat popup.spotify.anchor \
             --set spotify.repeat "${spotify_repeat[@]}" \
             --subscribe spotify.repeat mouse.clicked

  # Bracket for visual grouping of controls
  sketchybar --add bracket spotify.controls \
                           spotify.shuffle \
                           spotify.back \
                           spotify.play \
                           spotify.next \
                           spotify.repeat
fi
