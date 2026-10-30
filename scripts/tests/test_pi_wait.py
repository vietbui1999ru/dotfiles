"""Tests for scripts/pi-wait: the mechanical waits that release queued steps.

Run: python3 scripts/tests/test_pi_wait.py

Every external command goes through a stub binary named by the plan's env seam
(PI_QUEUE_PUEUE, PI_QUEUE_GH, PI_QUEUE_AC_RUN, PI_QUEUE_PI_OUTCOME, ...), so the
tests never touch the real pueue daemon, GitHub, ac-run or a live review ledger.
"""

import json
import os
import subprocess
import tempfile
import threading
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent.parent
PI_WAIT = REPO / "scripts" / "pi-wait"

# One stub binary template: record every argv as JSONL, then run the command's body.
STUB = """#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
root = Path(os.environ["PI_TEST_STUB"])
with (root / "{name}.calls").open("a") as f:
    f.write(json.dumps(sys.argv[1:]) + "\\n")
args = sys.argv[1:]
def fixture(file, default=None):
    path = root / file
    return json.loads(path.read_text()) if path.exists() else default
def emit(value):
    print(value if isinstance(value, str) else json.dumps(value))
{body}
"""

PUEUE = """
if args[:1] == ["enqueue"]:
    ids = [word for word in args[1:] if word.isdigit()]
    with (root / "enqueued.log").open("a") as f:
        for word in ids:
            f.write(word + "\\n")
sys.exit(fixture("pueue.code", 0))
"""

GH = """
emit(fixture("gh.json", {"state": "OPEN"}))
sys.exit(fixture("gh.code", 0))
"""

AC_RUN = """
emit(fixture("ac-run.out", "draft (no record)"))
sys.exit(fixture("ac-run.code", 3))
"""

PI_OUTCOME = """
emit(fixture("pi-outcome.json", {}))
sys.exit(fixture("pi-outcome.code", 0))
"""


class PiWait(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.bin = self.tmp / "bin"
        self.stub = self.tmp / "stub"
        self.state = self.tmp / "state"
        self.home = self.tmp / "home"
        for directory in (self.bin, self.stub, self.state, self.home):
            directory.mkdir(parents=True)
        for name, body in (
            ("pueue", PUEUE),
            ("gh", GH),
            ("ac-run", AC_RUN),
            ("pi-outcome", PI_OUTCOME),
            ("herdr", "sys.exit(0)"),
            ("claude", "sys.exit(0)"),
            ("pi-view", "sys.exit(0)"),
        ):
            path = self.bin / name
            path.write_text(STUB.format(name=name, body=body))
            path.chmod(0o755)
        self.env = dict(os.environ)
        self.env.update({
            "HOME": str(self.home),
            "PI_QUEUE_PUEUE": str(self.bin / "pueue"),
            "PI_QUEUE_GH": str(self.bin / "gh"),
            "PI_QUEUE_AC_RUN": str(self.bin / "ac-run"),
            "PI_QUEUE_PI_OUTCOME": str(self.bin / "pi-outcome"),
            "PI_QUEUE_HERDR": str(self.bin / "herdr"),
            "PI_QUEUE_CLAUDE": str(self.bin / "claude"),
            "PI_QUEUE_PI_VIEW": str(self.bin / "pi-view"),
            "PI_QUEUE_STATE": str(self.state),
            "PI_TEST_STUB": str(self.stub),
        })

    def tearDown(self):
        self._tmp.cleanup()

    def fixture(self, name, value):
        (self.stub / name).write_text(json.dumps(value))

    def calls(self, name):
        path = self.stub / f"{name}.calls"
        if not path.exists():
            return []
        return [json.loads(line) for line in path.read_text().splitlines() if line]

    def enqueued(self):
        path = self.stub / "enqueued.log"
        if not path.exists():
            return []
        return [int(line) for line in path.read_text().splitlines() if line]

    def events(self):
        path = self.state / "events.jsonl"
        if not path.exists():
            return []
        return [json.loads(line) for line in path.read_text().splitlines() if line]

    def wait(self, *args):
        return subprocess.run(
            [str(PI_WAIT), *args],
            env=self.env,
            capture_output=True,
            text=True,
            timeout=30,
        )

    def assert_event(self, event, **fields):
        found = [item for item in self.events() if item.get("event") == event]
        self.assertTrue(found, f"no {event} event in {self.events()}")
        last = found[-1]
        for key, value in fields.items():
            self.assertEqual(last.get(key), value, f"{key} in {last}")
        for key in ("time", "session", "workflow", "template", "step", "executor", "task"):
            self.assertIn(key, last, f"{key} missing from {last}")

    def test_pr_merged(self):
        # AC-1: MERGED releases the ids; CLOSED unmerged and a timeout release nothing.
        self.fixture("gh.json", {"state": "MERGED"})
        result = self.wait("pr-merged", "7", "--release", "12", "13")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.enqueued(), [12, 13])
        self.assert_event("released", executor="wait", task="12,13")
        self.assertEqual(self.calls("gh")[-1], ["pr", "view", "7", "--json", "state"])
        self.assertEqual(self.calls("pueue")[-1], ["enqueue", "12", "13"])

        self.fixture("gh.json", {"state": "CLOSED"})
        (self.stub / "enqueued.log").unlink()
        result = self.wait("pr-merged", "7", "--release", "12", "13")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.enqueued(), [])
        self.assert_event("failed", executor="wait")

        self.fixture("gh.json", {"state": "OPEN"})
        result = self.wait("pr-merged", "7", "--release", "12", "--timeout", "0.2", "--interval", "0.05")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.enqueued(), [])

    def test_spec_approved(self):
        # AC-2: an approved record releases; the wait only ever reads the gate's status.
        self.fixture("ac-run.out", "approved (record matches)")
        self.fixture("ac-run.code", 0)
        result = self.wait("spec-approved", "SPEC.md", "--release", "4")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.enqueued(), [4])
        self.assert_event("released", executor="wait")
        for argv in self.calls("ac-run"):
            self.assertEqual(argv[0], "status", argv)

        self.fixture("ac-run.out", "draft (no record)")
        self.fixture("ac-run.code", 3)
        (self.stub / "enqueued.log").unlink()
        result = self.wait("spec-approved", "SPEC.md", "--release", "4", "--timeout", "0.2", "--interval", "0.05")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.enqueued(), [])
        self.assert_event("failed", executor="wait")
        for argv in self.calls("ac-run"):
            self.assertNotIn("approve", argv)

    def test_outcome(self):
        # AC-3: the requested outcome releases; killed, failed and exhausted checks do not.
        self.fixture("pi-outcome.json", {"id": 3, "outcome": "checks passed", "round": 1})
        result = self.wait("outcome", "3", "checks passed", "--release", "8")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.enqueued(), [8])
        self.assert_event("released", executor="wait")
        self.assertEqual(self.calls("pi-outcome")[-1], ["3", "--json"])

        for outcome in (
            {"id": 3, "outcome": "killed"},
            {"id": 3, "outcome": "failed"},
            {"id": 3, "outcome": "checks failed", "round": 3},
        ):
            self.fixture("pi-outcome.json", outcome)
            if (self.stub / "enqueued.log").exists():
                (self.stub / "enqueued.log").unlink()
            result = self.wait("outcome", "3", "checks passed", "--release", "8", "--timeout", "0.2", "--interval", "0.05")
            self.assertNotEqual(result.returncode, 0, outcome)
            self.assertEqual(self.enqueued(), [], outcome)
            self.assert_event("failed", executor="wait")

        # `checks failed` round 1 is still fixing: wait, do not release, then time out.
        self.fixture("pi-outcome.json", {"id": 3, "outcome": "checks failed", "round": 1})
        result = self.wait("outcome", "3", "checks failed", "--release", "8", "--timeout", "0.2", "--interval", "0.05")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.enqueued(), [])

        # The checks-exhausted template waits for `checks failed` itself, at round 3.
        self.fixture("pi-outcome.json", {"id": 3, "outcome": "checks failed", "round": 3})
        result = self.wait("outcome", "3", "checks failed", "--release", "8")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.enqueued(), [8])

    def test_review_decided(self):
        # AC-4: only this run's pending record under .pi/agent-review/pending/ decides.
        worktree = self.tmp / "wt"
        pending = worktree / ".pi" / "agent-review" / "pending"
        pending.mkdir(parents=True)

        result = self.wait("review-decided", str(worktree), "run-1", "--release", "21")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.enqueued(), [21])
        self.assert_event("released", executor="wait")

        # Another run's record is not this run's decision.
        (pending / "run-2.json").write_text("{}")
        result = self.wait("review-decided", str(worktree), "run-1", "--release", "22")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.enqueued(), [21, 22])

        # A record that disappears while waiting releases, without polling anything but the ledger.
        record = pending / "run-3.json"
        record.write_text("{}")
        threading.Timer(0.1, lambda: record.unlink(missing_ok=True)).start()
        result = self.wait("review-decided", str(worktree), "run-3", "--release", "23", "--timeout", "5", "--interval", "0.05")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.enqueued(), [21, 22, 23])
        self.assertEqual(self.calls("herdr"), [])
        self.assertEqual(self.calls("pueue")[-1], ["enqueue", "23"])

        # A record that never goes fails without releasing.
        (pending / "run-4.json").write_text("{}")
        result = self.wait("review-decided", str(worktree), "run-4", "--release", "24", "--timeout", "0.3", "--interval", "0.05")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.enqueued(), [21, 22, 23])
        self.assert_event("failed", executor="wait")

    def test_requires_explicit_ids(self):
        # AC-5: no ids is a usage error, so a bare `pueue enqueue` can never release everything.
        self.fixture("gh.json", {"state": "MERGED"})
        for args in (
            ("pr-merged", "7"),
            ("pr-merged", "7", "--release"),
            ("pr-merged", "7", "--release", "all"),
        ):
            result = self.wait(*args)
            self.assertEqual(result.returncode, 2, (args, result.stderr))
            self.assertEqual(self.calls("pueue"), [])
        # A bare wait with no fact is a usage error too.
        self.assertEqual(self.wait().returncode, 2)

        result = self.wait("pr-merged", "7", "--release", "9")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.enqueued(), [9])
        for argv in self.calls("pueue"):
            self.assertGreater(len(argv), 1, f"bare pueue call: {argv}")


if __name__ == "__main__":
    unittest.main()
