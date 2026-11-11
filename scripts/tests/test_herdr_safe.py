"""Tests for scripts/herdr-safe: the fixed subset of hc and herdr-app a sandboxed agent may use.

Run: python3 scripts/tests/test_herdr_safe.py
"""

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

WRAPPER = Path(__file__).resolve().parent.parent / "herdr-safe"

# Stands in for hc and herdr-app: logs its argv; `get --json <t>` answers from STUB_TERMS.
STUB = """#!/usr/bin/env python3
import json, os, sys
with open(os.environ["STUB_LOG"], "a") as f:
    f.write(json.dumps(sys.argv[1:]) + "\\n")
if sys.argv[1:3] == ["get", "--json"]:
    t = json.loads(os.environ.get("STUB_TERMS", "{}")).get(sys.argv[3])
    if t is None:
        sys.exit(1)
    print(json.dumps({"address": sys.argv[3], "state": t[0], "foreground": {"argv": [t[1]]}}))
"""

TERMS = {"t1": ["live", "claude"], "t2": ["live", "/opt/bin/pi"], "t3": ["live", "/bin/zsh"],
         "t4": ["finished", "claude"], "pve2/t5": ["live", "claude"], "proxmox/t6": ["live", "claude"]}


def sh(*args, cwd):
    subprocess.run(args, cwd=cwd, check=True, capture_output=True)


class HerdrSafe(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp()).resolve()
        self.home = self.tmp / "home"
        self.log = self.tmp / "log"
        # herdr-safe reads HOME from the password database, not env: test a copy with it pinned.
        src = WRAPPER.read_text()
        line = "HOME = Path(pwd.getpwuid(os.getuid()).pw_dir)\n"
        self.assertEqual(src.count(line), 1, "HOME line changed; update this test's patch")
        self.wrapper = self.tmp / "herdr-safe"
        self.wrapper.write_text(src.replace(line, f"HOME = Path({str(self.home)!r})\n"))
        self.wrapper.chmod(0o755)
        bindir = self.home / ".local" / "bin"
        bindir.mkdir(parents=True)
        for name in ("hc", "herdr-app"):
            stub = bindir / name
            stub.write_text(STUB)
            stub.chmod(0o755)
        self.repo = self.home / "repo"
        self.repo.mkdir(parents=True)
        sh("git", "init", "-q", "-b", "main", cwd=self.repo)
        sh("git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "i", cwd=self.repo)
        self.wt = self.repo / ".claude" / "worktrees" / "w"
        sh("git", "worktree", "add", "-q", "-b", "feat/w", str(self.wt), cwd=self.repo)
        (self.wt / ".gitignore").write_text(".env\n")
        pi = self.home / ".pi" / "agent" / "settings.json"
        pi.parent.mkdir(parents=True)
        pi.write_text(json.dumps({"enabledModels": ["opencode-go/deepseek-v4.1-flash"]}))

    def run_safe(self, *args, cwd=None, env=None):
        base = {"PATH": "/usr/bin:/bin", "HOME": str(self.home), "STUB_LOG": str(self.log),
                "STUB_TERMS": json.dumps(TERMS)}
        out = subprocess.run([str(self.wrapper), *args], env={**base, **(env or {})},
                             cwd=cwd or self.wt, capture_output=True, text=True, timeout=30)
        return out

    def calls(self):
        """argv lists the stubs received, minus the target lookups."""
        if not self.log.exists():
            return []
        rows = [json.loads(l) for l in self.log.read_text().splitlines()]
        return [r for r in rows if r[:2] != ["get", "--json"]]

    def allowed(self, *args, cwd=None, env=None):
        out = self.run_safe(*args, cwd=cwd, env=env)
        self.assertEqual(out.returncode, 0, out.stderr)
        return self.calls()[-1]

    def refused(self, *args, cwd=None, env=None):
        before = len(self.calls())
        out = self.run_safe(*args, cwd=cwd, env=env)
        self.assertEqual(out.returncode, 2, out.stdout + out.stderr)
        self.assertIn("Stop and hand this to the person", out.stderr)
        self.assertEqual(len(self.calls()), before, "a refused call must not reach hc or herdr-app")
        return out.stderr

    # hc: read-only and refused commands
    def test_read_commands_pass_through(self):
        self.assertEqual(self.allowed("hc", "ls", "--json"), ["ls", "--json"])
        self.assertEqual(self.allowed("hc", "read", "pve2/t5"), ["read", "pve2/t5"])

    def test_remote_flag_and_other_machines_refused(self):
        self.refused("hc", "ls", "--on", "pve2")
        self.refused("hc", "read", "proxmox/t6")
        self.refused("hc", "exec", "--on", "pve2", "id")

    def test_unlisted_commands_refused(self):
        for sub in ("exec", "kill", "rm", "label", "keep", "attach", "connect", "file", "machine", "server", "update"):
            self.refused("hc", sub, "t1")

    # hc: messaging
    def test_send_to_agents_local_and_pve2(self):
        self.assertEqual(self.allowed("hc", "send", "t1", "ping"), ["send", "t1", "ping"])
        self.assertEqual(self.allowed("hc", "send", "pve2/t5", "ping"), ["send", "pve2/t5", "ping"])
        self.assertEqual(self.allowed("hc", "send", "t2", "ping"), ["send", "t2", "ping"])

    def test_send_to_non_agents_refused(self):
        self.refused("hc", "send", "t3", "ls")         # a shell
        self.refused("hc", "send", "t4", "ping")       # finished
        self.refused("hc", "send", "t9", "ping")       # unknown
        self.refused("hc", "send", "proxmox/t6", "ping")

    def test_send_content_guard(self):
        for text in ("!ls", "  /sandbox", "-x"):
            self.refused("hc", "send", "t1", text)

    def test_keys_only_named(self):
        self.assertEqual(self.allowed("hc", "keys", "t1", "esc", "enter"), ["keys", "t1", "esc", "enter"])
        self.refused("hc", "keys", "t1", "a")
        self.refused("hc", "keys", "t1")
        self.refused("hc", "keys", "t3", "enter")

    def test_put(self):
        (self.wt / "note.md").write_text("hi")
        self.assertEqual(self.allowed("hc", "put", "t1", "note.md"), ["put", "t1", str(self.wt / "note.md")])
        (self.wt / ".env").write_text("K=v")
        self.assertIn("ignored", self.refused("hc", "put", "t1", ".env"))
        (self.wt / "big").write_bytes(b"x" * 300 * 1024)
        self.refused("hc", "put", "t1", "big")
        (self.wt / "link").symlink_to(self.wt / "note.md")
        self.refused("hc", "put", "t1", "link")
        outside = self.tmp / "outside.md"
        outside.write_text("x")
        self.refused("hc", "put", "t1", str(outside))

    def test_put_under_secrets_refused(self):
        secret_repo = self.home / "secrets"
        secret_repo.mkdir()
        sh("git", "init", "-q", cwd=secret_repo)
        (secret_repo / "x").write_text("k")
        self.assertIn("protected", self.refused("hc", "put", "t1", "x", cwd=secret_repo))

    # trusted paths ignore the environment
    def test_env_home_ignored(self):
        secret_repo = self.home / "secrets"
        secret_repo.mkdir()
        sh("git", "init", "-q", cwd=secret_repo)
        (secret_repo / "x").write_text("k")
        elsewhere = {"HOME": str(self.tmp / "elsewhere")}
        self.assertIn("protected", self.refused("hc", "put", "t1", "x", cwd=secret_repo, env=elsewhere))

    def test_env_binary_override_ignored(self):
        self.assertEqual(self.allowed("hc", "ls", env={"HERDR_SAFE_HC": "/bin/echo"}), ["ls"])

    def test_env_git_dir_ignored(self):
        got = self.allowed("hc", "run", "claude", env={"GIT_DIR": "/nonexistent"})
        self.assertEqual(got[:3], ["run", "--bg", "--cwd"])
        self.refused("hc", "run", "claude", cwd=self.repo,
                     env={"GIT_DIR": str(self.repo / ".git" / "worktrees" / "w")})

    # hc: run
    def test_run_builds_argv(self):
        got = self.allowed("hc", "run", "--name", "rev", "claude", "review it")
        self.assertEqual(got, ["run", "--bg", "--cwd", str(self.wt), "--name", "rev", "--",
                               str(self.home / ".local/bin/claude"), "review it"])
        got = self.allowed("hc", "run", "pi", "--model", "opencode-go/deepseek-v4.1-flash:low")
        self.assertEqual(got[-5:], [str(self.home / "dotfiles/scripts/pi-view"), "--tui", "pi",
                                    "--model", "opencode-go/deepseek-v4.1-flash:low"])

    def test_run_refusals(self):
        self.refused("hc", "run", "touch", "x")
        self.refused("hc", "run", "bash")
        self.refused("hc", "run", "--on", "pve2", "claude")
        self.refused("hc", "run", "--keep", "claude")
        self.refused("hc", "run", "claude", "/sandbox")
        self.refused("hc", "run", "pi", "--model", "evil/model")
        self.refused("hc", "run", "claude", cwd=self.repo)  # main checkout
        self.refused("hc", "run", "--cwd", str(self.tmp), "claude")

    # app
    def test_app_read_and_navigation(self):
        self.assertEqual(self.allowed("app", "ls"), ["ls"])
        self.assertEqual(self.allowed("app", "do", "space.next"), ["do", "space.next"])
        self.assertEqual(self.allowed("app", "do", "pane.go", '{"direction":"left"}'),
                         ["do", "pane.go", '{"direction": "left"}'])
        self.assertEqual(self.allowed("app", "feedback", "hi"), ["feedback", "hi"])

    def test_app_refused_commands(self):
        for name in ("terminal.kill", "space.close", "terminal.paste", "tab.rename", "layout.set",
                     "mod.clone", "app.quit", "window.close", "pane.swap"):
            self.refused("app", "do", name)
        self.refused("app", "check", "x")
        self.refused("app", "do", "terminal.open", "--argv", '["bash"]')  # flag form

    def test_app_open_shell_or_agent(self):
        self.assertEqual(self.allowed("app", "do", "tab.new"), ["do", "tab.new"])
        got = self.allowed("app", "do", "space.new", json.dumps({"argv": ["claude"], "folder": str(self.wt), "task": "hi"}))
        self.assertEqual(json.loads(got[2]), {"argv": [str(self.home / ".local/bin/claude")],
                                              "folder": str(self.wt), "task": "hi"})
        got = self.allowed("app", "do", "terminal.open", json.dumps(
            {"argv": ["pi", "--model", "opencode-go/deepseek-v4.1-flash"], "folder": str(self.wt)}))
        self.assertEqual(json.loads(got[2])["argv"][0], str(self.home / "dotfiles/scripts/pi-view"))

    def test_app_open_refusals(self):
        wt = str(self.wt)
        for obj in ({"argv": ["bash"], "folder": wt},
                    {"argv": ["claude"]},                                  # no folder
                    {"argv": ["claude"], "folder": str(self.repo)},        # main checkout
                    {"argv": ["claude"], "folder": wt, "machine": "pve2"},
                    {"argv": ["claude"], "folder": wt, "task": "!rm x"},
                    {"task": "rm -rf x"},                                  # task typed into a shell
                    {"mod": "x"}):
            self.refused("app", "do", "tab.new", json.dumps(obj))
        self.refused("app", "do", "pane.split", json.dumps({"argv": ["claude"]}))

    def test_app_shot_inside_repo_only(self):
        self.assertEqual(self.allowed("app", "shot", "s.png"), ["shot", str(self.wt / "s.png")])
        self.refused("app", "shot", str(self.tmp / "s.png"))


if __name__ == "__main__":
    unittest.main()
