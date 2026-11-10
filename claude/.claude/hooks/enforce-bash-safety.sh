#!/usr/bin/env bash
# PreToolUse hook — block catastrophically dangerous bash commands.
# Scope: only truly irreversible wide-blast patterns. Not a general linter.
# Exit 0 = allow. Exit 2 = block. Claude Code shows the hook's stderr as the block reason,
# so everything after the input is read goes to stderr.

INPUT=$(cat)
CMD=$(echo "$INPUT" | jq -r '.tool_input.command // ""' 2>/dev/null)
CWD=$(echo "$INPUT" | jq -r '.cwd // ""' 2>/dev/null)

# ── block log (docs/workflows/bash-safety-log.md) ─────────────────────────────
# Each block appends one redacted entry for humans to trace with scripts/safety-log.
# Logging never weakens the guard: any failure here leaves the exit code and reason as they are.
log_block() {
  local dir="${SAFETY_LOG_DIR:-$HOME/.claude/state}" rule ts id redact
  local log="$dir/bash-safety-blocks.jsonl"
  # scripts/redact, resolved through this hook's real path (the hook is a stow link). If it is
  # missing, the entry is still written with the jq-only redaction, so a block is never unlogged.
  # Stow may link the file itself into a real folder, so follow the file's links first.
  local hook_dir src="${BASH_SOURCE[0]}" target
  while [ -L "$src" ]; do
    target=$(readlink "$src")
    case "$target" in /*) src=$target ;; *) src="$(dirname "$src")/$target" ;; esac
  done
  hook_dir=$(cd -P "$(dirname "$src")" && pwd -P)
  redact="$hook_dir/../../../scripts/redact"
  [ -x "$redact" ] || redact=cat
  case "$1" in
    *"rm -rf targeting"*) rule=rm-rf-root-home ;;
    *"force push to main"*) rule=force-push-main ;;
    *"reset --hard"*) rule=reset-hard-remote ;;
    *"git clean -f"*) rule=git-clean-force ;;
    *"forced push"*) rule=force-push-lease ;;
    *"+refspec"*) rule=push-plus-ref ;;
    *":branch"*) rule=push-delete-ref ;;
    *"git commit and jj commit"*) rule=worktree-commit ;;
    *"this command names"*) rule=secrets-read ;;
    *) rule=other ;;
  esac
  ts=$(date +%Y-%m-%dT%H:%M:%S%z | sed 's/\([0-9][0-9]\)$/:\1/')
  id=$(head -c 6 /dev/urandom | od -An -tx1 | tr -d ' \n')
  {
    umask 077 &&
    mkdir -p "$dir" &&
      { [ ! -f "$log" ] || [ "$(wc -l <"$log")" -lt 2000 ] || mv -f "$log" "$log.1"; } &&
      echo "$INPUT" | jq -c --arg id "$id" --arg ts "$ts" --arg rule "$rule" --arg reason "$1" --arg redacted "$(printf '%s' "$CMD" | sed -E 's/(-u|--user)([=[:space:]]+)[^[:space:]]+/\1\2[REDACTED]/g' | "$redact")" '
        def redact:
          gsub("(?<n>[A-Za-z_][A-Za-z0-9_]*(TOKEN|SECRET|PASSWORD|PASSWD|KEY)[A-Za-z0-9_]*)=(\"[^\"]*\"|'"'"'[^'"'"']*'"'"'|[^[:space:]]+)"; "\(.n)=[REDACTED]"; "i")
          | gsub("(?<f>--(token|password|passwd|secret|api-key|apikey))(?<s>=|[[:space:]]+)(\"[^\"]*\"|'"'"'[^'"'"']*'"'"'|[^[:space:]]+)"; "\(.f)\(.s)[REDACTED]"; "i")
          | gsub("(gh[pos]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16})"; "[REDACTED]")
          | gsub("(?<b>Bearer)[[:space:]]+[^[:space:]\"'"'"']+"; "\(.b) [REDACTED]"; "i");
        def cap: if length > 4000 then .[:4000] + "…[truncated]" else . end;
        {id: $id, ts: $ts, session: (.session_id // ""), cwd: (.cwd // ""),
         transcript: (.transcript_path // ""), rule: $rule,
         command: ($redacted | redact | cap), reason: $reason}' >>"$log"
  } 2>/dev/null
}

# Reasons are buffered and replayed to stderr on exit (Claude Code shows a blocking
# hook's stderr as the reason); a block also gets a log entry. Without a buffer,
# reasons go straight to stderr and nothing is logged.
REASONS=$(mktemp 2>/dev/null) && exec 1>"$REASONS" || { REASONS=""; exec 1>&2; }
finish() {
  local rc=$1
  if [ -n "$REASONS" ]; then
    cat "$REASONS" >&2
    [ "$rc" -eq 2 ] && log_block "$(head -n 1 "$REASONS")"
    rm -f "$REASONS"
  fi
  exit "$rc"
}
trap 'finish $?' EXIT

[ -z "$CMD" ] && exit 0

# ── reads of the secrets file ──────────────────────────────────────────────────
# shared/AGENTS.md: keys live in ~/secrets/.env, one key comes out through
# scripts/secret-get. Pi enforces the same rule with its secrets-guard extension.
# Quotes and backslashes are dropped first, so ~/"sec"rets/.env is caught too.
SECRETS_DIR="${HOME:-/nonexistent}/secrets"
SECRETS_PATTERN=$(printf '%s' "$SECRETS_DIR" | sed 's/[][\\.*^$+?(){}|]/\\&/g')
SECRETS_RE='(~/secrets|\$HOME/secrets|\$\{HOME\}/secrets|'"${SECRETS_PATTERN}"')([^-A-Za-z0-9_]|$)'
SECRETS_CMD=$(printf '%s' "$CMD" | sed -e 's/[\\]//g' -e 's/["]//g' -e "s/'//g")
if echo "$SECRETS_CMD" | grep -qE "$SECRETS_RE"; then
  echo "BLOCKED: this command names $SECRETS_DIR."
  echo "Read one key with ~/dotfiles/scripts/secret-get NAME, run a command with only the keys it needs"
  echo "through ~/dotfiles/scripts/with-secrets, and pass text that may hold a key through ~/dotfiles/scripts/redact."
  exit 2
fi

# ── rm targeting root or home ──────────────────────────────────────────────────
# Allow: rm -rf ./tmp, rm -rf some/specific/dir
# Block: rm -rf /, rm -rf ~, rm -rf $HOME, rm -rf /anything
if echo "$CMD" | grep -qE 'rm\s+-[a-zA-Z]*r[a-zA-Z]*f\s+(/|~|"\$HOME|\$HOME)'; then
  echo "BLOCKED: rm -rf targeting root or home. Too dangerous."
  echo "If you need to delete a specific directory, use an explicit relative path."
  exit 2
fi

# ── git force push to main or master ──────────────────────────────────────────
if echo "$CMD" | grep -qE 'git\s+(-C\s+\S+\s+)?push\s+.*(-f|--force).*\s+(origin\s+)?(main|master)'; then
  echo "BLOCKED: force push to main/master."
  echo "This overwrites remote history. If intentional, confirm with user first."
  exit 2
fi

# ── git reset --hard without a safe ref ───────────────────────────────────────
# Allow: git reset --hard HEAD~1, git reset --hard <sha>
# Block: git reset --hard (no ref = resets to HEAD, safe) — actually that IS safe
# Block: git reset --hard origin/main (discards local unpushed work)
if echo "$CMD" | grep -qE 'git\s+(-C\s+\S+\s+)?reset\s+--hard\s+origin/'; then
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

# ── commit from a worktree-isolated session ───────────────────────────────────
# A session cwd under */.claude/worktrees/* must commit through the funnel, so
# only the listed paths land, the message comes from a file, main/master is
# refused, and the jj bookmark plus git HEAD are moved for the git-based gates.
# Pieces: segment start (also subshell and $( ) substitution), env assignments and
# wrappers (command/exec/env/sudo/nohup/time), the binary, then global options
# (-c k=v, -C dir, --no-pager, -R repo) before the subcommand.
SEG='(^|[;&|(`]|\$\()[[:space:]]*'
ASSIGN='([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*'
WRAP="(${ASSIGN}(command|exec|env|sudo|nohup|time)[[:space:]]+)*${ASSIGN}"
OPTS='([[:space:]]+-[^[:space:]]+([[:space:]]+[^-[:space:]][^[:space:]]*)?)*'
END='([[:space:]]|$|[;&|)`])'
COMMIT_RE="${SEG}${WRAP}([^[:space:];&|()]*/)?git${OPTS}[[:space:]]+commit${END}|${SEG}${WRAP}([^[:space:];&|()]*/)?jj${OPTS}[[:space:]]+(commit|ci)${END}"
if echo "$CWD" | grep -qE '/\.claude/worktrees/'; then
  if echo "$CMD" | grep -qE "$COMMIT_RE"; then
    echo "BLOCKED: git commit and jj commit are not allowed inside a worktree session."
    echo "Commit through the funnel instead, from anywhere in your session worktree:"
    echo "  \$HOME/dotfiles/scripts/commit-funnel --worktree <session worktree> -F <message file> <path>..."
    echo "Write the message to a file first (first line at most 72 characters). The funnel stages only the paths you list, refuses main/master, a foreign checkout and a foreign staged path, and in jj mode moves the branch bookmark and reattaches git HEAD."
    exit 2
  fi
fi

# ── git or jj aimed at the primary checkout from a worktree session ───────────
# A session under */.claude/worktrees/* works only in its own workspace. Aiming git or jj
# at another checkout (-C, -R, --git-dir, GIT_DIR=, a cd to another path first) reaches the
# shared primary checkout. This matches command text, so it stops habit and accident, not a
# deliberate bypass. A path inside the session's own worktree, and a command with no path, pass.
# An aimed path is one of: -C/-R/--git-dir/--repository given a value, GIT_DIR= set, or a cd
# to a path before the git/jj command. Each is checked against the session's worktree root.
if echo "$CWD" | grep -qE '/\.claude/worktrees/'; then
  WS_ROOT=$(echo "$CWD" | sed -E 's#(/\.claude/worktrees/[^/]+).*#\1#')
  AIM_RE="${SEG}${WRAP}([^[:space:];&|()]*/)?(git|jj)${OPTS}[[:space:]]+(-C|-R|--git-dir|--repository|--work-tree)([[:space:]]*=[[:space:]]*|[[:space:]]+)[^[:space:];&|()]+"
  AIM_ENV="(^|[;&|(\`])[[:space:]]*(export[[:space:]]+|${ASSIGN})GIT_DIR="
  AIM_CD="(^|[;&|(])[[:space:]]*cd[[:space:]]+[^[:space:];&|()]+[[:space:]]*(&&|;)"
  aimed=""
  if echo "$CMD" | grep -qE "$AIM_RE|$AIM_ENV"; then
    aimed=1
  fi
  if [ -z "$aimed" ] && echo "$CMD" | grep -qE "$AIM_CD" && echo "$CMD" | grep -qE "${SEG}${WRAP}([^[:space:];&|()]*/)?(git|jj)[[:space:]]"; then
    aimed=1
  fi
  if [ -n "$aimed" ]; then
    # Every aimed path must sit inside this session's own worktree.
    targets=$(echo "$CMD" | grep -oE "(-C|-R|--git-dir|--repository|--work-tree)([[:space:]]*=[[:space:]]*|[[:space:]]+)[^[:space:];&|()]+|GIT_DIR=[^[:space:]]+|cd[[:space:]]+[^[:space:];&|()]+" \
      | sed -E 's/^(-C|-R|--git-dir|--repository|--work-tree|GIT_DIR=|cd)[[:space:]]*=?[[:space:]]*//; s/^GIT_DIR=//' \
      | sed -E "s/^[\"']//; s/[\"']\$//")
    outside=""
    while IFS= read -r t; do
      [ -z "$t" ] && continue
      # A ".." segment can climb out of the worktree even when the text starts inside it.
      case "$t" in
        *"/../"*|*/..|..|../*) outside=1; continue ;;
      esac
      case "$t" in
        "$WS_ROOT"|"$WS_ROOT"/*) ;;
        *) outside=1 ;;
      esac
    done <<< "$targets"
    if [ -n "$outside" ] || [ -z "$targets" ]; then
      echo "BLOCKED: git or jj aimed at another checkout from a worktree session."
      echo "This session works only in its own workspace: $WS_ROOT."
      echo "Run git and jj from there with no -C, -R, --git-dir, GIT_DIR= or cd to another path."
      echo "Agent: stop; do not reach that checkout another way (cd, a copy, a script). Tell the person what you needed there and the command they can run themselves."
      exit 2
    fi
  fi
fi

# ── agent-ref-guard overrides inside a worktree session ───────────────────────
# COMMIT_FUNNEL=1 and AGENT_REF_GUARD=off switch off the reference-transaction hook; an agent
# must not set them, and core.hooksPath would point git away from the hook. Those are the human's.
if echo "$CWD" | grep -qE '/\.claude/worktrees/'; then
  # Config keys are case-insensitive, and GIT_CONFIG_* / --config-env set config without naming
  # core.hooksPath on the command line, so block those forms too.
  if echo "$CMD" | grep -qE 'COMMIT_FUNNEL=|AGENT_REF_GUARD=|GIT_CONFIG_(PARAMETERS|COUNT|KEY_)|--config-env' \
    || echo "$CMD" | grep -qiE 'core\.hookspath'; then
    echo "BLOCKED: COMMIT_FUNNEL, AGENT_REF_GUARD and core.hooksPath are the human's override, not an agent's."
    echo "Commit through the funnel instead, from anywhere in your session worktree:"
    echo "  \$HOME/dotfiles/scripts/commit-funnel --worktree <session worktree> -F <message file> <path>..."
    exit 2
  fi
fi

exit 0
