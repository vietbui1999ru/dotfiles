"""pi-view writes one run-level provenance row and leaves the command it runs unchanged.

Run: python3 scripts/tests/test_pi_view_provenance.py
"""
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent
PI_VIEW = SCRIPTS / "pi-view"
FIELDS = {"ts", "harness", "harness_version", "model", "effort", "role",
          "session", "cwd", "path", "op"}


class PiViewProvenance(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="piv-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.ledger = self.tmp / "ledger.jsonl"
        self.work = self.tmp / "work"
        self.work.mkdir()
        self.env = {"PATH": "/usr/bin:/bin", "HOME": str(self.tmp), "TMPDIR": str(self.tmp),
                    "PI_VIEW_SECRETS": str(self.tmp / "none.env"),
                    "PROVENANCE_LEDGER": str(self.ledger)}

    def run_view(self, args):
        return subprocess.run([str(PI_VIEW), *args], cwd=self.work, env=self.env,
                              capture_output=True, text=True, timeout=60)

    def rows(self):
        if not self.ledger.exists():
            return []
        return [json.loads(line) for line in self.ledger.read_text().splitlines() if line]

    def test_run_row_parsed_from_model_and_session(self):
        out = self.run_view(["sh", "-c", "exit 0", "pi", "--model", "openai-codex/gpt-6.1-sol:high",
                             "--session-id", "pueue-abc"])
        self.assertEqual(out.returncode, 0, out.stderr)
        rows = self.rows()
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(set(row), FIELDS)
        self.assertEqual(row["harness"], "pi")
        self.assertEqual(row["model"], "openai-codex/gpt-6.1-sol")
        self.assertEqual(row["effort"], "high")
        self.assertEqual(row["session"], "pueue-abc")
        self.assertEqual(row["role"], "dispatch")
        self.assertEqual(row["op"], "run")
        self.assertEqual(row["path"], "*")
        self.assertEqual(row["cwd"], os.path.realpath(self.work))

    def test_command_output_and_exit_code_unchanged(self):
        out = self.run_view(["sh", "-c", "printf 'hello %s' \"$0\"; exit 7", "--model", "a/b"])
        self.assertEqual(out.returncode, 7)
        self.assertEqual(out.stdout, "hello --model")
        self.assertEqual(len(self.rows()), 1)

    def test_session_id_is_exported_for_commit_funnel(self):
        out = self.run_view(["sh", "-c", 'printf "%s" "${PROVENANCE_SESSION-unset}"',
                             "--session-id", "pueue-xyz"])
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(out.stdout, "pueue-xyz")
        out = self.run_view(["sh", "-c", 'printf "%s" "${PROVENANCE_SESSION-unset}"'])
        self.assertEqual(out.stdout, "unset")

    def test_unparsed_model_is_unknown_and_run_still_happens(self):
        out = self.run_view(["sh", "-c", "printf ran"])
        self.assertEqual(out.stdout, "ran")
        row = self.rows()[0]
        self.assertEqual(row["model"], "unknown")
        self.assertEqual(row["effort"], "unknown")
        self.assertEqual(row["session"], "unknown")


if __name__ == "__main__":
    unittest.main()
