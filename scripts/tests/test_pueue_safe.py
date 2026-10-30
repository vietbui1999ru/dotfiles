"""Tests for scripts/pueue-safe: `pueue add` never hands pueue the secrets in its environment.

Run: python3 scripts/tests/test_pueue_safe.py
"""

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

WRAPPER = Path(__file__).resolve().parent.parent / "pueue-safe"

# Stands in for the real pueue: prints the arguments and environment it was given.
STUB = """#!/bin/sh
python3 -c 'import json, os, sys; print(json.dumps({"args": sys.argv[1:], "env": dict(os.environ)}))' "$@"
"""


class PueueSafe(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.real = self.tmp / "real" / "pueue"
        self.real.parent.mkdir()
        self.real.write_text(STUB)
        self.real.chmod(0o755)
        self.secrets = self.tmp / ".env"
        # A name with no secret-looking suffix: dropped only because the secrets file lists it.
        self.secrets.write_text("# comment\nexport SYNC_THING=abc\nCONTEXT7_API_KEY=ctx7sk-test\n\n")

    def run_wrapper(self, *args, env=None, real=True):
        base = {
            "PATH": f"{self.real.parent}:/usr/bin:/bin",
            "HOME": str(self.tmp),
            "PUEUE_SAFE_SECRETS": str(self.secrets),
            "SSH_AUTH_SOCK": "/tmp/agent.sock",
            "MAX_THINKING_TOKENS": "10000",
            "HERDR_PANE_ID": "wB:p5",
            "SYNC_THING": "abc",
            "CONTEXT7_API_KEY": "ctx7sk-test",
            "GITHUB_TOKEN": "ghp-test",
            "ANTHROPIC_API_KEY": "sk-ant-test",
            "DB_PASSWORD": "hunter2",
            "MY_CLIENT_SECRET": "s3",
        }
        if real:
            base["PUEUE_SAFE_REAL"] = str(self.real)
        base.update(env or {})
        out = subprocess.run([str(WRAPPER), *args], env=base, capture_output=True, text=True, timeout=30)
        self.assertEqual(out.returncode, 0, out.stderr)
        return json.loads(out.stdout)

    def test_add_drops_names_listed_in_the_secrets_file(self):
        got = self.run_wrapper("add", "--", "echo", "hi")
        self.assertNotIn("SYNC_THING", got["env"])
        self.assertNotIn("CONTEXT7_API_KEY", got["env"])

    def test_add_drops_secret_looking_names_not_in_the_file(self):
        got = self.run_wrapper("add", "--", "echo", "hi")
        for name in ("GITHUB_TOKEN", "ANTHROPIC_API_KEY", "DB_PASSWORD", "MY_CLIENT_SECRET"):
            self.assertNotIn(name, got["env"], name)

    def test_add_keeps_what_tasks_need(self):
        got = self.run_wrapper("add", "--", "echo", "hi")
        for name in ("SSH_AUTH_SOCK", "MAX_THINKING_TOKENS", "HERDR_PANE_ID", "PATH", "HOME"):
            self.assertIn(name, got["env"], name)

    def test_add_passes_arguments_unchanged(self):
        got = self.run_wrapper("add", "-i", "--label", "x y", "--", "sh", "-c", "echo $HOME")
        self.assertEqual(got["args"], ["add", "-i", "--label", "x y", "--", "sh", "-c", "echo $HOME"])

    def test_other_subcommands_keep_the_environment(self):
        got = self.run_wrapper("status", "--json")
        self.assertEqual(got["args"], ["status", "--json"])
        self.assertEqual(got["env"]["CONTEXT7_API_KEY"], "ctx7sk-test")

    def test_missing_secrets_file_still_drops_by_pattern(self):
        got = self.run_wrapper("add", "--", "true", env={"PUEUE_SAFE_SECRETS": str(self.tmp / "nope")})
        self.assertNotIn("GITHUB_TOKEN", got["env"])
        self.assertIn("SYNC_THING", got["env"])

    def test_finds_the_real_pueue_on_path_and_skips_itself(self):
        shim_dir = self.tmp / "shim"
        shim_dir.mkdir()
        (shim_dir / "pueue").symlink_to(WRAPPER)
        got = self.run_wrapper("add", "--", "true", real=False,
                               env={"PATH": f"{shim_dir}:{self.real.parent}:/usr/bin:/bin"})
        self.assertNotIn("GITHUB_TOKEN", got["env"])


if __name__ == "__main__":
    unittest.main()
