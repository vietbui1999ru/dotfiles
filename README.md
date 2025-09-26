# Dotfiles - Development Environment Configuration

Personal dotfiles managed with [chezmoi](https://www.chezmoi.io/) for portable development workflow configuration across macOS systems.

## Overview

This repository contains configuration files for a complete development environment setup including window management, terminal tools, editor configurations, and system utilities.

### Key Components

- **AeroSpace** - Tiling window manager configuration with custom workspace assignments
- **Terminal Setup** - Zsh with Powerlevel10k, tmux, and integrated toolchain
- **Editors** - Neovim and Spacemacs configurations
- **System Tools** - Karabiner (keyboard customization), SketchyBar (status bar), btop (system monitor)
- **Development Tools** - Fastfetch system info, tmux-powerline, and various utility configs

### Application Workspace Auto-Assignment

The AeroSpace configuration automatically assigns applications to dedicated workspaces:
- **B** - Brave Browser
- **C** - ChatGPT/Claude AI tools
- **M** - Music (Spotify)
- **N** - Communication (Slack)
- **O** - Notes (Obsidian)
- **P** - Programming (VS Code, Emacs, Claude Code)
- **R** - Reading (Books, Preview)
- **S** - Services (Postman, Docker Desktop)
- **T** - Terminal (Kitty)

## Usage

```bash
# Install chezmoi
brew install chezmoi

# Apply configuration
chezmoi init https://github.com/yourusername/dotfiles
chezmoi apply
```

This setup ensures consistent development environment behavior across different macOS systems with automatic application organization and optimized terminal workflows.
