"""Tests for scripts/with-secrets: exec a command with only the named keys added.

Fake values are built at run time so this file holds no key-shaped literal.

Run: python3 scripts/tests/test_with_secrets.py
"""

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

WITH_SECRETS = Path(__file__).resolve().parent.parent / "with-secrets"

FAKE_A = "aa" + "1" * 16
FAKE_B = "bb" + "2" * 16
FAKE_OTHER = "oo" + "3" * 16

# Prints the environment it was given, as JSON.
DUMP = ["python3", "-c", "import json, os; print(json.dumps(dict(os.environ)))"]


class WithSecrets(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.folder = self.tmp / "secrets"
        self.folder.mkdir(mode=0o700)
        self.file = self.folder / ".env"
        self.file.write_text(
            f"FAKE_KEY_A={FAKE_A}\n"
            f"export FAKE_KEY_B='{FAKE_B}'\n"
            f"FAKE_KEY_OTHER={FAKE_OTHER}\n"
        )
        os.chmod(self.file, 0o600)

    def run_with(self, *args):
        env = {
            "PATH": "/usr/bin:/bin",
            "HOME": str(self.tmp),
            "SECRETS_ENV": str(self.file),
        }
        return subprocess.run([str(WITH_SECRETS), *args], env=env, capture_output=True, text=True, timeout=30)

    def test_named_keys_reach_the_child_and_others_do_not(self):
        out = self.run_with("FAKE_KEY_A", "FAKE_KEY_B", "--", *DUMP)
        self.assertEqual(out.returncode, 0, out.stderr)
        child = json.loads(out.stdout)
        self.assertEqual(child["FAKE_KEY_A"], FAKE_A)
        self.assertEqual(child["FAKE_KEY_B"], FAKE_B)
        self.assertNotIn("FAKE_KEY_OTHER", child)

    def test_arguments_pass_through_to_the_command(self):
        out = self.run_with("FAKE_KEY_A", "--", "sh", "-c", "printf '%s|%s' \"$1\" \"$FAKE_KEY_A\"", "x", "arg1")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(out.stdout, f"arg1|{FAKE_A}")

    def test_value_with_spaces_and_glob_chars_is_kept_whole(self):
        spaced = "x y*" + "z" * 10
        self.file.write_text(f"FAKE_SPACED={spaced}\n")
        out = self.run_with("FAKE_SPACED", "--", "sh", "-c", 'printf "%s" "$FAKE_SPACED"')
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(out.stdout, spaced)

    def test_missing_key_fails_before_exec(self):
        marker = self.tmp / "ran"
        out = self.run_with("FAKE_KEY_A", "NOT_THERE", "--", "sh", "-c", f"touch {marker}")
        self.assertNotEqual(out.returncode, 0)
        self.assertIn("NOT_THERE", out.stderr)
        self.assertFalse(marker.exists(), "command must not run when a key is missing")

    def test_missing_key_exit_code_is_secret_get_code(self):
        out = self.run_with("NOT_THERE", "--", "true")
        self.assertEqual(out.returncode, 1)

    def test_no_separator_is_a_usage_error(self):
        out = self.run_with("FAKE_KEY_A")
        self.assertEqual(out.returncode, 1)
        self.assertIn("usage", out.stderr)

    def test_no_names_is_a_usage_error(self):
        out = self.run_with("--", "true")
        self.assertEqual(out.returncode, 1)
        self.assertIn("usage", out.stderr)


if __name__ == "__main__":
    unittest.main()
