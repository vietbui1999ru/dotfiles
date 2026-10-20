---
status: approved
branch: feat/session-band-gitlab-mrs
---
# SPEC: session-band Draft PRs pane lists GitLab MRs

## Objective
The session-band Draft PRs pane (`/draft-prs`, jump key 4) runs `gh pr list` in every repo, so a
GitLab repo only shows "not a GitHub repo". The pane should pick the forge from the `origin`
remote host: GitHub runs `gh pr list`, GitLab runs `glab mr list`, and any other host shows a
message. Forges live in one ordered table so Forgejo or Codeberg can be added later as one entry
plus one reader, without touching the pane.

## Acceptance Criteria
- AC-1: `hooks/forge.ts` reads the host from https, ssh:// and scp-style (`git@host:owner/repo`) remote URLs, and `forgeFor` maps github.com to `github`, any host containing `gitlab` to `gitlab`, and other hosts (codeberg.org) to undefined; covered by `forge.test.ts`.
  verify: `cd session-band-plugin && claude plugin test .`
  baseline: pass
- AC-2: `hooks/gitlab.ts` turns `glab mr list --all --per-page 30 --output json` output into `DraftPr`s: opened plus `draft` (or legacy `work_in_progress`) is draft, other opened is ready, merged within 7 days by `merged_at` is merged, closed and older merges drop out, rows ordered as GitHub's; checks are `none`; covered by `gitlab.test.ts`.
  verify: `cd session-band-plugin && claude plugin test .`
  baseline: pass
- AC-3: `readGlab` maps a spawn failure or timeout, a 401 / not-logged-in stderr, any other non-zero exit, and unparseable output to distinct messages, as `readGh` does.
  verify: `cd session-band-plugin && claude plugin test .`
  baseline: pass
- AC-4: The pane runs `git remote get-url origin` first, then only the matching forge's command; a GitHub remote still renders exactly the rows it did before; a GitLab remote renders MR rows with a `!` sigil; an unknown host or no origin shows a message and runs no forge command; covered by `draft-prs-pane.test.ts`.
  verify: `cd session-band-plugin && claude plugin test .`
  baseline: pass
- AC-5: The pane's refresh path names no forge directly: it goes through `forgeFor`.
  verify: `! rg -n "GH_ARGV|GLAB_ARGV" session-band-plugin/hooks/draft-prs.tsx`
- AC-6: In a real GitLab repo with glab installed and logged in, pane 4 lists open and recently merged MRs.
  verify: manual - live use-test by the human (glab is not installed on this machine yet)

## Boundaries
### Always
- Keep the GitHub path's output unchanged; the existing pane test changes only its expected process calls (the new `git remote` call comes first).
- Keep pure parsing in `.ts` files and engine calls in `draft-prs.tsx`, as the plugin already does.
### Ask first
- Any extra per-MR or per-PR network call (for example GitLab pipeline status).
- Adding a forge beyond GitHub and GitLab.
### Never
- Run `ac-run approve`, or edit a `verify:` line to make it pass.
- Write to a forge (create, merge, comment); the pane stays read-only.

## Open Questions
- A self-hosted GitLab whose host does not contain "gitlab" is not matched. A `git config session-band.forge` override would fix it cheaply when needed.
- GitLab check glyphs stay `·` because the MR list carries no pipeline; showing them needs one call per MR.
