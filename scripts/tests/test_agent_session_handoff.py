"""Regression tests for agent-session worktree identity and index updates."""

import json
import subprocess
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "agent-session"


def run(*args, cwd=None, input=None):
    return subprocess.run(
        [str(SCRIPT), *map(str, args)], cwd=cwd, input=input, text=True,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )


class AgentSessionHandoffTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="agent session ")
        self.base = Path(self.temp.name)
        self.repo = self.base / "repo with spaces"
        self.repo.mkdir()
        subprocess.run(["git", "init", "-b", "main", str(self.repo)], check=True,
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        subprocess.run(["git", "-C", str(self.repo), "config", "user.email", "test@example.com"], check=True)
        subprocess.run(["git", "-C", str(self.repo), "config", "user.name", "Test"], check=True)
        (self.repo / "README").write_text("fixture\n")
        subprocess.run(["git", "-C", str(self.repo), "add", "README"], check=True)
        subprocess.run(["git", "-C", str(self.repo), "commit", "-m", "initial"], check=True,
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.feature = self.base / "feature checkout"
        subprocess.run(["git", "-C", str(self.repo), "worktree", "add", "-b", "feat/example",
                        str(self.feature)], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.inbox = self.repo / ".agents" / "sessions"

    def tearDown(self):
        self.temp.cleanup()

    def index(self):
        return json.loads((self.inbox / "index.json").read_text())

    def save(self, path, goal):
        return run("save", "--harness", "codex", "--goal", goal, path)

    def test_save_uses_worktree_identity_and_additive_metadata(self):
        (self.feature / "changed").write_text("feature state\n")
        result = self.save(self.feature, "feature goal")
        self.assertEqual(result.returncode, 0, result.stderr)
        row = self.index()["sessions"][0]
        self.assertEqual(row["branch"], "feat/example")
        self.assertEqual(row["worktree"], str(self.feature.resolve()))
        self.assertEqual(row["head"], subprocess.check_output(
            ["git", "-C", str(self.feature), "rev-parse", "HEAD"], text=True).strip())

    def test_unique_note_names_preserve_old_index_rows(self):
        old = {"file": "old.md", "kind": "session", "harness": "cc",
               "work_type": "general", "status": "idle", "goal": "old",
               "saved_at": "earlier", "branch": "main", "task": ""}
        self.inbox.mkdir(parents=True)
        (self.inbox / "index.json").write_text(json.dumps({"sessions": [old]}))
        results = [self.save(self.feature, "same goal") for _ in range(2)]
        self.assertTrue(all(r.returncode == 0 for r in results), [r.stderr for r in results])
        rows = self.index()["sessions"]
        self.assertEqual(len(rows), 3)
        self.assertEqual(rows[0], old)
        self.assertEqual(len({r["file"] for r in rows}), 3)

    def test_detached_head_has_empty_branch_and_current_head(self):
        head = subprocess.check_output(["git", "-C", str(self.feature), "rev-parse", "HEAD"], text=True).strip()
        subprocess.run(["git", "-C", str(self.feature), "checkout", "--detach", head], check=True,
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        result = self.save(self.feature, "detached task")
        self.assertEqual(result.returncode, 0, result.stderr)
        row = self.index()["sessions"][0]
        self.assertEqual(row["branch"], "")
        self.assertEqual(row["head"], head)

    def test_corrupt_index_is_preserved_and_save_fails(self):
        self.inbox.mkdir(parents=True)
        bad = b"{bad json\n"
        (self.inbox / "index.json").write_bytes(bad)
        result = self.save(self.feature, "must not replace index")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((self.inbox / "index.json").read_bytes(), bad)

    def test_unreadable_index_target_is_not_replaced(self):
        self.inbox.mkdir(parents=True)
        index_dir = self.inbox / "index.json"
        index_dir.mkdir()
        result = self.save(self.feature, "must preserve inaccessible index")
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(index_dir.is_dir())

    def test_template_save_keeps_identity_after_reindex(self):
        result = run("save", "--kind", "spec", "--harness", "codex",
                     "--goal", "template task", self.feature)
        self.assertEqual(result.returncode, 0, result.stderr)
        rebuilt = run("index", self.feature)
        self.assertEqual(rebuilt.returncode, 0, rebuilt.stderr)
        row = self.index()["sessions"][0]
        self.assertEqual(row["worktree"], str(self.feature.resolve()))
        self.assertEqual(row["head"], subprocess.check_output(
            ["git", "-C", str(self.feature), "rev-parse", "HEAD"], text=True).strip())
        note = (self.inbox / row["file"]).read_text()
        self.assertIn("kind: spec", note)
        self.assertIn("worktree:", note)
        self.assertIn("head:", note)

    def test_dangling_index_symlink_fails_closed(self):
        self.inbox.mkdir(parents=True)
        index = self.inbox / "index.json"
        index.symlink_to(self.inbox / "missing-index.json")
        result = self.save(self.feature, "must preserve dangling index")
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(index.is_symlink())

    def test_idle_validates_corrupt_index_before_editing_note(self):
        result = self.save(self.feature, "idle must preserve note")
        self.assertEqual(result.returncode, 0, result.stderr)
        row = self.index()["sessions"][0]
        note = self.inbox / row["file"]
        before = note.read_bytes()
        (self.inbox / "index.json").write_text("not json\n")
        result = run("idle", row["file"], self.feature)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(note.read_bytes(), before)

    def test_concurrent_save_idle_and_reindex_keep_every_saved_row(self):
        first = self.save(self.feature, "concurrent first")
        self.assertEqual(first.returncode, 0, first.stderr)
        existing = self.index()["sessions"][0]["file"]
        commands = [
            [str(SCRIPT), "save", "--harness", "codex", "--goal", f"task {i}", str(self.feature)]
            for i in range(8)
        ]
        commands += [[str(SCRIPT), "idle", existing, str(self.feature)],
                     [str(SCRIPT), "index", str(self.feature)]]
        procs = [subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                 for cmd in commands]
        outcomes = [p.communicate() + (p.returncode,) for p in procs]
        self.assertTrue(all(code == 0 for _, err, code in outcomes), outcomes)
        rows = self.index()["sessions"]
        self.assertEqual(len(rows), 9)
        self.assertEqual(len({r["file"] for r in rows}), 9)
        self.assertIn("status: idle", (self.inbox / existing).read_text())


if __name__ == "__main__":
    unittest.main()
