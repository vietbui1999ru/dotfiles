"""Tests for the focus hooks and pi-view refusal (SPEC: feat/focus, AC-5..8).

Runs scripts/focus prompt|guard|allow|check-dispatch in a temp HOME with a temp board, state
dir and git repo, so the person's real board and sessions are never touched. The hook JSON
goes in on stdin, as Claude Code sends it. Stdlib only.
"""
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent
ROOT = SCRIPTS.parent
CLI = SCRIPTS / "focus"
PI_VIEW = SCRIPTS / "pi-view"


def git(repo, *args):
    env = {**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t"}
    return subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, text=True, env=env).stdout


class HooksTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="focus-hooks-"))
        self.home = self.tmp / "home"
        self.home.mkdir()
        self.repos = self.home / "repos"
        self.repos.mkdir()
        self.board = self.tmp / "Focus.md"
        self.state = self.tmp / "state"
        self.env = {**os.environ, "HOME": str(self.home), "FOCUS_BOARD": str(self.board),
                    "FOCUS_STATE": str(self.state), "FOCUS_ROOTS": str(self.repos)}
        self.env.pop("CLAUDE_JOB_DIR", None)
        # Focus repo: acme-api with worktree on feat/x (the focus item). Outside repo: llm-wiki on main.
        self.acme = self.repos / "acme-api"
        self._repo(self.acme)
        git(self.acme, "branch", "feat/x")
        self.focus_wt = self.tmp / "focus-wt"
        git(self.acme, "worktree", "add", "-q", str(self.focus_wt), "feat/x")
        self.wiki = self.repos / "llm-wiki"
        self._repo(self.wiki)
        self.outside_wt = self.tmp / "outside"
        self.board.write_text(
            "work-repos: acme-api\n\n## Work\n- acme-api:feat/x | stage: build\n\n## Hobby\n\n## Frozen\n\n## Parked\n- keep\n",
            encoding="utf-8")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _repo(self, path):
        path.mkdir(parents=True)
        git(path, "init", "-q", "-b", "main")
        (path / "README").write_text("x")
        git(path, "add", "README")
        git(path, "commit", "-q", "-m", "init")

    def hook(self, *argv, data=None):
        return subprocess.run([str(CLI), *argv], input=json.dumps(data or {}), capture_output=True, text=True, env=self.env)


class PromptTest(HooksTest):
    def test_prompt_prints_both_slots_and_stage(self):
        r = self.hook("prompt", data={"session_id": "s1", "cwd": str(self.focus_wt)})
        self.assertEqual(r.returncode, 0)
        self.assertIn("acme-api:feat/x [build]", r.stdout)
        self.assertIn("hobby (empty)", r.stdout)
        self.assertIn("this session: focus", r.stdout)

    def test_prompt_says_read_only_outside_a_focus_item(self):
        r = self.hook("prompt", data={"session_id": "s2", "cwd": str(self.wiki)})
        self.assertEqual(r.returncode, 0)
        self.assertIn("this session: read-only", r.stdout)

    def test_prompt_records_start_cwd_once(self):
        self.hook("prompt", data={"session_id": "s3", "cwd": str(self.wiki)})
        self.hook("prompt", data={"session_id": "s3", "cwd": str(self.focus_wt)})
        sessions = json.loads((self.state / "sessions.json").read_text())
        self.assertEqual(sessions["s3"]["start_cwd"], str(self.wiki))

    def test_prompt_no_board_is_one_line(self):
        self.board.unlink()
        r = self.hook("prompt", data={"session_id": "s4", "cwd": str(self.wiki)})
        self.assertEqual((r.returncode, r.stdout.strip()), (0, "focus: no board"))


class GuardTest(HooksTest):
    def guard(self, cwd, tool, tool_input, session="g1"):
        # The first call records start_cwd, so a guard test starts the session in cwd.
        self.hook("prompt", data={"session_id": session, "cwd": cwd})
        return self.hook("guard", data={"session_id": session, "cwd": cwd, "tool_name": tool, "tool_input": tool_input})

    def denied(self, r):
        """The deny payload, or None when the guard allowed the call."""
        if not r.stdout.strip():
            return None
        return json.loads(r.stdout)["hookSpecificOutput"]

    def deny_of(self, r):
        """The deny payload, asserting the guard did deny."""
        payload = self.denied(r)
        assert payload is not None, "guard allowed a call that should be denied"
        return payload

    def test_guard_allows_writes_when_session_started_in_focus(self):
        r = self.guard(str(self.focus_wt), "Write", {"file_path": str(self.focus_wt / "a.txt")}, session="gA")
        self.assertIsNone(self.denied(r))

    def test_guard_denies_write_outside_focus(self):
        r = self.guard(str(self.wiki), "Write", {"file_path": str(self.wiki / "a.txt")}, session="gB")
        self.assertEqual(self.deny_of(r)["permissionDecision"], "deny")

    def test_guard_denial_names_focus_item_and_switch(self):
        r = self.guard(str(self.wiki), "Edit", {"file_path": str(self.wiki / "a.txt")}, session="gC")
        reason = self.deny_of(r)["permissionDecisionReason"]
        self.assertIn("acme-api:feat/x", reason)
        self.assertIn("scripts/focus switch", reason)
        self.assertIn("scripts/focus allow", reason)

    def test_guard_allows_focus_board_and_memory_and_plans(self):
        for target in [self.board, self.home / ".claude" / "projects" / "p" / "memory" / "m.md",
                       self.home / ".claude" / "plans" / "p.md"]:
            with self.subTest(target=str(target)):
                r = self.guard(str(self.wiki), "Write", {"file_path": str(target)}, session=f"gD{target.name}")
                self.assertIsNone(self.denied(r))

    def test_guard_allows_job_tmp_via_env(self):
        job = self.home / ".claude" / "jobs" / "j1" / "tmp"
        job.mkdir(parents=True)
        self.env["CLAUDE_JOB_DIR"] = str(self.home / ".claude" / "jobs" / "j1")
        r = self.guard(str(self.wiki), "Write", {"file_path": str(job / "out.txt")}, session="gE")
        self.assertIsNone(self.denied(r))

    def test_guard_denies_writing_bash_outside_focus(self):
        for command in ["echo x > notes.md", "tee out.txt", "rm -rf build", "mv a b", "cp a b",
                        "mkdir d", "touch f", "sed -i s/a/b/ f", "git commit -m x", "git push",
                        "git worktree add ../x", "vim file", "jj commit -m x"]:
            with self.subTest(command=command):
                r = self.guard(str(self.wiki), "Bash", {"command": command}, session=f"gF{abs(hash(command))}")
                self.assertEqual(self.deny_of(r)["permissionDecision"], "deny", command)

    def test_guard_allows_read_only_bash_outside_focus(self):
        for command in ["ls -la", "git status", "rg foo", "cat README", "echo hi > /dev/null", "git log --oneline"]:
            with self.subTest(command=command):
                r = self.guard(str(self.wiki), "Bash", {"command": command}, session=f"gG{abs(hash(command))}")
                self.assertIsNone(self.denied(r), command)

    def test_guard_allows_bash_writing_only_to_allowlisted_paths(self):
        target = self.board
        r = self.guard(str(self.wiki), "Bash", {"command": f"echo x >> {target}"}, session="gH")
        self.assertIsNone(self.denied(r))


class BlockerTest(HooksTest):
    def test_blocker_allow_lets_session_write_there_and_records_under_focus_item(self):
        self.hook("prompt", data={"session_id": "b1", "cwd": str(self.wiki)})
        r = self.hook("allow", str(self.focus_wt), "--session", "b1", "--blocker", "need the fix in acme-api")
        self.assertEqual(r.returncode, 0, r.stderr)
        sessions = json.loads((self.state / "sessions.json").read_text())
        self.assertIn(str(self.focus_wt.resolve()), sessions["b1"]["grants"])
        board = self.board.read_text()
        self.assertIn("  - blocker", board)
        self.assertIn("need the fix in acme-api", board)
        # The blocker sits under the focus item of the session's start repo, not the parked lines.
        work_idx = board.index("- acme-api:feat/x")
        blocker_idx = board.index("  - blocker")
        self.assertLess(work_idx, blocker_idx)
        self.assertLess(blocker_idx, board.index("## Frozen"))
        self.assertIn("- keep", board)

    def test_blocker_grant_allows_write_into_the_granted_worktree(self):
        blocked = self.repos / "other-wt"
        blocked.mkdir()
        self.hook("prompt", data={"session_id": "b2", "cwd": str(self.wiki)})
        self.hook("allow", str(blocked), "--session", "b2", "--blocker", "x")
        r = self.hook("guard", data={"session_id": "b2", "cwd": str(self.wiki), "tool_name": "Write",
                                     "tool_input": {"file_path": str(blocked / "fix.txt")}})
        self.assertEqual(r.stdout.strip(), "")

    def test_blocker_grant_is_session_scoped(self):
        # A blocker grant unlocks a worktree that is NOT a focus item; the target must sit outside focus.
        blocked = self.repos / "other-wt"
        blocked.mkdir()
        self.hook("prompt", data={"session_id": "b3", "cwd": str(self.wiki)})
        self.hook("allow", str(blocked), "--session", "b3", "--blocker", "x")
        mine = self.hook("guard", data={"session_id": "b3", "cwd": str(self.wiki), "tool_name": "Write",
                                        "tool_input": {"file_path": str(blocked / "fix.txt")}})
        self.assertEqual(mine.stdout.strip(), "")
        other = self.hook("guard", data={"session_id": "other", "cwd": str(self.wiki), "tool_name": "Write",
                                         "tool_input": {"file_path": str(blocked / "fix.txt")}})
        self.assertIn("deny", other.stdout)

    def test_blocker_requires_a_reason(self):
        self.hook("prompt", data={"session_id": "b4", "cwd": str(self.wiki)})
        r = subprocess.run([str(CLI), "allow", str(self.focus_wt), "--session", "b4", "--blocker", "  "],
                           capture_output=True, text=True, env=self.env)
        self.assertEqual(r.returncode, 1)


class PiDispatchTest(HooksTest):
    def run_pi_view(self, cwd):
        env = {**self.env, "PI_VIEW_SECRETS": str(self.tmp / "none.env")}
        return subprocess.run(["zsh", str(PI_VIEW), "pi", "--model", "x", "-p", "hi"], cwd=str(cwd),
                              capture_output=True, text=True, env=env)

    def test_pi_dispatch_refuses_outside_focus_with_the_shared_message(self):
        r = self.run_pi_view(self.wiki)
        self.assertEqual(r.returncode, 1)
        self.assertIn("read-only session", r.stderr)
        self.assertIn("scripts/focus switch", r.stderr)

    def test_pi_dispatch_writes_no_provenance_row_when_refused(self):
        ledger = self.home / ".claude" / "state"
        self.run_pi_view(self.wiki)
        self.assertFalse(ledger.exists() and any(ledger.iterdir()))

    def test_pi_dispatch_check_allows_focus_worktree(self):
        r = self.hook("check-dispatch", "--cwd", str(self.focus_wt))
        self.assertEqual(r.returncode, 0)

    def test_pi_dispatch_check_allows_when_no_board(self):
        self.board.unlink()
        r = self.hook("check-dispatch", "--cwd", str(self.wiki))
        self.assertEqual(r.returncode, 0)


if __name__ == "__main__":
    unittest.main()
