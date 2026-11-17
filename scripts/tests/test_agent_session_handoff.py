"""Regression tests for agent-session worktree identity and index updates."""

import json
import os
import re
import subprocess
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "agent-session"


def run(*args, cwd=None, input=None, env=None):
    return subprocess.run(
        [str(SCRIPT), *map(str, args)], cwd=cwd, input=input, text=True, env=env,
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

    def prune(self, *extra):
        return run("prune", *extra, self.feature,
                   env={**os.environ, "XDG_STATE_HOME": str(self.base / "state")})

    @property
    def archive(self):
        return self.base / "state" / "agent-sessions-archive" / self.repo.name

    def age_note(self, name, days):
        stamp = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")
        path = self.inbox / name
        path.write_text(re.sub(r'(?m)^saved_at:.*$',
                               lambda m: "saved_at: " + json.dumps(stamp),
                               path.read_text()))

    def test_task_identity_survives_all_save_forms_and_reindex(self):
        for kind, stdin in [("session", False), ("spec", False), ("session", True)]:
            with self.subTest(kind=kind, stdin=stdin):
                args=["save", "--harness", "codex", "--task", "task-alpha", "--kind", kind]
                if stdin: args.append("--stdin")
                result=run(*args,self.feature,input="summary body" if stdin else None)
                self.assertEqual(result.returncode,0,result.stderr)
        result=run("index",self.feature)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual([row["task"] for row in self.index()["sessions"]],["task-alpha"]*3)

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

    def test_second_session_save_retires_previous_note(self):
        for goal in ("first goal", "second goal"):
            result = self.save(self.feature, goal)
            self.assertEqual(result.returncode, 0, result.stderr)
        rows = self.index()["sessions"]
        self.assertEqual(rows[0]["status"], "idle")
        self.assertIn("status: idle", (self.inbox / rows[0]["file"]).read_text())
        self.assertEqual(rows[1]["status"], "active")

    def test_save_from_other_harness_or_checkout_keeps_note_active(self):
        result = self.save(self.feature, "codex goal")
        self.assertEqual(result.returncode, 0, result.stderr)
        result = run("save", "--harness", "cc", "--goal", "x", self.feature)
        self.assertEqual(result.returncode, 0, result.stderr)
        result = self.save(self.repo, "main")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.index()["sessions"][0]["status"], "active")

    def test_spec_save_does_not_retire_session_note(self):
        result = self.save(self.feature, "session goal")
        self.assertEqual(result.returncode, 0, result.stderr)
        result = run("save", "--kind", "spec", "--harness", "codex", "--goal", "s", self.feature)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.index()["sessions"][0]["status"], "active")

    def save_two_and_age_first(self):
        for goal in ("old goal", "new goal"):
            result = self.save(self.feature, goal)
            self.assertEqual(result.returncode, 0, result.stderr)
        old, new = [row["file"] for row in self.index()["sessions"]]
        self.age_note(old, 40)
        return old, new

    def test_prune_archives_old_notes_and_rebuilds_index(self):
        old, new = self.save_two_and_age_first()
        result = self.prune("--days", "30")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((self.archive / old).exists())
        self.assertFalse((self.inbox / old).exists())
        self.assertTrue((self.inbox / new).exists())
        self.assertEqual([row["file"] for row in self.index()["sessions"]], [new])

    def test_prune_dry_run_moves_nothing(self):
        old, new = self.save_two_and_age_first()
        result = self.prune("--dry-run", "--days", "30")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(old, result.stdout + result.stderr)
        self.assertTrue((self.inbox / old).exists())
        self.assertTrue((self.inbox / new).exists())
        self.assertFalse(self.archive.exists())

    def test_prune_name_collision_gets_suffix(self):
        result = self.save(self.feature, "collision goal")
        self.assertEqual(result.returncode, 0, result.stderr)
        name = self.index()["sessions"][0]["file"]
        self.age_note(name, 40)
        self.archive.mkdir(parents=True)
        placeholder = self.archive / name
        placeholder.write_text("placeholder\n")
        result = self.prune("--days", "30")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(placeholder.read_text(), "placeholder\n")
        self.assertTrue((self.archive / f"{Path(name).stem}-1.md").exists())


if __name__ == "__main__":
    unittest.main()
