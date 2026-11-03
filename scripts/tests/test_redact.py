"""Tests for scripts/redact: stdin to stdout, secret values and key shapes replaced.

Fake keys are built at run time (prefix + filler) so this file holds no key-shaped literal.

Run: python3 scripts/tests/test_redact.py
"""

import os
import subprocess
import tempfile
import unittest
from pathlib import Path

REDACT = Path(__file__).resolve().parent.parent / "redact"

LITERAL = "lit" + "e" * 12  # a value from the secrets file, length >= 8
SHORT = "ab"  # below the length floor; must not be used as a literal


class Redact(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.secrets = self.tmp / ".env"
        self.secrets.write_text(
            f"MY_LITERAL={LITERAL}\n"
            f"SHORT_VAL={SHORT}\n"
            "# comment\n"
        )
        os.chmod(self.secrets, 0o600)

    def run_redact(self, text, secrets=None):
        env = {"PATH": "/usr/bin:/bin", "HOME": str(self.tmp), "SECRETS_ENV": str(secrets or self.secrets)}
        return subprocess.run([str(REDACT)], input=text, env=env, capture_output=True, text=True, timeout=30)

    def assertRedacts(self, text, expected):
        out = self.run_redact(text)
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(out.stdout, expected)

    # Literal values from the secrets file
    def test_literal_value_from_env_file_is_replaced(self):
        out = self.run_redact(f"token is {LITERAL} here\n")
        self.assertEqual(out.stdout, "token is [REDACTED:MY_LITERAL] here\n")
        self.assertNotIn(LITERAL, out.stdout)

    def test_short_value_is_not_used_as_literal(self):
        out = self.run_redact(f"plain {SHORT} text\n")
        self.assertEqual(out.stdout, f"plain {SHORT} text\n")

    def test_unreadable_env_file_warns_once_and_still_pattern_redacts(self):
        missing = self.tmp / "absent.env"
        out = self.run_redact(f"{LITERAL} sk-{'a' * 30}\n", secrets=missing)
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(out.stderr.count("warning"), 1)
        self.assertNotIn("sk-" + "a" * 30, out.stdout)

    # Key shapes
    def test_openai_style_sk_key(self):
        key = "sk-" + "a" * 32
        self.assertRedacts(f"key={key}\n", "key=sk-[REDACTED]\n")

    def test_github_classic_token(self):
        key = "ghp_" + "B" * 36
        self.assertRedacts(f"{key}\n", "ghp_[REDACTED]\n")

    def test_github_oauth_token(self):
        key = "gho_" + "C" * 36
        self.assertRedacts(f"{key}\n", "gho_[REDACTED]\n")

    def test_github_fine_grained_pat(self):
        key = "github_pat_" + "D" * 40
        self.assertRedacts(f"{key}\n", "github_pat_[REDACTED]\n")

    def test_google_api_key(self):
        key = "AIza" + "E" * 35
        self.assertRedacts(f"{key}\n", "AIza[REDACTED]\n")

    def test_firecrawl_key(self):
        key = "fc-" + "f" * 32
        self.assertRedacts(f"{key}\n", "fc-[REDACTED]\n")

    def test_slack_token(self):
        key = "xoxb-" + "1" * 24
        self.assertRedacts(f"{key}\n", "xoxb-[REDACTED]\n")

    def test_aws_access_key_id(self):
        key = "AKIA" + "G" * 16
        self.assertRedacts(f"{key}\n", "AKIA[REDACTED]\n")

    def test_bearer_token(self):
        tok = "tok" + "h" * 20
        self.assertRedacts(f"Authorization: Bearer {tok}\n", "Authorization: [REDACTED]\n")

    def test_bearer_token_inline(self):
        tok = "tok" + "h" * 20
        self.assertRedacts(f"curl -H 'Bearer {tok}'\n", "curl -H 'Bearer [REDACTED]'\n")

    def test_authorization_header_value(self):
        self.assertRedacts("Authorization: Basic abcdefghijkl\n", "Authorization: [REDACTED]\n")

    def test_x_api_key_header_value(self):
        self.assertRedacts("X-Api-Key: somevalue123\n", "X-Api-Key: [REDACTED]\n")

    def test_url_userinfo_password(self):
        self.assertRedacts("https://alice:hunter2pass@example.com/x\n", "https://alice:[REDACTED]@example.com/x\n")

    def test_name_value_assignment_with_secret_like_name(self):
        self.assertRedacts("API_KEY=abcdef123456\n", "API_KEY=[REDACTED]\n")

    def test_name_value_assignment_token_suffix(self):
        self.assertRedacts("github_token=zzzz1234\n", "github_token=[REDACTED]\n")

    def test_name_value_assignment_is_case_insensitive(self):
        self.assertRedacts("Db_Password=qwerty99\n", "Db_Password=[REDACTED]\n")

    def test_short_flag_with_glued_value_is_redacted(self):
        self.assertRedacts("mysql -pXXXXXXXX db\n", "mysql -p[REDACTED] db\n")

    # Ordinary text stays unchanged
    def test_ordinary_code_unchanged(self):
        text = "def main():\n    return compute(x, y)  # ok\n"
        self.assertRedacts(text, text)

    def test_paths_unchanged(self):
        text = "/Users/someone/dotfiles/scripts/redact and ~/repos/llm-wiki\n"
        self.assertRedacts(text, text)

    def test_git_output_unchanged(self):
        text = "commit 86f2c9c10fef\nAuthor: Dev <dev@example.com>\n    fix: tidy scripts\n"
        self.assertRedacts(text, text)

    def test_ls_la_unchanged(self):
        text = "drwxr-xr-x  5 user staff  160 Nov  3 10:00 scripts\n-rw-r--r--  1 user staff 12 Nov  3 .gitignore\n"
        self.assertRedacts(text, text)

    def test_short_flags_la_rf_m_unchanged(self):
        text = "ls -la /tmp && rm -rf build && git commit -m 'message here'\n"
        self.assertRedacts(text, text)

    def test_plain_words_unchanged(self):
        text = "the quick brown fox jumps over the lazy dog\n"
        self.assertRedacts(text, text)


if __name__ == "__main__":
    unittest.main()
