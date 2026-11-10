"""Tests for the focus board: caps and lifecycle (SPEC: feat/focus, AC-3, AC-4).

Each test runs scripts/focus in a temp dir with FOCUS_BOARD, FOCUS_STATE and FOCUS_ROOTS
pointed there, so the person's real board is never touched. Stdlib only.
"""
import contextlib
import importlib.machinery
import importlib.util
import io
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent


def _load_focus():
    """scripts/focus has no .py suffix, so load it by path."""
    loader = importlib.machinery.SourceFileLoader("focus_cli", str(SCRIPTS / "focus"))
    spec = importlib.util.spec_from_loader("focus_cli", loader)
    assert spec is not None, "scripts/focus is not loadable"
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


focus = _load_focus()

BOARD_HEAD = "work-repos: acme-api, acme-web\n\n"


def board_text(work=(), hobby=(), frozen=(), parked=()):
    def section(name, lines):
        return f"## {name}\n" + "".join(f"{line}\n" for line in lines) + "\n"
    return BOARD_HEAD + section("Work", work) + section("Hobby", hobby) + section("Frozen", frozen) + section("Parked", parked)


class BoardTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="focus-board-"))
        self.board = self.tmp / "Focus.md"
        self.env = {"FOCUS_BOARD": str(self.board), "FOCUS_STATE": str(self.tmp / "state"),
                    "FOCUS_ROOTS": str(self.tmp / "repos"), "HOME": str(self.tmp)}
        self.old = {k: os.environ.get(k) for k in self.env}
        os.environ.update(self.env)

    def tearDown(self):
        for k, v in self.old.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        shutil.rmtree(self.tmp, ignore_errors=True)

    def write(self, text):
        self.board.write_text(text, encoding="utf-8")

    def run_cli(self, *argv):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = focus.main(list(argv))
        return code, out.getvalue(), err.getvalue()


class CapsTest(BoardTest):
    def test_caps_status_is_clean_within_limits(self):
        self.write(board_text(work=["- acme-api:feat/x | stage: build"], hobby=["- dotfiles:feat/focus | stage: build"],
                              frozen=["- acme-api:feat/a | stage: plan"]))
        code, out, _ = self.run_cli("status")
        self.assertEqual(code, 0)
        self.assertIn("work:   acme-api:feat/x [build]", out)

    def test_caps_two_work_items_breach(self):
        self.write(board_text(work=["- acme-api:feat/x | stage: build", "- acme-web:feat/y | stage: plan"]))
        code, out, _ = self.run_cli("status")
        self.assertEqual(code, 1)
        self.assertIn("breach: Work holds 2 items", out)

    def test_caps_two_hobby_items_breach(self):
        self.write(board_text(hobby=["- dotfiles:a | stage: build", "- dotfiles:b | stage: spec"]))
        code, out, _ = self.run_cli("status")
        self.assertEqual(code, 1)
        self.assertIn("breach: Hobby holds 2 items", out)

    def test_caps_four_frozen_breach(self):
        self.write(board_text(frozen=[f"- acme-api:b{i} | stage: plan" for i in range(4)]))
        code, out, _ = self.run_cli("status")
        self.assertEqual(code, 1)
        self.assertIn("breach: Frozen holds 4 items", out)

    def test_caps_json_contract(self):
        self.write(board_text(work=["- acme-api:feat/x | stage: build"], parked=["- something the person wrote"]))
        code, out, _ = self.run_cli("status", "--json")
        data = json.loads(out)
        self.assertEqual(data["work"], {"key": "acme-api:feat/x", "stage": "build"})
        self.assertIsNone(data["hobby"])
        self.assertEqual(data["frozen"], [])
        self.assertEqual(data["parked"], ["something the person wrote"])
        self.assertEqual(data["breaches"], [])
        self.assertIn("read_only", data)

    def test_caps_json_names_the_board_path_under_focus_board(self):
        self.write(board_text(work=["- acme-api:feat/x | stage: build"]))
        code, out, _ = self.run_cli("status", "--json")
        self.assertEqual(json.loads(out)["board"], str(self.board))

    def test_caps_no_board_is_one_line_and_allows(self):
        self.assertFalse(self.board.exists())
        code, out, _ = self.run_cli("status")
        self.assertEqual((code, out.strip()), (0, "focus: no board"))


class LifecycleTest(BoardTest):
    def test_lifecycle_switch_freezes_old_item_and_takes_slot(self):
        self.write(board_text(work=["- acme-api:feat/x | stage: build"], parked=["- keep me"]))
        code, _, _ = self.run_cli("switch", "acme-web:feat/y", "--stage", "plan")
        self.assertEqual(code, 0)
        text = self.board.read_text()
        self.assertIn("## Work\n- acme-web:feat/y | stage: plan\n", text)
        self.assertIn("## Frozen\n- acme-api:feat/x | stage: build\n", text)
        self.assertIn("## Parked\n- keep me\n", text)

    def test_lifecycle_switch_pulls_key_out_of_frozen(self):
        self.write(board_text(work=["- acme-api:feat/x | stage: build"], frozen=["- acme-web:feat/y | stage: plan"]))
        self.run_cli("switch", "acme-web:feat/y")
        text = self.board.read_text()
        self.assertEqual(text.count("acme-web:feat/y"), 1)
        self.assertIn("## Work\n- acme-web:feat/y", text)

    def test_lifecycle_switch_refuses_at_three_frozen(self):
        frozen = [f"- acme-api:b{i} | stage: plan" for i in range(3)]
        self.write(board_text(work=["- acme-api:feat/x | stage: build"], frozen=frozen))
        code, _, err = self.run_cli("switch", "acme-web:feat/y")
        self.assertEqual(code, 1)
        self.assertIn("Frozen already holds 3", err)
        self.assertEqual(self.board.read_text(), board_text(work=["- acme-api:feat/x | stage: build"], frozen=frozen))

    def test_lifecycle_park_moves_to_end_of_parked(self):
        self.write(board_text(hobby=["- dotfiles:feat/focus | stage: build"], parked=["- first", "- second"]))
        code, _, _ = self.run_cli("park", "dotfiles:feat/focus")
        self.assertEqual(code, 0)
        text = self.board.read_text()
        parked = text.split("## Parked\n", 1)[1]
        items = [line for line in parked.splitlines() if line.startswith("- ")]
        self.assertEqual(items, ["- first", "- second", "- dotfiles:feat/focus"])
        self.assertNotIn("## Hobby\n- dotfiles", text)

    def test_lifecycle_stage_updates_line(self):
        self.write(board_text(work=["- acme-api:feat/x | stage: build"]))
        code, _, _ = self.run_cli("stage", "acme-api:feat/x", "review")
        self.assertEqual(code, 0)
        self.assertIn("- acme-api:feat/x | stage: review", self.board.read_text())

    def test_caps_freeform_line_counts(self):
        # The live board writes `- repo:branch: note` with no stage. It is still an item, with stage unknown.
        self.write(board_text(hobby=["- dotfiles:feat/focus: focus slots, guards, and the pane"]))
        code, out, _ = self.run_cli("status", "--json")
        data = json.loads(out)
        self.assertEqual(data["hobby"], {"key": "dotfiles:feat/focus", "stage": "?"})
        self.assertEqual(code, 0)

    def test_lifecycle_freeform_note_kept(self):
        note = "- dotfiles:feat/focus: focus slots, guards, and the pane"
        self.write(board_text(hobby=[note]))
        self.run_cli("stage", "dotfiles:feat/focus", "review")
        self.assertIn("- dotfiles:feat/focus: focus slots, guards, and the pane | stage: review", self.board.read_text())

    def test_lifecycle_round_trip_keeps_bytes(self):
        text = board_text(work=["- acme-api:feat/x | stage: build"], parked=["- free text, odd   spacing"])
        self.write(text)
        self.assertEqual(focus.Board(text).render(), text)

    def test_lifecycle_drop_keeps_branch_and_worktree_without_yes(self):
        repo = self._git_repo()
        self.write(board_text(hobby=["- dotfiles:feat/focus | stage: build"]))
        code, _, _ = self.run_cli("drop", "dotfiles:feat/focus")
        self.assertEqual(code, 0)
        self.assertNotIn("feat/focus", self.board.read_text())
        self.assertTrue((repo / "wt").exists())

    def test_lifecycle_drop_yes_removes_worktree_but_not_branch(self):
        repo = self._git_repo()
        self.write(board_text(hobby=["- dotfiles:feat/focus | stage: build"]))
        code, _, _ = self.run_cli("drop", "dotfiles:feat/focus", "--yes")
        self.assertEqual(code, 0)
        self.assertFalse((repo / "wt").exists())
        branches = subprocess.run(["git", "-C", str(repo), "branch", "--list", "feat/focus"], capture_output=True, text=True).stdout
        self.assertIn("feat/focus", branches)

    def _git_repo(self):
        """A temp dotfiles repo with feat/focus checked out in a linked worktree at <repo>/wt."""
        repo = self.tmp / "dotfiles"
        repo.mkdir()
        env = {**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t"}
        def git(*a):
            subprocess.run(["git", "-C", str(repo), *a], check=True, capture_output=True, env=env)
        git("init", "-q", "-b", "main")
        git("commit", "-q", "--allow-empty", "-m", "init")
        git("branch", "feat/focus")
        git("worktree", "add", "-q", str(repo / "wt"), "feat/focus")
        return repo


class PathsTest(BoardTest):
    """`status --json` names each board repo's main worktree (the Workspaces panel reads it)."""

    def make_repo(self, name, under="repos"):
        repo = self.tmp / under / name
        (repo / ".git").mkdir(parents=True)
        return repo

    def test_paths_lists_work_and_frozen_repos(self):
        work = self.make_repo("acme-api")
        frozen = self.make_repo("acme-web")
        self.write(board_text(work=["- acme-api:feat/x | stage: build"], frozen=["- acme-web:feat/y | stage: plan"]))
        code, out, _ = self.run_cli("status", "--json")
        data = json.loads(out)
        self.assertEqual(data["paths"], {"acme-api": str(work), "acme-web": str(frozen)})
        self.assertEqual(data["path_errors"], [])

    def test_paths_parked_free_text_adds_nothing(self):
        self.make_repo("acme-api")
        self.write(board_text(work=["- acme-api:feat/x | stage: build"], parked=["- other-repo:feat/z", "- free text, odd spacing"]))
        code, out, _ = self.run_cli("status", "--json")
        data = json.loads(out)
        self.assertEqual(list(data["paths"]), ["acme-api"])
        self.assertNotIn("other-repo", data["paths"])

    def test_paths_items_keep_key_and_stage_only(self):
        self.make_repo("acme-api")
        self.write(board_text(work=["- acme-api:feat/x | stage: build"], hobby=["- acme-api:feat/h: a note"]))
        code, out, _ = self.run_cli("status", "--json")
        data = json.loads(out)
        self.assertEqual(set(data["work"]), {"key", "stage"})
        self.assertEqual(set(data["hobby"]), {"key", "stage"})

    def test_paths_clash_is_left_out_and_named(self):
        self.make_repo("acme-api", under="repos")
        self.make_repo("acme-api", under="repos/second")
        self.write(board_text(work=["- acme-api:feat/x | stage: build"]))
        code, out, _ = self.run_cli("status", "--json")
        data = json.loads(out)
        self.assertEqual(data["paths"], {})
        self.assertEqual(data["path_errors"], ["acme-api"])


if __name__ == "__main__":
    unittest.main()
