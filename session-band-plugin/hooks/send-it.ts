// Repos send-it never touches, as absolute git common dirs. HOME comes from the caller:
// node:os is not importable from a hooks module.
export const refusedRepos = (home: string): readonly string[] =>
  Object.freeze([`${home}/dotfiles/.git`, `${home}/repos/llm-wiki/.git`, `${home}/repos/agent-events/.git`])

export const SEND_IT_SINCE = '2026-10-16T00:00:00Z'

// An empty root commit date means an empty repo, which is eligible. Anything unparseable is refused.
export const isEligible = (commonDir: string, rootCommitDate: string, home: string): boolean => {
  if (refusedRepos(home).includes(commonDir)) return false
  if (rootCommitDate === '') return true
  const root = Date.parse(rootCommitDate)
  return !Number.isNaN(root) && root >= Date.parse(SEND_IT_SINCE)
}

export const acceptsOrigin = (kind: string): boolean => kind === 'composer'

const field = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}

// Both keys must hold: one stray key alone never turns send-it on.
export const sendItOn = (settings: Readonly<Record<string, unknown>>): boolean =>
  field(settings.env).SEND_IT === '1' && field(settings.permissions).defaultMode === 'dontAsk'

// Works on raw text, so a malformed file still answers. Any SEND_IT "1" marks the block.
export const hasSendItBlock = (text: string): boolean => /"SEND_IT"\s*:\s*"1"/.test(text)

// Real Claude Code settings keys, written into the repo's settings.local.json.
export const SEND_IT_BLOCK = {
  env: { SEND_IT: '1', SEND_IT_ENV: '~/.config/send-it/.env' },
  model: 'opus',
  permissions: {
    defaultMode: 'dontAsk',
    allow: ['Bash', 'Edit', 'Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Agent', 'Skill', 'mcp__context7', 'mcp__qmd', 'mcp__firecrawl'],
    deny: [
      'AskUserQuestion',
      'Read(~/secrets/**)',
      'Edit(./.claude/settings*.json)',
      'Edit(./.claude/{hooks,agents,rules,commands,skills}/**)',
      'Edit(./.mcp.json)',
      'Edit(./.git/hooks/**)',
    ],
  },
  sandbox: {
    enabled: true,
    allowUnsandboxedCommands: false,
    filesystem: {
      denyRead: ['~/secrets'],
      denyWrite: ['~/.claude', '~/dotfiles', '~/repos/llm-wiki', '~/repos/agent-events', '~/.config/send-it', './.git/hooks', './.mcp.json'],
    },
    network: { allowedDomains: ['github.com', 'api.github.com', '*.githubusercontent.com', 'registry.npmjs.org'] },
  },
} as const

type Settings = Record<string, unknown>

// Throws on malformed or non-object JSON so the caller never overwrites the file.
const parseSettings = (json: string): Settings => {
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch (err) {
    throw new Error(`send-it: settings JSON is malformed, not editing it: ${(err as Error).message}`)
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('send-it: settings JSON is not an object, not editing it')
  }
  return value as Settings
}

const serialize = (settings: Settings): string => `${JSON.stringify(settings, null, 2)}\n`

const asObject = (value: unknown): Settings =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Settings) : {}

const asList = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

// Recursive equality on parsed JSON; key order does not matter.
const sameJson = (a: unknown, b: unknown): boolean => {
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return a === b
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((k) => Object.hasOwn(b, k) && sameJson((a as Settings)[k], (b as Settings)[k]))
}

// Removes the block's entries from a list; drops the key when nothing is left.
const stripList = (holder: Settings, key: string, drop: readonly unknown[]): void => {
  if (!Array.isArray(holder[key])) return
  const left = (holder[key] as unknown[]).filter((entry) => !drop.includes(entry))
  if (left.length === 0) delete holder[key]
  else holder[key] = left
}

const deleteIfEmpty = (holder: Settings, key: string): void => {
  if (Object.keys(asObject(holder[key])).length === 0) delete holder[key]
}

// Block keys that already hold a different value. Names only: the values can be secrets.
const conflictingKeys = (settings: Settings): string[] => {
  const env = asObject(settings.env)
  const permissions = asObject(settings.permissions)
  const found: string[] = []
  if (settings.model !== undefined && settings.model !== SEND_IT_BLOCK.model) found.push('model')
  if (settings.sandbox !== undefined && !sameJson(settings.sandbox, SEND_IT_BLOCK.sandbox)) found.push('sandbox')
  if (env.SEND_IT !== undefined && env.SEND_IT !== SEND_IT_BLOCK.env.SEND_IT) found.push('env.SEND_IT')
  if (env.SEND_IT_ENV !== undefined && env.SEND_IT_ENV !== SEND_IT_BLOCK.env.SEND_IT_ENV) found.push('env.SEND_IT_ENV')
  if (permissions.defaultMode !== undefined && permissions.defaultMode !== SEND_IT_BLOCK.permissions.defaultMode) found.push('permissions.defaultMode')
  return found
}

export const enable = (json: string): string => {
  const settings = parseSettings(json)
  const conflicts = conflictingKeys(settings)
  if (conflicts.length > 0) {
    throw new Error(`send-it: refused, these keys already hold other values: ${conflicts.join(', ')}. Resolve them by hand, then run /send-it on again.`)
  }
  const env = asObject(settings.env)
  const permissions = asObject(settings.permissions)
  const allow = asList(permissions.allow)
  const deny = asList(permissions.deny)
  return serialize({
    ...settings,
    env: { ...env, ...SEND_IT_BLOCK.env },
    model: SEND_IT_BLOCK.model,
    permissions: {
      ...permissions,
      defaultMode: SEND_IT_BLOCK.permissions.defaultMode,
      allow: [...allow, ...SEND_IT_BLOCK.permissions.allow.filter((entry) => !allow.includes(entry))],
      deny: [...deny, ...SEND_IT_BLOCK.permissions.deny.filter((entry) => !deny.includes(entry))],
    },
    sandbox: structuredClone(SEND_IT_BLOCK.sandbox),
  })
}

export const disable = (json: string): string => {
  const settings: Settings = { ...parseSettings(json) }
  const env: Settings = { ...asObject(settings.env) }
  delete env.SEND_IT
  delete env.SEND_IT_ENV
  settings.env = env
  deleteIfEmpty(settings, 'env')
  if (settings.model === SEND_IT_BLOCK.model) delete settings.model
  const permissions: Settings = { ...asObject(settings.permissions) }
  if (permissions.defaultMode === SEND_IT_BLOCK.permissions.defaultMode) delete permissions.defaultMode
  stripList(permissions, 'allow', SEND_IT_BLOCK.permissions.allow)
  stripList(permissions, 'deny', SEND_IT_BLOCK.permissions.deny)
  settings.permissions = permissions
  deleteIfEmpty(settings, 'permissions')
  if (sameJson(settings.sandbox, SEND_IT_BLOCK.sandbox)) delete settings.sandbox
  return serialize(settings)
}

export const isOn = (json: string): boolean => {
  const settings = parseSettings(json)
  return asObject(settings.env).SEND_IT === '1' && asObject(settings.permissions).defaultMode === 'dontAsk'
}
