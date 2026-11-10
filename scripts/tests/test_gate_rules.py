"""The Gates rule block is one text in every harness, and agent-review names the next step."""
import argparse
import importlib.machinery
import importlib.util
import io
import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
COPIES = [
    ROOT / "shared" / "AGENTS.md",
    ROOT / "shared" / "research-tool-routing.md",
    ROOT / "pi" / ".pi" / "agent" / "AGENTS.md",
]
BLOCK = re.compile(r"<!-- gates:start -->\n(.*?)<!-- gates:end -->", re.S)


def gates_block(path: Path) -> str:
    found = BLOCK.findall(path.read_text())
    if len(found) != 1:
        raise AssertionError(f"{path}: expected one gates block, found {len(found)}")
    return found[0]


class GateRulesBlock(unittest.TestCase):
    def test_block_identical_in_every_copy(self):
        first, *rest = [gates_block(p) for p in COPIES]
        for path, block in zip(COPIES[1:], rest):
            self.assertEqual(block, first, f"{path} differs from {COPIES[0]}")

    def test_block_states_the_rule(self):
        block = gates_block(COPIES[0])
        self.assertIn("One refusal means stop", block)
        self.assertIn("Hand over the unblock", block)

    def test_pi_agents_file_is_current(self):
        r = subprocess.run(["zsh", str(ROOT / "scripts" / "build-pi-agents"), "--check"],
                           cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)


class AgentReviewNextSteps(unittest.TestCase):
    def setUp(self):
        loader = importlib.machinery.SourceFileLoader("agent_review_under_test",
                                                      str(ROOT / "scripts" / "agent-review"))
        spec = importlib.util.spec_from_loader(loader.name, loader)
        self.mod = importlib.util.module_from_spec(spec)
        loader.exec_module(self.mod)

    def test_gate_refusals_have_a_next_step(self):
        for reason in ("tree-changed", "already-decided", "not-confirmed"):
            self.assertIn(reason, self.mod.NEXT)
            refusal = self.mod.Refusal(reason, "base")
            self.assertEqual(refusal.reason, reason)
            self.assertTrue(refusal.message.startswith("base. "), refusal.message)

    def test_tree_changed_tells_agents_to_stop(self):
        self.assertIn("Agents: stop", self.mod.Refusal("tree-changed", "x").message)

    def test_other_refusals_keep_their_message(self):
        self.assertEqual(self.mod.Refusal("invalid-id", "not a run id").message, "not a run id")


def load_agent_review(name: str):
    loader = importlib.machinery.SourceFileLoader(name, str(ROOT / "scripts" / "agent-review"))
    module = importlib.util.module_from_spec(importlib.util.spec_from_loader(name, loader))
    loader.exec_module(module)
    return module


class AgentReviewGateEvents(unittest.TestCase):
    """approve and skip append one event line; a failed write changes nothing the caller sees."""
    RUN = "0f0e0d0c-0b0a-4000-8000-000000000001"

    def setUp(self):
        self.mod = load_agent_review("agent_review_events")
        self.state = Path(tempfile.mkdtemp(prefix="gate-events-"))
        self.addCleanup(shutil.rmtree, self.state, True)
        patcher = mock.patch.dict(os.environ, {"XDG_STATE_HOME": str(self.state)})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.mod.run_label = lambda run_id: "my-run"

    def stub(self, name, reason=None):
        def gate(run_id):
            if reason:
                raise self.mod.Refusal(reason, "base")
            return self.mod.reply(True, runId=run_id)
        setattr(self.mod, name, gate)

    def call(self, command):
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = getattr(self.mod, command)(argparse.Namespace(run_id=self.RUN))
        return code, out.getvalue(), err.getvalue()

    def events(self):
        path = self.state / "herdr-mods" / "gate-events.jsonl"
        return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []

    def test_each_outcome_is_one_line(self):
        cases = [("approve", None, "approve", "ok"), ("approve", "not-confirmed", "approve", "cancelled"),
                 ("approve", "tree-changed", "approve", "refused"), ("skip", None, "skip", "ok"),
                 ("skip", "processing", "skip", "refused")]
        for name, reason, action, outcome in cases:
            with self.subTest(name=name, reason=reason):
                self.stub(name, reason)
                before = len(self.events())
                code, _out, err = self.call(f"command_{name}")
                self.assertEqual(code, 2 if reason else 0)
                self.assertEqual(err, "")
                events = self.events()
                self.assertEqual(len(events), before + 1)
                event = events[-1]
                self.assertEqual(set(event), {"ts", "gate", "action", "outcome", "target", "message"})
                self.assertIsInstance(event["ts"], int)
                self.assertEqual((event["gate"], event["action"], event["outcome"], event["target"]),
                                 ("agent-review", action, outcome, "my-run"))
                if reason:
                    self.assertTrue(event["message"].startswith("base"), event)
                else:
                    self.assertIsNone(event["message"])

    def test_unwritable_state_dir_changes_nothing(self):
        for reason in (None, "tree-changed"):
            with self.subTest(reason=reason):
                self.stub("approve", reason)
                writable = self.call("command_approve")
                blocker = self.state / "blocker"
                blocker.write_text("")
                with mock.patch.dict(os.environ, {"XDG_STATE_HOME": str(blocker)}):
                    self.assertEqual(self.call("command_approve"), writable)

    def test_run_label_falls_back_to_the_short_id(self):
        self.assertEqual(load_agent_review("agent_review_fresh").run_label(self.RUN), self.RUN[:8])


if __name__ == "__main__":
    unittest.main()
