"""Tests for scripts/bench and scripts/bench_lib (workflow benchmark harness). Stdlib only."""
import tempfile
import unittest
from pathlib import Path

import json
import os
import subprocess

import random
import unittest.mock

from scripts.bench_lib import anonymize, arms, cli_log, collect, compare, events, loop, prepare, report, review

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
    def test_run_id_cannot_escape(self):
        for bad in ("../../etc", "a/b", "..", "", "x..y/z"):
            with self.assertRaises(events.BadRunId):
                events.check_run_id(bad)
        self.assertEqual(events.check_run_id("safety-block-log-council-1"), "safety-block-log-council-1")

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


class ReviewRun(unittest.TestCase):
    """End to end: a prepared run reviewed through the fake pi, logging rounds and writing REVIEW.md."""

    def _prepared(self, tmp, arm):
        repo = Path(tmp) / "repo"
        repo.mkdir()
        env = {"GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t",
               "GIT_COMMITTER_EMAIL": "t@t", "PATH": os.environ["PATH"], "HOME": tmp}
        def g(*a):
            subprocess.run(["git", "-C", str(repo), *a], check=True, capture_output=True, env=env)
        g("init", "-q", "-b", "main")
        (repo / "app.txt").write_text("base\n")
        (repo / "docs" / "specs").mkdir(parents=True)
        (repo / "docs" / "specs" / "d.md").write_text(
            "---\nstatus: draft\n---\n# SPEC: d\n\n## Acceptance Criteria\n- AC-1: app says changed\n")
        g("add", "-A")
        g("commit", "-q", "-m", "base")
        tasks = {"d": {"spec": "docs/specs/d.md", "base": "HEAD", "reference": []}}
        out = prepare.prepare("d", arm, 1, repo=repo, runs=Path(tmp) / "runs",
                              wt_root=Path(tmp) / "wt", tasks=tasks)
        (Path(out["worktree"]) / "app.txt").write_text("changed\n")
        return out["run_id"], Path(tmp) / "runs", Path(out["worktree"])

    def test_round_logged_and_review_md_written(self):
        with tempfile.TemporaryDirectory() as tmp:
            rid, runs, wt = self._prepared(tmp, "single-gpt")
            fake = str(FIXTURES / "fake-pi")
            old = os.environ.get("BENCH_PI_BIN")
            os.environ["BENCH_PI_BIN"] = fake
            os.environ["FAKE_PI_MODE"] = "nits"
            try:
                idx, action, result = review.review(rid, runs=runs)
            finally:
                os.environ.pop("FAKE_PI_MODE", None)
                if old is None:
                    os.environ.pop("BENCH_PI_BIN", None)
                else:
                    os.environ["BENCH_PI_BIN"] = old
            self.assertEqual(idx, 1)
            self.assertEqual(action, loop.STOP_NITS)
            recs = events.read(runs / rid / "events.jsonl")
            self.assertEqual([r["type"] for r in recs], ["review_round", "finding"])
            self.assertTrue((runs / rid / "findings-1.json").exists())
            first = (wt / "REVIEW.md").read_text().splitlines()[0]
            self.assertEqual(first, "[bench-review]")
            diff_text = review.diff_of(wt, "HEAD")
            self.assertIn("+changed", diff_text)

    def test_harness_files_stay_out_of_the_diff_and_rounds_keep_their_findings(self):
        with tempfile.TemporaryDirectory() as tmp:
            rid, runs, wt = self._prepared(tmp, "single-gpt")
            old = os.environ.get("BENCH_PI_BIN")
            os.environ["BENCH_PI_BIN"] = str(FIXTURES / "fake-pi")
            os.environ["FAKE_PI_MODE"] = "nits"
            try:
                review.review(rid, runs=runs)
                review.review(rid, runs=runs)
            finally:
                os.environ.pop("FAKE_PI_MODE", None)
                if old is None:
                    os.environ.pop("BENCH_PI_BIN", None)
                else:
                    os.environ["BENCH_PI_BIN"] = old
            diff_text = review.diff_of(wt, "HEAD")
            self.assertIn("+changed", diff_text)
            self.assertNotIn("REVIEW.md", diff_text)
            self.assertNotIn("SPEC.md", diff_text)
            rounds = review._prior_rounds(runs / rid)
            self.assertEqual(len(rounds), 2)
            self.assertEqual([len(r["findings"]) for r in rounds], [1, 1])

    def test_malformed_output_logs_note_and_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            rid, runs, _ = self._prepared(tmp, "single-deepseek")
            old = os.environ.get("BENCH_PI_BIN")
            os.environ["BENCH_PI_BIN"] = str(FIXTURES / "fake-pi")
            os.environ["FAKE_PI_MODE"] = "garbage"
            try:
                idx, action, result = review.review(rid, runs=runs)
            finally:
                os.environ.pop("FAKE_PI_MODE", None)
                if old is None:
                    os.environ.pop("BENCH_PI_BIN", None)
                else:
                    os.environ["BENCH_PI_BIN"] = old
            self.assertEqual(result["verdict"], "fail")
            types = [r["type"] for r in events.read(runs / rid / "events.jsonl")]
            self.assertIn("note", types)
            self.assertIn("review_round", types)


class Collect(unittest.TestCase):
    def test_steer_from_session(self):
        steers, tokens, cost = collect.read_session(FIXTURES / "session-sample.jsonl")
        # First user message is the brief, not steering. The [bench-review] message is the
        # harness's own, not steering. The custom_message is an extension injection, not steering.
        self.assertEqual(steers, ["The log path is wrong, fix it.", "Also rename the flag."])
        self.assertEqual(tokens, 150 + 110 + 80)
        self.assertAlmostEqual(cost, 0.0021 + 0.0015 + 0.0009, places=6)

    def test_collect_writes_events_diff_and_is_idempotent(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            repo = tmp / "repo"
            repo.mkdir()
            env = {"GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t",
                   "GIT_COMMITTER_EMAIL": "t@t", "PATH": os.environ["PATH"], "HOME": str(tmp)}
            def g(*a):
                subprocess.run(["git", "-C", str(repo), *a], check=True, capture_output=True, env=env)
            g("init", "-q", "-b", "main")
            (repo / "a.txt").write_text("one\n")
            g("add", "-A")
            g("commit", "-q", "-m", "base")
            wt = tmp / "wt"
            g("worktree", "add", "-q", "--detach", str(wt), "HEAD")
            (wt / "a.txt").write_text("two\n")
            run_id = "demo-single-gpt-1"
            runs = tmp / "runs"
            (runs / run_id).mkdir(parents=True)
            base = subprocess.run(["git", "-C", str(repo), "rev-parse", "HEAD"],
                                  capture_output=True, text=True).stdout.strip()
            (runs / run_id / "meta.json").write_text(json.dumps(
                {"run_id": run_id, "worktree": str(wt), "base": base}))
            (runs / run_id / "events.jsonl").write_text("")
            events.append(runs / run_id / "events.jsonl", "note", "a manual note")
            sessions = tmp / "sessions" / "enc"
            sessions.mkdir(parents=True)
            (sessions / f"2026-10-29_bench-{run_id}-abc.jsonl").write_text(
                (FIXTURES / "session-sample.jsonl").read_text())

            out1 = collect.collect(run_id, runs, sessions=tmp / "sessions")
            out2 = collect.collect(run_id, runs, sessions=tmp / "sessions")
            recs = events.read(runs / run_id / "events.jsonl")
            steer = [r for r in recs if r["type"] == "steer"]
            self.assertEqual(len(steer), 2)
            self.assertEqual(out1["steers"], 2)
            self.assertEqual(len(steer), out2["steers"])
            self.assertEqual(len([r for r in recs if r["type"] == "note"]), 1)
            diff = (runs / run_id / "final.diff").read_text()
            self.assertIn("+two", diff)
            meta = json.loads((runs / run_id / "meta.json").read_text())
            self.assertEqual(meta["tokens"], 340)


class Anonymize(unittest.TestCase):
    def test_no_arm_leak(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            runs = tmp / "runs"
            for rid, arm in (("t-council-1", "council"), ("t-single-gpt-1", "single-gpt")):
                d = runs / rid
                d.mkdir(parents=True)
                (d / "meta.json").write_text(json.dumps({"task": "t", "arm": arm, "run_id": rid,
                                                         "base": "b", "worktree": "w", "tokens": 1, "cost": 0}))
                (d / "final.diff").write_text(f"+ used {arm} via openai-codex/gpt-6.1-sol and {rid}\n")
                (d / "findings-1.json").write_text(json.dumps({"verdict": "fail", "findings": [
                    {"file": "a", "line": 1, "severity": "major", "ac": "AC-1",
                     "failure_scenario": f"{arm} reviewer said so"}]}))
                (d / "events.jsonl").write_text("")
            grading = tmp / "grading"
            sealed = grading / ".sealed-map.json"
            n = anonymize.anonymize(runs=runs, grading=grading, sealed=sealed, rng=random.Random(1))
            self.assertEqual(n, 2)
            for item in grading.iterdir():
                if not item.is_dir():
                    continue
                blob = "".join(p.read_text() for p in item.iterdir())
                for needle in ("council", "single-gpt", "t-council-1", "t-single-gpt-1",
                               "gpt-6.1-sol", "openai-codex"):
                    self.assertNotIn(needle, blob)
            self.assertTrue(sealed.exists())
            self.assertIn("t-council-1", sealed.read_text())
            for item in grading.iterdir():
                if item.is_dir():
                    self.assertNotIn(".sealed-map", [p.name for p in item.iterdir()])


class Report(unittest.TestCase):
    def _setup(self, tmp, graded):
        tmp = Path(tmp)
        runs = tmp / "runs"
        grading = tmp / "grading"
        grading.mkdir(parents=True)
        sealed = grading / ".sealed-map.json"
        seal = {}
        for i, (rid, arm) in enumerate((("t-council-1", "council"), ("t-single-gpt-1", "single-gpt")), 1):
            d = runs / rid
            d.mkdir(parents=True)
            (d / "meta.json").write_text(json.dumps({"task": "t", "arm": arm, "run_id": rid, "base": "b",
                                                     "worktree": "w", "tokens": 100 * i, "cost": 0.01 * i}))
            events.append(d / "events.jsonl", "steer", "fix it")
            events.append(d / "events.jsonl", "review_round", "round 1: fail, 1 findings")
            item = grading / f"item{i}"
            item.mkdir()
            grades = {"classes": list(anonymize.CLASSES),
                      "human": {"rubric": dict.fromkeys(anonymize.RUBRIC, 4),
                                "findings": {"f1": "real"}},
                      "judge": {"rubric": dict.fromkeys(anonymize.RUBRIC, 3),
                                "findings": {"f1": "nit"}}}
            if not graded:
                grades["judge"]["rubric"]["correctness"] = None
            (item / "grades-template.json").write_text(json.dumps(grades))
            seal[item.name] = rid
        sealed.write_text(json.dumps(seal))
        return runs, grading, sealed

    def test_sealed_until_graded(self):
        with tempfile.TemporaryDirectory() as tmp:
            runs, grading, sealed = self._setup(tmp, graded=False)
            with self.assertRaises(report.NotGraded):
                report.report(grading, sealed, runs)

    def test_per_arm_summary(self):
        with tempfile.TemporaryDirectory() as tmp:
            runs, grading, sealed = self._setup(tmp, graded=True)
            text = report.report(grading, sealed, runs)
            self.assertIn("== council", text)
            self.assertIn("== single-gpt", text)
            self.assertIn("steers", text)
            self.assertIn("review_rounds", text)
            self.assertIn("finding classes", text)
            self.assertIn("rubric (human)", text)
            self.assertIn("rubric (judge)", text)
            self.assertIn("real=1", text)


class Compare(unittest.TestCase):
    RUNS = {"d-council-1": True, "d-single-gpt-1": True, "d-send-it-1": False}

    def _runs(self, tmp):
        runs = Path(tmp) / "runs"
        for rid, has_file in self.RUNS.items():
            wt = Path(tmp) / "wt" / rid
            (wt / "src").mkdir(parents=True)
            if has_file:
                (wt / "src" / "app.py").write_text("def handle(x):\n    return x\n")
            (runs / rid).mkdir(parents=True)
            meta = {"task": "d", "arm": rid[2:-2], "run_id": rid, "worktree": str(wt)}
            (runs / rid / "meta.json").write_text(json.dumps(meta))
        return runs

    def test_blind_copies(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = compare.compare("d", "src/app.py", runs=self._runs(tmp), out_root=Path(tmp) / "cmp")
            out_dir = Path(out["dir"])
            copies = sorted(p for p in out_dir.iterdir() if not p.name.startswith("."))
            self.assertEqual(len(copies), 2)
            self.assertEqual(len(out["absent"]), 1)
            sealed = json.loads((out_dir / ".sealed-map.json").read_text())
            self.assertEqual(set(sealed), {p.stem for p in copies} | set(out["absent"]))
            for p in copies:
                for rid in self.RUNS:
                    self.assertNotIn(rid, str(p.relative_to(tmp)) + p.read_text())
                self.assertIn(str(p), out["command"])
            self.assertTrue(out["command"].startswith("nvim -O "))
            for rid in self.RUNS:
                self.assertNotIn(rid, out["command"])

    def test_ids_distinct_from_grading(self):
        with tempfile.TemporaryDirectory() as tmp:
            grading_map = Path(tmp) / "grading-map.json"
            grading_map.write_text(json.dumps({"aaaa0001": "d-council-1"}))
            ids = iter(["aaaa0001", "bbbb0002", "cccc0003", "dddd0004"])
            with unittest.mock.patch.object(compare.secrets, "token_hex", lambda n: next(ids)):
                out = compare.compare("d", "src/app.py", runs=self._runs(tmp),
                                      out_root=Path(tmp) / "cmp", grading_map=grading_map)
            sealed = json.loads((Path(out["dir"]) / ".sealed-map.json").read_text())
            self.assertNotIn("aaaa0001", sealed)
            self.assertEqual(len(sealed), 3)


if __name__ == "__main__":
    unittest.main()
