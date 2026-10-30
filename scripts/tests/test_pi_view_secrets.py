"""pi-view loads ~/secrets/.env at run time, so a dispatch gets its keys although pueue-safe
kept them out of pueue's state file.

Run: python3 scripts/tests/test_pi_view_secrets.py
"""

import subprocess
import tempfile
import unittest
from pathlib import Path

PI_VIEW = Path(__file__).resolve().parent.parent / "pi-view"


class PiViewSecrets(unittest.TestCase):
    def run_view(self, secrets_text=None, extra_env=None):
        tmp = Path(tempfile.mkdtemp())
        secrets = tmp / ".env"
        if secrets_text is not None:
            secrets.write_text(secrets_text)
        # Outside herdr (no HERDR_ENV), pi-view runs its arguments directly.
        env = {"PATH": "/usr/bin:/bin", "HOME": str(tmp), "TMPDIR": str(tmp), "PI_VIEW_SECRETS": str(secrets)}
        env.update(extra_env or {})
        cmd = [str(PI_VIEW), "sh", "-c", 'printf "%s|%s|%s" "${CONTEXT7_API_KEY-unset}" "${QUOTED-unset}" "${KEEP-unset}"']
        return subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=30)

    def test_secrets_reach_the_command(self):
        out = self.run_view('CONTEXT7_API_KEY=ctx7sk-test\nexport QUOTED="a b"\n', {"KEEP": "k"})
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(out.stdout, "ctx7sk-test|a b|k")

    def test_missing_secrets_file_still_runs(self):
        out = self.run_view(None, {"KEEP": "k"})
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(out.stdout, "unset|unset|k")


if __name__ == "__main__":
    unittest.main()
