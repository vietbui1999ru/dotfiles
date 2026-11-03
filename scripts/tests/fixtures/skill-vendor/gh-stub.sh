#!/bin/sh
# Stub gh for skill-vendor tests. Routes on the API path.
#   SKILL_VENDOR_STUB_CHANGED  JSON list returned by compare calls
#   SKILL_VENDOR_STUB_FAIL     if set, every call fails with this message
#   SKILL_VENDOR_STUB_CONTENT  base64 body returned by contents calls
#   SKILL_VENDOR_STUB_LOG      if set, each call's path is appended here
if [ -n "${SKILL_VENDOR_STUB_FAIL:-}" ]; then
  echo "$SKILL_VENDOR_STUB_FAIL" >&2
  exit 1
fi
path="$2"
[ -n "${SKILL_VENDOR_STUB_LOG:-}" ] && echo "$path" >> "$SKILL_VENDOR_STUB_LOG"
case "$path" in
  */compare/*) printf '%s\n' "${SKILL_VENDOR_STUB_CHANGED:-[]}" ;;
  */contents/*) printf '%s' "${SKILL_VENDOR_STUB_CONTENT:-}" ;;
  *) echo "unexpected gh call: $path" >&2; exit 1 ;;
esac
