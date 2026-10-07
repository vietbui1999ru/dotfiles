import type { EngineInterface, Register } from 'claude-code'

import { classify, type Classification, type CommandFact } from './classify'
import { preview, type PreviewFacts, type PreviewTarget } from './preview'

const hasGlob = (value: string) => /[*?[]/.test(value)
const cannotExpandGlob = (value: string) => value.includes('**') || value.includes('{') || value.includes('}')

const inClass = (source: string, value: string) => {
  for (let index = 0; index < source.length; index += 1) {
    const start = source[index] ?? ''
    const end = source[index + 2]
    if (source[index + 1] === '-' && end !== undefined) {
      if (start <= value && value <= end) return true
      index += 2
    } else if (start === value) return true
  }
  return false
}

const matches = (pattern: string, name: string) => {
  let patternIndex = 0
  let nameIndex = 0
  let starIndex = -1
  let retryNameIndex = 0

  while (nameIndex < name.length) {
    const token = pattern[patternIndex]
    if (token === '*') {
      starIndex = patternIndex
      patternIndex += 1
      retryNameIndex = nameIndex
    } else if (token === '?' || token === name[nameIndex]) {
      patternIndex += 1
      nameIndex += 1
    } else if (token === '[') {
      const close = pattern.indexOf(']', patternIndex + 1)
      if (close !== -1 && inClass(pattern.slice(patternIndex + 1, close), name[nameIndex] ?? '')) {
        patternIndex = close + 1
        nameIndex += 1
      } else if (starIndex !== -1) {
        patternIndex = starIndex + 1
        retryNameIndex += 1
        nameIndex = retryNameIndex
      } else return false
    } else if (starIndex !== -1) {
      patternIndex = starIndex + 1
      retryNameIndex += 1
      nameIndex = retryNameIndex
    } else return false
  }

  while (pattern[patternIndex] === '*') patternIndex += 1
  return patternIndex === pattern.length
}

const globParts = (target: string) => {
  const slash = target.lastIndexOf('/')
  if (slash === -1) return { directory: '.', pattern: target, prefix: '' }
  const directory = slash === 0 ? '/' : target.slice(0, slash)
  return { directory, pattern: target.slice(slash + 1), prefix: target.slice(0, slash + 1) }
}

const tracked = async ($: EngineInterface, path: string) => {
  const result = await $.process.run(['git', 'ls-files', '--error-unmatch', '--', path]).catch(() => undefined)
  return result?.exitCode === 0
}

const expandedTargets = async ($: EngineInterface, target: string): Promise<{ targets: PreviewTarget[]; unexpanded?: string }> => {
  if (!hasGlob(target)) {
    const stat = await $.fs.stat(target).catch(() => undefined)
    if (!stat) return { targets: [{ path: target }] }
    return { targets: [{ path: target, bytes: stat.size, tracked: await tracked($, target) }] }
  }
  if (cannotExpandGlob(target)) return { targets: [], unexpanded: target }

  const { directory, pattern, prefix } = globParts(target)
  const entries = await $.fs.list(directory).catch(() => undefined)
  if (!entries) return { targets: [], unexpanded: target }

  return {
    targets: await Promise.all(entries.flatMap(entry => {
      if (!matches(pattern, entry.name)) return []
      const path = `${prefix}${entry.name}`
      return [(async () => ({ path, bytes: entry.size, tracked: await tracked($, path) }))()]
    })),
  }
}

const dryRun = async ($: EngineInterface, commands: readonly CommandFact[]) => {
  const command = commands.find(item => item.program === 'git' && item.args[0] === 'clean')
  if (command) {
    const result = await $.process.run(['git', 'clean', '-n', ...command.args.slice(1)]).catch(() => undefined)
    if (result) return { label: 'git clean -n', output: result.stdout || result.stderr }
  }

  if (commands.some(item => item.program === 'git' && ['reset', 'checkout', 'restore'].includes(item.args[0] ?? ''))) {
    const result = await $.process.run(['git', 'diff', '--stat']).catch(() => undefined)
    if (result) return { label: 'git diff --stat', output: result.stdout || result.stderr }
  }

  const rsync = commands.find(item => item.program === 'rsync')
  if (rsync) {
    const result = await $.process.run(['rsync', '-n', ...rsync.args]).catch(() => undefined)
    if (result) return { label: 'rsync -n', output: result.stdout || result.stderr }
  }

  return undefined
}

const previewFacts = async ($: EngineInterface, command: string, result: Classification): Promise<PreviewFacts> => {
  const expanded = await Promise.all(result.commands.flatMap(item => item.targets).map(target => expandedTargets($, target)))
  const targets = expanded.flatMap(item => item.targets)
  const totalBytes = targets.reduce((total, target) => total + (target.bytes ?? 0), 0)

  return {
    command,
    reason: result.reason ?? 'this command may have a broad effect',
    targets,
    totalBytes: targets.some(target => target.bytes !== undefined) ? totalBytes : undefined,
    unexpandedGlobs: expanded.flatMap(item => item.unexpanded ? [item.unexpanded] : []),
    dryRun: await dryRun($, result.commands),
  }
}

const refusal = (command: string, reason: string) => `Bash command ${JSON.stringify(command)} was refused by blast-radius: ${reason}.`

let isInteractive = false

export const captureSession = (interactive: boolean) => {
  isInteractive = interactive
}

export const register: Register = on => {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const result = classify(e.command)
    if (result.tier === 'pass') return next(e)
    if (result.tier === 'deny') return { deny: refusal(e.command, result.reason ?? 'it is unconditionally dangerous') }
    if (!isInteractive) return { deny: refusal(e.command, 'nobody is available to answer the blast-radius prompt') }

    const facts = await previewFacts($, e.command, result).catch(() => ({
      command: e.command,
      reason: result.reason ?? 'this command may have a broad effect',
    }))
    try {
      const answer = await $.ui.ask(`${preview(facts)}\n\nAllow this Bash command?`, ['Allow', 'Deny'])
      return answer === 'Allow'
        ? next(e)
        : { deny: refusal(e.command, 'the blast-radius prompt was not allowed') }
    } catch {
      return { deny: refusal(e.command, 'the blast-radius prompt was dismissed') }
    }
  }).catch(($, e, next) => next.called ? next(e) : { deny: 'Bash command was refused by blast-radius: the guard failed closed.' })
}
