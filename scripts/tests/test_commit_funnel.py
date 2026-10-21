"""Tests for scripts/commit-funnel.

Each test builds a throwaway git (and, where needed, colocated jj) repo in a temp
dir and runs the script with sys.executable, a temp HOME and
GIT_CONFIG_NOSYSTEM=1. Stdlib only.
"""
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent
ROOT = SCRIPTS.parent
FUNNEL = SCRIPTS / "commit-funnel"
GITC = ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false"]


class Fixture(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="funnel-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.home = self.tmp / "home"
        self.home.mkdir()
        self.repo = self.tmp / "repo"
        self.msg = self.tmp / "msg"
        self.msg.write_text("add a and b\n\nbody line\n")
        self.env = {k: v for k, v in os.environ.items()
                    if not k.startswith(("GIT_", "JJ_"))}
        self.env.update(HOME=str(self.home), GIT_CONFIG_NOSYSTEM="1",
                        XDG_CONFIG_HOME=str(self.home / ".config"))
        self.jj_config = self.tmp / "jj.toml"
        self.jj_config.write_text('[user]\nname = "t"\nemail = "t@t"\n')
        self.env["JJ_CONFIG"] = str(self.jj_config)

    def fresh(self, name):
        """A brand-new repo directory, so subTests share no git state."""
        base = self.tmp / name
        base.mkdir()
        self.repo = base / "repo"
        return base

    def git(self, *args, check=True):
        return subprocess.run(["git", *GITC, *args], cwd=self.repo, env=self.env,
                              check=check, capture_output=True, text=True, timeout=60).stdout

    def jj(self, *args, check=True):
        jj = shutil.which("jj")
        if jj is None:
            self.fail("jj is required for the jj tests")
        return subprocess.run([jj, "--no-pager", *args], cwd=self.repo, env=self.env,
                              check=check, capture_output=True, text=True, timeout=60)

    def put(self, rel, body):
        path = self.repo / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(body)

    def commit(self, msg):
        self.git("add", "-A")
        self.git("commit", "-q", "-m", msg)

    def init_repo(self, base="main", feature="feat/x", files=None):
        self.repo.mkdir()
        self.git("init", "-q", "-b", base)
        for rel, body in (files or {"README.md": "fixture\n"}).items():
            self.put(rel, body)
        self.commit("base")
        if feature:
            self.git("checkout", "-q", "-b", feature)

    def jj_colocated(self):
        """Turn the checked-out repo into a colocated jj repo on the feature branch."""
        self.jj("git", "init", "--colocate")

    def run_funnel(self, *args, cwd=None):
        return subprocess.run([sys.executable, str(FUNNEL), *args],
                              cwd=cwd or self.repo, env=self.env,
                              capture_output=True, text=True, timeout=120)

    def head_count(self):
        return self.git("rev-list", "--count", "HEAD").strip()

    def assert_refused(self, r, *needles):
        self.assertEqual(r.returncode, 2, r.stderr)
        self.assertIn("commit-funnel: refused", r.stderr)
        self.assertIn("1.", r.stderr)
        for needle in needles:
            self.assertIn(needle, r.stderr)

    def test_git_commits_listed_paths(self):
        self.init_repo()
        self.put("a.txt", "a\n")
        self.put("b.txt", "b\n")
        self.put("c.txt", "c\n")
        r = self.run_funnel("-F", str(self.msg), "a.txt", "b.txt")
        self.assertEqual(r.returncode, 0, r.stderr)
        names = sorted(n for n in self.git("show", "--name-only", "--format=", "HEAD").splitlines() if n)
        self.assertEqual(names, ["a.txt", "b.txt"])
        self.assertEqual(self.git("log", "-1", "--format=%s").strip(), "add a and b")
        self.assertIn("body line", self.git("log", "-1", "--format=%B"))
        sha = self.git("rev-parse", "--short", "HEAD").strip()
        self.assertEqual(r.stdout.split(), [sha, "add", "a", "and", "b"])
        self.assertEqual(self.head_count(), "2")
        # the unlisted file stays out of the commit and out of the tree state
        self.assertEqual(sorted(self.git("ls-tree", "--name-only", "HEAD").split()),
                         ["README.md", "a.txt", "b.txt"])
        self.assertIn("c.txt", self.git("status", "--porcelain"))

    def test_git_refuses_protected_or_detached(self):
        for case in ("main", "master", "detached"):
            with self.subTest(case=case):
                self.fresh(case)
                if case == "detached":
                    self.init_repo()
                    self.git("checkout", "-q", "--detach", "HEAD")
                else:
                    self.init_repo(base=case, feature=None)
                self.put("a.txt", "a\n")
                r = self.run_funnel("-F", str(self.msg), "a.txt")
                self.assert_refused(r)
                self.assertEqual(self.head_count(), "1")
                self.assertIn("main" if case != "detached" else "detached", r.stderr)

    def test_refuses_bad_paths(self):
        self.init_repo()
        self.put("a.txt", "a\n")
        for args in ([], ["."], ["-A"], ["--all"], ["../outside.txt"]):
            with self.subTest(args=args):
                r = self.run_funnel("-F", str(self.msg), *args)
                self.assert_refused(r, *(args or ["no paths given"]))
                self.assertEqual(self.head_count(), "1")
        self.assertNotIn("a.txt", self.git("ls-tree", "--name-only", "HEAD"))

    def test_refuses_bad_message(self):
        self.init_repo()
        self.put("a.txt", "a\n")
        missing = self.tmp / "nope.txt"
        empty = self.tmp / "empty.txt"
        empty.write_text("\n \n")
        long_line = self.tmp / "long.txt"
        long_line.write_text("x" * 73 + "\n")
        for path, needle in ((missing, "missing"), (empty, "empty"), (long_line, "73")):
            with self.subTest(path=path.name):
                r = self.run_funnel("-F", str(path), "a.txt")
                self.assert_refused(r, needle)
                self.assertEqual(self.head_count(), "1")

    def test_git_refuses_foreign_staged(self):
        self.init_repo()
        self.put("a.txt", "a\n")
        self.put("b.txt", "b\n")
        self.git("add", "b.txt")
        r = self.run_funnel("-F", str(self.msg), "a.txt")
        self.assert_refused(r, "b.txt")
        self.assertEqual(self.git("diff", "--cached", "--name-only").split(), ["b.txt"])
        self.assertEqual(self.head_count(), "1")

    def test_git_commits_deletion(self):
        self.init_repo(files={"a.txt": "a\n", "keep.txt": "k\n"})
        (self.repo / "a.txt").unlink()
        r = self.run_funnel("-F", str(self.msg), "a.txt")
        self.assertEqual(r.returncode, 0, r.stderr)
        status = self.git("show", "--name-status", "--format=", "HEAD").split()
        self.assertEqual(status, ["D", "a.txt"])
        self.assertNotIn("a.txt", self.git("ls-tree", "--name-only", "HEAD").split())
        self.assertEqual(self.head_count(), "2")

    def test_refuses_wrong_checkout(self):
        self.init_repo()
        self.put("a.txt", "a\n")
        self.put("b.txt", "b\n")
        other = self.tmp / "other"
        other.mkdir()
        r = self.run_funnel("--worktree", str(other), "-F", str(self.msg), "a.txt", "b.txt")
        self.assert_refused(r, os.path.realpath(self.repo), os.path.realpath(other),
                            "a.txt b.txt", "2.", "3.")
        self.assertIn("isolation", r.stderr)
        self.assertEqual(self.head_count(), "1")

    def test_jj_commits_and_moves_bookmark(self):
        self.init_repo()
        self.jj_colocated()
        self.put("a.txt", "a\n")
        self.put("b.txt", "b\n")
        r = self.run_funnel("-F", str(self.msg), "a.txt")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.jj("diff", "--name-only", "-r", "@-").stdout.split(), ["a.txt"])
        self.assertEqual(self.jj("diff", "--name-only", "-r", "@").stdout.split(), ["b.txt"])
        committed = self.jj("log", "--no-graph", "-r", "@-", "-T", "commit_id").stdout.strip()
        bookmark = self.jj("log", "--no-graph", "-r", "feat/x", "-T", "commit_id").stdout.strip()
        self.assertEqual(bookmark, committed)
        self.assertEqual(self.git("rev-parse", "feat/x").strip(), committed)
        self.assertEqual(self.git("symbolic-ref", "--short", "HEAD").strip(), "feat/x")
        self.assertEqual(self.git("rev-parse", "HEAD").strip(), committed)
        self.assertIn("add a and b", r.stdout)

    def test_jj_refuses_ambiguous_branch(self):
        for case in ("none", "two"):
            with self.subTest(case=case):
                self.fresh(f"amb-{case}")
                self.init_repo()
                self.jj_colocated()
                self.put("a.txt", "a\n")
                self.git("checkout", "-q", "--detach", "HEAD")
                if case == "none":
                    self.jj("bookmark", "forget", "feat/x")
                    self.jj("bookmark", "forget", "main")
                    needle = "(none)"
                else:
                    self.jj("bookmark", "forget", "main")
                    self.jj("bookmark", "create", "extra", "-r", "@-")
                    needle = "extra"
                before = self.git("rev-parse", "HEAD").strip()
                r = self.run_funnel("-F", str(self.msg), "a.txt")
                self.assert_refused(r, "detached", needle)
                if case == "two":
                    self.assertIn("feat/x", r.stderr)
                self.assertEqual(self.git("rev-parse", "HEAD").strip(), before)



if __name__ == "__main__":
    unittest.main()
