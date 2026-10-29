"""Tests for scripts/bench and scripts/bench_lib (workflow benchmark harness). Stdlib only."""
import tempfile
import unittest
from pathlib import Path

import os
import subprocess

from scripts.bench_lib import arms, cli_log, events, prepare

ROOT = Path(__file__).resolve().parent.parent.parent
BENCH = ROOT / "scripts" / "bench"
FIXTURES = Path(__file__).resolve().parent / "fixtures" / "bench"


class Arms(unittest.TestCase):
    def test_review_arms_differ_only_in_reviewer(self):
        data = arms.load()
        resolved = [arms.resolve(n, data) for n in arms.REVIEW_ARMS]
        stripped = []
        for cfg in resolved:
            self.assertIn("reviewer", cfg)
            rest = {k: v for k, v in cfg.items() if k not in ("reviewer", "description")}
            stripped.append(rest)
        self.assertEqual(stripped[0], stripped[1])
        self.assertEqual(stripped[1], stripped[2])
        self.assertEqual(stripped[0]["implementer"], "opencode-go/claude-haiku-5-5:off")
        self.assertEqual(stripped[0]["max_rounds"], 3)
        self.assertNotEqual(resolved[0]["reviewer"], resolved[1]["reviewer"])
        self.assertNotEqual(resolved[1]["reviewer"], resolved[2]["reviewer"])

    def test_council_voices_at_medium(self):
        voices = arms.resolve("council")["reviewer"]["voices"]
        self.assertEqual([v["name"] for v in voices],
                         ["acceptance-criteria", "code-quality", "style", "security"])
        self.assertTrue(all(v["model"].endswith(":medium") for v in voices))
        self.assertEqual(voices[-1]["role"], "veto")


class Log(unittest.TestCase):
    def test_append_and_reject_unknown(self):
        with tempfile.TemporaryDirectory() as tmp:
            runs = Path(tmp)
            self.assertEqual(cli_log.log("t-a-1", "note", "hello", runs=runs), 0)
            path = runs / "t-a-1" / "events.jsonl"
            recs = events.read(path)
            self.assertEqual(len(recs), 1)
            for key in ("ts", "type", "detail"):
                self.assertIn(key, recs[0])
            self.assertEqual(recs[0]["detail"], "hello")
            before = path.read_text()
            self.assertEqual(cli_log.log("t-a-1", "bogus", "x", runs=runs), 2)
            self.assertEqual(path.read_text(), before)


class Prepare(unittest.TestCase):
    def _repo(self, tmp):
        """A temp git repo: base commit has a file; the archived spec sits at a path under docs/specs."""
        repo = Path(tmp) / "repo"
        repo.mkdir()
        env = {"GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t",
               "GIT_COMMITTER_EMAIL": "t@t", "PATH": os.environ["PATH"], "HOME": tmp}
        def g(*a):
            subprocess.run(["git", "-C", str(repo), *a], check=True, capture_output=True, env=env)
        g("init", "-q", "-b", "main")
        (repo / "app.txt").write_text("base\n")
        (repo / "docs" / "specs").mkdir(parents=True)
        (repo / "docs" / "specs" / "2026-01-01-demo.md").write_text(
            "---\nstatus: draft\nbranch: feat/demo\n---\n# SPEC: demo\n")
        g("add", "-A")
        g("commit", "-q", "-m", "base")
        (repo / "app.txt").write_text("changed\n")
        g("commit", "-qam", "change")
        return repo, env

    def test_worktree_at_base_with_spec(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo, _ = self._repo(tmp)
            base = subprocess.run(["git", "-C", str(repo), "rev-parse", "HEAD~1"],
                                  capture_output=True, text=True).stdout.strip()
            tasks = {"demo": {"spec": "docs/specs/2026-01-01-demo.md", "base": "HEAD~1", "reference": []}}
            runs = Path(tmp) / "runs"
            wt_root = Path(tmp) / "wt"
            out = prepare.prepare("demo", "council", 1, repo=repo, runs=runs, wt_root=wt_root, tasks=tasks)
            wt = Path(out["worktree"])
            self.assertEqual(out["run_id"], "demo-council-1")
            self.assertEqual((wt / "app.txt").read_text(), "base\n")
            self.assertEqual(out["base"], base)
            spec = (wt / "SPEC.md").read_text()
            self.assertIn("status: approved", spec)
            self.assertIn("# SPEC: demo", spec)
            run_dir = runs / "demo-council-1"
            self.assertEqual((run_dir / "events.jsonl").read_text(), "")
            self.assertTrue((run_dir / "meta.json").exists())
            self.assertIn("pi-view", out["command"])
            self.assertIn("bench-demo-council-1", out["command"])


if __name__ == "__main__":
    unittest.main()
