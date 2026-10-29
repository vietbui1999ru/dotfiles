"""Tests for scripts/bench and scripts/bench_lib (workflow benchmark harness). Stdlib only."""
import tempfile
import unittest
from pathlib import Path

import json
import os
import subprocess

from scripts.bench_lib import arms, cli_log, events, loop, prepare, review

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


class Review(unittest.TestCase):
    ACS = ["- AC-1: block logging for safety events", "- AC-2: rotate the log file"]

    def test_reviewer_input_and_flags(self):
        seen = {}
        def caller(model, prompt):
            seen["model"], seen["prompt"] = model, prompt
            return '{"verdict":"pass","findings":[]}'
        template = "REVIEW TEMPLATE"
        diff = "+added line\n"
        review.review_once("m:medium", template, self.ACS, diff, caller)
        self.assertIn("REVIEW TEMPLATE", seen["prompt"])
        self.assertIn("- AC-1: block logging for safety events", seen["prompt"])
        self.assertIn("+added line", seen["prompt"])
        self.assertNotIn("transcript", seen["prompt"].lower())
        self.assertNotIn("plan", seen["prompt"].lower())
        # The real call site builds the exact flag set.
        with tempfile.TemporaryDirectory() as tmp:
            fake = Path(tmp) / "pi"
            argv_log = Path(tmp) / "argv.json"
            fake.write_text(
                "#!/usr/bin/env python3\nimport json,os,sys\n"
                f"open({str(argv_log)!r},'w').write(json.dumps({{'argv':sys.argv[1:],"
                "'routing':os.environ.get('PI_ROUTING_FILE')}))\n"
                "print('{\"verdict\":\"pass\",\"findings\":[]}')\n")
            fake.chmod(0o755)
            old = os.environ.get("BENCH_PI_BIN")
            os.environ["BENCH_PI_BIN"] = str(fake)
            try:
                review.call_pi("x/y:medium", "hello", routing=Path(tmp) / "r.env")
            finally:
                if old is None:
                    os.environ.pop("BENCH_PI_BIN", None)
                else:
                    os.environ["BENCH_PI_BIN"] = old
            rec = json.loads(argv_log.read_text())
            for flag in ("--no-session", "--no-extensions", "--no-skills", "-p"):
                self.assertIn(flag, rec["argv"])
            self.assertEqual(rec["argv"][rec["argv"].index("--model") + 1], "x/y:medium")
            self.assertTrue(rec["routing"].endswith("r.env"))

    def test_parse_findings(self):
        good = ('{"verdict":"fail","findings":[{"file":"a.py","line":3,"severity":"major",'
                '"ac":"AC-1","failure_scenario":"crashes on empty input"}]}')
        verdict, findings = review.parse_findings(good)
        self.assertEqual(verdict, "fail")
        self.assertEqual(set(findings[0]),
                         {"file", "line", "severity", "ac", "failure_scenario"})
        self.assertEqual(findings[0]["ac"], "AC-1")
        for bad in ("not json", '{"verdict":"maybe","findings":[]}',
                    '{"verdict":"fail","findings":[{"file":"a"}]}'):
            with self.assertRaises((ValueError, json.JSONDecodeError)):
                review.parse_findings(bad)

    def test_malformed_output_is_fail_and_noted(self):
        result = review.review_once("m", "t", self.ACS, "d", lambda m, p: "garbage")
        self.assertEqual(result["verdict"], "fail")
        self.assertEqual(result["findings"], [])
        self.assertFalse(result["ok"])

    def test_council_majority_and_veto(self):
        ok = {"verdict": "pass", "findings": [], "ok": True}
        bad = {"verdict": "fail", "findings": [{"file": "f", "line": 1, "severity": "major",
                                                "ac": None, "failure_scenario": "x"}], "ok": True}
        votes = [("a", "voice", ok), ("b", "voice", bad), ("c", "voice", bad), ("s", "veto", ok)]
        self.assertEqual(review.merge_council(votes)["verdict"], "fail")
        votes = [("a", "voice", ok), ("b", "voice", bad), ("c", "voice", ok), ("s", "veto", ok)]
        self.assertEqual(review.merge_council(votes)["verdict"], "pass")
        votes = [("a", "voice", ok), ("b", "voice", ok), ("c", "voice", ok), ("s", "veto", bad)]
        self.assertEqual(review.merge_council(votes)["verdict"], "fail")


class Loop(unittest.TestCase):
    def test_stop_conditions(self):
        P = {"verdict": "pass", "findings": []}
        F = {"verdict": "fail", "findings": [{"severity": "major"}]}
        N = {"verdict": "fail", "findings": [{"severity": "nit"}, {"severity": "nit"}]}
        self.assertEqual(loop.next_action([], 3), loop.CONTINUE)
        self.assertEqual(loop.next_action([F], 3), loop.CONTINUE)
        self.assertEqual(loop.next_action([F, P], 3), loop.STOP_PASSED)
        self.assertEqual(loop.next_action([F, N], 3), loop.STOP_NITS)
        self.assertEqual(loop.next_action([F, F, F], 3), loop.STOP_CAP)
        self.assertEqual(loop.next_action([F, F], 3), loop.CONTINUE)


if __name__ == "__main__":
    unittest.main()
