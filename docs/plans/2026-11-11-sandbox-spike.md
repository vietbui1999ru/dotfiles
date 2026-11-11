# Sandbox spike: Claude Bash sandbox and Pi sandbox-exec profile

Date: 2026-11-11. Branch: `feat/sandbox`. Parent plan: Slice S of `~/.claude/plans/herdr-approval-inbox.md`.

This spike tests whether the two sandbox mechanisms Slice S depends on work on this machine:

- Claude Code's `sandbox` setting, which wraps Bash in Seatbelt.
- A macOS `sandbox-exec` profile for Pi.

It also records the allow and deny lists the build step needs. Nothing here is live config. Probes ran from throwaway files in the job tmp directory, through a `--settings` overlay and stand-in targets.

## Decisions made by the person (2026-11-11)

- **The focus board (`~/repos/Obsidian/Focus.md`) is human-writable and agent-readable only.** Agents cannot write the board with any tool, Bash included. This reverses the current allowlist entry in `scripts/focus` (`is_allowlisted`, `:523`) and the test that pins it (`scripts/tests/test_focus_hooks.py:124`). The person approved that contract change.
- **`scripts/focus` gets a gate-style exemption for a few commands.** Agents keep the documented focus steps (`shared/AGENTS.md:286-293`), and the script writes the board for them from outside the sandbox. Exempt: `switch`, `drop` and `park`. Not exempt: `allow` (the person's blocker command) and `stage` (the person advances the stage). The read-only commands need no exemption, and the hook commands already run unsandboxed.

## Claude results

Method: `claude -p --model claude-haiku-5-5 --settings <overlay>` in this worktree. A probe prompt ran one Bash call per probe. The overlay set `sandbox.enabled`, `failIfUnavailable: true` and `allowUnsandboxedCommands: false`, with `denyWrite` on `<worktree>/scripts/**` and a stand-in folder, and `denyRead` on a stand-in secret and on `~/repos/llm-wiki/**`.

| Id | Question | Result |
|---|---|---|
| C1 | Overlay loads; no silent fallback | Pass. Seatbelt denials were observed. `/status` was not checked. |
| C2 | A `denyWrite` inside cwd beats the default cwd grant | Pass. A write to `scripts/` from a Bash-spawned `python3` gets `PermissionError: [Errno 1] Operation not permitted`. A write at the worktree root is allowed. A retry with `dangerouslyDisableSandbox: true` fails the same way. |
| C3 | Git and jj in a worktree | Partial. With only `~/dotfiles/.jj` granted, `git hash-object -w` on unique content (an object write into the main `.git`) and `jj st` both succeed. Without the `.jj` grant, `jj st` fails with `Failed to take lock for Git import/export` (EPERM). The main `.git` appears to be granted automatically. Recheck this with an explicit deny before relying on it. |
| C4 | One-command exemption | Pass. `excludedCommands` matches the literal call text. The absolute path is exempt. These all stay sandboxed: `cd … && ./bin/gate`, `bash -c '…/gate'`, `$H/bin/gate` and `$HOME/…/gate`. Not tested: an exempt command with no permission allow rule, and a symlinked copy. |
| C5 | Harness tools under the sandbox | `rtk`, `mise ls` and `scripts/focus status` work. pueue needs `network.allowUnixSockets` for its socket. GitHub needs `network.allowedDomains` of `github.com` and `api.github.com`; other domains get `403 user denied`. `gh auth status` still fails its keyring login with `allowMachLookup` set to `com.apple.SecurityServer`. Unresolved. |
| C6 | Write and Edit tools | Pass for Write: an `Edit(<path>/**)` deny refuses the Write tool. MultiEdit and NotebookEdit were not tested. |
| C7 | Inheritance | Partial. A subagent's Bash is sandboxed and its write is denied. A `--bg` session was not tested. |
| C8 | Read denial | Pass for Bash: `cat` of the stand-in secret and `ls` of llm-wiki are denied. The Read tool is not covered and returned the stand-in secret's content. Protected reads need `Read(...)` deny rules as well. |

Gates met during the probes, recorded rather than worked around:

- **Blast-radius** (`session-band-plugin/hooks/blast.tsx:141`) refuses ask-tier Bash, such as redirect writes, in any non-interactive session: "nobody is available to answer the blast-radius prompt". It is a Claude-only gate and fails closed in headless runs.
- **`Bash(*agent-review/decisions*)`** (`claude/.claude/settings.json:64`) refused probe setup commands that only named the path. It is a text match, so it gives false positives.
- **`enforce-bash-safety.sh`** refused a file append whose heredoc body contained the words of a commit command. Another text-match false positive.

## Pi results

Method: `sandbox-exec -f <profile> -D WT=… -D HOME=… <command>`, with denials watched through `log stream --predicate 'sender == "Sandbox"'`.

| Id | Question | Result |
|---|---|---|
| P1 | Profile shape and parameters | Pass. `(param "X")` with `-D X=…` works. The last matching rule wins, so a narrow `deny file-write*` inside an allowed subpath holds. Write rules leave reads alone. |
| P2 | Real Pi run with zero denials | Pass after two profile fixes, in a non-git scratch dir. (1) context-mode writes `~/.context-mode/projects/`, which is now granted. (2) `~/.pi/agent/auth.json` resolves provider keys by reading `~/secrets/.env` itself, so with that folder unreadable Pi reported "No API key found for opencode-go". With the secrets read allowed for the probe only, Pi made the edit in 28 s. Pi, pi-lens and context-mode logs showed no EPERM. The only error was agent-review's "not a git repository", which is expected outside git. |
| P3 | Negative probes inside Pi | Pass. Pi's own edit tool, a `python3` write and a Bash redirect all got EPERM on `scripts/`, `~/.pi/agent/extensions` and `~/.pi-lens/bin`. A plain worktree write succeeded. The OS layer covers Pi's file tools, not only its Bash. |
| P4 | Does Pi write `decisions/`? | Only in two places. `mkdir -p decisions` runs at session start (`pi/.pi/agent/extensions/agent-review/index.ts:686`). The `/review skip` command writes a skip decision (`index.ts:674`). Under a write deny, `mkdir -p` on an existing directory and `fs.watch` both work, and only new paths get EPERM. Two consequences: the wrapper must create `decisions/` before launch, and `/review skip` inside Pi stops working. `agent-review skip <id>` (`scripts/agent-review:421`) replaces it from outside the sandbox. |
| P5 | Wrap point | Open. `scripts/pi-view` has four exec paths: `:95` (pi-view-app), `:103` (plain exec), `:370` (`--tui` through `pi-pane-run` in a separate herdr pane) and `:448` (herdr). A pueue-dispatched Pi is spawned by the pueue daemon, so it never inherits Claude's sandbox. The wrapper must sit in pi-view and in `pi-pane-run`, or in a shared `pi-sandbox` launcher both call. |
| P6 | Cost | None measurable: `pi --version` takes 0.25 to 0.28 s with and without the sandbox. `sandbox-exec` printed no deprecation warning. |

Decision by the person (2026-11-11) on keys: the launcher reads only Pi's provider keys from the secrets file, outside the sandbox, and passes them as environment variables. `~/secrets` stays unreadable inside. This needs the `auth.json` entries that read the secrets file switched to the environment, unless the environment already wins over them.

## Draft allow and deny lists

### Claude overlay (the build step turns this into a settings patch for the person)

```json
{
  "sandbox": {
    "enabled": true,
    "failIfUnavailable": true,
    "allowUnsandboxedCommands": false,
    "excludedCommands": [
      "/Users/vietquocbui/dotfiles/scripts/gate *",
      "/Users/vietquocbui/dotfiles/scripts/focus switch *",
      "/Users/vietquocbui/dotfiles/scripts/focus drop *",
      "/Users/vietquocbui/dotfiles/scripts/focus park *"
    ],
    "filesystem": {
      "allowWrite": ["~/dotfiles/.jj", "~/.claude/jobs", "~/.claude/plans"],
      "denyWrite": ["<protected paths, below>"],
      "denyRead": ["~/secrets/**", "<other repos not given to the session>"]
    },
    "network": {
      "allowedDomains": ["github.com", "api.github.com", "<model and package hosts, to list>"],
      "allowUnixSockets": ["~/Library/Application Support/pueue/pueue_vietquocbui.socket", "<herdr socket>"]
    }
  },
  "permissions": {
    "deny": [
      "Bash(*focus drop*--yes*)",
      "Edit(~/repos/Obsidian/Focus.md)",
      "Read(~/secrets/**)",
      "<Edit(...) for every protected path>"
    ]
  }
}
```

The exemption rules match only the literal absolute path (C4). The rule text in `shared/AGENTS.md` must therefore say `$HOME/dotfiles/scripts/focus switch …`, spelled as the absolute path, or the agent's call stays sandboxed and fails on the board write. An exempt `drop` pattern also matches `drop <key> --yes`, which the rules forbid. The `Bash(*focus drop*--yes*)` deny keeps that out.

### Pi profile (draft)

```scheme
(version 1)
(allow default)
(deny file-write*)
(allow file-write*
  (subpath (param "WT")) (subpath (param "GITDIR")) (subpath (param "TMP"))
  (subpath "/private/var/folders") (subpath "/dev")
  (subpath (string-append (param "HOME") "/.pi"))
  (subpath (string-append (param "HOME") "/.pi-lens"))
  (subpath (string-append (param "HOME") "/.local/state/agent-review"))
  (subpath (string-append (param "HOME") "/.local/state/pi-checks"))
  (subpath (string-append (param "HOME") "/.local/state/provenance"))
  (subpath (string-append (param "HOME") "/.local/state/herdr-mods")))
(deny file-write*
  ;; Pi config and installed code
  (subpath (string-append (param "HOME") "/.pi/agent/extensions"))
  (subpath (string-append (param "HOME") "/.pi/agent/extensions-available"))
  (subpath (string-append (param "HOME") "/.pi/agent/skills"))
  (subpath (string-append (param "HOME") "/.pi/agent/agents"))
  (subpath (string-append (param "HOME") "/.pi/agent/npm"))
  (literal (string-append (param "HOME") "/.pi/agent/settings.json"))
  (literal (string-append (param "HOME") "/.pi/agent/mcp.json"))
  (literal (string-append (param "HOME") "/.pi/agent/models.json"))
  (subpath (string-append (param "HOME") "/.pi-lens/bin"))
  (literal (string-append (param "HOME") "/.pi-lens/config.json"))
  ;; gate state and the focus board
  (subpath (string-append (param "WT") "/.pi/agent-review/decisions"))
  (subpath (string-append (param "HOME") "/.local/state/ac-run"))
  (literal (string-append (param "HOME") "/repos/Obsidian/Focus.md"))
  ;; system tools, only when the worktree is a system repo
  (subpath (string-append (param "WT") "/scripts"))
  (subpath (string-append (param "WT") "/claude/.claude"))
  (subpath (string-append (param "WT") "/shared"))
  (subpath (string-append (param "WT") "/pi/.pi")))
(deny file-read* (subpath (string-append (param "HOME") "/secrets")))
```

The profile may break Pi in one known way: Pi writes `~/.pi/agent/settings.json` itself (deviceId, lastChangelogVersion). P2 must confirm that the deny does not break startup. If it does, seed those fields outside the sandbox instead of granting the write.

### Protected paths (both runtimes)

- Gate state:
  - `~/.local/state/ac-run`
  - `<repo>/.pi/agent-review/decisions`
  - `~/.local/state/herdr-mods/gate-events.jsonl`
  - `~/.local/state/provenance/ledger.jsonl`
  - `~/.claude/state/focus/sessions.json`
  - `~/.claude/state/gates/` (Slice F)
- `~/repos/Obsidian/Focus.md`. Agents reach it only through the exempt `scripts/focus` commands.
- The system repos' `scripts/`, `claude/.claude/`, `shared/`, `pi/.pi/`, `session-band-plugin/` and `herdr-app/`, plus `llm-wiki/claude-setup/` and their stowed targets.
- Pi config: the deny block above.

## Gaps found that the build must cover

1. **Code-executing tools outside both layers.** Pi's `gateBlocked` judges only `write`, `edit` and `bash`, so context-mode's `ctx_execute` is not checked. Claude's MCP servers run unsandboxed, including `serena_repl` and Playwright's `browser_run_code_unsafe`, and the focus guard matcher (`Write|Edit|MultiEdit|NotebookEdit|Bash`) does not see them. Fix options:
   - deny those tools,
   - match them in the guards, or
   - run the MCP servers under the same profile.
2. **The Read tool ignores `denyRead`** (C8). Mirror every `denyRead` as a `Read(...)` deny.
3. **Pi has no per-call focus or command guard.** The ban-parity work (`~/.claude/plans/sandbox-ban-parity.md` and its report) owns this. The OS profile is the backstop.
4. **Fail-open spots in the text guards.**
   - `enforce-bash-safety.sh:8` allows the call when `jq` is missing or the input is malformed.
   - Pi's redaction passes text through when the redactor returns nothing (`secrets-guard.ts:39`).
   - Pi's `candidates()` does not resolve symlinks for targets that do not exist yet.
5. **Hooks, MCP servers and mod processes run unsandboxed by design.** Their only protection is the protected-path deny on their source. Accepted as a limit.

## Proposed build split for Slice S

| Slice | Owner | Work |
|---|---|---|
| S1 | Claude | `pi-sandbox` launcher plus the profile. Wire it into `scripts/pi-view` and `scripts/pi-pane-run`, and create `decisions/` before launch. Run P2, P3 and P6 for real. |
| S2 | Claude, patch the person applies | Claude settings: the `sandbox` block, the exemptions and the `Read`/`Edit` mirrors. Settings are edit-denied for agents. |
| S3 | Claude | Focus board change. Remove the board from `is_allowlisted`, update the test at `test_focus_hooks.py:124` (approved), and switch the `shared/AGENTS.md` focus commands to the absolute path. |
| S4 | Claude | `system-pin`. |
| S5 | Claude | Copy detection in `floor-guard`. |
| S6 | Claude | Coverage for code-executing tools (gap 1). |

## Still to recheck

- C3: whether the main `.git` is auto-granted; confirm with an explicit deny.
- C5: `gh` keyring access under the sandbox.
- C6: MultiEdit and NotebookEdit; whether Edit rules follow symlinks.
- C7: a `--bg` session.
- Whether Claude Code treats a hook timeout as allow. The focus guard's limit is 5 s, and `focus check-dispatch` measured 0.13 to 0.89 s.
