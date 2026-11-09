# herdr and Paseo mesh: Mac and pve2

The Mac and the pve2 box reach each other over Tailscale, so agents on one
machine can see and drive terminals and agents on the other.

## Topology

| | Mac | pve2 |
|---|---|---|
| Tailscale node | `viets-macbook-pro-2` (100.73.122.127) | `pve-2-1` (100.116.136.75) |
| SSH alias (Mac side) | — | `pve2-ts` (MagicDNS `pve-2-1.tail953017.ts.net`) |
| herdr core (`hc`) | 0.1.18 | 0.1.18 |
| herdr TUI | herdr | herdr 0.9.5 in `~/.local/bin` |
| Paseo daemon | desktop-managed, listens on `100.73.122.127:6767` | listens on `100.116.136.75:6767` |

`pve-2` (100.109.48.121) is a stale Tailscale node for the same box. Ignore it.
The old `Host pve2` SSH entry uses the LAN address 10.10.6.221 and only works on
the home network, so the mesh uses `pve2-ts` instead.

| Link | Direction | How |
|---|---|---|
| herdr core | Mac → pve2 | `hc machine add pve2-ts --name pve2` (SSH) |
| herdr TUI | Mac → pve2 | `herdr machine add pve2-ts --label pve2` (SSH) |
| herdr core | pve2 → Mac | not set up: pve2 has no key the Mac accepts (see Limits) |
| Paseo | both | each daemon registers the other with `paseo host add` (TCP 6767, password) |

## Passwords

Both Paseo daemons need a password because they listen beyond localhost. Each
is a random 32-character hex string, stored only in the Mac's login Keychain:

```sh
security find-generic-password -a "$USER" -s paseo-mac  -w   # Mac daemon
security find-generic-password -a "$USER" -s paseo-pve2 -w   # pve2 daemon
```

Keychain Access shows the same items: search for `paseo-`. Use the Mac one
when you add the Mac as a Direct host in the Paseo app on a phone
(`100.73.122.127:6767`, with Tailscale on).

To change a password, run `paseo daemon set-password` in a terminal on that
machine (it needs a TTY), then run `paseo daemon restart`. Update the Keychain
item, and re-add the host on the other daemon (next section).

## Setup commands

SSH host key for `pve2-ts`: compare the key with the one hc reports from the box
before you trust it:

```sh
hc exec --on pve2 -- ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
ssh-keyscan -t ed25519 pve-2-1.tail953017.ts.net | ssh-keygen -lf -
```

Paseo host registration. The password goes in the query string of a `tcp://`
URI. A bare `host:port?password=` or `user:pass@` form is rejected as
`invalid_connection`.

```sh
# on the Mac
paseo host add "tcp://100.116.136.75:6767?password=$(security find-generic-password -a "$USER" -s paseo-pve2 -w)" --label pve2
# on pve2 (paseo is only on PATH with mise active)
eval "$(mise activate bash)"
paseo host add "tcp://100.73.122.127:6767?password=<mac password>" --label mac
paseo host ls     # both should show status online
```

`paseo host rm` takes the registration id from `paseo host ls --json`, not the label.

## Using it

- `hx2 <cmd>`: `hc exec --on pve2`, runs one program on pve2.
- `herdr2 <command>`: `herdr --machine pve2`.
- `p2 <paseo args>`: paseo against the pve2 daemon. It reads the password from
  the Keychain on every call (macOS only).
- The Herdr app sidebar lists pve2's spaces under machine `pve2`.
- Agents start work on the other host through the Paseo MCP tools by passing
  that host's `serverId` (`paseo host ls --json`).

## Herdr app keys

`herdr-app/.config/herdr-app/keys.json` is stowed by `scripts/restow.sh`, which
links the file and keeps the folder real. The vim keys:

| Keys | Action |
|---|---|
| `cmd-alt-h/j/k/l` | move to the pane left, down, up, right (replaces hide-others on `cmd-alt-h`) |
| `cmd-alt-shift-h/j/k/l` | swap the pane that way |
| `cmd-ctrl-j` / `cmd-ctrl-k` | next and previous space |
| `cmd-ctrl-%` / `cmd-ctrl-"` | split right and down, as in tmux |
| `cmd-ctrl-z` / `cmd-ctrl-x` | zoom and close the pane |
| `cmd-ctrl-v` | paste an image (moved off plain `ctrl-v`, so nvim gets visual block) |

Plain ctrl keys are not bound, so tmux `C-s` and `C-h/j/k/l` reach the program.
The TUI's `prefix+=` (pi-layout rebalance) is not ported: `pi-layout.mjs` drives
the herdr TUI socket only.

Before the branch is merged, the live `~/.config/herdr-app/keys.json` is a copy.
After the merge, move it aside and run `scripts/restow.sh` so it becomes a link.

## Paseo vim keys (manual)

Paseo keeps its settings and shortcut overrides (`@paseo:settings`,
`@paseo:keyboard-shortcut-overrides`) in Electron localStorage (LevelDB), so
they cannot be stowed. Set them by hand on each install:

1. Settings → Editor → turn on Vim keybindings (this applies to source files).
2. Settings → Keyboard shortcuts: rebind workspace and agent navigation to
   `cmd-alt-h/j/k/l` if you want it to match the Herdr app.

## Detection in shells

`zsh/.zsh/headroom.zsh` and `scripts/headroom-doctor` route a macOS shell
through the Headroom proxy when any of these markers is set:

| Terminal | Marker |
|---|---|
| herdr TUI pane | `HERDR_ENV=1` |
| Herdr app / hc terminal | `HC_TERMINAL_ID` (also `HC_TERMINAL_SOCKET`) |
| Paseo terminal | `PASEO_TERMINAL_ID` (also `PASEO_WORKSPACE_ID`) |

The herdr agent-state hooks (Claude, Pi, opencode) and `pi-view` need the herdr
TUI. Outside it they do nothing, or `pi-view` falls back to a plain dispatch.
`pane-handoff` needs the TUI and stops with an error elsewhere.

## Limits

- herdr is one-way: pve2 cannot add the Mac as a machine yet. The Mac's sshd is
  on and reachable from pve2, but none of pve2's keys is in the Mac's
  `~/.ssh/authorized_keys` (which does not exist). To enable it, create a key on
  pve2, authorize it on the Mac, then run `hc machine add <mac> --name mac` on pve2.
- `paseo host add` takes the password in its connection argument, so it shows
  in `ps` for that one call. `p2` passes it in `PASEO_HOST` instead, which keeps
  it out of the argument list.
