"""Phase 3 tests for scripts/headroom-measure (SPEC: feat/headroom, AC-7).

Every case writes JSONL samples into a temporary directory and runs the CLI as a
subprocess. Only counters and metadata are involved: no provider traffic, no
credentials and no raw prompt or response text. Stdlib only.
"""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent
CLI = SCRIPTS / "headroom-measure"

RATES = {
    "source": "test fixture rates, not a real price list",
    "date": "2026-11-03",
    "currency": "USD",
    "per_million": {
        "uncached_input": 3.0,
        "cache_read": 0.3,
        "cache_write": 3.75,
        "output": 15.0,
    },
}


def sample(**overrides):
    """A complete, valid sample; tests override only what they exercise."""
    base = {
        "workflow": "fix-tests",
        "provider": "anthropic",
        "model": "claude-x",
        "mode": "direct",
        "run_id": "r1",
        "turn": 1,
        "input_tokens": 1000,
        "cache_read_tokens": 0,
        "cache_write_tokens": 0,
        "output_tokens": 100,
        "latency_ms": 500.0,
        "errors": 0,
        "correctness": "pass",
        "billing": "api",
    }
    base.update(overrides)
    return base


class MeasureCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)

    def run_cli(self, samples=(), pricing=None, raw_lines=None):
        path = self.dir / "samples.jsonl"
        if raw_lines is not None:
            path.write_text("\n".join(raw_lines) + "\n", encoding="utf-8")
        else:
            path.write_text(
                "".join(json.dumps(s) + "\n" for s in samples), encoding="utf-8")
        argv = [sys.executable, str(CLI)]
        if pricing is not None:
            ppath = self.dir / "pricing.json"
            ppath.write_text(json.dumps(pricing), encoding="utf-8")
            argv += ["--pricing", str(ppath)]
        argv.append(str(path))
        return subprocess.run(argv, capture_output=True, text=True)

    def measure(self, samples, pricing=None):
        result = self.run_cli(samples, pricing)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def rejected(self, samples=(), raw_lines=None, pricing=None, expect=()):
        result = self.run_cli(samples, pricing, raw_lines)
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        for needle in expect:
            self.assertIn(needle, result.stderr)
        self.assertEqual(result.stdout, "")

    @staticmethod
    def group(report, model):
        for entry in report["groups"]:
            if entry["model"] == model:
                return entry
        raise AssertionError(f"no group for model {model!r}: {report}")

    @staticmethod
    def comparison(entry, baseline, variant):
        for item in entry["comparisons"]:
            if item["baseline"] == baseline and item["variant"] == variant:
                return item
        raise AssertionError(f"no {baseline}->{variant} comparison: {entry}")


class TestGrouping(MeasureCase):
    def test_groups_by_provider_model_workflow(self):
        report = self.measure([
            sample(mode="direct", turn=1, input_tokens=1000, output_tokens=100,
                   latency_ms=400.0),
            sample(mode="direct", turn=2, input_tokens=2000, output_tokens=200,
                   latency_ms=600.0),
            sample(mode="cache", turn=1, input_tokens=900, cache_read_tokens=800,
                   output_tokens=100, latency_ms=300.0),
            sample(mode="cache", turn=2, input_tokens=1800, cache_read_tokens=1600,
                   output_tokens=200, latency_ms=500.0, correctness="fail"),
            sample(provider="openai-codex", model="gpt-5", correctness="unverified"),
        ])
        self.assertEqual(report["samples"], 5)
        self.assertEqual(len(report["groups"]), 2)

        anthropic = self.group(report, "claude-x")
        self.assertEqual(anthropic["provider"], "anthropic")
        self.assertEqual(anthropic["workflow"], "fix-tests")
        self.assertEqual(anthropic["missing_modes"], ["passthrough"])

        direct = anthropic["modes"]["direct"]
        self.assertEqual(direct["count"], 2)
        self.assertEqual(direct["tokens"]["input"], 3000)
        self.assertEqual(direct["tokens"]["cache_read"], 0)
        self.assertEqual(direct["tokens"]["uncached_input"], 3000)
        self.assertEqual(direct["tokens"]["output"], 300)
        self.assertEqual(direct["errors"], 0)
        self.assertAlmostEqual(direct["mean_latency_ms"], 500.0)
        self.assertEqual(direct["correctness"], {"pass": 2, "fail": 0, "unverified": 0})
        self.assertTrue(direct["correctness_complete"])

        cache = anthropic["modes"]["cache"]
        self.assertEqual(cache["tokens"]["input"], 2700)
        self.assertEqual(cache["tokens"]["cache_read"], 2400)
        self.assertEqual(cache["tokens"]["uncached_input"], 300)
        self.assertEqual(cache["correctness"], {"pass": 1, "fail": 1, "unverified": 0})
        self.assertTrue(cache["correctness_complete"])

        # A failed run blocks a win but stays in the totals.
        self.assertEqual(self.comparison(anthropic, "direct", "cache")["verdict"],
                         "withheld")

        codex = self.group(report, "gpt-5")
        self.assertEqual(codex["missing_modes"], ["passthrough", "cache"])
        self.assertFalse(codex["modes"]["direct"]["correctness_complete"])
        self.assertEqual(codex["comparisons"], [])

    def test_output_is_compact_json(self):
        result = self.run_cli([sample()])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(result.stdout.strip().splitlines()), 1)
        json.loads(result.stdout)


class TestCost(MeasureCase):
    def test_lost_cache_reads_are_a_regression(self):
        samples = [
            sample(mode="passthrough", turn=1, input_tokens=10000,
                   cache_read_tokens=9000, output_tokens=1000),
            sample(mode="passthrough", turn=2, input_tokens=10000,
                   cache_read_tokens=9000, output_tokens=1000),
            sample(mode="cache", turn=1, input_tokens=8000, cache_read_tokens=0,
                   output_tokens=1000),
            sample(mode="cache", turn=2, input_tokens=8000, cache_read_tokens=0,
                   output_tokens=1000),
        ]
        report = self.measure(samples, RATES)
        entry = self.group(report, "claude-x")
        passthrough = entry["modes"]["passthrough"]["cost"]
        cache = entry["modes"]["cache"]["cost"]
        self.assertAlmostEqual(passthrough["total"], 0.0414, places=6)
        self.assertAlmostEqual(cache["total"], 0.078, places=6)

        cmp = self.comparison(entry, "passthrough", "cache")
        self.assertEqual(cmp["verdict"], "regression")
        self.assertEqual(cmp["basis"], "cost")
        # Fewer total input tokens...
        self.assertEqual(cmp["delta"]["total_input"]["delta"], -4000)
        # ...but a higher bill, because the cache reads were lost.
        self.assertGreater(cmp["delta"]["cost"]["delta"], 0)
        self.assertIn("cache_read", cmp["note"])

    def test_kept_cache_reads_are_a_reduction(self):
        samples = [
            sample(mode="passthrough", turn=1, input_tokens=10000,
                   cache_read_tokens=9000, output_tokens=1000),
            sample(mode="cache", turn=1, input_tokens=10000,
                   cache_read_tokens=9500, output_tokens=1000),
        ]
        entry = self.group(self.measure(samples, RATES), "claude-x")
        cmp = self.comparison(entry, "passthrough", "cache")
        self.assertEqual(cmp["verdict"], "reduction")
        self.assertEqual(cmp["basis"], "cost")
        self.assertLess(cmp["delta"]["cost"]["delta"], 0)
        self.assertEqual(cmp["delta"]["total_input"]["delta"], 0)
        self.assertEqual(cmp["delta"]["uncached_input"]["delta"], -500)

    def test_omitted_rates_are_unknown_not_zero(self):
        samples = [
            sample(mode="direct", turn=1),
            sample(mode="cache", turn=1, input_tokens=900, cache_read_tokens=800),
        ]
        entry = self.group(self.measure(samples), "claude-x")
        self.assertEqual(entry["modes"]["direct"]["cost"], "unknown")
        self.assertEqual(entry["modes"]["cache"]["cost"], "unknown")
        cmp = self.comparison(entry, "direct", "cache")
        self.assertEqual(cmp["basis"], "uncached_input_tokens")
        self.assertIsNone(cmp["delta"]["cost"])

        partial = json.loads(json.dumps(RATES))
        del partial["per_million"]["cache_write"]
        entry = self.group(self.measure(samples, partial), "claude-x")
        self.assertEqual(entry["modes"]["cache"]["cost"], "unknown")

    def test_pricing_requires_source_and_date(self):
        for missing in ("source", "date"):
            with self.subTest(missing=missing):
                pricing = json.loads(json.dumps(RATES))
                del pricing[missing]
                self.rejected([sample()], pricing=pricing, expect=[missing])

    def test_negative_or_nonfinite_rate_is_rejected(self):
        for value in (-1.0, float("inf")):
            with self.subTest(value=value):
                pricing = json.loads(json.dumps(RATES))
                pricing["per_million"]["output"] = value
                self.rejected([sample()], pricing=pricing,
                              expect=["per_million", "output"])

    def test_subscription_runs_are_not_dollar_savings(self):
        samples = [
            sample(mode="direct", turn=1, billing="subscription"),
            sample(mode="cache", turn=1, billing="subscription",
                   input_tokens=900, cache_read_tokens=800),
        ]
        report = self.measure(samples, RATES)
        entry = self.group(report, "claude-x")
        self.assertEqual(entry["modes"]["direct"]["cost"], "subscription")
        self.assertEqual(entry["modes"]["cache"]["cost"], "subscription")
        cmp = self.comparison(entry, "direct", "cache")
        self.assertEqual(cmp["basis"], "uncached_input_tokens")
        self.assertIsNone(cmp["delta"]["cost"])
        text = json.dumps(report)
        self.assertNotIn("savings", text)
        # No dollar amount anywhere: no cost total, no currency, no rate list.
        self.assertNotIn('"total"', text)
        self.assertNotIn('"currency"', text)
        self.assertNotIn('"per_million"', text)

    def test_unstated_billing_is_unknown_cost(self):
        samples = [sample(mode="direct"), sample(mode="cache", turn=1)]
        for item in samples:
            del item["billing"]
        entry = self.group(self.measure(samples, RATES), "claude-x")
        self.assertEqual(entry["modes"]["direct"]["cost"], "unknown")


class TestComparability(MeasureCase):
    def test_unmatched_runs_are_not_compared(self):
        samples = [
            sample(mode="direct", turn=1),
            sample(mode="direct", turn=2),
            sample(mode="cache", turn=1, input_tokens=900, cache_read_tokens=800),
            sample(mode="cache", turn=3, input_tokens=900, cache_read_tokens=800),
        ]
        entry = self.group(self.measure(samples, RATES), "claude-x")
        cmp = self.comparison(entry, "direct", "cache")
        self.assertEqual(cmp["matched_pairs"], 1)
        self.assertEqual(cmp["baseline_only"], 1)
        self.assertEqual(cmp["variant_only"], 1)
        self.assertFalse(cmp["complete"])
        self.assertEqual(cmp["verdict"], "withheld")
        self.assertIsNone(cmp["delta"])

    def test_unverified_is_never_a_win(self):
        samples = [
            sample(mode="direct", turn=1),
            sample(mode="cache", turn=1, input_tokens=900, cache_read_tokens=800,
                   correctness="unverified"),
        ]
        entry = self.group(self.measure(samples, RATES), "claude-x")
        self.assertFalse(entry["modes"]["cache"]["correctness_complete"])
        cmp = self.comparison(entry, "direct", "cache")
        self.assertEqual(cmp["verdict"], "withheld")
        self.assertIsNone(cmp["delta"])

    def test_failed_pairs_block_a_win_but_stay_counted(self):
        samples = [
            sample(mode="direct", turn=1),
            sample(mode="cache", turn=1, input_tokens=900, cache_read_tokens=800,
                   correctness="fail"),
        ]
        entry = self.group(self.measure(samples, RATES), "claude-x")
        cmp = self.comparison(entry, "direct", "cache")
        self.assertEqual(cmp["failed_pairs"], 1)
        self.assertEqual(cmp["verdict"], "withheld")
        self.assertEqual(entry["modes"]["cache"]["correctness"]["fail"], 1)

    def test_different_models_are_never_compared(self):
        samples = [
            sample(mode="direct", model="claude-x"),
            sample(mode="cache", model="claude-y", input_tokens=900,
                   cache_read_tokens=800),
        ]
        report = self.measure(samples, RATES)
        self.assertEqual(len(report["groups"]), 2)
        for entry in report["groups"]:
            self.assertEqual(entry["comparisons"], [])
            self.assertEqual(len(entry["missing_modes"]), 2)


class TestValidation(MeasureCase):
    def test_negative_counts_are_rejected(self):
        for field in ("input_tokens", "cache_read_tokens", "cache_write_tokens",
                      "output_tokens", "errors", "latency_ms", "turn"):
            with self.subTest(field=field):
                self.rejected([sample(**{field: -1})], expect=[field, "negative"])

    def test_inconsistent_uncached_input_is_rejected(self):
        self.rejected([sample(input_tokens=100, cache_read_tokens=80,
                              cache_write_tokens=80)],
                      expect=["uncached", "input_tokens"])

    def test_nonfinite_latency_is_rejected(self):
        line = json.dumps(sample())
        line = line.replace('"latency_ms": 500.0', '"latency_ms": NaN')
        self.rejected(raw_lines=[line], expect=["latency_ms", "finite"])

    def test_duplicate_samples_are_rejected(self):
        self.rejected([sample(), sample()],
                      expect=["duplicate", "direct", "r1"])

    def test_unknown_mode_is_rejected(self):
        self.rejected([sample(mode="compressed")], expect=["mode", "compressed"])

    def test_unknown_correctness_is_rejected(self):
        self.rejected([sample(correctness="maybe")], expect=["correctness", "maybe"])

    def test_missing_field_is_rejected(self):
        item = sample()
        del item["output_tokens"]
        self.rejected([item], expect=["output_tokens", "missing"])

    def test_non_string_workflow_is_rejected(self):
        self.rejected([sample(workflow=7)], expect=["workflow"])

    def test_bad_json_line_names_the_line(self):
        self.rejected(raw_lines=['{"workflow": '], expect=["line 1", "JSON"])


if __name__ == "__main__":
    unittest.main()
