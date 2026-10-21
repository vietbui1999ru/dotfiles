"""Tests for the agent-ref-guard: the reference-transaction hook, link-git-hooks and the Bash block.

Each test builds a throwaway repo with a real linked worktree under `.claude/worktrees/`,
in a temp dir, with a temp HOME and GIT_CONFIG_NOSYSTEM=1. The real repo is never touched.
Stdlib only.
"""
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent
ROOT = SCRIPTS.parent
HOOK_SRC = SCRIPTS / "hooks" / "reference-transaction"
LINKER = SCRIPTS / "link-git-hooks"
BASH_HOOK = ROOT / "claude" / ".claude" / "hooks" / "enforce-bash-safety.sh"
GITC = ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false"]
ZERO = "0" * 40


class Fixture(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="refguard-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.home = self.tmp / "home"
        self.home.mkdir()
        self.env = {k: v for k, v in os.environ.items()
                    if not k.startswith(("GIT_", "COMMIT_FUNNEL", "AGENT_REF_GUARD"))}
        self.env.update(HOME=str(self.home), GIT_CONFIG_NOSYSTEM="1")
        self.repo = self.tmp / "repo"
        self.repo.mkdir()
        self.git(self.repo, "init", "-q", "-b", "main")
        (self.repo / "a.txt").write_text("a")
        self.git(self.repo, "add", "a.txt")
        self.git(self.repo, "commit", "-q", "-m", "init")
        self.git(self.repo, "branch", "other")
        self.wt = self.repo / ".claude" / "worktrees" / "w"
        self.wt.parent.mkdir(parents=True)
        self.git(self.repo, "worktree", "add", "-q", "-b", "feat", str(self.wt))
        self.hooks_dir = Path(self.git(self.repo, "rev-parse", "--git-common-dir",
                                       capture=True).stdout.strip())
        if not self.hooks_dir.is_absolute():
            self.hooks_dir = self.repo / self.hooks_dir
        self.hooks_dir = self.hooks_dir / "hooks"

    def git(self, cwd, *args, capture=False, env=None):
        r = subprocess.run(["git", *GITC, *args], cwd=cwd, env=env or self.env,
                           capture_output=True, text=True)
        if not capture and r.returncode != 0:
            self.fail(f"git {' '.join(args)} failed: {r.stderr}")
        return r

    def install_hook(self):
        """Link the real reference-transaction hook into the temp repo's common hooks dir."""
        self.hooks_dir.mkdir(parents=True, exist_ok=True)
        (self.hooks_dir / "reference-transaction").symlink_to(HOOK_SRC)

    def head(self, cwd, ref="refs/heads/feat"):
        return self.git(cwd, "rev-parse", ref, capture=True).stdout.strip()

    def commit_file(self, cwd, name, env=None):
        (cwd / name).write_text(name)
        self.git(cwd, "add", name)
        return self.git(cwd, "commit", "-q", "-m", name, env=env, capture=True)


class ReferenceTransactionCases(Fixture):
    def setUp(self):
        super().setUp()
        self.install_hook()

    def test_plain_commit_refused(self):
        before = self.head(self.wt)
        r = self.commit_file(self.wt, "b.txt")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("commit-funnel", r.stderr)
        self.assertEqual(self.head(self.wt), before)

    def test_other_branch_moves_refused(self):
        # Seed a second commit on feat through the funnel's own env so HEAD~1 exists.
        self.commit_file(self.wt, "seed.txt", env={**self.env, "COMMIT_FUNNEL": "1"})
        before = self.head(self.wt)
        other_before = self.head(self.wt, "refs/heads/other")

        (self.wt / "c.txt").write_text("c")
        self.git(self.wt, "add", "c.txt")
        r = self.git(self.wt, "commit", "-q", "--no-verify", "-m", "c", capture=True)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("commit-funnel", r.stderr)
        self.assertEqual(self.head(self.wt), before)

        (self.wt / "x.txt").write_text("x")
        self.git(self.wt, "add", "x.txt")
        r = subprocess.run(["bash", "-c", "git commit -q -m x"], cwd=self.wt,
                           env=self.env, capture_output=True, text=True)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("commit-funnel", r.stderr)

        r = self.git(self.wt, "reset", "--soft", "HEAD~1", capture=True)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("commit-funnel", r.stderr)

        r = self.git(self.wt, "update-ref", "refs/heads/feat", self.head(self.repo, "refs/heads/main"),
                     capture=True)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("commit-funnel", r.stderr)

        r = self.git(self.wt, "branch", "-D", "other", capture=True)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("commit-funnel", r.stderr)

        self.assertEqual(self.head(self.wt), before)
        self.assertEqual(self.head(self.wt, "refs/heads/other"), other_before)

    def test_non_branch_moves_allowed(self):
        self.git(self.wt, "switch", "-q", "-c", "new")
        self.assertTrue(self.head(self.wt, "refs/heads/new"))
        self.git(self.wt, "tag", "t")
        self.git(self.wt, "status", "--short")
        remote = self.tmp / "remote.git"
        self.git(self.tmp, "init", "-q", "--bare", str(remote))
        self.git(self.repo, "remote", "add", "origin", str(remote))
        r = self.git(self.repo, "push", "-q", "origin", "main", capture=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        r = self.git(self.wt, "fetch", "-q", "origin", capture=True)
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_funnel_commit_allowed(self):
        env = {**self.env, "COMMIT_FUNNEL": "1"}
        before = self.head(self.wt)
        r = self.commit_file(self.wt, "d.txt", env=env)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertNotEqual(self.head(self.wt), before)

        msg = self.tmp / "msg"
        msg.write_text("funnel commit\n")
        (self.wt / "e.txt").write_text("e")
        r = subprocess.run([str(SCRIPTS / "commit-funnel"), "--worktree", str(self.wt),
                            "-F", str(msg), "e.txt"], cwd=self.wt, env=self.env,
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr + r.stdout)
        self.assertIn("funnel commit", self.git(self.wt, "log", "-1", "--format=%s",
                                                capture=True).stdout)

    def test_main_checkout_unaffected(self):
        self.commit_file(self.repo, "m.txt")
        before = self.head(self.repo, "refs/heads/main")
        self.git(self.repo, "reset", "-q", "--soft", "HEAD~1")
        self.assertNotEqual(self.head(self.repo, "refs/heads/main"), before)
        r = self.git(self.repo, "branch", "-D", "other", capture=True)
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_human_override(self):
        env = {**self.env, "AGENT_REF_GUARD": "off"}
        before = self.head(self.wt)
        r = self.commit_file(self.wt, "h.txt", env=env)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertNotEqual(self.head(self.wt), before)


class LinkerCases(Fixture):
    def make_dotfiles(self):
        """A dotfiles stand-in: its own git repo with scripts/hooks copied from the real tree."""
        dot = self.tmp / "dotfiles"
        hooks = dot / "scripts" / "hooks"
        hooks.mkdir(parents=True)
        for name in ("post-commit", "reference-transaction"):
            dst = hooks / name
            shutil.copy(SCRIPTS / "hooks" / name, dst)
            dst.chmod(0o755)
        self.git(dot, "init", "-q", "-b", "main") if False else None
        subprocess.run(["git", "init", "-q", "-b", "main", str(dot)], env=self.env, check=True)
        self.git(dot, "add", "-A")
        self.git(dot, "commit", "-q", "-m", "init")
        return dot

    def run_linker(self, dot, extra=None):
        env = {**self.env, "DOTFILES": str(dot), **(extra or {})}
        return subprocess.run([str(LINKER)], env=env, capture_output=True, text=True)

    def test_bootstrap_links_hook(self):
        dot = self.make_dotfiles()
        hooks = Path(subprocess.run(["git", "-C", str(dot), "rev-parse", "--git-common-dir"],
                                    env=self.env, capture_output=True, text=True,
                                    check=True).stdout.strip())
        hooks = (dot / hooks if not hooks.is_absolute() else hooks).resolve() / "hooks"
        ref = hooks / "reference-transaction"
        ref.parent.mkdir(parents=True, exist_ok=True)
        ref.write_text("#!/bin/sh\necho old\n")

        r = self.run_linker(dot)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue((hooks / "reference-transaction.bak").exists())
        self.assertTrue(ref.is_symlink())
        self.assertEqual(os.readlink(ref), str(dot / "scripts/hooks/reference-transaction"))
        self.assertTrue((hooks / "post-commit").is_symlink())

        r = self.run_linker(dot)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(ref.is_symlink())
        self.assertFalse((hooks / "reference-transaction.bak.bak").exists())


class BashHookCases(unittest.TestCase):
    def run_hook(self, cmd, cwd):
        import json
        payload = json.dumps({"tool_input": {"command": cmd}, "cwd": cwd})
        return subprocess.run(["bash", str(BASH_HOOK)], input=payload, capture_output=True,
                              text=True, env={**os.environ, "GIT_CONFIG_NOSYSTEM": "1"})

    def test_bash_hook_blocks_forged_env(self):
        # Fake hook cwd values only; the hook reads the string and touches no file.
        base = os.path.join(tempfile.gettempdir(), "refguard-cwd")
        inside = os.path.join(base, ".claude", "worktrees", "w")
        outside = base
        for cmd in ("COMMIT_FUNNEL=1 git commit -m x",
                    "AGENT_REF_GUARD=off git reset --soft HEAD~1",
                    "git -c core.hooksPath=/dev/null commit -m x"):
            r = self.run_hook(cmd, inside)
            self.assertEqual(r.returncode, 2, cmd)
            self.assertIn("commit-funnel", r.stderr)
            self.assertEqual(self.run_hook(cmd, outside).returncode, 0, cmd)


if __name__ == "__main__":
    unittest.main()
