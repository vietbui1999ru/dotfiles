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

# SSH into remote machine without nesting tmux
# Detaches local tmux, SSHs in (remote .zshrc auto-attaches),
# then reattaches local tmux on exit.
sshr() {
  local host="${1:-vietbui1999ru@rtx2060}"
  [ -n "${TMUX:-}" ] && tmux detach
  ssh "$host"
  [ -z "${TMUX:-}" ] && tmux attach 2>/dev/null || true
}
