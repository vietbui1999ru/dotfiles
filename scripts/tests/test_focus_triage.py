"""Tests for `scripts/focus triage` (SPEC: feat/focus, AC-1, AC-2).

Each test builds temp repos under a fake HOME, puts a fake `gh` first on PATH, and runs
scripts/focus triage. The read-only test snapshots every file, every ref and the worktree
list before and after. Stdlib only.
"""
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent
CLI = SCRIPTS / "focus"

FAKE_GH = """#!/bin/sh
echo "$@" >> "$FAKE_GH_LOG"
cat "$FAKE_GH_JSON"
"""


def git(repo, *args):
    env = {**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t"}
    return subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, text=True, env=env).stdout


class TriageTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="focus-triage-"))
        self.home = self.tmp / "home"
        self.home.mkdir()
        self.repos = self.home / "repos"
        self.repos.mkdir()
        self.bin = self.tmp / "bin"
        self.bin.mkdir()
        self.gh_log = self.tmp / "gh.log"
        self.gh_json = self.tmp / "gh.json"
        self.gh_json.write_text(json.dumps([{"headRefName": "feat/x", "state": "OPEN"},
                                            {"headRefName": "feat/done", "state": "MERGED"}]))
        gh = self.bin / "gh"
        gh.write_text(FAKE_GH)
        gh.chmod(0o755)
        self.env = {**os.environ, "HOME": str(self.home), "PATH": f"{self.bin}{os.pathsep}{os.environ['PATH']}",
                    "FOCUS_ROOTS": str(self.repos), "FAKE_GH_LOG": str(self.gh_log), "FAKE_GH_JSON": str(self.gh_json),
                    "FOCUS_BOARD": str(self.tmp / "Focus.md"), "FOCUS_STATE": str(self.tmp / "state")}
        self.dotfiles = self.home / "dotfiles"
        self._make_repo(self.dotfiles)
        self.acme = self.repos / "acme-api"
        self._make_repo(self.acme)
        git(self.acme, "branch", "feat/x")
        git(self.acme, "worktree", "add", "-q", str(self.tmp / "wt-x"), "feat/x")
        (self.tmp / "wt-x" / "SPEC.md").write_text("spec")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _make_repo(self, path):
        path.mkdir(parents=True)
        git(path, "init", "-q", "-b", "main")
        (path / "README").write_text("x")
        git(path, "add", "README")
        git(path, "commit", "-q", "-m", "init")

    def triage(self, *extra):
        return subprocess.run([str(CLI), "triage", *extra], capture_output=True, text=True, env=self.env)

    def snapshot(self):
        """Content hash and mtime of every file under the repos' git dirs, the board and the state dir,
        plus each repo's refs and worktree list. The fake gh log and the working trees are excluded:
        they are the test's own bookkeeping, and triage must not change anything else."""
        watched = []
        for repo in [self.dotfiles, self.acme]:
            watched.append(repo / ".git")
        watched += [self.tmp / "Focus.md", self.tmp / "state"]
        files = {}
        for root in watched:
            paths = root.rglob("*") if root.is_dir() else [root]
            for path in paths:
                if path.is_file():
                    files[str(path)] = (hashlib.sha256(path.read_bytes()).hexdigest(), path.stat().st_mtime_ns)
        refs = {}
        for repo in [self.dotfiles, self.acme]:
            refs[str(repo)] = (git(repo, "for-each-ref"), git(repo, "worktree", "list", "--porcelain"))
        return files, refs


class InventoryTest(TriageTest):
    def test_inventory_lists_every_worktree_with_its_fields(self):
        result = self.triage("--json")
        self.assertEqual(result.returncode, 0, result.stderr)
        rows = json.loads(result.stdout)
        by = {(r["repo"], r["branch"]): r for r in rows}
        self.assertIn(("dotfiles", "main"), by)
        self.assertIn(("acme-api", "main"), by)
        self.assertIn(("acme-api", "feat/x"), by)
        x = by[("acme-api", "feat/x")]
        self.assertRegex(x["last_commit"], r"^\d{4}-\d{2}-\d{2}$")
        self.assertEqual(x["pr"], "open")
        self.assertTrue(x["spec"])
        self.assertFalse(by[("dotfiles", "main")]["spec"])

    def test_inventory_marks_dirty_and_unknown_pr(self):
        (self.tmp / "wt-x" / "dirty.txt").write_text("edit")
        rows = {(r["repo"], r["branch"]): r for r in json.loads(self.triage("--json").stdout)}
        self.assertTrue(rows[("acme-api", "feat/x")]["dirty"])
        self.assertEqual(rows[("dotfiles", "main")]["pr"], "none")

    def test_inventory_gh_failure_shows_question_mark(self):
        self.gh_json.write_text("not json at all")
        rows = {(r["repo"], r["branch"]): r for r in json.loads(self.triage("--json").stdout)}
        self.assertEqual(rows[("acme-api", "feat/x")]["pr"], "?")

    def test_inventory_render_has_header_and_rows(self):
        out = self.triage().stdout
        self.assertIn("REPO", out.splitlines()[0])
        self.assertIn("feat/x", out)


class ReadOnlyTest(TriageTest):
    def test_read_only_triage_changes_nothing(self):
        before = self.snapshot()
        result = self.triage("--json")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.snapshot(), before)
        # gh was called once per repo, and that is the only network-facing call.
        self.assertEqual(len(self.gh_log.read_text().splitlines()), 2)


if __name__ == "__main__":
    unittest.main()
