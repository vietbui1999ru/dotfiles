export type Tier = 'pass' | 'ask' | 'deny'

type Separator = ';' | '&&' | '||' | '|' | '&' | '\n'

type Word = {
  value: string
  dynamic: boolean
}

export type CommandFact = {
  command: string
  program?: string
  args: string[]
  targets: string[]
}

export type Classification = {
  tier: Tier
  reason?: string
  commands: CommandFact[]
}

type Segment = {
  words: Word[]
  separator?: Separator
}

type Tokenized = {
  segments: Segment[]
  cannotAnalyze?: boolean
}

const SYSTEM_DIRECTORY = /^\/(?:usr|etc|bin|System|Users)(?:\/|$)/
const SHELL = new Set(['sh', 'bash', 'zsh'])
const TIER_ORDER: Record<Tier, number> = { pass: 0, ask: 1, deny: 2 }

const basename = (value: string) => value.split('/').filter(Boolean).at(-1) ?? value

const isAssignment = (value: string) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(value)

const hasRecursiveFlag = (args: readonly string[]) => args.some(arg => arg === '--recursive' || /^-[^-]*[rR]/.test(arg))

const hasForceFlag = (args: readonly string[]) => args.some(arg => arg === '--force' || arg === '--force-with-lease' || /^-[^-]*f/.test(arg))

const nonOptions = (args: readonly string[]) => {
  const values: string[] = []
  let afterDoubleDash = false
  for (const arg of args) {
    if (arg === '--') {
      afterDoubleDash = true
      continue
    }
    if (afterDoubleDash || !arg.startsWith('-') || arg === '-') values.push(arg)
  }
  return values
}

const stripLauncher = (words: readonly Word[]): Word[] => {
  let remaining = [...words]

  while (remaining.length > 0) {
    while (remaining[0] && isAssignment(remaining[0].value)) remaining = remaining.slice(1)
    const launcher = basename(remaining[0]?.value ?? '')

    if (launcher === 'rtk') {
      remaining = remaining.slice(1)
      if (remaining[0]?.value === 'proxy') remaining = remaining.slice(1)
      continue
    }

    if (launcher === 'command' || launcher === 'builtin' || launcher === 'exec' || launcher === 'nohup' || launcher === 'time') {
      remaining = remaining.slice(1)
      while (remaining[0]?.value.startsWith('-')) remaining = remaining.slice(1)
      continue
    }

    if (launcher === 'env') {
      remaining = remaining.slice(1)
      while (remaining[0] && (remaining[0].value.startsWith('-') || isAssignment(remaining[0].value))) remaining = remaining.slice(1)
      continue
    }

    if (launcher === 'sudo') {
      remaining = remaining.slice(1)
      while (remaining[0]?.value.startsWith('-')) {
        const option = remaining[0].value
        remaining = remaining.slice(1)
        if (['-u', '-g', '-h', '-C', '--user', '--group', '--host', '--chdir', '--close-from', '--prompt', '--role', '--type'].includes(option)) {
          remaining = remaining.slice(1)
        }
      }
      continue
    }

    if (launcher === 'xargs') {
      remaining = remaining.slice(1)
      while (remaining[0]?.value.startsWith('-')) {
        const option = remaining[0].value
        remaining = remaining.slice(1)
        if (['-a', '-d', '-E', '-e', '-I', '-i', '-L', '-l', '-n', '-P', '-s', '--arg-file', '--delimiter', '--eof', '--replace', '--max-lines', '--max-args', '--max-procs', '--max-chars'].includes(option)) {
          remaining = remaining.slice(1)
        }
      }
      continue
    }

    break
  }

  return remaining
}

const isDangerousRmTarget = (target: string, recursiveAndForce: boolean) =>
  target === '/' || target === '~' || target === '$HOME' || target.startsWith('~/') || target.startsWith('$HOME/') || target === '/*' || SYSTEM_DIRECTORY.test(target) || (recursiveAndForce && target.startsWith('/'))

const isShell = (program: string | undefined) => program !== undefined && SHELL.has(program)

const containsOverwrite = (args: readonly string[]) => args.some((arg, index) => {
  if (arg !== '>' && arg !== '>>') return false
  const target = args[index + 1]
  return target !== '/dev/null' && !/^&\d+$/.test(target ?? '')
})

const factFor = (segment: Segment): CommandFact => {
  const normalized = stripLauncher(segment.words)
  const program = normalized[0] ? basename(normalized[0].value) : undefined
  const args = normalized.slice(1).map(word => word.value)
  const values = nonOptions(args)
  let targets: string[] = []

  if (program === 'rm' || program === 'chmod' || program === 'find') targets = values
  if (program === 'mv') targets = values.slice(-1)
  if (program === 'git' && ['clean', 'checkout', 'restore'].includes(args[0] ?? '')) targets = values.slice(1)

  return { command: segment.words.map(word => word.value).join(' '), program, args, targets }
}

const classifySegment = (segment: Segment): Classification => {
  const fact = factFor(segment)
  const { program, args } = fact
  const values = nonOptions(args)

  if (containsOverwrite(args)) return { tier: 'ask', reason: 'overwriting a redirect', commands: [fact] }
  if (program === 'eval') return { tier: 'ask', reason: "can't analyze eval", commands: [fact] }
  if (isShell(program) && (args.includes('<<') || args.includes('<<-'))) return { tier: 'ask', reason: "can't analyze a here-doc feeding a shell", commands: [fact] }
  if (segment.separator === '|' && isShell(program)) return { tier: 'ask', reason: "can't analyze a pipe into a shell", commands: [fact] }
  if (isShell(program) && args.includes('-c')) {
    const body = args[args.indexOf('-c') + 1]
    const word = stripLauncher(segment.words).at(args.indexOf('-c') + 2)
    if (!body || word?.dynamic) return { tier: 'ask', reason: "can't analyze a dynamic shell body", commands: [fact] }
  }

  if (program === 'rm') {
    const recursiveAndForce = hasRecursiveFlag(args) && hasForceFlag(args)
    if (values.some(target => isDangerousRmTarget(target, recursiveAndForce))) {
      return { tier: 'deny', reason: 'rm targets a root, home, or system path', commands: [fact] }
    }
    return { tier: 'ask', reason: 'rm deletes files', commands: [fact] }
  }

  if (program === 'git') {
    const subcommand = args[0]
    if (subcommand === 'push' && hasForceFlag(args) && values.slice(1).some(value => value === 'main' || value === 'master' || value === 'refs/heads/main' || value === 'refs/heads/master')) {
      return { tier: 'deny', reason: 'force-push targets main or master', commands: [fact] }
    }
    if (subcommand === 'reset' && args.includes('--hard')) {
      const ref = values.slice(1).at(-1)
      if (ref?.startsWith('origin/') || ref === '@{u}') return { tier: 'deny', reason: 'hard reset targets a remote upstream ref', commands: [fact] }
      return { tier: 'ask', reason: 'git reset --hard discards work', commands: [fact] }
    }
    if (subcommand === 'clean') return { tier: 'ask', reason: 'git clean deletes files', commands: [fact] }
    if ((subcommand === 'checkout' || subcommand === 'restore') && values.slice(1).includes('.')) return { tier: 'ask', reason: `git ${subcommand} . discards work`, commands: [fact] }
    if (subcommand === 'stash' && ['drop', 'clear'].includes(args[1] ?? '')) return { tier: 'ask', reason: `git stash ${args[1]} discards work`, commands: [fact] }
  }

  if (program === 'mv') return { tier: 'ask', reason: 'mv may overwrite its destination', commands: [fact] }
  if (program === 'find' && args.includes('-delete')) return { tier: 'ask', reason: 'find -delete removes files', commands: [fact] }
  if (program === 'chmod' && hasRecursiveFlag(args)) return { tier: 'ask', reason: 'chmod -R changes permissions recursively', commands: [fact] }
  if ((program === 'docker' || program === 'kubectl') && args.some(arg => ['rm', 'rmi', 'prune', 'delete', 'kill'].includes(arg))) {
    return { tier: 'ask', reason: `${program} deletes resources`, commands: [fact] }
  }

  return { tier: 'pass', commands: [fact] }
}

export const tokenize = (command: string): Tokenized => {
  const segments: Segment[] = []
  let words: Word[] = []
  let word = ''
  let dynamic = false
  let quote: 'single' | 'double' | undefined
  let separator: Separator | undefined
  let cannotAnalyze = false

  const pushWord = () => {
    if (word) words.push({ value: word, dynamic })
    word = ''
    dynamic = false
  }
  const pushSegment = (nextSeparator: Separator) => {
    pushWord()
    if (words.length > 0) segments.push({ words, separator })
    words = []
    separator = nextSeparator
  }

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index] ?? ''
    const next = command[index + 1]

    if (char === '\\' && quote !== 'single') {
      if (next === undefined) {
        cannotAnalyze = true
      } else {
        word += next
        index += 1
      }
      continue
    }

    if (char === "'" && quote !== 'double') {
      quote = quote === 'single' ? undefined : 'single'
      continue
    }
    if (char === '"' && quote !== 'single') {
      quote = quote === 'double' ? undefined : 'double'
      continue
    }

    if (quote !== 'single' && char === '`') cannotAnalyze = true
    if (quote !== 'single' && char === '$' && next === '(') cannotAnalyze = true
    if (quote === 'double' && char === '$') dynamic = true

    if (quote) {
      word += char
      continue
    }

    if (char === '>' || (char === '<' && next === '<')) {
      pushWord()
      if (char === '<') {
        words.push({ value: next === '<' && command[index + 2] === '-' ? '<<-' : '<<', dynamic: false })
        index += next === '<' && command[index + 2] === '-' ? 2 : 1
      } else {
        words.push({ value: next === '>' ? '>>' : '>', dynamic: false })
        if (next === '>') index += 1
        if (command[index + 1] === '&') {
          let target = '&'
          index += 1
          while (/\d/.test(command[index + 1] ?? '')) {
            target += command[index + 1]
            index += 1
          }
          words.push({ value: target, dynamic: false })
        }
      }
      continue
    }

    if (/\s/.test(char)) {
      if (char === '\n') pushSegment('\n')
      else pushWord()
      continue
    }

    if (char === ';') {
      pushSegment(';')
      continue
    }
    if (char === '|' || char === '&') {
      const joined = next === char ? `${char}${char}` as Separator : char as Separator
      pushSegment(joined)
      if (next === char) index += 1
      continue
    }

    word += char
  }

  pushWord()
  if (words.length > 0) segments.push({ words, separator })
  if (quote) cannotAnalyze = true

  return { segments, cannotAnalyze }
}

export const classify = (command: string): Classification => {
  const parsed = tokenize(command)
  if (parsed.cannotAnalyze) return { tier: 'ask', reason: "can't analyze this command", commands: parsed.segments.map(factFor) }

  return parsed.segments.reduce<Classification>((strictest, segment) => {
    const candidate = classifySegment(segment)
    if (TIER_ORDER[candidate.tier] > TIER_ORDER[strictest.tier]) return {
      ...candidate,
      commands: [...strictest.commands, ...candidate.commands],
    }
    return { ...strictest, commands: [...strictest.commands, ...candidate.commands] }
  }, { tier: 'pass', commands: [] })
}
