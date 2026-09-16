#!/opt/homebrew/bin/bash

source "$CONFIG_DIR/colors.sh"
source "$CONFIG_DIR/icons.sh"

BRIGHTNESS=$(swift -e '
import Foundation
import CoreGraphics
let id = CGMainDisplayID()
let lib = dlopen("/System/Library/PrivateFrameworks/DisplayServices.framework/DisplayServices", RTLD_NOW)
typealias F = @convention(c) (UInt32, UnsafeMutablePointer<Float>) -> Int32
let f = unsafeBitCast(dlsym(lib, "DisplayServicesGetBrightness"), to: F.self)
var b: Float = 0; _ = f(id, &b); print(Int(b * 100))
' 2>/dev/null)

if [ -z "$BRIGHTNESS" ]; then
  BRIGHTNESS="N/A"
fi

sketchybar --set $NAME icon=$ICON_BRIGHTNESS label="${BRIGHTNESS}%"
