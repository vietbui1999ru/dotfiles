# Codex permission profile

Codex runs tool commands in a sandbox. With `[features] network_proxy = true` and no allowlist, every
outbound host is blocked, so tools that call an API fail (the Firecrawl CLI reports
`getaddrinfo ENOTFOUND api.firecrawl.dev`). The profile `dev` fixes that without loosening the
filesystem rules.

## What the profile does

`shared/templates/codex-permissions.toml` defines `[permissions.dev]`:

- `extends = ":workspace"`: inherits Codex's own workspace-write sandbox. Commands can read the whole
  filesystem and write only the workspace roots and temp. Nothing here widens that.
- A network allowlist: `api.firecrawl.dev` (Firecrawl's cloud fetches the pages, so only the API host
  is needed), GitHub hosts, PyPI, npm, crates.io, the Go proxy, and loopback for local test servers.
  Any other host is refused.

`~/secrets/.env` stays readable, because the `firecrawl` shim reads the API key from it. That is the
same read access Codex already had.

## Install on a machine

`~/.codex/config.toml` is not managed by stow (Codex writes to it), so apply it once:

1. Put `default_permissions = "dev"` at the top of `~/.codex/config.toml`, before the first `[table]`.
2. Append everything below the `append from here` marker in the template to the end of the file.
3. Check it: ask Codex to run `firecrawl scrape https://example.com --format markdown`; it should return
   the page. A fetch from a host that is not on the list, or a write outside the workspace, should fail.

Test it first in a scratch config: `CODEX_HOME=/some/dir` with a copy of `config.toml` and a link to
`auth.json`. This setup was tested that way before it touched the real file.

## Extending it

Add a line to `[permissions.dev.network.domains]`. Entries are exact hostnames, or `*.example.com`
(subdomains) and `**.example.com` (apex plus subdomains); a bare `*` is rejected. A `"deny"` entry
always beats an allow.

## Known limits

- A bad profile name or schema error stops Codex from starting a session. Keep a copy of the previous
  `config.toml` before editing.
- Written against Codex 0.153; the profile schema may change between releases.
- This allowlist applies to commands Codex runs. MCP servers are separate processes.
