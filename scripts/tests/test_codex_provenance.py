"""Codex observe hook adds model and effort to its record, then ledger rows for apply_patch.

Run: python3 scripts/tests/test_codex_provenance.py
"""
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
HOOK = ROOT / "codex" / ".codex" / "hooks" / "observe-session.sh"
PROVENANCE = ROOT / "scripts" / "provenance"
FIELDS = {"ts", "harness", "harness_version", "model", "effort", "role",
          "session", "cwd", "path", "op"}


class CodexProvenance(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="cdx-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.home = self.tmp / "home"
        (self.home / ".codex").mkdir(parents=True)
        self.ledger = self.tmp / "ledger.jsonl"
        self.env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HOME": str(self.home),
                    "PROVENANCE_LEDGER": str(self.ledger),
                    "PROVENANCE_BIN": str(PROVENANCE),
                    "CODEX_HOME": str(self.home / ".codex")}

    def write_config(self, text):
        (self.home / ".codex" / "config.toml").write_text(text)

    def run_hook(self, data):
        return subprocess.run(["bash", str(HOOK)], input=json.dumps(data), env=self.env,
                              capture_output=True, text=True, timeout=30)

    def record(self):
        logs = list((self.home / ".claude" / "logs").glob("session-*.jsonl"))
        self.assertEqual(len(logs), 1)
        lines = logs[0].read_text().splitlines()
        return json.loads(lines[-1])

    def rows(self):
        if not self.ledger.exists():
            return []
        return [json.loads(line) for line in self.ledger.read_text().splitlines() if line]

    def test_input_model_and_effort_win_over_config(self):
        self.write_config('model = "gpt-6.1"\nmodel_reasoning_effort = "low"\n')
        out = self.run_hook({"tool_name": "Bash", "session_id": "c1", "model": "openai/gpt-7",
                             "effort": "high", "tool_input": {"command": "ls"}})
        self.assertEqual(out.returncode, 0, out.stderr)
        rec = self.record()
        self.assertEqual(rec["model"], "openai/gpt-7")
        self.assertEqual(rec["effort"], "high")
        self.assertEqual(rec["tool"], "Bash")
        self.assertTrue(rec["ok"])

    def test_config_toml_fallback_with_provider_prefix(self):
        self.write_config('model = "gpt-6.1-sol"\nmodel_provider = "openai-codex"\n'
                          'model_reasoning_effort = "medium"\n')
        self.run_hook({"tool_name": "Bash", "session_id": "c2", "tool_input": {"command": "ls"}})
        rec = self.record()
        self.assertEqual(rec["model"], "openai-codex/gpt-6.1-sol")
        self.assertEqual(rec["effort"], "medium")

    def test_config_without_provider_defaults_to_openai(self):
        self.write_config('model = "gpt-6.1"\n')
        self.run_hook({"tool_name": "Bash", "session_id": "c3", "tool_input": {"command": "ls"}})
        self.assertEqual(self.record()["model"], "openai/gpt-6.1")
        self.assertEqual(self.record()["effort"], "unknown")

    def test_no_input_no_config_is_unknown(self):
        out = self.run_hook({"tool_name": "Bash", "session_id": "c4", "tool_input": {"command": "ls"}})
        self.assertEqual(out.returncode, 0)
        rec = self.record()
        self.assertEqual(rec["model"], "unknown")
        self.assertEqual(rec["effort"], "unknown")

    def test_apply_patch_writes_one_ledger_row_per_file(self):
        self.write_config('model = "gpt-6.1"\nmodel_reasoning_effort = "high"\n')
        patch = ("*** Begin Patch\n*** Add File: src/new.py\n+x\n"
                 "*** Update File: src/old.py\n@@\n-a\n+b\n"
                 "*** Delete File: gone.txt\n*** End Patch\n")
        cwd = str(self.tmp / "work")
        out = self.run_hook({"tool_name": "apply_patch", "session_id": "c5", "cwd": cwd,
                             "tool_input": {"command": patch}})
        self.assertEqual(out.returncode, 0, out.stderr)
        rows = self.rows()
        self.assertEqual([r["path"] for r in rows],
                         [f"{cwd}/src/new.py", f"{cwd}/src/old.py", f"{cwd}/gone.txt"])
        for row in rows:
            self.assertEqual(set(row), FIELDS)
            self.assertEqual(row["harness"], "codex")
            self.assertEqual(row["model"], "openai/gpt-6.1")
            self.assertEqual(row["effort"], "high")
            self.assertEqual(row["role"], "main")
            self.assertEqual(row["op"], "apply_patch")


if __name__ == "__main__":
    unittest.main()
