"""The Gates rule block is one text in every harness, and agent-review names the next step."""
import importlib.machinery
import importlib.util
import re
import subprocess
import unittest
from pathlib import Path

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


if __name__ == "__main__":
    unittest.main()
