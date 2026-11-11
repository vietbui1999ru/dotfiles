"""Tests for scripts/full-mode (S4 full mode). The script reads HOME from the password
database, so these tests load it as a module and point GATE_DIR at a temp dir. Stdlib only.
"""
import contextlib
import importlib.machinery
import importlib.util
import io
import json
import os
import tempfile
import time
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "full-mode"


def load():
    loader = importlib.machinery.SourceFileLoader("full_mode", str(SCRIPT))
    mod = importlib.util.module_from_spec(importlib.util.spec_from_loader("full_mode", loader))
    loader.exec_module(mod)
    return mod


class FullModeTest(unittest.TestCase):
    def setUp(self):
        self.fm = load()
        self.tmp = tempfile.TemporaryDirectory()
        self.fm.GATE_DIR = os.path.join(self.tmp.name, "full")

    def tearDown(self):
        self.tmp.cleanup()

    def run_cmd(self, *argv, stdin="{}", env=None):
        out, code = io.StringIO(), 0
        old_env, old_stdin = dict(os.environ), self.fm.sys.stdin
        os.environ.pop("CLAUDE_FULL_WS", None)
        os.environ.update(env or {})
        self.fm.sys.stdin = io.StringIO(stdin)
        try:
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
                self.fm.main(list(argv))
        except SystemExit as e:
            code = e.code or 0
        finally:
            os.environ.clear(); os.environ.update(old_env); self.fm.sys.stdin = old_stdin
        return code, out.getvalue()

    def write(self, ws, line):
        os.makedirs(self.fm.GATE_DIR, exist_ok=True)
        Path(self.fm.GATE_DIR, ws).write_text(line)

    def test_arm_then_check(self):
        self.assertEqual(self.run_cmd("arm", "sbx-full", "feat/sbx-full", "2")[0], 0)
        self.assertEqual(self.run_cmd("check", "sbx-full")[0], 0)
        self.assertEqual(os.stat(Path(self.fm.GATE_DIR, "sbx-full")).st_mode & 0o777, 0o600)

    def test_arm_bounds_and_branch(self):
        for hours in ("0", "9", "x", "-1"):
            self.assertEqual(self.run_cmd("arm", "a", "feat/a", hours)[0], 2, hours)
        self.assertEqual(self.run_cmd("arm", "a", "feat/b", "1")[0], 2)
        self.assertEqual(self.run_cmd("arm", "../x", "feat/x", "1")[0], 2)

    def test_check_missing_expired_malformed(self):
        self.assertEqual(self.run_cmd("check", "a")[0], 1)
        self.write("a", f"expires={int(time.time()) - 1} branch=feat/a\n")
        self.assertEqual(self.run_cmd("check", "a")[0], 1)
        self.write("a", "expires=9999999999 branch=main\n")
        self.assertEqual(self.run_cmd("check", "a")[0], 1)
        self.write("a", "garbage\n")
        self.assertEqual(self.run_cmd("check", "a")[0], 1)

    def test_clear(self):
        self.run_cmd("arm", "a", "feat/a", "1")
        self.assertEqual(self.run_cmd("clear", "a")[0], 0)
        self.assertEqual(self.run_cmd("check", "a")[0], 1)
        self.assertEqual(self.run_cmd("clear", "a")[0], 0)

    def test_hook(self):
        self.assertEqual(self.run_cmd("hook"), (0, ""))
        self.run_cmd("arm", "a", "feat/a", "1")
        self.assertEqual(self.run_cmd("hook", env={"CLAUDE_FULL_WS": "a"}), (0, ""))
        for ws in ("b", "../a", ""):
            code, out = self.run_cmd("hook", env={"CLAUDE_FULL_WS": ws})
            decision = json.loads(out)["hookSpecificOutput"]["permissionDecision"]
            self.assertEqual((code, decision), (0, "deny"), ws)


if __name__ == "__main__":
    unittest.main()
