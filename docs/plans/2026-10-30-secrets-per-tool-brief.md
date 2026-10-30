# Brief: give each tool only its own keys (Keychain or per-tool loading)

Status: research brief for a separate session and worktree. Nothing here is decided. That session should end with a grill-me `SPEC.md` (status: draft) for the option it picks, or with a written "not worth it" and the reasons.

## Background

On 2026-10-29 a `pi-outcome` bug printed pueue's whole `state.json` into a Claude session. pueue stores the full environment of every `pueue add`. Because of `zsh/.zshrc:62`, that environment held every key in `~/secrets/.env`: about ten API keys, in a file any account could read. The fix on branch `feat/pueue-safe` has three layers:

1. `scripts/pueue-safe`, linked as `~/.local/bin/pueue`, strips secret variables from `pueue add`.
2. `scripts/pi-view` loads `~/secrets/.env` at run time, inside the task.
3. The pueue folder is set to 700.

Those layers fix pueue. They do not fix the root cause: `.zshrc:62` runs `set -a; source ~/secrets/.env` in every interactive shell, so **every** process started from a shell inherits **every** key. That includes Claude, Pi, MCP servers, editors and any script or package install hook. Any of them can read all keys with `printenv`, and a single bug like the `pi-outcome` dump can print them all.

## Goal

Each tool gets only the key or keys it needs, only when it runs. The interactive shell holds no keys.

## Options to evaluate

- **A. Per-tool loading from the existing file.** Remove `.zshrc:62`. Each tool that needs a key gets a small shim that reads just that key from `~/secrets/.env` at run time. `scripts/firecrawl` already works this way and is the prior art; `pi-view` loads the whole file and would load only its own keys. This is the smallest change, with no new dependency, and works the same on macOS and Linux.
- **B. macOS Keychain.** Store each key with `security add-generic-password -s <service> -a "$USER" -w`, and read it in the shim with `security find-generic-password -s <service> -w`. The values stop living in a plaintext file. Open questions: whether an unattended pueue task, an SSH session or a launchd job can read the login keychain without an unlock prompt; what replaces it on Linux (`secret-tool`/libsecret, which this repo's Linux bootstrap would need); and how a new machine gets the keys.
- **C. An external secrets manager** (1Password CLI `op run`, or sops/age). This adds an account or a tool, and would only be worth it if A or B fall short.

## Questions the session must answer

1. **Inventory.** Which tools need which keys? Start from `~/secrets/.env`'s names and search the repo and live configs: Claude `settings.json` `env` and MCP servers, `~/.pi/agent/mcp.json` `${VAR}` references, OpenCode `{env:VAR}`, Codex, scripts, Ansible.
2. Which of those read the key from the **environment** and cannot take a file or a command instead? Those need a shim or a launcher.
3. For option B: does reading the keychain from a pueue task, a herdr pane, SSH and launchd work without a prompt? Test it with one throwaway key before deciding anything.
4. What breaks on Linux for each option, given that this repo bootstraps Ubuntu too?
5. Is it worth it? Weigh the exposure that remains after `feat/pueue-safe` (every process can read every key) against the cost: shims to maintain, and possible prompts or friction in agent runs.

## Out of scope

- Rotating the keys exposed on 2026-10-29. That is a manual step, done separately.
- Changing `pueue-safe` or `pi-view`'s run-time loading. Both stay valid under every option. Under option A or B, `pi-view` would load only Pi's own keys.

## Starting points

- `zsh/.zshrc:59-62` (the global export)
- `scripts/firecrawl` and `scripts/firecrawl-setup.sh` (an existing per-tool key shim)
- `scripts/pueue-safe`, `scripts/pi-view` (the run-time load) and `docs/workflows/worktree-guard-bandaid.md`
