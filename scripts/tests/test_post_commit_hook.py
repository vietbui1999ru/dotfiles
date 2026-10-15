"""The post-commit hook syncs after a main-checkout commit and skips commits from a linked worktree."""
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

HOOK = Path(__file__).resolve().parent.parent / "hooks" / "post-commit"
GIT = ["git", "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false"]


class PostCommitHookCases(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.root, True)
        self.main = self.root / "main"
        (self.main / "scripts").mkdir(parents=True)
        # stand-in sync script: leaves a marker so the test can see whether the hook ran it
        stub = self.main / "scripts" / "sync-agent-rules.sh"
        stub.write_text('#!/bin/sh\necho "$PWD" >> "$MARKER"\n')
        stub.chmod(0o755)
        self.env = {**os.environ, "GIT_CONFIG_NOSYSTEM": "1", "MARKER": str(self.root / "marker")}
        self.git(self.main, "init", "-q", "-b", "main")
        self.git(self.main, "add", "-A")
        self.git(self.main, "commit", "-q", "-m", "init", hooks=False)
        hook = self.main / ".git" / "hooks" / "post-commit"
        os.symlink(HOOK, hook)

    def git(self, cwd, *args, hooks=True):
        cmd = GIT if hooks else GIT + ["-c", "core.hooksPath=/dev/null"]
        return subprocess.run([*cmd, *args], cwd=cwd, env=self.env, capture_output=True, text=True)

    def marker(self):
        p = self.root / "marker"
        return p.read_text().splitlines() if p.exists() else []

    def test_main_checkout_commit_runs_sync(self):
        (self.main / "a.txt").write_text("a")
        self.git(self.main, "add", "a.txt")
        self.git(self.main, "commit", "-q", "-m", "a")
        self.assertEqual(len(self.marker()), 1)
        self.assertTrue(self.marker()[0].endswith("main"))

    def test_linked_worktree_commit_skips_sync(self):
        wt = self.root / "wt"
        self.git(self.main, "worktree", "add", "-q", "-b", "feat", str(wt))
        (wt / "b.txt").write_text("b")
        self.git(wt, "add", "b.txt")
        r = self.git(wt, "commit", "-q", "-m", "b")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.marker(), [])

    def test_hook_exits_zero_without_sync_script(self):
        (self.main / "scripts" / "sync-agent-rules.sh").unlink()
        (self.main / "c.txt").write_text("c")
        self.git(self.main, "add", "-A")
        self.assertEqual(self.git(self.main, "commit", "-q", "-m", "c").returncode, 0)


if __name__ == "__main__":
    unittest.main()
