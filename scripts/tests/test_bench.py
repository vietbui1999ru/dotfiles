"""Tests for scripts/bench and scripts/bench_lib (workflow benchmark harness). Stdlib only."""
import tempfile
import unittest
from pathlib import Path

from scripts.bench_lib import arms, cli_log, events

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


if __name__ == "__main__":
    unittest.main()
