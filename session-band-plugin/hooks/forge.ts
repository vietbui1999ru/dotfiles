// Which forge a repo lives on, picked from its `origin` remote, and how the draft PRs pane lists that forge's PRs.
// One entry per forge: adding Forgejo or Codeberg is one more entry here and one reader beside gitlab.ts.
import type { DraftPrsState, ForgeId } from '../types'
import { GH_ARGV, readGh, type GhResult } from './draft-prs'
import { GLAB_ARGV, readGlab } from './gitlab'

// Every remote, not just origin: a clone can name its remote anything (`gitlab`, `upstream`).
export const REMOTE_ARGV = ['git', 'remote', '-v'] as const
export const NO_REMOTE = 'no git remote here'
export const noForge = (host: string) => `the remote is on ${host}: no PR list for it`

export type Forge = {
  id: ForgeId
  /** How the forge writes a PR number in a row: `#117`, `!117`. */
  sigil: string
  matches: (host: string) => boolean
  argv: readonly string[]
  read: (r: GhResult | undefined, now: number) => Pick<DraftPrsState, 'prs' | 'error'>
}

// First match wins. Self-hosted GitLab is matched by "gitlab" in its host name.
export const FORGES: readonly Forge[] = [
  { id: 'github', sigil: '#', matches: host => host === 'github.com', argv: GH_ARGV, read: readGh },
  { id: 'gitlab', sigil: '!', matches: host => host.includes('gitlab'), argv: GLAB_ARGV, read: readGlab },
]

/** The host of `https://host/o/r`, `ssh://git@host:22/o/r` or `git@host:o/r`, lowercased; undefined if none. */
export const hostOf = (remote: string): string | undefined => {
  const url = remote.trim()
  const host = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^:/]+)/i.exec(url)?.[1] ?? /^(?:[^@/]+@)?([^:/]+):(?!\/)/.exec(url)?.[1]
  return host?.toLowerCase()
}

export const forgeFor = (host: string): Forge | undefined => FORGES.find(forge => forge.matches(host))

/** From `git remote -v`: origin if it is on a known forge, else the first remote that is. With no known forge,
 *  the host of origin (or the first remote) so the pane can name it; `{}` when there is no remote with a host. */
export const pickRemote = (out: string): { host?: string; forge?: Forge } => {
  const rows = out.split('\n').flatMap(line => {
    const m = /^(\S+)\s+(\S+)\s+\(fetch\)/.exec(line)
    const host = m?.[2] === undefined ? undefined : hostOf(m[2])
    return m?.[1] !== undefined && host !== undefined ? [{ name: m[1], host }] : []
  })
  const hosts = [...rows.filter(r => r.name === 'origin'), ...rows.filter(r => r.name !== 'origin')].map(r => r.host)
  const host = hosts.find(h => forgeFor(h)) ?? hosts[0]
  return host === undefined ? {} : { host, forge: forgeFor(host) }
}

export const forgeById =(id: ForgeId | undefined): Forge | undefined => FORGES.find(forge => forge.id === id)
