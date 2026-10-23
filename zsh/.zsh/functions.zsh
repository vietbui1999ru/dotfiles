# Restore terminal state after nvim exit.
# nvim's cleanup emits \033c (RIS hard reset via tmux-256color rs2 / xterm-kitty rs1),
# which wipes SGR attributes and breaks Starship colors + fast-syntax-highlighting.
# Running these sequences AFTER nvim exits (post-rs2) repairs the terminal.
nvim() {
  command nvim "$@"
  printf '\033[0m'     # reset SGR: undo hard-reset's color/attr wipe
  printf '\033[?25h'   # show cursor
  printf '\033[?2004h' # re-enable bracketed paste
  printf '\033[<999u'  # pop kitty keyboard protocol stack (Ctrl+A/E fix)
}

# ZLE widgets
autoload -U edit-command-line select-word-style smart-insert-last-word
zle -N edit-command-line
zle -N insert-last-word smart-insert-last-word
select-word-style bash

# Activate virtualenv if present, then launch nvim
nvimvenv() {
  if [[ -n "$VIRTUAL_ENV" ]] && [[ -f "$VIRTUAL_ENV/bin/activate" ]]; then
    source "$VIRTUAL_ENV/bin/activate"
    command nvim "$@"
    deactivate
  else
    command nvim "$@"
  fi
}

# LLM council — voices: claude-sonnet-5-5 + gpt-6.1-sol | chairman: claude-opus-5-5
council() {
  source ~/repos/llm-wiki/templates/env-model-routing.sh
  uv run ~/repos/llm-wiki/templates/council.py "$@"
}

resumed() {
  node "99 System/Agents/Gemini/skills/obsidian-notes-to-resume/scripts/generate_resume.js"
}

# Copy files from the Taildrive inbox on proxmox into the current directory.
# Goes over SSH rather than the Finder mount: no WebDAV cache, no ._ sidecars.
#   inbox-pull              everything except dotfiles (._*, .DS_Store, ...)
#   inbox-pull a.pdf b.zip  only the named files
inbox-pull() {
  local src="root@proxmox.tail953017.ts.net:/root/Inbox"
  if (( $# == 0 )); then
    rsync -ah --progress --exclude='.*' "$src/" .
  else
    rsync -ah --progress "${@/#/$src/}" .
  fi
}

sshr() {
  local host="${1:-vietbui1999ru@rtx2060}"
  kitten ssh "$host"
}

# Tab completion for agent-review: subcommands, then run ids for approve and skip.
# Type a prefix (edaf) and Tab completes it; Tab again cycles the other matches.
# Ids come from every registered repo; --offline keeps gh off the keypress path.
_agent_review() {
  if (( CURRENT == 2 )); then
    local -a subs=(mode status approve list register skip)
    _describe 'subcommand' subs
    return
  fi
  [[ $words[2] == (approve|skip) ]] || return 1
  local -a ids
  ids=(${(f)"$("$HOME/dotfiles/scripts/agent-review" list --global --offline --json 2>/dev/null \
    | jq -r '.[] | "\(.runId):\(if .orphan then "[orphan]" else "\(.name) \(.branch)\(if .decided then " [decided]" else "" end)" end)"' 2>/dev/null)"})
  _describe 'run id' ids
}
compdef _agent_review agent-review "$HOME/dotfiles/scripts/agent-review"
