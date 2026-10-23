"""Tests for scripts/review-reply (plan C's Pi side of a review batch).

The CLI answers one file of a batch the pane queued, writing plan B's thread format and plan C's
queue update. Each test builds a throwaway worktree under a temp dir, so no real `.pi/` is touched.
Stdlib only.
"""
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from urllib.parse import quote

SCRIPTS = Path(__file__).resolve().parent.parent
CLI = SCRIPTS / "review-reply"


def encode(part):
    return quote(part, safe="!~*'()")


class Worktree(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="review-reply-"))
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)
        self.worktree = self.root / "work"
        self.threads = self.worktree / ".pi" / "agent-review" / "threads"
        self.queue_file = self.threads / "queue.jsonl"
        self.threads.mkdir(parents=True)

    # -- fixtures -------------------------------------------------------------------------------
    def batch(self, **over):
        row = {
            "id": "b1",
            "agent": "pi:p1",
            "entryIds": ["e1"],
            "state": "delivered",
            "queuedAt": "2026-10-23T10:00:00.000Z",
            "deliveredAt": "2026-10-23T10:01:00.000Z",
            "model": "opencode-go/flash",
            "effort": "high",
        }
        row.update(over)
        return row

    def entry(self, **over):
        row = {
            "id": "e1",
            "at": "2026-10-23T10:00:00.000Z",
            "agent": "pi:p1",
            "file": "src/a.ts",
            "kind": "comment",
            "author": "person",
            "text": "why?",
        }
        row.update(over)
        return row

    def write_queue(self, *batches):
        self.queue_file.write_text("".join(json.dumps(row) + "\n" for row in batches))

    def thread_file(self, agent="pi:p1", file="src/a.ts"):
        return self.threads / encode(agent) / f"{encode(file)}.jsonl"

    def write_thread(self, *entries, agent="pi:p1", file="src/a.ts"):
        path = self.thread_file(agent, file)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("".join(json.dumps(row) + "\n" for row in entries))

    def read_thread(self, agent="pi:p1", file="src/a.ts"):
        path = self.thread_file(agent, file)
        return [json.loads(line) for line in path.read_text().splitlines()]

    def queue(self):
        return [json.loads(line) for line in self.queue_file.read_text().splitlines()]

    def run_cli(self, *args, worktree=None):
        return subprocess.run(
            [sys.executable, str(CLI), "--worktree", str(worktree or self.worktree), *args],
            capture_output=True,
            text=True,
        )

    def reply(self, *extra, file="src/a.ts", verdict="agree", text="ok", worktree=None):
        return self.run_cli("--batch", "b1", "--file", file, "--verdict", verdict, "--text", text, *extra, worktree=worktree)

    # -- tests ----------------------------------------------------------------------------------
    def test_a_reply_is_written_and_the_batch_is_answered(self):
        self.write_queue(self.batch())
        self.write_thread(self.entry(kind="patch", patch="--- a\n+++ b\n"))

        result = self.reply("--entry", "e1")

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("reply recorded for src/a.ts", result.stdout)
        rows = self.read_thread()
        self.assertEqual(len(rows), 2)
        reply = rows[1]
        self.assertEqual(reply["agent"], "pi:p1")
        self.assertEqual(reply["file"], "src/a.ts")
        self.assertEqual(reply["kind"], "reply")
        self.assertEqual(reply["author"], "agent")
        self.assertEqual(reply["text"], "ok")
        self.assertEqual(reply["batch"], "b1")
        self.assertEqual(reply["verdict"], "agree")
        self.assertEqual(reply["replyTo"], "e1")
        self.assertEqual(reply["model"], "opencode-go/flash")
        self.assertEqual(reply["effort"], "high")
        self.assertNotEqual(reply["id"], "e1")
        self.assertRegex(reply["at"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$")
        latest = self.queue()[-1]
        self.assertEqual((latest["id"], latest["state"]), ("b1", "answered"))
        self.assertIn("answeredAt", latest)

    def test_a_clapback_carries_its_reason_and_the_alternative_patch(self):
        self.write_queue(self.batch())
        self.write_thread(self.entry(kind="patch", patch="--- a\n+++ b\n"))
        patch = self.root / "alt.diff"
        patch.write_text("--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-1\n+2\n")

        result = self.reply("--verdict", "clapback", "--text", "that drops the guard", "--patch-file", str(patch))

        self.assertEqual(result.returncode, 0, result.stderr)
        reply = self.read_thread()[1]
        self.assertEqual(reply["kind"], "clapback")
        self.assertEqual(reply["verdict"], "clapback")
        self.assertEqual(reply["text"], "that drops the guard")
        self.assertEqual(reply["patch"], patch.read_text())

    def test_an_unknown_batch_is_refused_and_writes_nothing(self):
        self.write_queue(self.batch())
        self.write_thread(self.entry())
        before = self.queue_file.read_text()

        result = self.reply("--batch", "nope", file="src/a.ts")

        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stderr.strip(), "unknown or undelivered review batch nope")
        self.assertEqual(len(self.read_thread()), 1)
        self.assertEqual(self.queue_file.read_text(), before)

    def test_a_batch_that_was_never_delivered_is_refused(self):
        self.write_queue(self.batch(state="queued", deliveredAt=None))
        self.write_thread(self.entry())

        result = self.reply()

        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stderr.strip(), "unknown or undelivered review batch b1")
        self.assertEqual(len(self.read_thread()), 1)

    def test_a_later_queue_line_wins(self):
        self.write_queue(self.batch(state="queued"), self.batch(state="delivered"))
        self.write_thread(self.entry())

        result = self.reply()

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(self.read_thread()), 2)

    def test_a_duplicate_reply_is_ignored(self):
        self.write_queue(self.batch(entryIds=["e1", "e2"]))
        self.write_thread(self.entry(id="e1"))
        self.write_thread(self.entry(id="e2", file="src/b.ts"), file="src/b.ts")

        first = self.reply(text="first")
        second = self.reply(text="second")

        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertIn("already answered src/a.ts in batch b1", second.stdout)
        self.assertEqual([row for row in self.read_thread() if row.get("batch") == "b1"], self.read_thread()[1:])
        self.assertEqual(len(self.read_thread()), 2)
        self.assertEqual(self.read_thread()[1]["text"], "first")
        # The batch waited: one file answered leaves it delivered.
        self.assertEqual(self.queue()[-1]["state"], "delivered")

        self.assertEqual(self.reply(file="src/b.ts", text="ok").returncode, 0)
        again = self.reply(file="src/b.ts", text="redelivered")
        self.assertIn("already answered", again.stdout)
        self.assertEqual(len([row for row in self.read_thread(file="src/b.ts") if row.get("batch") == "b1"]), 1)
        self.assertEqual(self.queue()[-1]["state"], "answered")

    def test_a_missing_patch_file_is_refused_and_writes_nothing(self):
        self.write_queue(self.batch())
        self.write_thread(self.entry())

        result = self.reply("--patch-file", str(self.root / "absent.diff"))

        self.assertEqual(result.returncode, 2)
        self.assertIn("cannot read patch file", result.stderr)
        self.assertEqual(len(self.read_thread()), 1)

    def test_the_worktree_is_resolved_to_the_repository_root(self):
        if shutil.which("git") is None:
            self.skipTest("git is not installed")
        subprocess.run(["git", "init", "-q", str(self.worktree)], check=True, capture_output=True)
        subdirectory = self.worktree / "src"
        subdirectory.mkdir()
        self.write_queue(self.batch())
        self.write_thread(self.entry())

        result = self.reply(worktree=subdirectory)

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(self.read_thread()), 2)

    def test_the_thread_path_matches_the_mod_encoding(self):
        self.write_queue(self.batch(agent="claude:s1"))
        self.write_thread(self.entry(agent="claude:s1", file="src/a b.ts"), agent="claude:s1", file="src/a b.ts")

        result = self.reply(file="src/a b.ts", worktree=self.worktree)

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((self.threads / "claude%3As1" / "src%2Fa%20b.ts.jsonl").is_file())


if __name__ == "__main__":
    unittest.main()
