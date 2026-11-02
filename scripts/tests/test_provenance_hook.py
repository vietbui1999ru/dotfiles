"""Tests for scripts/provenance hook (Claude Code): rows, model resolution, pruning.

Run: python3 scripts/tests/test_provenance_hook.py
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent
PROVENANCE = SCRIPTS / "provenance"
FIELDS = {"ts", "harness", "harness_version", "model", "effort", "role",
          "session", "cwd", "path", "op"}


class Fixture(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="prov-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.home = self.tmp / "home"
        self.home.mkdir()
        self.ledger = self.tmp / "ledger.jsonl"
        self.agents = self.tmp / "agents"
        self.agents.mkdir()
        self.env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HOME": str(self.home),
                    "PROVENANCE_LEDGER": str(self.ledger),
                    "PROVENANCE_AGENTS_DIR": str(self.agents)}

    def run_hook(self, data, env_extra=None):
        env = {**self.env, **(env_extra or {})}
        return subprocess.run([sys.executable, str(PROVENANCE), "hook"],
                              input=json.dumps(data), capture_output=True, text=True,
                              env=env, timeout=30)

    def rows(self):
        if not self.ledger.exists():
            return []
        return [json.loads(line) for line in self.ledger.read_text().splitlines() if line]

    def session_start(self, model="claude-opus-5-5", session="s1"):
        return self.run_hook({"hook_event_name": "SessionStart", "session_id": session,
                              "model": model})

    def edit(self, tool="Edit", session="s1", **extra):
        data = {"hook_event_name": "PostToolUse", "tool_name": tool, "session_id": session,
                "cwd": "/w", "tool_input": {"file_path": "/w/a.py"}}
        data.update(extra)
        return self.run_hook(data)


class ProvenanceHook(Fixture):
    def test_row_has_all_fields_and_is_silent(self):
        self.session_start()
        out = self.edit(effort={"level": "high"}, tool_name="Write")
        self.assertEqual(out.returncode, 0)
        self.assertEqual(out.stdout, "")
        rows = self.rows()
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(set(row), FIELDS)
        self.assertEqual(row["harness"], "claude")
        self.assertEqual(row["model"], "anthropic/claude-opus-5-5")
        self.assertEqual(row["effort"], "high")
        self.assertEqual(row["role"], "main")
        self.assertEqual(row["session"], "s1")
        self.assertEqual(row["cwd"], "/w")
        self.assertEqual(row["path"], "/w/a.py")
        self.assertEqual(row["op"], "write")
        self.assertTrue(row["ts"].endswith("Z"))

    def test_missing_values_are_unknown(self):
        out = self.run_hook({"hook_event_name": "PostToolUse", "tool_name": "Edit",
                             "tool_input": {"file_path": "/w/b.py"}}, {"CLAUDE_EFFORT": ""})
        self.assertEqual(out.returncode, 0)
        row = self.rows()[0]
        self.assertEqual(row["model"], "unknown")
        self.assertEqual(row["effort"], "unknown")
        self.assertEqual(row["session"], "unknown")
        self.assertEqual(row["cwd"], "unknown")
        self.assertEqual(row["harness_version"], "unknown")

    def test_multiedit_and_non_write_tools(self):
        self.session_start()
        self.edit(tool="MultiEdit")
        self.edit(tool="Bash")
        self.assertEqual([r["op"] for r in self.rows()], ["multiedit"])

    def test_effort_falls_back_to_env(self):
        self.session_start()
        self.run_hook({"hook_event_name": "PostToolUse", "tool_name": "Edit", "session_id": "s1",
                       "tool_input": {"file_path": "/w/c.py"}}, {"CLAUDE_EFFORT": "low"})
        self.assertEqual(self.rows()[0]["effort"], "low")


class ModelResolution(Fixture):
    def test_model_from_session_state(self):
        self.session_start("claude-sonnet-5-5")
        self.edit()
        self.assertEqual(self.rows()[0]["model"], "anthropic/claude-sonnet-5-5")

    def test_post_model_switch_updates_model(self):
        self.session_start("claude-sonnet-5-5")
        self.run_hook({"hook_event_name": "PostModelSwitch", "session_id": "s1",
                       "to_model": "claude-opus-5-5"})
        self.edit()
        self.assertEqual(self.rows()[0]["model"], "anthropic/claude-opus-5-5")

    def test_subagent_model_from_frontmatter(self):
        (self.agents / "worker.md").write_text("---\nname: worker\nmodel: claude-haiku-5-5\n---\nbody\n")
        self.session_start("claude-opus-5-5")
        self.edit(agent_type="worker")
        row = self.rows()[0]
        self.assertEqual(row["model"], "anthropic/claude-haiku-5-5")
        self.assertEqual(row["role"], "worker")

    def test_inherit_resolves_unknown(self):
        (self.agents / "scout.md").write_text("---\nmodel: inherit\n---\n")
        self.session_start("claude-opus-5-5")
        self.edit(agent_type="scout")
        self.assertEqual(self.rows()[0]["model"], "unknown")

    def test_missing_agent_file_is_unknown(self):
        self.session_start("claude-opus-5-5")
        self.edit(agent_type="built-in-explorer")
        self.assertEqual(self.rows()[0]["model"], "unknown")

    def test_real_worker_definition_resolves(self):
        env = {k: v for k, v in self.env.items() if k != "PROVENANCE_AGENTS_DIR"}
        self.session_start("claude-opus-5-5")
        subprocess.run([sys.executable, str(PROVENANCE), "hook"], input=json.dumps({
            "hook_event_name": "PostToolUse", "tool_name": "Write", "session_id": "s1",
            "agent_type": "worker", "tool_input": {"file_path": "/w/d.py"}}),
            capture_output=True, text=True, env=env, timeout=30)
        self.assertEqual(self.rows()[-1]["model"], "anthropic/claude-haiku-5-5")


class Prune(Fixture):
    def test_prune_drops_rows_older_than_30_days(self):
        old = (datetime.now(timezone.utc) - timedelta(days=31)).strftime("%Y-%m-%dT%H:%M:%SZ")
        fresh = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        self.ledger.write_text(json.dumps({"ts": old}) + "\n" + json.dumps({"ts": fresh}) + "\n")
        self.session_start()  # appending triggers the once-a-day prune check
        rows = self.rows()
        stamps = [r["ts"] for r in rows]
        self.assertNotIn(old, stamps)
        self.assertIn(fresh, stamps)

    def test_prune_runs_at_most_once_a_day(self):
        self.session_start()
        stamp = self.ledger.parent / ".pruned"
        self.assertTrue(stamp.exists())
        old = (datetime.now(timezone.utc) - timedelta(days=40)).strftime("%Y-%m-%dT%H:%M:%SZ")
        self.ledger.write_text(json.dumps({"ts": old}) + "\n")
        self.edit()  # stamp is fresh, so no prune this time
        self.assertIn(old, self.ledger.read_text())

    def test_prune_after_interval_removes_old_rows(self):
        self.session_start()
        stamp = self.ledger.parent / ".pruned"
        past = time.time() - 2 * 24 * 3600
        os.utime(stamp, (past, past))
        old = (datetime.now(timezone.utc) - timedelta(days=40)).strftime("%Y-%m-%dT%H:%M:%SZ")
        self.ledger.write_text(json.dumps({"ts": old}) + "\n")
        self.edit()
        self.assertNotIn(old, self.ledger.read_text())


if __name__ == "__main__":
    unittest.main()
