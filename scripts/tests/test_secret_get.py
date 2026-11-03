"""Tests for scripts/secret-get: prints one NAME from the secrets file, never sources it.

Fake values are built at run time so this file holds no key-shaped literal.

Run: python3 scripts/tests/test_secret_get.py
"""

import os
import subprocess
import tempfile
import unittest
from pathlib import Path

SECRET_GET = Path(__file__).resolve().parent.parent / "secret-get"

FAKE_CTX7 = "ctx7" + "x" * 24
FAKE_QUOTED = "q" + "y" * 12


class SecretGet(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.folder = self.tmp / "secrets"
        self.folder.mkdir(mode=0o700)
        self.file = self.folder / ".env"
        self.file.write_text(
            "# comment line\n"
            "export CONTEXT7_API_KEY=" + FAKE_CTX7 + "\n"
            "QUOTED_KEY='" + FAKE_QUOTED + "'\n"
            'DOUBLE_KEY="dq-value"\n'
            "CRLF_KEY=crlf-value\r\n"
            "DUP=first\n"
            "DUP=second\n"
        )
        os.chmod(self.file, 0o600)

    def run_get(self, *args, path=None):
        env = {
            "PATH": "/usr/bin:/bin",
            "HOME": str(self.tmp),
            "SECRETS_ENV": str(path or self.file),
        }
        return subprocess.run([str(SECRET_GET), *args], env=env, capture_output=True, text=True, timeout=30)

    def test_prints_exact_value(self):
        out = self.run_get("CONTEXT7_API_KEY")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(out.stdout, FAKE_CTX7 + "\n")

    def test_single_quoted_value(self):
        out = self.run_get("QUOTED_KEY")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(out.stdout, FAKE_QUOTED + "\n")

    def test_double_quoted_value(self):
        out = self.run_get("DOUBLE_KEY")
        self.assertEqual(out.stdout, "dq-value\n")

    def test_crlf_line_ending_is_stripped(self):
        out = self.run_get("CRLF_KEY")
        self.assertEqual(out.stdout, "crlf-value\n")

    def test_last_definition_wins(self):
        out = self.run_get("DUP")
        self.assertEqual(out.stdout, "second\n")

    def test_missing_name_exits_1_and_names_it(self):
        out = self.run_get("NOT_THERE")
        self.assertEqual(out.returncode, 1)
        self.assertEqual(out.stdout, "")
        self.assertIn("secret-get: NOT_THERE not found", out.stderr)

    def test_file_is_never_executed(self):
        marker = self.tmp / "pwned"
        self.file.write_text(f"touch {marker}\nSAFE=ok\n")
        out = self.run_get("SAFE")
        self.assertEqual(out.stdout, "ok\n")
        self.assertFalse(marker.exists())

    def test_mode_file_not_600_refused(self):
        os.chmod(self.file, 0o644)
        out = self.run_get("CONTEXT7_API_KEY")
        self.assertEqual(out.returncode, 2, out.stderr)
        self.assertEqual(out.stdout, "")
        self.assertIn("mode", out.stderr)

    def test_mode_folder_not_700_refused(self):
        # A throwaway folder carries the deliberately loose mode, not the fixture folder.
        loose = self.tmp / "loose"
        loose.mkdir(mode=0o755)
        if (loose.stat().st_mode & 0o777) == 0o700:
            self.skipTest("umask forced the throwaway folder to 700")
        loose_file = loose / ".env"
        loose_file.write_text("CONTEXT7_API_KEY=" + FAKE_CTX7 + "\n")
        os.chmod(loose_file, 0o600)
        out = self.run_get("CONTEXT7_API_KEY", path=loose_file)
        self.assertEqual(out.returncode, 2, out.stderr)
        self.assertEqual(out.stdout, "")
        self.assertIn("mode", out.stderr)

    def test_mode_600_and_700_accepted(self):
        out = self.run_get("CONTEXT7_API_KEY")
        self.assertEqual(out.returncode, 0, out.stderr)


if __name__ == "__main__":
    unittest.main()
