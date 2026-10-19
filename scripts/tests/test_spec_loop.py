"""Tests for scripts/ac-run and scripts/floor-guard (the spec loop).

Each test builds a throwaway git repo in a temp dir and runs the scripts with
sys.executable, a temp HOME and GIT_CONFIG_NOSYSTEM=1. Stdlib only.
"""
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent
ROOT = SCRIPTS.parent
ACRUN = SCRIPTS / "ac-run"
FLOOR = SCRIPTS / "floor-guard"
HUMAN = "HUMAN ONLY (agents must not run this): ~/dotfiles/scripts/ac-run approve SPEC.md"
GITC = ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false"]

SPEC = """---
status: {status}
branch: {branch}
---
# SPEC: fixture

## Objective
Make the fixture pass.

## Acceptance Criteria
{acs}

## Boundaries
### Always
- Run the checks
### Ask first
- New dependencies
### Never
- Edit a verify line

## Open Questions
- Anything else? Default: no.
"""


def ac_block(acs):
    """acs: (n, verify) or (n, verify, baseline_pass); manual verifies stay raw."""
    out = []
    for n, verify, *rest in acs:
        out.append(f"- AC-{n}: criterion {n}")
        out.append("  verify: " + (verify if verify.startswith("manual") else f"`{verify}`"))
        if rest and rest[0]:
            out.append("  baseline: pass")
    return "\n".join(out)


def spec_text(acs, branch="feat/x", status="draft"):
    return SPEC.format(status=status, branch=branch, acs=ac_block(acs))


def line_of(text, needle, nth=1):
    hits = [i for i, line in enumerate(text.splitlines(), 1) if needle in line]
    return hits[nth - 1]


class Fixture(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="specloop-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.home = self.tmp / "home"
        self.home.mkdir()
        self.repo = self.tmp / "repo"
        self.env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
        self.env.update(HOME=str(self.home), GIT_CONFIG_NOSYSTEM="1",
                        XDG_CONFIG_HOME=str(self.home / ".config"))

    def git(self, *args):
        return subprocess.run(["git", *GITC, *args], cwd=self.repo, env=self.env, check=True,
                              capture_output=True, text=True, timeout=30).stdout

    def put(self, rel, body):
        path = self.repo / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(body)

    def commit(self, msg):
        self.git("add", "-A")
        self.git("commit", "-q", "-m", msg)

    def init_repo(self, base="main", feature="feat/x", files=None):
        """Base commit on `base`, then cut `feature` before any SPEC.md is written."""
        self.repo.mkdir()
        self.git("init", "-q", "-b", base)
        for rel, body in (files or {"README.md": "fixture\n"}).items():
            self.put(rel, body)
        self.commit("base")
        if feature:
            self.git("checkout", "-q", "-b", feature)

    def fresh(self):
        """New repo dir (not yet created) and new HOME, so subTests share no approval records."""
        base = Path(tempfile.mkdtemp(dir=self.tmp))
        self.repo = base / "repo"
        self.home = base / "home"
        self.home.mkdir()
        self.env.update(HOME=str(self.home), XDG_CONFIG_HOME=str(self.home / ".config"))

    def write_spec(self, acs, **kw):
        text = spec_text(acs, **kw)
        self.put("SPEC.md", text)
        return text

    def run_script(self, script, args, cwd=None, stdin="", extra_env=None, timeout=60):
        env = dict(self.env, **(extra_env or {}))
        return subprocess.run([sys.executable, str(script), *args], cwd=cwd or self.repo, env=env,
                              input=stdin, capture_output=True, text=True, timeout=timeout)

    def run_acrun(self, *args, **kw):
        return self.run_script(ACRUN, args, **kw)

    def run_floor(self, *args, **kw):
        return self.run_script(FLOOR, args, **kw)

    def lint(self, **kw):
        return self.run_acrun("lint", "SPEC.md", **kw)

    def check(self, *opts, **kw):
        return self.run_acrun("check", *opts, "SPEC.md", **kw)

    def approve(self, answer="y\n", *opts, **kw):
        return self.run_acrun("approve", *opts, "SPEC.md", stdin=answer, **kw)

    def approved(self, acs, dirty=False, opts=(), **kw):
        """Repo on feat/x with SPEC.md approved by `y`; dirty adds an untracked file first."""
        self.init_repo()
        self.write_spec(acs)
        if dirty:
            self.put("sub/dirty.txt", "x\n")
        r = self.approve("y\n", *opts, **kw)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        return r

    def records(self):
        state = self.home / ".local" / "state" / "ac-run"
        return sorted(state.glob("*.json")) if state.is_dir() else []

    def result(self, out, ac):
        for line in out.splitlines():
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if line.lstrip().startswith("|") and cells[0] == ac:
                return cells[1]
        self.fail(f"no table row for {ac} in:\n{out}")

    def assert_clean_lint(self, r):
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        lines = r.stdout.strip().splitlines()
        self.assertTrue(lines and lines[-1] == HUMAN, r.stdout)

    def assert_lint_error(self, r, pattern):
        out = r.stdout + r.stderr
        self.assertEqual(r.returncode, 2, out)
        self.assertRegex(out, re.compile(pattern, re.M))

    def lint_text(self, text, branch="feat/x"):
        self.init_repo(feature=branch)
        self.put("SPEC.md", text)
        return self.lint()

    def lint_file_example(self, path, text):
        m = re.search(r"^branch:\s*(\S+)\s*$", text, re.M)
        self.assertIsNotNone(m, f"{path}: no branch: line")
        self.assert_clean_lint(self.lint_text(text, m.group(1)))


EXAMPLE = """---
status: draft
branch: feat/export-rate-limit
---
# SPEC: Rate-limit the export endpoint

## Objective
Stop one client from exhausting export workers. Success: >10 req/min from one key gets 429.

## Acceptance Criteria
- AC-1: 11th request in a minute from one key returns 429
  verify: `pytest -q tests/test_export_limit.py::test_eleventh_request_429`
- AC-2: Other keys are unaffected
  verify: `pytest -q tests/test_export_limit.py::test_other_keys_ok`
- AC-3: Existing export tests still pass
  verify: `pytest -q tests/test_export.py`
  baseline: pass
- AC-4: Limit is documented in the API docs
  verify: `rg -q "429" docs/api/export.md`
- AC-5: Error message reads well to a human
  verify: manual - wording judgement

## Boundaries
### Always
- Run `~/dotfiles/scripts/ac-run check SPEC.md` before claiming done
### Ask first
- New dependencies; schema changes
### Never
- Edit a `verify:` line or a test to make a check pass

## Open Questions
- Limit per key or per IP? Default: per key.
"""


class SpecLoopCases(Fixture):
    # AC-1, AC-2: lint
    def test_lint_good_example(self):
        self.assert_clean_lint(self.lint_text(EXAMPLE, "feat/export-rate-limit"))

    def test_lint_template(self):
        path = ROOT / "shared" / "templates" / "spec.md"
        self.lint_file_example(path, path.read_text())

    def test_lint_bad_missing_verify(self):
        text = spec_text([(1, "true"), (2, "true")])
        n = line_of(text, "- AC-2:")
        lines = text.splitlines(keepends=True)
        del lines[n]  # the verify line right after AC-2
        r = self.lint_text("".join(lines))
        self.assert_lint_error(r, rf"^SPEC\.md:{n}: .*AC-2.*; expected: verify: ")

    def test_lint_bad_duplicate_id(self):
        text = spec_text([(1, "true"), (1, "false")])
        r = self.lint_text(text)
        self.assert_lint_error(r, rf"^SPEC\.md:{line_of(text, '- AC-1:', 2)}: .*AC-1.*; expected: ")
        with self.subTest("ids out of order"):
            self.fresh()
            text = spec_text([(2, "true"), (1, "true")])
            r = self.lint_text(text)
            self.assert_lint_error(r, rf"^SPEC\.md:{line_of(text, '- AC-1:')}: .*AC-1")

    def test_lint_bad_missing_subsection(self):
        text = spec_text([(1, "true")]).replace("### Never\n- Edit a verify line\n", "")
        r = self.lint_text(text)
        self.assert_lint_error(r, r"^SPEC\.md:\d+: .*(?i:never).*; expected: .*(?i:### never)")

    def test_lint_bad_missing_branch(self):
        text = spec_text([(1, "true")]).replace("branch: feat/x\n", "")
        r = self.lint_text(text)
        self.assert_lint_error(r, r"^SPEC\.md:\d+: .*branch.*; expected: branch: ")

    def test_lint_bad_manual_and_backticks_ok(self):
        text = spec_text([(1, "manual - wording"), (2, "manual — tone"),
                          (3, "manual: layout"), (4, 'test "`echo ok`" = ok')])
        self.assert_clean_lint(self.lint_text(text))

    def test_lint_bad_headings_case_unknown_ok(self):
        text = spec_text([(1, "true")])
        for old, new in [("## Objective", "## objective"),
                         ("## Acceptance Criteria", "## ACCEPTANCE CRITERIA"),
                         ("## Boundaries", "## boundaries"), ("### Ask first", "### ask FIRST"),
                         ("## Open Questions", "## Tech Stack\n- Python\n\n## open questions")]:
            text = text.replace(old, new)
        self.assert_clean_lint(self.lint_text(text))

    # AC-3, AC-4: no matching approval record means nothing runs
    def test_trust_unapproved(self):
        self.init_repo()
        self.write_spec([(1, "touch sentinel.txt")])
        c = self.check()
        self.assertEqual(c.returncode, 3, c.stdout + c.stderr)
        self.assertFalse((self.repo / "sentinel.txt").exists())
        spec = self.repo / "SPEC.md"
        spec.write_bytes(spec.read_bytes().replace(b"Make the fixture", b"Make \xff\xfe the fixture"))
        for name, r in [("lint not utf-8", self.lint()), ("check not utf-8", self.check())]:
            with self.subTest(name):
                out = r.stdout + r.stderr
                self.assertEqual(r.returncode, 2, out)
                self.assertIn("SPEC.md", out)
                self.assertNotIn("Traceback", out)
                self.assertFalse((self.repo / "sentinel.txt").exists())
        with self.subTest("record without baseline key"):
            self.fresh()
            self.approved([(1, "test -f README.md")])
            (rec,) = self.records()
            rec.write_text("{}")
            c = self.check()
            out = c.stdout + c.stderr
            self.assertNotIn("Traceback", out)
            self.assertEqual(self.result(c.stdout, "AC-1"), "PASS (no baseline)", out)

    def test_trust_hashmismatch(self):
        verify = "`touch first.txt`\n"
        cases = [("verify edited", [(1, "touch first.txt")],
                  lambda t: t.replace("touch first.txt", "touch second.txt")),
                 ("baseline added", [(1, "touch first.txt")],
                  lambda t: t.replace(verify, verify + "  baseline: pass\n")),
                 ("baseline removed", [(1, "touch first.txt", True)],
                  lambda t: t.replace("  baseline: pass\n", ""))]
        for name, acs, edit in cases:
            with self.subTest(name):
                self.fresh()
                self.approved(acs)
                (self.repo / "first.txt").unlink(missing_ok=True)  # baseline ran it
                spec = self.repo / "SPEC.md"
                before = spec.read_text()
                spec.write_text(edit(before))
                self.assertNotEqual(spec.read_text(), before)
                c = self.check()
                self.assertEqual(c.returncode, 3, c.stdout + c.stderr)
                for f in ("first.txt", "second.txt"):
                    self.assertFalse((self.repo / f).exists(), f)

    # AC-5: approve
    def test_approve_yes(self):
        self.approved([(1, "test -f impl.txt")])
        recs = self.records()
        self.assertEqual(len(recs), 1, recs)
        self.assertRegex(recs[0].name, r"^[0-9a-f]{64}\.json$")
        text = (self.repo / "SPEC.md").read_text()
        self.assertRegex(text, r"(?m)^status: approved$")
        self.assertNotRegex(text, r"(?m)^status: draft$")
        with self.subTest("SPEC.md changed while approve ran"):
            self.fresh()
            self.init_repo()
            self.write_spec([(1, "printf x >> SPEC.md")])  # baseline edits the spec
            r = self.approve("y\n")
            out = r.stdout + r.stderr
            self.assertEqual(r.returncode, 1, out)
            self.assertIn("changed since it was read", out)
            self.assertEqual(self.records(), [])
            self.assertTrue((self.repo / "SPEC.md").read_text().endswith("x"), "edit lost")
        with self.subTest("CRLF bytes preserved"):
            self.fresh()
            self.init_repo()
            original = spec_text([(1, "true")]).replace("\n", "\r\n").encode()
            (self.repo / "SPEC.md").write_bytes(original)
            r = self.approve("y\n")
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            self.assertEqual((self.repo / "SPEC.md").read_bytes(),
                             original.replace(b"status: draft\r\n", b"status: approved\r\n"))
        with self.subTest("read-only SPEC.md"):
            self.fresh()
            self.init_repo()
            self.write_spec([(1, "true")])
            (self.repo / "SPEC.md").chmod(0o444)
            r = self.approve("y\n")
            out = r.stdout + r.stderr
            self.assertNotIn("Traceback", out)
            self.assertIn(r.returncode, (0, 1), out)
            self.assertIn("by hand", out)

    def test_approve_refused(self):
        self.init_repo()
        self.write_spec([(1, "touch sentinel.txt")])
        for answer in ("n\n", ""):
            with self.subTest(answer=answer):
                r = self.approve(answer)
                self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
                self.assertIn("not approved", r.stdout + r.stderr)
                self.assertEqual(self.records(), [])
                self.assertRegex((self.repo / "SPEC.md").read_text(), r"(?m)^status: draft$")
                self.assertFalse((self.repo / "sentinel.txt").exists())

    # AC-6: branch check
    def test_branch_lint_mismatch(self):
        self.init_repo()
        text = self.write_spec([(1, "true")], branch="feat/y")
        r = self.lint()
        self.assertEqual(r.returncode, 2, r.stdout + r.stderr)
        self.assertIn(f"SPEC.md:{line_of(text, 'branch:')}: branch: is feat/y, "
                      "current branch is feat/x", r.stdout + r.stderr)

    def test_branch_check_mismatch(self):
        self.approved([(1, "true")])
        n = line_of((self.repo / "SPEC.md").read_text(), "branch:")
        self.git("checkout", "-q", "-b", "feat/z")
        c = self.check()
        self.assertEqual(c.returncode, 2, c.stdout + c.stderr)
        self.assertIn(f"SPEC.md:{n}: branch: is feat/x, current branch is feat/z",
                      c.stdout + c.stderr)

    def test_branch_detached(self):
        self.init_repo()
        text = self.write_spec([(1, "true")])
        self.git("checkout", "-q", "--detach")
        r = self.lint()
        self.assertEqual(r.returncode, 2, r.stdout + r.stderr)
        self.assertIn(f"SPEC.md:{line_of(text, 'branch:')}: detached HEAD; check out branch feat/x",
                      r.stdout + r.stderr)

    # AC-7: classification against the baseline taken at approve
    def assert_check(self, expected, code, *opts, **kw):
        c = self.check(*opts, **kw)
        out = c.stdout + c.stderr
        for ac, want in expected.items():
            self.assertEqual(self.result(c.stdout, ac), want, out)
        self.assertEqual(c.returncode, code, out)
        return c

    def test_classify_pass(self):
        r = self.approved([(1, "test -f impl.txt"), (2, "test -f impl2.txt", True)])
        self.assertIn("WARN AC-2 marked baseline: pass but fails now", r.stdout + r.stderr)
        self.put("impl.txt", "")
        self.put("impl2.txt", "")
        c = self.assert_check({"AC-1": "PASS", "AC-2": "PASS"}, 0)
        self.assertIn("| AC | Result | Exit | Seconds |", c.stdout)
        self.assertRegex(c.stdout, r"(?m)^approved: \S+")

    def test_classify_kept(self):
        self.approved([(1, "test -f README.md", True)])
        self.assert_check({"AC-1": "PASS (kept)"}, 0)

    def test_classify_presatisfied(self):
        self.approved([(1, "test -f README.md")])
        self.assert_check({"AC-1": "PRE-SATISFIED"}, 1)

    def test_classify_nobaseline(self):
        # AC-2 runs whole: the command is first-to-last backtick, not the first backtick pair
        r = self.approved([(1, "test -f impl.txt"),
                           (2, 'test "`echo ok`" = ok && touch ran.txt')], dirty=True)
        self.assertIn("baseline skipped: tree has changes", r.stdout + r.stderr)
        self.put("impl.txt", "")
        self.assert_check({"AC-1": "PASS (no baseline)", "AC-2": "PASS (no baseline)"}, 0)
        self.assertTrue((self.repo / "ran.txt").exists())

    def test_classify_fail(self):
        self.approved([(1, "test -f impl.txt")])
        self.assert_check({"AC-1": "FAIL"}, 1)
        with self.subTest("about 5 MB of output"):
            self.fresh()
            self.approved([(1, "yes 0123456789 | head -n 500000; exit 1")], dirty=True)
            c = self.assert_check({"AC-1": "FAIL"}, 1)
            self.assertIn("| AC | Result | Exit | Seconds |", c.stdout)
            self.assertLessEqual(c.stdout.count("0123456789"), 40)

    def test_classify_manual(self):
        self.approved([(1, "manual - wording judgement"), (2, "test -f impl.txt")])
        self.put("impl.txt", "")
        self.assert_check({"AC-1": "MANUAL", "AC-2": "PASS"}, 0)

    # AC-8: timeout kills the whole process group
    def test_timeout_killpg(self):
        self.approved([(1, "echo $$ > pid.txt; sleep 30 & sleep 30")], opts=("--timeout", "1"))
        pidfile = self.repo / "pid.txt"
        pidfile.unlink(missing_ok=True)
        start = time.monotonic()
        self.assert_check({"AC-1": "TIMEOUT"}, 1, "--timeout", "1")
        self.assertLess(time.monotonic() - start, 3)
        pgid = int(pidfile.read_text().strip())
        deadline = time.monotonic() + 1
        while True:
            try:
                os.killpg(pgid, 0)
            except ProcessLookupError:
                break
            if time.monotonic() > deadline:
                os.killpg(pgid, signal.SIGKILL)
                self.fail(f"process group {pgid} still alive after check returned")
            time.sleep(0.05)
        with self.subTest("child escapes the process group"):
            self.fresh()
            py = ("import os,sys,time; os.fork() and sys.exit(0); os.setsid(); "
                  "open('esc.pid','w').write(str(os.getpid())); time.sleep(20)")
            self.approved([(1, f"{sys.executable} -c \"{py}\" ; exit 0")], dirty=True)
            self.addCleanup(self.kill_pidfile, self.repo / "esc.pid")
            start = time.monotonic()
            c = self.check("--timeout", "2", timeout=30)
            out = c.stdout + c.stderr
            self.assertLess(time.monotonic() - start, 6, out)
            self.assertNotIn("Traceback", out)
            self.assertIn("| AC | Result | Exit | Seconds |", c.stdout)
            self.result(c.stdout, "AC-1")
        with self.subTest("background child killed after a normal exit"):
            self.fresh()
            self.approved([(1, "(sleep 1; touch LATE) & true")], dirty=True)
            c = self.check()
            self.assertIn(self.result(c.stdout, "AC-1"), ("PASS", "PASS (no baseline)"),
                          c.stdout + c.stderr)
            time.sleep(2.5)
            self.assertFalse((self.repo / "LATE").exists(), "background child outlived check")

    def kill_pidfile(self, pidfile):
        try:
            os.kill(int(pidfile.read_text().strip()), signal.SIGKILL)
        except (OSError, ValueError):
            pass

    # AC-9: env scrubbed, cwd is the repo root even when invoked from a subdir
    def test_env_scrub_cwd(self):
        secret = {"FAKE_SECRET": "leak"}
        self.approved([(1, 'test -z "$FAKE_SECRET" && test -f SPEC.md')], dirty=True,
                      extra_env=secret)
        c = self.run_acrun("check", "../SPEC.md", cwd=self.repo / "sub", extra_env=secret)
        self.assertEqual(self.result(c.stdout, "AC-1"), "PASS (no baseline)", c.stdout + c.stderr)
        self.assertEqual(c.returncode, 0, c.stdout + c.stderr)

    # AC-10: floor-guard
    def floor_repo(self, base="main", extra=None):
        files = {"README.md": "fixture\n", "src/app.py": "def f():\n    return 1\n",
                 "tests/test_app.py": "from src.app import f\n\n\ndef test_f():\n"
                                      "    assert f() == 1\n    assert f() != 2\n"}
        self.init_repo(base=base, files=dict(files, **(extra or {})))

    def assert_finding(self, r, path, line, rule):
        out = r.stdout + r.stderr
        self.assertEqual(r.returncode, 1, out)
        self.assertRegex(out, re.compile(rf"^{re.escape(path)}:{line}: \[rule{rule}\] ", re.M))

    def test_floor_rule1(self):
        self.floor_repo()
        self.put("src/app.py", "def f():\n    return 1\nx = 1  # noqa\n")  # uncommitted
        suppressions = ["@ts-ignore", "@ts-expect-error", "eslint-disable", "biome-ignore",
                        "# noqa", "# type: ignore", "shellcheck disable", "istanbul ignore",
                        "Stryker disable", "nosemgrep", "gitleaks:allow"]
        for i, pat in enumerate(suppressions):  # one untracked file per pattern, line 1
            self.put(f"src/s{i}.py", f"x = 1  {pat}\n")
        r = self.run_floor()
        self.assert_finding(r, "src/app.py", 3, 1)
        for i, pat in enumerate(suppressions):
            with self.subTest(pat):
                self.assert_finding(r, f"src/s{i}.py", 1, 1)
        with self.subTest("content lines that look like diff headers"):
            self.fresh()
            self.floor_repo(extra={"src/x.sql": "-- c\nselect 1;\n"})
            self.put("src/x.sql", "++ b/evil\nselect 1; # noqa\n")
            self.commit("header-like lines")
            r = self.run_floor()
            self.assert_finding(r, "src/x.sql", 2, 1)
            self.assertNotRegex(r.stdout, re.compile(r"^(b/)?evil:", re.M))

    def test_floor_rule2(self):
        self.floor_repo()
        self.put("tests/test_new.py",  # untracked counts as added
                 "import pytest\n\n\n@pytest.mark.skip\ndef test_a():\n    assert True\n")
        self.put("src/cli.py", "import sys; sys.exit(0)\nexit(1)\n")  # xit( must not match exit(
        skips = ["it.skip('a', f)", "xit('a', f)", "xdescribe('a', f)", "@pytest.mark.skip",
                 "@unittest.skip('x')", "t.Skip()", "#[ignore]"]
        for i, line in enumerate(skips):
            self.put(f"tests/k{i}.test.txt", line + "\n")
        r = self.run_floor()
        self.assert_finding(r, "tests/test_new.py", 4, 2)
        self.assertNotRegex(r.stdout + r.stderr, re.compile(r"^src/cli\.py:\d+: \[rule2\]", re.M))
        for i, line in enumerate(skips):
            with self.subTest(line):
                self.assert_finding(r, f"tests/k{i}.test.txt", 1, 2)

    def test_floor_rule3(self):
        self.floor_repo(extra={"tests/test_bin.py": "\x00\x01binary\x00\n",
                               "tests/my dir/test_sp.py": "def test_s():\n    assert 1\n",
                               "tests/test_mv.py": "def test_m():\n    assert 1\n",
                               "tests/my dir/x.py": "a = 1\n",
                               "src/a.spec.ts": "it('a', () => {});\n",
                               "pkg/a_test.go": "package pkg\n",
                               "tests/test_out.py": "def test_out():\n    assert 3\n"})
        self.git("rm", "-q", "tests/test_app.py", "tests/test_bin.py", "tests/my dir/test_sp.py",
                 "src/a.spec.ts", "pkg/a_test.go")
        self.git("mv", "tests/test_mv.py", "tests/test_mv2.py")
        self.git("mv", "tests/test_out.py", "src/helper_out.py")
        self.put("tests/my dir/x.py", "a = 1\nb = 2  # noqa\n")
        self.commit("drop and rename tests")
        r = self.run_floor()
        self.assert_finding(r, "tests/test_app.py", 0, 3)
        with self.subTest("spaced path in +++ header, no tab"):
            self.assertNotIn("\t:", r.stdout)
            self.assert_finding(r, "tests/my dir/x.py", 2, 1)
        for path in ("src/a.spec.ts", "pkg/a_test.go"):
            with self.subTest(f"test file outside tests/: {path}"):
                self.assert_finding(r, path, 0, 3)
        with self.subTest("renamed out of a test path"):
            self.assert_finding(r, "tests/test_out.py", 0, 3)
        with self.subTest("binary"):
            self.assert_finding(r, "tests/test_bin.py", 0, 3)
        with self.subTest("path with spaces, no trailing tab"):
            self.assert_finding(r, "tests/my dir/test_sp.py", 0, 3)
        with self.subTest("rename is not a delete"):
            self.assertNotRegex(r.stdout, re.compile(r"^tests/test_mv\.py:\d+: \[rule3\]", re.M))

    def test_floor_rule4(self):
        twice = {"tests/test_a.py": "    assert f() == 1\n",
                 "tests/test_p.py": "    assert(f() == 1)\n",
                 "tests/b.test.js": "  expect(f()).toBe(1);\n",
                 "tests/test_u.py": "        self.assertEqual(f(), 1)\n"}
        self.floor_repo(extra={p: "def test_x():\n" + line * 2 for p, line in twice.items()})
        self.put("tests/test_app.py",
                 "from src.app import f\n\n\ndef test_f():\n    assert f() == 1\n")
        for p, line in twice.items():
            self.put(p, "def test_x():\n" + line)
        self.commit("weaken tests")
        r = self.run_floor()
        self.assert_finding(r, "tests/test_app.py", 0, 4)
        for p in twice:
            with self.subTest(p):
                self.assert_finding(r, p, 0, 4)

    def test_floor_rule5(self):
        self.floor_repo()
        self.put("src/app.py", "def f():\n    return 1\n\n\ntry:\n    f()\n"
                               "except Exception:\n    pass\n")
        self.put("src/b.py", "def g():\n    raise NotImplementedError\n")
        self.commit("stubs")
        stubs = ["throw new Error('Not implemented');", "todo!()", "unimplemented!()",
                 "try { f(); } catch {}", "try { f(); } catch (e) {}", "except ValueError: pass"]
        for i, line in enumerate(stubs):  # untracked non-test files, line 1
            self.put(f"src/r{i}.txt", line + "\n")
        r = self.run_floor()
        self.assert_finding(r, "src/app.py", "(7|8)", 5)
        self.assert_finding(r, "src/b.py", 2, 5)
        for i, line in enumerate(stubs):
            with self.subTest(line):
                self.assert_finding(r, f"src/r{i}.txt", 1, 5)

    def test_floor_clean_master(self):
        self.floor_repo(base="master")
        self.put("src/app.py", "def f():\n    return 1\n\n\ny = 2\n")
        self.commit("clean change")
        r = self.run_floor()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertNotIn("[rule", r.stdout + r.stderr)

    def test_floor_info_status(self):
        self.floor_repo(extra={"SPEC.md": "---\nstatus: draft\nbranch: feat/x\n---\n"})
        self.put("SPEC.md", "---\nstatus: approved\nbranch: feat/x\n---\n")
        r = self.run_floor()
        self.assertIn("INFO SPEC.md status: draft -> approved", r.stdout + r.stderr)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    # The spec-loop rule block is duplicated for two loaders; the copies must match
    def test_rule_blocks_identical(self):
        def block(name):
            text = (ROOT / "shared" / name).read_text()
            return text[text.index("<!-- spec-loop:start -->"):text.index("<!-- spec-loop:end -->")]
        self.assertEqual(block("AGENTS.md"), block("research-tool-routing.md"))

    # AC-15: the example inside grill-me lints clean
    def test_lint_skill_example(self):
        path = ROOT / "shared" / "skills" / "grill-me" / "SKILL.md"
        self.assertTrue(path.is_file(), f"missing {path}")
        lines = path.read_text().splitlines()
        starts = [i for i, l in enumerate(lines[:-1]) if l == "```markdown" and lines[i + 1] == "---"]
        self.assertTrue(starts, f"{path}: no ```markdown block opening with ---")
        end = lines.index("```", starts[0] + 1)
        self.lint_file_example(path, "\n".join(lines[starts[0] + 1:end]) + "\n")

    def test_lint_prints_reject_line(self):
        r = self.lint_text(spec_text([(1, "true")]))
        self.assert_clean_lint(r)
        self.assertIn("~/dotfiles/scripts/ac-run reject SPEC.md", r.stdout)

    def test_approve_summary(self):
        self.init_repo()
        self.put("SPEC.md", spec_text([(1, "touch sentinel.txt"), (2, "manual - wording"),
                                       (3, "true", True)]))
        r = self.approve("")
        out = r.stdout + r.stderr
        self.assertEqual(r.returncode, 1, out)
        self.assertIn("not approved", out)
        self.assertEqual(self.records(), [])
        self.assertFalse((self.repo / "sentinel.txt").exists())
        for text in ("runs: touch sentinel.txt", "checked by a human: manual - wording",
                     "must keep passing", "status: approved", "[y/N]"):
            self.assertIn(text, r.stdout)
        self.assertNotIn("\x1b", r.stdout)

    def test_reject(self):
        self.approved([(1, "touch ran.txt")])
        (self.repo / "ran.txt").unlink(missing_ok=True)  # baseline ran it
        for want in ("removed record", "no approval record"):
            with self.subTest(want):
                r = self.run_acrun("reject", "SPEC.md")
                out = r.stdout + r.stderr
                self.assertEqual(r.returncode, 0, out)
                self.assertEqual(len(r.stdout.strip().splitlines()), 1, out)
                self.assertIn(want, out)
                self.assertEqual(self.records(), [])
                self.assertRegex((self.repo / "SPEC.md").read_text(), r"(?m)^status: draft$")
        self.assertEqual(self.check().returncode, 3)
        self.assertFalse((self.repo / "ran.txt").exists())

    def test_status(self):
        self.init_repo()
        self.write_spec([(1, "true")])
        c = self.run_acrun("status", "SPEC.md")
        self.assertEqual(c.returncode, 3, c.stdout + c.stderr)
        self.assertIn("draft (no record)", c.stdout)
        self.approve("y\n")
        c = self.run_acrun("status", "SPEC.md")
        self.assertEqual(c.returncode, 0, c.stdout + c.stderr)
        self.assertIn("approved (record matches)", c.stdout)
        spec = self.repo / "SPEC.md"
        spec.write_text(spec.read_text().replace("`true`", "`false`"))
        c = self.run_acrun("status", "SPEC.md")
        self.assertEqual(c.returncode, 3, c.stdout + c.stderr)
        self.assertIn("stale (spec changed since approval; approve again)", c.stdout)


if __name__ == "__main__":
    unittest.main()
