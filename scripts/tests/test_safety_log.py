"""Tests for the bash-safety block log (SPEC: feat/safety-block-log).

HookLog runs claude/.claude/hooks/enforce-bash-safety.sh with SAFETY_LOG_DIR in a
temp dir, so the real log under ~/.claude/state is never touched. Stdlib only.
"""
import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent
ROOT = SCRIPTS.parent
HOOK = ROOT / "claude" / ".claude" / "hooks" / "enforce-bash-safety.sh"
FIELDS = {"id", "ts", "session", "cwd", "transcript", "rule", "command", "reason"}


class HookLog(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="safety-log-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.dir = self.tmp / "state"
        self.log = self.dir / "bash-safety-blocks.jsonl"

    def run_hook(self, command, log_dir=None):
        payload = json.dumps({"tool_input": {"command": command}, "cwd": "/tmp/x",
                              "session_id": "sess-123", "transcript_path": "/tmp/t.jsonl"})
        env = {**os.environ, "SAFETY_LOG_DIR": str(log_dir or self.dir)}
        return subprocess.run(["bash", str(HOOK)], input=payload, env=env,
                              capture_output=True, text=True)

    def entries(self, path=None):
        path = path or self.log
        return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []

    def test_block_appends_one_entry(self):
        r = self.run_hook("git clean -fd")
        self.assertEqual(r.returncode, 2)
        self.assertIn("BLOCKED: git clean -f", r.stderr)
        [entry] = self.entries()
        self.assertEqual(set(entry), FIELDS)
        self.assertRegex(entry["id"], r"^[0-9a-f]{12}$")
        datetime.fromisoformat(entry["ts"])
        self.assertEqual((entry["session"], entry["cwd"], entry["transcript"]),
                         ("sess-123", "/tmp/x", "/tmp/t.jsonl"))
        self.assertEqual(entry["rule"], "git-clean-force")
        self.assertEqual(entry["command"], "git clean -fd")
        self.assertTrue(entry["reason"].startswith("BLOCKED: git clean -f"))

    def test_allowed_appends_nothing(self):
        r = self.run_hook("git status")
        self.assertEqual((r.returncode, r.stdout, r.stderr), (0, "", ""))
        self.assertEqual(self.entries(), [])

    def test_redaction(self):
        secrets = ["abc123secret", "xyzBearerToken", "ghp_" + "A" * 36,
                   "sk-proj-abcdefghij1234567890", "AKIAABCDEFGHIJKLMNOP", "hunter2"]
        command = (f"GITHUB_TOKEN={secrets[0]} DB_PASSWORD={secrets[5]} git clean -fd && "
                   f"curl -H 'Authorization: Bearer {secrets[1]}' https://x/?k={secrets[2]} "
                   f"{secrets[3]} {secrets[4]}")
        self.assertEqual(self.run_hook(command).returncode, 2)
        [entry] = self.entries()
        for secret in secrets:
            self.assertNotIn(secret, entry["command"])
        self.assertIn("[REDACTED]", entry["command"])
        self.assertIn("git clean -fd", entry["command"])
        self.assertIn("curl -H", entry["command"])

    def test_truncation(self):
        self.assertEqual(self.run_hook("git clean -fd " + "x" * 5000).returncode, 2)
        [entry] = self.entries()
        self.assertTrue(entry["command"].endswith("…[truncated]"))
        self.assertLessEqual(len(entry["command"]), 4000 + len("…[truncated]"))

    def test_unwritable_log_still_blocks(self):
        blocker = self.tmp / "not-a-dir"
        blocker.write_text("x")
        r = self.run_hook("git clean -fd", log_dir=blocker)
        self.assertEqual(r.returncode, 2)
        self.assertIn("BLOCKED: git clean -f", r.stderr)
        self.assertEqual(r.stdout, "")

    def test_rotation(self):
        self.dir.mkdir()
        old = json.dumps({"id": "0" * 12, "rule": "old"})
        self.log.write_text((old + "\n") * 2000)
        self.assertEqual(self.run_hook("git clean -fd").returncode, 2)
        self.assertEqual(len(self.entries(self.dir / "bash-safety-blocks.jsonl.1")), 2000)
        [entry] = self.entries()
        self.assertEqual(entry["rule"], "git-clean-force")


if __name__ == "__main__":
    unittest.main()
