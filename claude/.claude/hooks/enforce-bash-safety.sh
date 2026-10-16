#!/usr/bin/env bash
# PreToolUse hook — block catastrophically dangerous bash commands.
# Scope: only truly irreversible wide-blast patterns. Not a general linter.
# Exit 0 = allow. Exit 2 = block (stdout shown as block reason).

INPUT=$(cat)
CMD=$(echo "$INPUT" | jq -r '.tool_input.command // ""' 2>/dev/null)

[ -z "$CMD" ] && exit 0

# ── rm targeting root or home ──────────────────────────────────────────────────
# Allow: rm -rf ./tmp, rm -rf some/specific/dir
# Block: rm -rf /, rm -rf ~, rm -rf $HOME, rm -rf /anything
if echo "$CMD" | grep -qE 'rm\s+-[a-zA-Z]*r[a-zA-Z]*f\s+(/|~|"\$HOME|\$HOME)'; then
  echo "BLOCKED: rm -rf targeting root or home. Too dangerous."
  echo "If you need to delete a specific directory, use an explicit relative path."
  exit 2
fi

# ── git force push to main or master ──────────────────────────────────────────
if echo "$CMD" | grep -qE 'git\s+push\s+.*(-f|--force).*\s+(origin\s+)?(main|master)'; then
  echo "BLOCKED: force push to main/master."
  echo "This overwrites remote history. If intentional, confirm with user first."
  exit 2
fi

# ── git reset --hard without a safe ref ───────────────────────────────────────
# Allow: git reset --hard HEAD~1, git reset --hard <sha>
# Block: git reset --hard (no ref = resets to HEAD, safe) — actually that IS safe
# Block: git reset --hard origin/main (discards local unpushed work)
if echo "$CMD" | grep -qE 'git\s+reset\s+--hard\s+origin/'; then
  echo "BLOCKED: git reset --hard to remote ref discards unpushed commits."
  echo "Confirm this is intentional before proceeding."
  exit 2
fi

# ── git clean with -f (removes untracked files; -fd, -df, -fdx) ───────────────
if echo "$CMD" | grep -qE 'git\s+(-C\s+\S+\s+)?clean\s+-[a-zA-Z]*f'; then
  echo "BLOCKED: git clean -f deletes untracked files irreversibly."
  echo "List what would go with git clean -n first, then confirm with user."
  exit 2
fi

# ── git push with lease or if-includes force flags ────────────────────────────
if echo "$CMD" | grep -qE 'git\s+(-C\s+\S+\s+)?push\s+.*--force-(with-lease|if-includes)'; then
  echo "BLOCKED: forced push (--force-with-lease / --force-if-includes)."
  echo "This rewrites remote history. If intentional, confirm with user first."
  exit 2
fi

# ── git push with a +refspec (forced update of one ref) ───────────────────────
if echo "$CMD" | grep -qE 'git\s+(-C\s+\S+\s+)?push\s+.*\s\+\S'; then
  echo "BLOCKED: git push +refspec forces a ref update."
  echo "If intentional, confirm with user first."
  exit 2
fi

# ── git push with a :refspec (deletes a remote branch) ────────────────────────
if echo "$CMD" | grep -qE 'git\s+(-C\s+\S+\s+)?push\s+.*\s:\S'; then
  echo "BLOCKED: git push :branch deletes a remote branch."
  echo "If intentional, confirm with user first."
  exit 2
fi

exit 0
