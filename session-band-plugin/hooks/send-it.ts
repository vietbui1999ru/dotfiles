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

export const SEND_IT_BLOCK = {
  env: { SEND_IT: '1', SEND_IT_ENV: '~/.config/send-it/.env' },
  model: 'opus',
  permissions: { defaultMode: 'dontAsk' },
} as const

const MARKER = 'send_it_block'

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

export const enable = (json: string): string =>
  serialize({ ...parseSettings(json), [MARKER]: SEND_IT_BLOCK })

export const disable = (json: string): string => {
  const settings = { ...parseSettings(json) }
  delete settings[MARKER]
  return serialize(settings)
}

export const isOn = (json: string): boolean => Object.hasOwn(parseSettings(json), MARKER)
