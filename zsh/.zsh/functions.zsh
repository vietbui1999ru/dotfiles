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

# LLM council — voices: sonnet + gpt-5.4 | chairman: opus
council() {
  source ~/repos/llm-wiki/templates/env-model-routing.sh
  uv run ~/repos/llm-wiki/templates/council.py "$@"
}

claude-tui() {
  cd ~/repos/RustProjects/claude-tui/ && cargo run -p claude-tui
}

resumed() {
  node "99 System/Agents/Gemini/skills/obsidian-notes-to-resume/scripts/generate_resume.js"
}

sshr() {
  local host="${1:-vietbui1999ru@rtx2060}"
  kitten ssh "$host"
}
