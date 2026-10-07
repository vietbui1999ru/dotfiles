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
  // Force-push by refspec, and the system directories themselves.
  ['git push origin +main', 'deny'],
  ['git push -f origin HEAD:main', 'deny'],
  ['git push origin +HEAD:refs/heads/master', 'deny'],
  ['rm /usr', 'deny'],
  ['rm -r /Users/', 'deny'],
  ['rm ~/*', 'deny'],
  // A plain rm below home or a system dir is a question, not a wall.
  ['rm /Users/me/tmp/x.txt', 'ask'],
  ['rm ~/Downloads/x.txt', 'ask'],
  ['rm $HOME/x.txt', 'ask'],
  ['rm /usr/local/bin/foo', 'ask'],
  ['rm -r ~/build', 'ask'],
  ['git push origin feat:other', 'pass'],
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
  ['bash -c $X', 'ask'],
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

const heredoc = (body: string, tag = 'EOF') => `"$(cat <<'${tag}'\n${body}\n${tag}\n)"`

test('a quoted heredoc is literal text for git and gh only', () => {
  expect(classify(`git commit -m ${heredoc('fix: x\n\nBody $(rm -rf ~) stays text')}`).tier).toBe('pass')
  expect(classify(`gh pr create --title t --body ${heredoc('## What')}`).tier).toBe('pass')
  expect(classify(`git add a && git commit -m ${heredoc('msg')}`).tier).toBe('pass')
})

test('a heredoc feeding anything else, or not provably literal, still asks', () => {
  expect(classify(`python3 -c ${heredoc('import os')}`).tier).toBe('ask')
  expect(classify(`bash -c ${heredoc('echo hi')}`).tier).toBe('ask')
  expect(classify(`git commit -m "$(cat <<EOF\nunquoted $(id)\nEOF\n)"`).tier).toBe('ask')
  expect(classify('git commit -m "$(cat <<\'EOF\'\nx\nEOF\n; rm x\nEOF\n)"').tier).toBe('ask')
  expect(classify('git commit -m "$(date)"').tier).toBe('ask')
  expect(classify(`git filter-branch --msg-filter ${heredoc('echo hi')}`).tier).toBe('ask')
  expect(classify(`git rebase --exec ${heredoc('make')}`).tier).toBe('ask')
  expect(classify(`git -C /tmp commit -m ${heredoc('msg')}`).tier).toBe('ask')
})

test('a heredoc never hides a dangerous segment around it', () => {
  expect(classify(`git commit -m ${heredoc('msg')} && git push -f origin main`).tier).toBe('deny')
  expect(classify(`git commit -m ${heredoc('msg')}; rm x`).tier).toBe('ask')
})

test('uses the strictest tier across shell separators', () => {
  expect(classify('echo ok; rm x').tier).toBe('ask')
  expect(classify('echo ok || git push -f origin main').tier).toBe('deny')
  expect(classify('printf ok\nrm x').tier).toBe('ask')
})
