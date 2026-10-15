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

    def test_trust_hashmismatch(self):
        self.approved([(1, "touch first.txt")])
        spec = self.repo / "SPEC.md"
        spec.write_text(spec.read_text().replace("touch first.txt", "touch second.txt"))
        c = self.check()
        self.assertEqual(c.returncode, 3, c.stdout + c.stderr)
        self.assertFalse((self.repo / "second.txt").exists())

    # AC-5: approve
    def test_approve_yes(self):
        self.approved([(1, "test -f impl.txt")])
        recs = self.records()
        self.assertEqual(len(recs), 1, recs)
        self.assertRegex(recs[0].name, r"^[0-9a-f]{64}\.json$")
        text = (self.repo / "SPEC.md").read_text()
        self.assertRegex(text, r"(?m)^status: approved$")
        self.assertNotRegex(text, r"(?m)^status: draft$")

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
        r = self.approved([(1, "test -f impl.txt")], dirty=True)
        self.assertIn("baseline skipped: tree has changes", r.stdout + r.stderr)
        self.put("impl.txt", "")
        self.assert_check({"AC-1": "PASS (no baseline)"}, 0)

    def test_classify_fail(self):
        self.approved([(1, "test -f impl.txt")])
        self.assert_check({"AC-1": "FAIL"}, 1)

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
        self.assert_finding(self.run_floor(), "src/app.py", 3, 1)

    def test_floor_rule2(self):
        self.floor_repo()
        self.put("tests/test_new.py",  # untracked counts as added
                 "import pytest\n\n\n@pytest.mark.skip\ndef test_a():\n    assert True\n")
        self.put("src/cli.py", "import sys; sys.exit(0)\nexit(1)\n")  # xit( must not match exit(
        r = self.run_floor()
        self.assert_finding(r, "tests/test_new.py", 4, 2)
        self.assertNotRegex(r.stdout + r.stderr, re.compile(r"^src/cli\.py:\d+: \[rule2\]", re.M))

    def test_floor_rule3(self):
        self.floor_repo()
        self.git("rm", "-q", "tests/test_app.py")
        self.commit("drop test")
        self.assert_finding(self.run_floor(), "tests/test_app.py", 0, 3)

    def test_floor_rule4(self):
        self.floor_repo()
        self.put("tests/test_app.py",
                 "from src.app import f\n\n\ndef test_f():\n    assert f() == 1\n")
        self.commit("weaken test")
        self.assert_finding(self.run_floor(), "tests/test_app.py", 0, 4)

    def test_floor_rule5(self):
        self.floor_repo()
        self.put("src/app.py", "def f():\n    return 1\n\n\ntry:\n    f()\n"
                               "except Exception:\n    pass\n")
        self.put("src/b.py", "def g():\n    raise NotImplementedError\n")
        self.commit("stubs")
        r = self.run_floor()
        self.assert_finding(r, "src/app.py", "(7|8)", 5)
        self.assert_finding(r, "src/b.py", 2, 5)

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

    # AC-15: the example inside grill-me lints clean
    def test_lint_skill_example(self):
        path = ROOT / "shared" / "skills" / "grill-me" / "SKILL.md"
        self.assertTrue(path.is_file(), f"missing {path}")
        lines = path.read_text().splitlines()
        starts = [i for i, l in enumerate(lines[:-1]) if l == "```markdown" and lines[i + 1] == "---"]
        self.assertTrue(starts, f"{path}: no ```markdown block opening with ---")
        end = lines.index("```", starts[0] + 1)
        self.lint_file_example(path, "\n".join(lines[starts[0] + 1:end]) + "\n")


if __name__ == "__main__":
    unittest.main()
