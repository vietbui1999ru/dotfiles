"""The pre-commit hook blocks a staged secret and lets clean or allow-marked content through."""
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

HOOK = Path(__file__).resolve().parent.parent / "hooks" / "pre-commit"
GIT = ["git", "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false"]
# Built at runtime so this file holds no key-shaped literal of its own.
FAKE_KEY = "sk-" + "a" * 32


class PreCommitHook(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.root, True)
        # A repo with a copy of the scanner beside the hook, mirroring scripts/ in the real tree.
        self.repo = self.root / "repo"
        (self.repo / "scripts" / "hooks").mkdir(parents=True)
        scripts = Path(__file__).resolve().parent.parent
        shutil.copy(scripts / "secret-scan", self.repo / "scripts" / "secret-scan")
        shutil.copy(scripts / "redact", self.repo / "scripts" / "redact")
        (self.repo / "scripts" / "secret-scan").chmod(0o755)
        (self.repo / "scripts" / "redact").chmod(0o755)
        hook = self.repo / "scripts" / "hooks" / "pre-commit"
        shutil.copy(HOOK, hook)
        hook.chmod(0o755)
        self.env = {**os.environ, "GIT_CONFIG_NOSYSTEM": "1",
                    "SECRETS_ENV": str(self.root / "no-such-env")}
        self.git("init", "-q", "-b", "main")
        (self.repo / "seed.txt").write_text("seed\n")
        self.git("add", "seed.txt")
        self.git("commit", "-q", "-m", "seed", hooks=False)
        (self.repo / ".git" / "hooks").mkdir(exist_ok=True)
        os.symlink(hook, self.repo / ".git" / "hooks" / "pre-commit")

    def git(self, *args, hooks=True):
        cmd = GIT if hooks else GIT + ["-c", "core.hooksPath=/dev/null"]
        return subprocess.run([*cmd, *args], cwd=self.repo, env=self.env, capture_output=True, text=True)

    def stage(self, name, text):
        (self.repo / name).write_text(text)
        self.git("add", name)

    def test_staged_key_blocks_the_commit(self):
        self.stage("cfg.txt", f"key = {FAKE_KEY}\n")
        r = self.git("commit", "-q", "-m", "bad")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("cfg.txt", r.stdout + r.stderr)
        self.assertIn("openai-style-key", r.stdout + r.stderr)
        self.assertNotIn(FAKE_KEY, r.stdout + r.stderr)
        self.assertIn("--no-verify", r.stdout + r.stderr)
        self.assertIn("secret-scan: allow", r.stdout + r.stderr)

    def test_clean_commit_passes(self):
        self.stage("ok.txt", "nothing to see\n")
        self.assertEqual(self.git("commit", "-q", "-m", "clean").returncode, 0)

    def test_key_in_working_tree_only_does_not_block(self):
        self.stage("ok.txt", "clean staged\n")
        (self.repo / "ok.txt").write_text(f"later {FAKE_KEY}\n")
        self.assertEqual(self.git("commit", "-q", "-m", "wt only").returncode, 0)

    def test_allow_marker_line_passes(self):
        self.stage("fixture.py", f'FAKE = "{FAKE_KEY}"  # secret-scan: allow\n')
        self.assertEqual(self.git("commit", "-q", "-m", "fixture").returncode, 0)


if __name__ == "__main__":
    unittest.main()
