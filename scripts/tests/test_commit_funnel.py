"""Tests for scripts/commit-funnel and its worktree hook block.

Each test builds a throwaway git (and, where needed, colocated jj) repo in a temp
dir and runs the script with sys.executable, a temp HOME and
GIT_CONFIG_NOSYSTEM=1. Stdlib only.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent
ROOT = SCRIPTS.parent
FUNNEL = SCRIPTS / "commit-funnel"
HOOK = ROOT / "claude" / ".claude" / "hooks" / "enforce-bash-safety.sh"
GITC = ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false"]
# Fake hook cwd values: a worktree session and a checkout outside one.
TMP_ROOT = os.path.join(os.path.sep, "tmp", "x")
INSIDE = os.path.join(TMP_ROOT, ".claude", "worktrees", "w")
OUTSIDE = TMP_ROOT


class Fixture(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="funnel-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.home = self.tmp / "home"
        self.home.mkdir()
        self.repo = self.tmp / "repo"
        self.msg = self.tmp / "msg"
        self.msg.write_text("add a and b\n\nbody line\n")
        self.env = {k: v for k, v in os.environ.items()
                    if not k.startswith(("GIT_", "JJ_"))}
        self.env.update(HOME=str(self.home), GIT_CONFIG_NOSYSTEM="1",
                        XDG_CONFIG_HOME=str(self.home / ".config"))
        self.jj_config = self.tmp / "jj.toml"
        self.jj_config.write_text('[user]\nname = "t"\nemail = "t@t"\n')
        self.env["JJ_CONFIG"] = str(self.jj_config)

    def fresh(self, name):
        """A brand-new repo directory, so subTests share no git state."""
        base = self.tmp / name
        base.mkdir()
        self.repo = base / "repo"
        return base

    def git(self, *args, check=True):
        return subprocess.run(["git", *GITC, *args], cwd=self.repo, env=self.env,
                              check=check, capture_output=True, text=True, timeout=60).stdout

    def jj(self, *args, check=True):
        jj = shutil.which("jj")
        if jj is None:
            self.fail("jj is required for the jj tests")
        return subprocess.run([jj, "--no-pager", *args], cwd=self.repo, env=self.env,
                              check=check, capture_output=True, text=True, timeout=60)

    def put(self, rel, body):
        path = self.repo / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(body)

    def commit(self, msg):
        self.git("add", "-A")
        self.git("commit", "-q", "-m", msg)

    def init_repo(self, base: str = "main", feature: str | None = "feat/x",
                  files: dict[str, str] | None = None):
        self.repo.mkdir()
        self.git("init", "-q", "-b", base)
        for rel, body in (files or {"README.md": "fixture\n"}).items():
            self.put(rel, body)
        self.commit("base")
        if feature:
            self.git("checkout", "-q", "-b", feature)

    def jj_colocated(self):
        """Turn the checked-out repo into a colocated jj repo on the feature branch."""
        self.jj("git", "init", "--colocate")

    def run_funnel(self, *args, cwd=None):
        return subprocess.run([sys.executable, str(FUNNEL), *args],
                              cwd=cwd or self.repo, env=self.env,
                              capture_output=True, text=True, timeout=120)

    def run_hook(self, cwd, command):
        payload = json.dumps({"cwd": cwd, "tool_input": {"command": command}})
        return subprocess.run(["bash", str(HOOK)], input=payload, env=self.env,
                              capture_output=True, text=True, timeout=60)

    def head_count(self):
        return self.git("rev-list", "--count", "HEAD").strip()

    def assert_refused(self, r, *needles):
        self.assertEqual(r.returncode, 2, r.stderr)
        self.assertIn("commit-funnel: refused", r.stderr)
        self.assertIn("1.", r.stderr)
        for needle in needles:
            self.assertIn(needle, r.stderr)

    def test_git_commits_listed_paths(self):
        self.init_repo()
        self.put("a.txt", "a\n")
        self.put("b.txt", "b\n")
        self.put("c.txt", "c\n")
        r = self.run_funnel("-F", str(self.msg), "a.txt", "b.txt")
        self.assertEqual(r.returncode, 0, r.stderr)
        names = sorted(n for n in self.git("show", "--name-only", "--format=", "HEAD").splitlines() if n)
        self.assertEqual(names, ["a.txt", "b.txt"])
        self.assertEqual(self.git("log", "-1", "--format=%s").strip(), "add a and b")
        self.assertIn("body line", self.git("log", "-1", "--format=%B"))
        sha = self.git("rev-parse", "--short", "HEAD").strip()
        self.assertEqual(r.stdout.split(), [sha, "add", "a", "and", "b"])
        self.assertEqual(self.head_count(), "2")
        # the unlisted file stays out of the commit and out of the tree state
        self.assertEqual(sorted(self.git("ls-tree", "--name-only", "HEAD").split()),
                         ["README.md", "a.txt", "b.txt"])
        self.assertIn("c.txt", self.git("status", "--porcelain"))

    def test_git_commits_symlink_itself(self):
        # A path that is a symlink is committed as the link, not resolved to its
        # target: resolving it made the funnel commit the unchanged target and
        # report success with an empty commit.
        self.init_repo(files={"README.md": "fixture\n", "shared/a.md": "a\n"})
        link = self.repo / "agents" / "a.md"
        link.parent.mkdir()
        link.symlink_to(os.path.join("..", "shared", "a.md"))
        r = self.run_funnel("-F", str(self.msg), "agents/a.md")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.git("show", "--name-only", "--format=", "HEAD").split(), ["agents/a.md"])
        self.assertTrue(self.git("ls-tree", "HEAD", "agents/a.md").startswith("120000 "))

    def test_refuses_symlink_to_outside(self):
        self.init_repo()
        (self.repo / "out.md").symlink_to(self.tmp / "msg")
        r = self.run_funnel("-F", str(self.msg), "out.md")
        self.assert_refused(r, "outside the work-tree root")
        self.assertEqual(self.head_count(), "1")

    def test_git_refuses_protected_or_detached(self):
        for case in ("main", "master", "detached"):
            with self.subTest(case=case):
                self.fresh(case)
                if case == "detached":
                    self.init_repo()
                    self.git("checkout", "-q", "--detach", "HEAD")
                else:
                    self.init_repo(base=case, feature=None)
                self.put("a.txt", "a\n")
                r = self.run_funnel("-F", str(self.msg), "a.txt")
                self.assert_refused(r)
                self.assertEqual(self.head_count(), "1")
                self.assertIn("main" if case != "detached" else "detached", r.stderr)

    def test_refuses_bad_paths(self):
        self.init_repo()
        self.put("a.txt", "a\n")
        for args in ([], ["."], ["-A"], ["--all"], ["../outside.txt"]):
            with self.subTest(args=args):
                r = self.run_funnel("-F", str(self.msg), *args)
                self.assert_refused(r, *(args or ["no paths given"]))
                self.assertEqual(self.head_count(), "1")
        self.assertNotIn("a.txt", self.git("ls-tree", "--name-only", "HEAD"))

    def test_refuses_root_aliases(self):
        self.init_repo()
        self.put("a.txt", "a\n")
        self.put("sub/b.txt", "b\n")
        for raw in ("./", "sub/..", str(self.repo)):
            with self.subTest(raw=raw):
                r = self.run_funnel("-F", str(self.msg), raw)
                self.assert_refused(r, "work-tree root itself")
                self.assertEqual(self.head_count(), "1")

    def test_refuses_bad_message(self):
        self.init_repo()
        self.put("a.txt", "a\n")
        missing = self.tmp / "nope.txt"
        empty = self.tmp / "empty.txt"
        empty.write_text("\n \n")
        long_line = self.tmp / "long.txt"
        long_line.write_text("x" * 73 + "\n")
        for path, needle in ((missing, "missing"), (empty, "empty"), (long_line, "73")):
            with self.subTest(path=path.name):
                r = self.run_funnel("-F", str(path), "a.txt")
                self.assert_refused(r, needle)
                self.assertEqual(self.head_count(), "1")

    def test_git_refuses_foreign_staged(self):
        self.init_repo()
        self.put("a.txt", "a\n")
        self.put("b.txt", "b\n")
        self.git("add", "b.txt")
        r = self.run_funnel("-F", str(self.msg), "a.txt")
        self.assert_refused(r, "b.txt")
        self.assertEqual(self.git("diff", "--cached", "--name-only").split(), ["b.txt"])
        self.assertEqual(self.head_count(), "1")

    def test_git_commits_deletion(self):
        self.init_repo(files={"a.txt": "a\n", "keep.txt": "k\n"})
        (self.repo / "a.txt").unlink()
        r = self.run_funnel("-F", str(self.msg), "a.txt")
        self.assertEqual(r.returncode, 0, r.stderr)
        status = self.git("show", "--name-status", "--format=", "HEAD").split()
        self.assertEqual(status, ["D", "a.txt"])
        self.assertNotIn("a.txt", self.git("ls-tree", "--name-only", "HEAD").split())
        self.assertEqual(self.head_count(), "2")

    def test_git_commits_staged_deletion(self):
        self.init_repo(files={"a.txt": "a\n", "keep.txt": "k\n"})
        self.git("rm", "-q", "a.txt")
        r = self.run_funnel("-F", str(self.msg), "a.txt")
        self.assertEqual(r.returncode, 0, r.stderr)
        status = self.git("show", "--name-status", "--format=", "HEAD").split()
        self.assertEqual(status, ["D", "a.txt"])
        self.assertEqual(self.head_count(), "2")

    def test_refuses_unknown_path(self):
        self.init_repo()
        r = self.run_funnel("-F", str(self.msg), "nope.txt")
        self.assert_refused(r, "nope.txt")
        self.assertEqual(self.head_count(), "1")

    def test_jj_commits_deletion(self):
        self.init_repo(files={"a.txt": "a\n", "keep.txt": "k\n"})
        self.jj_colocated()
        (self.repo / "a.txt").unlink()
        r = self.run_funnel("-F", str(self.msg), "a.txt")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.jj("diff", "--name-only", "-r", "@-").stdout.split(), ["a.txt"])
        self.assertTrue((self.repo / "keep.txt").exists())

    def test_refuses_wrong_checkout(self):
        self.init_repo()
        self.put("a.txt", "a\n")
        self.put("b.txt", "b\n")
        other = self.tmp / "other"
        other.mkdir()
        r = self.run_funnel("--worktree", str(other), "-F", str(self.msg), "a.txt", "b.txt")
        self.assert_refused(r, os.path.realpath(self.repo), os.path.realpath(other),
                            "a.txt b.txt", "2.", "3.")
        self.assertIn("isolation", r.stderr)
        self.assertEqual(self.head_count(), "1")

    def test_jj_commits_and_moves_bookmark(self):
        self.init_repo()
        self.jj_colocated()
        self.put("a.txt", "a\n")
        self.put("b.txt", "b\n")
        r = self.run_funnel("-F", str(self.msg), "a.txt")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.jj("diff", "--name-only", "-r", "@-").stdout.split(), ["a.txt"])
        self.assertEqual(self.jj("diff", "--name-only", "-r", "@").stdout.split(), ["b.txt"])
        committed = self.jj("log", "--no-graph", "-r", "@-", "-T", "commit_id").stdout.strip()
        bookmark = self.jj("log", "--no-graph", "-r", "feat/x", "-T", "commit_id").stdout.strip()
        self.assertEqual(bookmark, committed)
        self.assertEqual(self.git("rev-parse", "feat/x").strip(), committed)
        self.assertEqual(self.git("symbolic-ref", "--short", "HEAD").strip(), "feat/x")
        self.assertEqual(self.git("rev-parse", "HEAD").strip(), committed)
        self.assertIn("add a and b", r.stdout)

    def test_jj_commits_submodule_pointer_through_git(self):
        # jj ignores submodules, so a jj commit would drop the pointer move and come out empty.
        self.init_repo()
        sub = self.repo / "sub"
        sub.mkdir()
        sg = ["git", *GITC, "-C", str(sub)]
        subprocess.run([*sg, "init", "-q"], env=self.env, check=True)
        for m in ("s1", "s2"):
            subprocess.run([*sg, "commit", "-q", "--allow-empty", "-m", m], env=self.env, check=True)
        subprocess.run([*sg, "checkout", "-q", "HEAD~1"], env=self.env, check=True)
        self.git("add", "sub")
        self.git("commit", "-q", "-m", "add sub")
        self.jj_colocated()
        subprocess.run([*sg, "checkout", "-q", "-"], env=self.env, check=True)
        new = subprocess.run([*sg, "rev-parse", "HEAD"], env=self.env, check=True,
                             capture_output=True, text=True).stdout.strip()
        self.put("a.txt", "a\n")
        self.put("b.txt", "b\n")
        r = self.run_funnel("-F", str(self.msg), "sub", "a.txt")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.git("rev-parse", "HEAD:sub").strip(), new)
        self.assertEqual(self.git("diff", "--name-only", "HEAD~1", "HEAD").split(),
                         ["a.txt", "sub"])
        self.assertEqual(self.git("symbolic-ref", "--short", "HEAD").strip(), "feat/x")
        head = self.git("rev-parse", "HEAD").strip()
        bookmark = self.jj("log", "--no-graph", "-r", "feat/x", "-T", "commit_id").stdout.strip()
        self.assertEqual(bookmark, head)
        self.assertEqual(self.jj("diff", "--name-only", "-r", "@").stdout.split(), ["b.txt"])

    def test_jj_quotes_odd_path_names(self):
        self.init_repo()
        self.jj_colocated()
        odd = ['c(1).txt', 'd "q".txt', 'e b.txt']
        for rel in odd:
            self.put(rel, "x\n")
        self.put("left.txt", "l\n")
        r = self.run_funnel("-F", str(self.msg), *odd)
        self.assertEqual(r.returncode, 0, r.stderr)
        committed = self.jj("diff", "--name-only", "-r", "@-").stdout.splitlines()
        self.assertEqual(sorted(committed), sorted(odd))
        self.assertEqual(self.jj("diff", "--name-only", "-r", "@").stdout.split(), ["left.txt"])

    def test_jj_refuses_ambiguous_branch(self):
        for case in ("none", "two"):
            with self.subTest(case=case):
                self.fresh(f"amb-{case}")
                self.init_repo()
                self.jj_colocated()
                self.put("a.txt", "a\n")
                self.git("checkout", "-q", "--detach", "HEAD")
                if case == "none":
                    self.jj("bookmark", "forget", "feat/x")
                    self.jj("bookmark", "forget", "main")
                    needle = "(none)"
                else:
                    self.jj("bookmark", "forget", "main")
                    self.jj("bookmark", "create", "extra", "-r", "@-")
                    needle = "extra"
                before = self.git("rev-parse", "HEAD").strip()
                r = self.run_funnel("-F", str(self.msg), "a.txt")
                self.assert_refused(r, "detached", needle)
                if case == "two":
                    self.assertIn("feat/x", r.stderr)
                self.assertEqual(self.git("rev-parse", "HEAD").strip(), before)

    def test_hook_blocks_worktree_commit(self):
        commands = ["git commit -F x", "/usr/bin/git commit -F x",
                    "cd a && git commit -F x", "jj commit -m x", "jj ci -m x"]
        for command in commands:
            with self.subTest(command=command, where="inside"):
                r = self.run_hook(INSIDE, command)
                self.assertEqual(r.returncode, 2, command)
                self.assertIn("commit-funnel", r.stdout + r.stderr)
            with self.subTest(command=command, where="outside"):
                r = self.run_hook(OUTSIDE, command)
                self.assertEqual(r.returncode, 0, command)
        for command in ("git status", "git push origin feat", "jj st"):
            with self.subTest(command=command, where="inside-allowed"):
                r = self.run_hook(INSIDE, command)
                self.assertEqual(r.returncode, 0, command)

    def test_hook_blocks_commit_variants(self):
        blocked = ["git -c user.name=x commit -F m", "git -C . commit -F m",
                   "git --no-pager commit -F m", "command git commit -F m",
                   "env GIT_X=1 git commit -F m", "exec git commit -F m",
                   "echo $(git commit -F m)", "(git commit -F m)",
                   "jj --no-pager commit -m x", "jj -R . ci -m x"]
        for command in blocked:
            with self.subTest(command=command):
                r = self.run_hook(INSIDE, command)
                self.assertEqual(r.returncode, 2, command)
        allowed = ["git log --grep commit", "git -C sub log", "echo git commit is blocked",
                   "git commit-tree HEAD^{tree}", "jj log -r commit"]
        for command in allowed:
            with self.subTest(command=command, where="allowed"):
                r = self.run_hook(INSIDE, command)
                self.assertEqual(r.returncode, 0, command)


    # --- provenance trailers (AC-5, AC-6) ---

    def ledger(self, rows):
        path = self.tmp / "ledger.jsonl"
        path.write_text("".join(json.dumps(r) + "\n" for r in rows))
        self.env["PROVENANCE_LEDGER"] = str(path)
        return path

    def row(self, path, model="anthropic/claude-opus-5-5", cwd=None, **extra):
        base = {"ts": "2099-01-01T00:00:00Z", "harness": "claude", "harness_version": "2.1",
                "model": model, "effort": "high", "role": "main", "session": "s1",
                "cwd": cwd or str(self.repo), "path": path, "op": "edit"}
        base.update(extra)
        return base

    def trailer_values(self, key):
        return self.git("log", "-1", f"--format=%(trailers:key={key},valueonly)").strip()

    def test_provenance_git_writes_one_trailer_per_model(self):
        self.init_repo()
        self.put("a.txt", "a\n")
        self.put("b.txt", "b\n")
        rp = str(self.repo)
        self.ledger([
            self.row(f"{rp}/a.txt", model="anthropic/claude-opus-5-5"),
            self.row(f"{rp}/b.txt", model="anthropic/claude-haiku-5-5", role="worker"),
        ])
        r = self.run_funnel("-F", str(self.msg), "a.txt", "b.txt")
        self.assertEqual(r.returncode, 0, r.stderr)
        agent = self.trailer_values("Agent").splitlines()
        self.assertEqual(len(agent), 2)
        self.assertTrue(any(v.startswith("anthropic/claude-opus-5-5 effort=high role=main")
                            and "paths=1" in v for v in agent), agent)
        self.assertTrue(any(v.startswith("anthropic/claude-haiku-5-5") for v in agent))
        paths = self.trailer_values("Agent-Paths").splitlines()
        self.assertIn("anthropic/claude-opus-5-5 a.txt", paths)
        self.assertIn("anthropic/claude-haiku-5-5 b.txt", paths)
        body = self.git("log", "-1", "--format=%B")
        self.assertTrue(body.startswith("add a and b\n\nbody line"))

    def test_provenance_pi_run_row_covers_worktree_paths(self):
        self.init_repo()
        self.put("a.txt", "a\n")
        self.put("sub/c.txt", "c\n")
        self.ledger([self.row("*", model="openai-codex/gpt-6.1-sol", harness="pi", op="run",
                              role="dispatch", effort="high")])
        r = self.run_funnel("-F", str(self.msg), "a.txt", "sub/c.txt")
        self.assertEqual(r.returncode, 0, r.stderr)
        agent = self.trailer_values("Agent")
        self.assertIn("openai-codex/gpt-6.1-sol effort=high role=dispatch harness=pi", agent)
        self.assertIn("paths=2", agent)
        self.assertIn("openai-codex/gpt-6.1-sol a.txt, sub/c.txt",
                      self.trailer_values("Agent-Paths"))

    def init_old_repo(self):
        """A repo whose base commit is dated 2020, so 2021 ledger rows fall between it and now."""
        self.env["GIT_COMMITTER_DATE"] = self.env["GIT_AUTHOR_DATE"] = "2020-01-01T00:00:00Z"
        self.init_repo()
        del self.env["GIT_COMMITTER_DATE"], self.env["GIT_AUTHOR_DATE"]

    def test_provenance_edit_survives_an_earlier_commit_of_other_paths(self):
        self.init_old_repo()
        self.put("a.txt", "a\n")
        self.put("b.txt", "b\n")
        rp = str(self.repo)
        self.ledger([self.row(f"{rp}/a.txt", ts="2021-01-01T00:00:00Z"),
                     self.row(f"{rp}/b.txt", ts="2021-01-01T00:00:00Z")])
        self.assertEqual(self.run_funnel("-F", str(self.msg), "a.txt").returncode, 0)
        r = self.run_funnel("-F", str(self.msg), "b.txt")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("anthropic/claude-opus-5-5 b.txt", self.trailer_values("Agent-Paths"))

    def test_provenance_edit_row_is_spent_once_its_path_is_committed(self):
        self.init_old_repo()
        self.put("a.txt", "a\n")
        self.ledger([self.row(f"{self.repo}/a.txt", ts="2021-01-01T00:00:00Z")])
        self.assertEqual(self.run_funnel("-F", str(self.msg), "a.txt").returncode, 0)
        self.assertNotEqual(self.trailer_values("Agent"), "")
        self.put("a.txt", "a2\n")
        r = self.run_funnel("-F", str(self.msg), "a.txt")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.trailer_values("Agent"), "")

    def test_provenance_pi_run_row_covers_every_commit_in_its_run(self):
        self.init_old_repo()
        self.ledger([self.row("*", model="opencode-go/x", harness="pi", op="run",
                              session="pueue-run-1", ts="2021-01-01T00:00:00Z")])
        for session, expect in (("pueue-run-1", True), (None, False)):
            with self.subTest(session=session):
                if session:
                    self.env["PROVENANCE_SESSION"] = session
                else:
                    self.env.pop("PROVENANCE_SESSION", None)
                for body in ("1\n", "2\n"):
                    self.put("a.txt", body + str(session))
                    r = self.run_funnel("-F", str(self.msg), "a.txt")
                    self.assertEqual(r.returncode, 0, r.stderr)
                # The second commit of a.txt: only the live run's session keeps the run row.
                self.assertEqual("opencode-go/x" in self.trailer_values("Agent"), expect)

    def test_provenance_pi_run_outside_worktree_is_not_counted(self):
        self.init_repo()
        self.put("a.txt", "a\n")
        self.ledger([self.row("*", model="openai/x", harness="pi", op="run",
                              cwd=str(self.tmp / "elsewhere"))])
        r = self.run_funnel("-F", str(self.msg), "a.txt")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.trailer_values("Agent"), "")

    def test_provenance_keeps_co_authored_by(self):
        self.init_repo()
        self.put("a.txt", "a\n")
        self.ledger([self.row(f"{self.repo}/a.txt")])
        self.msg.write_text("add a\n\nbody\n\nCo-Authored-By: Someone <s@example.com>\n")
        r = self.run_funnel("-F", str(self.msg), "a.txt")
        self.assertEqual(r.returncode, 0, r.stderr)
        body = self.git("log", "-1", "--format=%B")
        self.assertIn("Co-Authored-By: Someone <s@example.com>", body)
        self.assertIn("Agent: anthropic/claude-opus-5-5", body)
        self.assertTrue(body.startswith("add a\n\nbody\n"))

    def test_provenance_directory_compresses_large_commit(self):
        self.init_repo()
        files = [f"docs/page{i}.md" for i in range(12)]
        for f in files:
            self.put(f, "x\n")
        self.ledger([self.row(f"{self.repo}/{f}") for f in files])
        r = self.run_funnel("-F", str(self.msg), *files)
        self.assertEqual(r.returncode, 0, r.stderr)
        paths = self.trailer_values("Agent-Paths")
        self.assertEqual(paths, "anthropic/claude-opus-5-5 docs/")
        self.assertIn("paths=12", self.trailer_values("Agent"))

    def test_provenance_jj_mode_writes_trailers(self):
        self.init_repo()
        self.jj_colocated()
        self.put("a.txt", "a\n")
        self.ledger([self.row(f"{self.repo}/a.txt", model="anthropic/claude-sonnet-5-5")])
        r = self.run_funnel("-F", str(self.msg), "a.txt")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("Agent: anthropic/claude-sonnet-5-5", self.jj("log", "--no-graph", "-r", "@-", "-T", "description").stdout)
        self.assertIn("Agent-Paths: anthropic/claude-sonnet-5-5 a.txt", self.jj("log", "--no-graph", "-r", "@-", "-T", "description").stdout)

    def test_provenance_jj_squash_keeps_one_trailer(self):
        self.init_repo()
        self.jj_colocated()
        self.put("a.txt", "a\n")
        self.ledger([self.row(f"{self.repo}/a.txt")])
        r = self.run_funnel("-F", str(self.msg), "a.txt")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.put("a.txt", "a2\n")
        self.ledger([self.row(f"{self.repo}/a.txt")])
        self.msg.write_text("second change\n")
        r = self.run_funnel("-F", str(self.msg), "a.txt")
        self.assertEqual(r.returncode, 0, r.stderr)
        # Fold the second funnel commit into the first: jj merges both descriptions.
        self.jj("squash", "--from", "@-", "--into", "@--", "--use-destination-message")
        desc = self.jj("log", "--no-graph", "-r", "@-", "-T", "description").stdout
        self.assertEqual(desc.count("Agent: anthropic/claude-opus-5-5"), 1, desc)

    def test_no_ledger_adds_no_trailers_and_notes_it(self):
        self.init_repo()
        self.put("a.txt", "a\n")
        self.ledger([])
        r = self.run_funnel("-F", str(self.msg), "a.txt")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("no provenance ledger rows for the committed paths; no Agent: trailers added",
                      r.stderr)
        self.assertNotIn("Agent:", self.git("log", "-1", "--format=%B"))
        self.assertEqual(self.git("log", "-1", "--format=%B").strip(), "add a and b\n\nbody line")

    def test_no_ledger_rows_for_other_paths_adds_nothing(self):
        self.init_repo()
        self.put("a.txt", "a\n")
        self.ledger([self.row(f"{self.repo}/other.txt")])
        r = self.run_funnel("-F", str(self.msg), "a.txt")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("no Agent: trailers added", r.stderr)
        self.assertNotIn("Agent:", self.git("log", "-1", "--format=%B"))

    def test_no_ledger_file_is_handled(self):
        self.init_repo()
        self.put("a.txt", "a\n")
        self.env["PROVENANCE_LEDGER"] = str(self.tmp / "missing.jsonl")
        r = self.run_funnel("-F", str(self.msg), "a.txt")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("no Agent: trailers added", r.stderr)


if __name__ == "__main__":
    unittest.main()
