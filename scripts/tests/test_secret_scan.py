"""Tests for scripts/secret-scan: exit 1 with file:line and pattern name on a hit, never the value.

Fake keys are built at run time so this file holds no key-shaped literal.

Run: python3 scripts/tests/test_secret_scan.py
"""

import os
import subprocess
import tempfile
import unittest
from pathlib import Path

SCAN = Path(__file__).resolve().parent.parent / "secret-scan"

FAKE_SK = "sk-" + "a" * 32
FAKE_GHP = "ghp_" + "B" * 36
LITERAL = "lit" + "e" * 12


class SecretScan(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.secrets = self.tmp / ".env"
        self.secrets.write_text(f"MY_LITERAL={LITERAL}\n")
        os.chmod(self.secrets, 0o600)

    def run_scan(self, *args, stdin=None):
        env = {"PATH": "/usr/bin:/bin", "HOME": str(self.tmp), "SECRETS_ENV": str(self.secrets)}
        return subprocess.run([str(SCAN), *args], input=stdin, env=env, capture_output=True, text=True, timeout=30)

    def write(self, name, text):
        path = self.tmp / name
        path.write_text(text)
        return path

    def test_clean_file_exits_0(self):
        f = self.write("clean.txt", "def main():\n    return 1\n")
        out = self.run_scan(str(f))
        self.assertEqual(out.returncode, 0, out.stdout + out.stderr)
        self.assertEqual(out.stdout, "")

    def test_hit_exits_1_with_file_line_and_pattern_name(self):
        f = self.write("leak.txt", f"ok\nkey {FAKE_SK}\n")
        out = self.run_scan(str(f))
        self.assertEqual(out.returncode, 1)
        self.assertIn(f"{f}:2: openai-style-key", out.stdout)

    def test_output_never_contains_the_value(self):
        f = self.write("leak.txt", f"key {FAKE_SK} and {FAKE_GHP}\n")
        out = self.run_scan(str(f))
        self.assertEqual(out.returncode, 1)
        self.assertNotIn(FAKE_SK, out.stdout)
        self.assertNotIn(FAKE_GHP, out.stdout)
        self.assertNotIn("a" * 32, out.stdout)

    def test_literal_env_value_is_a_hit(self):
        f = self.write("lit.txt", f"value is {LITERAL}\n")
        out = self.run_scan(str(f))
        self.assertEqual(out.returncode, 1)
        self.assertIn(f"{f}:1: MY_LITERAL", out.stdout)
        self.assertNotIn(LITERAL, out.stdout)

    def test_stdin_dash_is_scanned_with_label(self):
        out = self.run_scan("-", stdin=f"x {FAKE_GHP}\n")
        self.assertEqual(out.returncode, 1)
        self.assertIn("<stdin>:1: github-token", out.stdout)
        self.assertNotIn(FAKE_GHP, out.stdout)

    def test_no_args_reads_stdin(self):
        out = self.run_scan(stdin=f"x {FAKE_GHP}\n")
        self.assertEqual(out.returncode, 1)
        self.assertIn("<stdin>:1: github-token", out.stdout)

    def test_no_args_clean_stdin_exits_0(self):
        out = self.run_scan(stdin="plain text\n")
        self.assertEqual(out.returncode, 0)

    def test_multiple_files_each_reported(self):
        a = self.write("a.txt", f"{FAKE_SK}\n")
        b = self.write("b.txt", "clean\n")
        c = self.write("c.txt", f"{FAKE_GHP}\n")
        out = self.run_scan(str(a), str(b), str(c))
        self.assertEqual(out.returncode, 1)
        self.assertIn(f"{a}:1: openai-style-key", out.stdout)
        self.assertIn(f"{c}:1: github-token", out.stdout)
        self.assertNotIn(f"{b}:", out.stdout)

    def test_ordinary_code_is_clean(self):
        f = self.write("code.py", "import os\nls = ['-la']\nrm = 'rm -rf build'\n")
        out = self.run_scan(str(f))
        self.assertEqual(out.returncode, 0, out.stdout)

    def test_missing_file_is_an_error_not_a_pass(self):
        out = self.run_scan(str(self.tmp / "nope.txt"))
        self.assertNotEqual(out.returncode, 0)


if __name__ == "__main__":
    unittest.main()
