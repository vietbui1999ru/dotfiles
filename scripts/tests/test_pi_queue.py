"""Tests for scripts/pi-queue: the pueue work queue (SPEC.md on feat/pi-queue).

Run: python3 scripts/tests/test_pi_queue.py
"""

import json
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent.parent


class PiQueue(unittest.TestCase):
    def test_commandr_unhooked(self):
        # AC-13: Commandr's task bus is retired; the pueue queue replaces it.
        defaults = (REPO / "shared" / "agent-workflow.default.json").read_text()
        self.assertIs(json.loads(defaults).get("commandr"), False)
        self.assertNotIn("repos/Commandr", defaults)
        settings = (REPO / "claude" / ".claude" / "settings.json").read_text()
        self.assertNotIn("commandr", settings.lower())
        repo_ts = (REPO / "session-band-plugin" / "hooks" / "repo.ts").read_text()
        self.assertNotIn(".agents/claimed", repo_ts)
        agents = (REPO / "shared" / "AGENTS.md").read_text()
        self.assertNotIn("Commandr is", agents)


if __name__ == "__main__":
    unittest.main()
