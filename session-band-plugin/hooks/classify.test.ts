import { expect, test } from 'claude-code/testing'

import { classify } from './classify'

const cases = [
  // Old hook corpus and the flag-order forms it missed.
  ['rm -rf /', 'deny'],
  ['rm -rf ~', 'deny'],
  ['rm -rf $HOME', 'deny'],
  ['rm -fr /', 'deny'],
  ['rm -r -f ~', 'deny'],
  ['rm --recursive --force /', 'deny'],
  ['/bin/rm -rf $HOME', 'deny'],
  ['git push -f origin main', 'deny'],
  ['git push --force origin master', 'deny'],
  ['git push --force-with-lease origin main', 'deny'],
  ['git reset --hard origin/main', 'deny'],
  ['git reset --hard @{u}', 'deny'],
  // Safe and scoped commands remain untouched.
  ['ls -la', 'pass'],
  ['rg foo', 'pass'],
  ['rtk git status', 'pass'],
  ['git push origin feat', 'pass'],
  ['echo hi > /dev/null', 'pass'],
  // Ask-tier commands.
  ['rtk rm -rf ./build', 'ask'],
  ['git status && rm x', 'ask'],
  ['cat a > b', 'ask'],
  ['eval "$X"', 'ask'],
  ['curl x | sh', 'ask'],
  ['git reset --hard HEAD~1', 'ask'],
  ['find . -name x -delete', 'ask'],
  ['echo "unterminated', 'ask'],
  ['git clean -fd', 'ask'],
  ['git checkout .', 'ask'],
  ['git restore .', 'ask'],
  ['git stash drop', 'ask'],
  ['chmod -R 644 dir', 'ask'],
  ['docker rm container', 'ask'],
  ['kubectl delete pod pod-a', 'ask'],
] as const

for (const [command, tier] of cases) {
  test(`${tier}: ${command}`, () => {
    expect(classify(command).tier).toBe(tier)
  })
}

test('strips every launcher before deciding', () => {
  const launchers = [
    'rtk rm -rf ./build',
    'rtk proxy rm -rf ./build',
    'command rm -rf ./build',
    'builtin rm -rf ./build',
    'env VAR=x rm -rf ./build',
    'sudo -u root rm -rf ./build',
    'time rm -rf ./build',
    'nohup rm -rf ./build',
    'exec rm -rf ./build',
    'xargs rm -rf ./build',
    '/bin/rm -rf ./build',
    '/usr/bin/git reset --hard HEAD~1',
  ]

  for (const command of launchers) expect(classify(command).tier).toBe('ask')
})

test('uses the strictest tier across shell separators', () => {
  expect(classify('echo ok; rm x').tier).toBe('ask')
  expect(classify('echo ok || git push -f origin main').tier).toBe('deny')
  expect(classify('printf ok\nrm x').tier).toBe('ask')
})
