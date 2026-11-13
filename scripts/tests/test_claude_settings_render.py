"""Tests for scripts/claude-settings-render. Each test runs with HOME set to a temp
Linux-style home, so the rewrite is observable and the real ~/.claude and the
real dotfiles repo are never touched."""
import hashlib
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "claude-settings-render"

SOURCE = {
    "hooks": {"x": [{"command": "/Users/vietquocbui/dotfiles/scripts/hook --a"}]},
    "sandbox": {
        "enabled": True,
        "excludedCommands": [
            "/Users/vietquocbui/dotfiles/scripts/focus switch *",
            "/Users/vietquocbui/dotfiles/scripts/focus drop *",
        ],
        "filesystem": {
            "allowWrite": ["~/.pi"],
            "denyWrite": ["~/.claude/state/focus"],
        },
    },
}


class RenderTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.home = self.tmp / "home" / "tester"
        self.home.mkdir(parents=True)
        self.source = self.tmp / "source.json"
        self.source.write_text(json.dumps(SOURCE))
        self.target = self.home / ".claude" / "settings.json"
        self.state = self.home / ".local" / "state" / "claude-settings" / "rendered.sha256"

    def run_script(self, *extra, os_name="Linux", target=None):
        env = dict(os.environ, HOME=str(self.home), CLAUDE_SETTINGS_RENDER_OS=os_name)
        argv = [str(SCRIPT), "--source", str(self.source),
                "--target", str(target or self.target), "--state", str(self.state), *extra]
        return subprocess.run(argv, env=env, capture_output=True, text=True)

    def rendered(self):
        return json.loads(self.target.read_text())

    def test_prefix_rewritten_in_nested_strings(self):
        self.assertEqual(self.run_script().returncode, 0)
        out = self.rendered()
        home = str(self.home)
        self.assertEqual(out["hooks"]["x"][0]["command"], f"{home}/dotfiles/scripts/hook --a")
        self.assertEqual(out["sandbox"]["excludedCommands"][0],
                         f"{home}/dotfiles/scripts/focus switch *")
        self.assertNotIn("/Users/", self.target.read_text())

    def test_added_paths_present_and_not_duplicated(self):
        self.run_script()
        self.run_script("--force")
        fs = self.rendered()["sandbox"]["filesystem"]
        for p in ("~/.cache/uv", "~/.claude/plans"):
            self.assertEqual(fs["allowWrite"].count(p), 1)
        self.assertEqual(fs["denyWrite"].count("~/.config/pi-sandbox"), 1)
        self.assertIn("~/.pi", fs["allowWrite"])

    def test_refuses_on_darwin(self):
        result = self.run_script(os_name="Darwin")
        self.assertEqual(result.returncode, 1)
        self.assertFalse(self.target.exists())

    def test_refuses_target_inside_repo(self):
        repo = self.home / "dotfiles"
        result = self.run_script(target=repo / "claude" / "settings.json")
        self.assertEqual(result.returncode, 1)
        self.assertIn("dotfiles repo", result.stderr)
        self.assertFalse((repo / "claude" / "settings.json").exists())

    def test_symlink_target_replaced_destination_untouched(self):
        dest = self.tmp / "dest.json"
        dest.write_text("{}\n")
        self.target.parent.mkdir(parents=True)
        self.target.symlink_to(dest)
        self.assertEqual(self.run_script().returncode, 0)
        self.assertFalse(self.target.is_symlink())
        self.assertEqual(dest.read_text(), "{}\n")
        self.assertIn("sandbox", self.rendered())

    def test_hand_edited_target_refused_with_diff(self):
        self.assertEqual(self.run_script().returncode, 0)
        self.target.write_text(self.target.read_text().replace('"enabled": true', '"enabled": true, "x": 1'))
        result = self.run_script()
        self.assertEqual(result.returncode, 1)
        self.assertIn("---", result.stdout)
        self.assertIn('"x": 1', result.stdout)

    def test_force_overwrites_and_keeps_prev(self):
        self.run_script()
        edited = self.target.read_text() + " "
        self.target.write_text(edited)
        result = self.run_script("--force")
        self.assertEqual(result.returncode, 0)
        self.assertEqual(self.target.with_name("settings.json.prev").read_text(), edited)
        self.assertEqual(self.rendered()["sandbox"]["enabled"], True)

    def test_second_run_is_silent_noop(self):
        self.run_script()
        result = self.run_script()
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "")
        self.assertEqual(result.stderr, "")

    def test_check_prints_line_and_exits_zero(self):
        result = self.run_script("--check")
        self.assertEqual(result.returncode, 0)
        self.assertIn("stale or hand-edited", result.stdout)
        self.assertFalse(self.target.exists())

    def test_refuses_when_sandbox_disabled(self):
        data = json.loads(self.source.read_text())
        data["sandbox"]["enabled"] = False
        self.source.write_text(json.dumps(data))
        result = self.run_script()
        self.assertEqual(result.returncode, 1)
        self.assertIn("sandbox.enabled", result.stderr)
        self.assertFalse(self.target.exists())

    def test_state_hash_recorded(self):
        self.run_script()
        self.assertEqual(self.state.read_text().strip(),
                         hashlib.sha256(self.target.read_bytes()).hexdigest())

    def test_refuses_duplicate_keys(self):
        self.source.write_text(
            '{"sandbox": {"enabled": true}, "sandbox": {"enabled": false}}')
        result = self.run_script()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("duplicate key", result.stderr)
        self.assertFalse(self.target.exists())


if __name__ == "__main__":
    unittest.main()
