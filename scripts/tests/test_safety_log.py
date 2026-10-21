"""Tests for the bash-safety block log (SPEC: feat/safety-block-log).

HookLog runs claude/.claude/hooks/enforce-bash-safety.sh with SAFETY_LOG_DIR in a
temp dir, so the real log under ~/.claude/state is never touched. Cli does the
same for scripts/safety-log. Stdlib only.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent
ROOT = SCRIPTS.parent
HOOK = ROOT / "claude" / ".claude" / "hooks" / "enforce-bash-safety.sh"
CLI = SCRIPTS / "safety-log"
FIELDS = {"id", "ts", "session", "cwd", "transcript", "rule", "command", "reason"}
# Fixture paths for the hook payload: strings the hook only records, never opens.
CWD = "/work/x"
TRANSCRIPT = "/work/t.jsonl"
NOW = datetime.now().astimezone()


class HookLog(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="safety-log-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.dir = self.tmp / "state"
        self.log = self.dir / "bash-safety-blocks.jsonl"

    def run_hook(self, command, log_dir=None):
        payload = json.dumps({"tool_input": {"command": command}, "cwd": CWD,
                              "session_id": "sess-123", "transcript_path": TRANSCRIPT})
        env = {**os.environ, "SAFETY_LOG_DIR": str(log_dir or self.dir)}
        return subprocess.run(["bash", str(HOOK)], input=payload, env=env,
                              capture_output=True, text=True)

    def entries(self, path=None):
        path = path or self.log
        return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []

    def test_block_appends_one_entry(self):
        r = self.run_hook("git clean -fd")
        self.assertEqual(r.returncode, 2)
        self.assertIn("BLOCKED: git clean -f", r.stderr)
        [entry] = self.entries()
        self.assertEqual(set(entry), FIELDS)
        self.assertRegex(entry["id"], r"^[0-9a-f]{12}$")
        datetime.fromisoformat(entry["ts"])
        self.assertEqual((entry["session"], entry["cwd"], entry["transcript"]),
                         ("sess-123", CWD, TRANSCRIPT))
        self.assertEqual(entry["rule"], "git-clean-force")
        self.assertEqual(entry["command"], "git clean -fd")
        self.assertTrue(entry["reason"].startswith("BLOCKED: git clean -f"))

    def test_allowed_appends_nothing(self):
        r = self.run_hook("git status")
        self.assertEqual((r.returncode, r.stdout, r.stderr), (0, "", ""))
        self.assertEqual(self.entries(), [])

    def test_redaction(self):
        secrets = ["abc123secret", "xyzBearerToken", "ghp_" + "A" * 36,
                   "sk-proj-abcdefghij1234567890", "AKIAABCDEFGHIJKLMNOP", "hunter2"]
        command = (f"GITHUB_TOKEN={secrets[0]} DB_PASSWORD={secrets[5]} git clean -fd && "
                   f"curl -H 'Authorization: Bearer {secrets[1]}' https://x/?k={secrets[2]} "
                   f"{secrets[3]} {secrets[4]}")
        self.assertEqual(self.run_hook(command).returncode, 2)
        [entry] = self.entries()
        for secret in secrets:
            self.assertNotIn(secret, entry["command"])
        self.assertIn("[REDACTED]", entry["command"])
        self.assertIn("git clean -fd", entry["command"])
        self.assertIn("curl -H", entry["command"])

    def test_truncation(self):
        self.assertEqual(self.run_hook("git clean -fd " + "x" * 5000).returncode, 2)
        [entry] = self.entries()
        self.assertTrue(entry["command"].endswith("…[truncated]"))
        self.assertLessEqual(len(entry["command"]), 4000 + len("…[truncated]"))

    def test_unwritable_log_still_blocks(self):
        blocker = self.tmp / "not-a-dir"
        blocker.write_text("x")
        r = self.run_hook("git clean -fd", log_dir=blocker)
        self.assertEqual(r.returncode, 2)
        self.assertIn("BLOCKED: git clean -f", r.stderr)
        self.assertEqual(r.stdout, "")

    def test_rotation(self):
        self.dir.mkdir()
        old = json.dumps({"id": "0" * 12, "rule": "old"})
        self.log.write_text((old + "\n") * 2000)
        self.assertEqual(self.run_hook("git clean -fd").returncode, 2)
        self.assertEqual(len(self.entries(self.dir / "bash-safety-blocks.jsonl.1")), 2000)
        [entry] = self.entries()
        self.assertEqual(entry["rule"], "git-clean-force")


class Cli(unittest.TestCase):
    """scripts/safety-log against fixture logs, with SAFETY_LOG_DIR in a temp dir."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="safety-cli-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.dir = self.tmp / "state"
        self.dir.mkdir()
        self.log = self.dir / "bash-safety-blocks.jsonl"
        self.rotated = self.dir / "bash-safety-blocks.jsonl.1"
        self.verdicts = self.dir / "bash-safety-verdicts.jsonl"

    def block(self, ident, ts, session, rule, command):
        return {"id": ident, "ts": ts, "session": session, "cwd": f"/work/{ident}",
                "transcript": f"/transcripts/{ident}.jsonl", "rule": rule, "command": command,
                "reason": f"BLOCKED: {rule} ({ident})"}

    def write(self, path, rows):
        path.write_text("".join(json.dumps(row) + "\n" for row in rows))

    def ago(self, **span):
        return (NOW - timedelta(**span)).isoformat(timespec="seconds")

    def cli(self, *args, log_dir=None):
        env = {**os.environ, "SAFETY_LOG_DIR": str(log_dir or self.dir)}
        return subprocess.run([sys.executable, str(CLI), *args], env=env,
                              capture_output=True, text=True)

    def fixture(self):
        """Newest is a1 (this session), then b2 in the rotated file, then c3 two days old."""
        mine = self.block("a1b2c3d4e5f6", self.ago(minutes=5), "11112222-3333-4444-5555-666677778888",
                          "git-clean-force", "git clean -fd")
        other = self.block("b2c3d4e5f6a1", self.ago(hours=3), "99998888-7777-6666-5555-444433332222",
                           "reset-hard-remote", "git reset --hard origin/main")
        old = self.block("c3d4e5f6a1b2", self.ago(days=2), "11112222-3333-4444-5555-666677778888",
                         "force-push-main", "git push -f origin main")
        self.write(self.log, [old, mine])
        self.write(self.rotated, [other])
        return mine, other, old

    def test_list_and_filters(self):
        mine, other, old = self.fixture()
        lines = self.cli().stdout.splitlines()
        self.assertEqual(len(lines), 3)
        # Newest first across both files, one line each: time, session, rule, verdict, command.
        self.assertIn(mine["id"], [mine["id"]])
        self.assertIn("git clean -fd", lines[0])
        self.assertIn("git reset --hard origin/main", lines[1])
        self.assertIn("git push -f origin main", lines[2])
        self.assertIn("pending", lines[0])
        self.assertIn("11112222", lines[0])
        self.assertNotIn("11112222-3333", lines[0])
        self.assertEqual(len(self.cli("--since", "1h").stdout.splitlines()), 1)
        self.assertEqual(len(self.cli("--since", "1d").stdout.splitlines()), 2)
        self.assertEqual(len(self.cli("--since", self.ago(days=1)[:10]).stdout.splitlines()), 2)

        same_session = self.cli("--session", "11112222-3333-4444-5555-666677778888").stdout.splitlines()
        self.assertEqual(len(same_session), 2)
        self.assertTrue(all("11112222" in line for line in same_session))
        self.assertEqual(len(self.cli("--session", "11112222").stdout.splitlines()), 2)
        self.assertEqual(len(self.cli("--session", "99998888").stdout.splitlines()), 1)

        one_rule = self.cli("--rule", "force-push-main").stdout.splitlines()
        self.assertEqual(len(one_rule), 1)
        self.assertIn("git push -f origin main", one_rule[0])
        self.assertEqual(self.cli("--rule", "no-such-rule").stdout, "")
        self.assertEqual(len(self.cli("--rule", "git-clean-force", "--pending").stdout.splitlines()), 1)

        self.assertEqual(self.cli("mark", mine["id"], "ok").returncode, 0)
        pending = self.cli("--pending").stdout.splitlines()
        self.assertEqual(len(pending), 2)
        self.assertFalse(any("git clean -fd" in line for line in pending))
        self.assertIn("ok", self.cli().stdout.splitlines()[0])
        del other, old

    def test_mark(self):
        mine, _, _ = self.fixture()
        unknown = self.cli("mark", "0" * 12, "ok")
        self.assertEqual(unknown.returncode, 2)
        self.assertIn("no block with id", unknown.stderr)
        self.assertFalse(self.verdicts.exists())

        self.assertEqual(self.cli("mark", mine["id"], "ok").returncode, 0)
        [record] = [json.loads(line) for line in self.verdicts.read_text().splitlines()]
        self.assertEqual((record["id"], record["verdict"]), (mine["id"], "ok"))
        datetime.fromisoformat(record["ts"])
        self.assertIn("ok", self.cli().stdout.splitlines()[0])
        self.assertIn("pending", self.cli().stdout.splitlines()[1])

        # A second verdict appends; the last one wins in the listing.
        self.assertEqual(self.cli("mark", mine["id"], "false-positive").returncode, 0)
        self.assertEqual(len(self.verdicts.read_text().splitlines()), 2)
        self.assertIn("false-positive", self.cli().stdout.splitlines()[0])
        self.assertEqual(len(self.cli("--pending").stdout.splitlines()), 2)

        # An unknown verdict choice is refused before anything is written.
        before = self.verdicts.read_text()
        self.assertEqual(self.cli("mark", mine["id"], "maybe").returncode, 2)
        self.assertEqual(self.verdicts.read_text(), before)
        self.assertEqual(self.cli("mark", "f" * 12, "ok", log_dir=self.tmp / "empty").returncode, 2)
        self.assertFalse((self.tmp / "empty" / "bash-safety-verdicts.jsonl").exists())

    def test_show_json_false_positives(self):
        mine, other, old = self.fixture()
        shown = self.cli("show", mine["id"])
        self.assertEqual(shown.returncode, 0)
        self.assertIn(mine["reason"], shown.stdout)
        self.assertIn(mine["cwd"], shown.stdout)
        self.assertIn(mine["transcript"], shown.stdout)
        self.assertIn("git clean -fd", shown.stdout)
        self.assertNotEqual(self.cli("show", "0" * 12).returncode, 0)

        self.assertEqual(self.cli("mark", mine["id"], "false-positive").returncode, 0)
        self.assertEqual(self.cli("mark", other["id"], "false-positive").returncode, 0)
        self.assertEqual(self.cli("mark", old["id"], "ok").returncode, 0)

        listed = json.loads(self.cli("--json").stdout)
        self.assertEqual([row["id"] for row in listed], [mine["id"], other["id"], old["id"]])
        self.assertEqual([row["verdict"] for row in listed], ["false-positive", "false-positive", "ok"])
        self.assertEqual(set(listed[0]), FIELDS | {"verdict"})
        self.assertEqual([row["rule"] for row in json.loads(self.cli("--json", "--rule", "reset-hard-remote").stdout)],
                         ["reset-hard-remote"])

        counts = self.cli("--false-positives").stdout
        self.assertRegex(counts, r"(?m)^\s*1\s+git-clean-force$")
        self.assertRegex(counts, r"(?m)^\s*1\s+reset-hard-remote$")
        self.assertNotIn("force-push-main", counts)
        self.assertEqual(self.cli("--false-positives", log_dir=self.tmp / "empty").stdout, "no false positives.\n")


if __name__ == "__main__":
    unittest.main()
