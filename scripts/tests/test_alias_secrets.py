"""zsh/.zsh/aliases.zsh starts claude, opencode and codex through with-secrets, so each client
gets only the two MCP keys (CONTEXT7_API_KEY, EXCALIDRAW_API_KEY), and hclaude starts Headroom
with telemetry off through the same wrapper.

Both MCP keys are optional: the file holding neither, one, or both still starts the client, and
only the keys that are present reach it. A missing optional key must not cost the launch.

Fake values are built at run time so this file holds no key-shaped literal.

Run: python3 scripts/tests/test_alias_secrets.py
"""

import subprocess
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent.parent
ALIASES = REPO / "zsh" / ".zsh" / "aliases.zsh"

FAKE_CTX = "ctx" + "7" * 20
FAKE_EXC = "exc" + "8" * 20
FAKE_OTHER = "oth" + "9" * 20

# Each fake client prints the three variables it was given, as name=value pairs.
REPORT = 'printf "%s|%s|%s" "${CONTEXT7_API_KEY-unset}" "${EXCALIDRAW_API_KEY-unset}" "${OTHER-unset}"'


class AliasSecrets(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.home = self.tmp / "home"
        self.home.mkdir()
        # $HOME/dotfiles resolves to the worktree, so with-secrets under test is the worktree copy.
        (self.home / "dotfiles").symlink_to(REPO)
        self.bin = self.tmp / "bin"
        self.bin.mkdir()
        for name in ("claude", "opencode", "codex", "headroom"):
            exe = self.bin / name
            exe.write_text("#!/bin/sh\n" + REPORT + "\necho\n")
            exe.chmod(0o755)
        self.secrets_folder = self.tmp / "secrets"
        self.secrets_folder.mkdir(mode=0o700)
        self.secrets = self.secrets_folder / ".env"

    def write_secrets(self, text):
        self.secrets.write_text(text)
        self.secrets.chmod(0o600)

    def run_zsh(self, command, use_secrets=True):
        env = {
            "PATH": f"{self.bin}:/usr/bin:/bin",
            "HOME": str(self.home),
            "TMPDIR": str(self.tmp),
        }
        if use_secrets:
            env["SECRETS_ENV"] = str(self.secrets)
        # Aliases expand at parse time in a non-interactive shell only with `aliases` set.
        script = f"setopt aliases\nsource {ALIASES}\n{command}\n"
        return subprocess.run(
            ["zsh", "-f", "-c", script], env=env, capture_output=True, text=True, timeout=60
        )

    def test_each_client_gets_only_the_two_mcp_keys(self):
        self.write_secrets(f"CONTEXT7_API_KEY={FAKE_CTX}\nEXCALIDRAW_API_KEY={FAKE_EXC}\nOTHER={FAKE_OTHER}\n")
        for client in ("claude", "opencode", "codex"):
            with self.subTest(client=client):
                out = self.run_zsh(client)
                self.assertEqual(out.returncode, 0, out.stderr)
                self.assertEqual(out.stdout.strip(), f"{FAKE_CTX}|{FAKE_EXC}|unset")

    def test_no_secrets_file_starts_client_without_mcp_keys(self):
        for client in ("claude", "opencode", "codex"):
            with self.subTest(client=client):
                out = self.run_zsh(client, use_secrets=False)
                self.assertEqual(out.returncode, 0, out.stderr)
                self.assertEqual(out.stdout.strip(), "unset|unset|unset")

    def test_missing_mcp_key_leaves_the_client_running(self):
        self.write_secrets(f"CONTEXT7_API_KEY={FAKE_CTX}\nOTHER={FAKE_OTHER}\n")
        for client in ("claude", "opencode", "codex"):
            with self.subTest(client=client):
                out = self.run_zsh(client)
                self.assertEqual(out.returncode, 0, out.stderr)
                self.assertEqual(out.stdout.strip(), f"{FAKE_CTX}|unset|unset")

    def test_missing_mcp_keys_still_run_each_client(self):
        self.write_secrets(f"OTHER={FAKE_OTHER}\n")
        for client in ("claude", "opencode", "codex"):
            with self.subTest(client=client):
                out = self.run_zsh(client)
                self.assertEqual(out.returncode, 0, out.stderr)
                self.assertEqual(out.stdout.strip(), "unset|unset|unset")

    def test_hclaude_alias_starts_headroom_with_telemetry_off_and_two_keys(self):
        out = self.run_zsh("alias hclaude")
        self.assertEqual(out.returncode, 0, out.stderr)
        alias = out.stdout
        self.assertIn("HEADROOM_TELEMETRY=off", alias)
        self.assertIn("--optional CONTEXT7_API_KEY EXCALIDRAW_API_KEY --", alias)
        self.assertIn("headroom wrap claude", alias)
        self.assertNotIn("umask", alias)

    def test_hclaude_runs_headroom_with_the_two_keys(self):
        self.write_secrets(f"CONTEXT7_API_KEY={FAKE_CTX}\nEXCALIDRAW_API_KEY={FAKE_EXC}\nOTHER={FAKE_OTHER}\n")
        out = self.run_zsh("eval \"$(alias hclaude | sed \"s/^hclaude=//; s/^'//; s/'\\$//\")\"")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertIn(f"{FAKE_CTX}|{FAKE_EXC}|unset", out.stdout)

    def test_hclaude_runs_headroom_when_an_mcp_key_is_missing(self):
        self.write_secrets(f"CONTEXT7_API_KEY={FAKE_CTX}\n")
        out = self.run_zsh("eval \"$(alias hclaude | sed \"s/^hclaude=//; s/^'//; s/'\\$//\")\"")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertIn(f"{FAKE_CTX}|unset|unset", out.stdout)


if __name__ == "__main__":
    unittest.main()
