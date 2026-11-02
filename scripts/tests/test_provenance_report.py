"""provenance-report: per model/effort/month commit counts and follow-up rates from git only.

Run: python3 scripts/tests/test_provenance_report.py
"""
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent
REPORT = SCRIPTS / "provenance-report"
GITC = ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false"]


class ProvenanceReport(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="rep-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.repo = self.tmp / "repo"
        self.repo.mkdir()
        self.env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HOME": str(self.tmp),
                    "GIT_CONFIG_NOSYSTEM": "1"}
        self.git("init", "-q", "-b", "feat/x")

    def git(self, *args, date=None):
        env = dict(self.env)
        if date:
            env.update(GIT_COMMITTER_DATE=date, GIT_AUTHOR_DATE=date)
        r = subprocess.run(["git", *GITC, *args], cwd=self.repo, env=env,
                           capture_output=True, text=True, timeout=60)
        if r.returncode != 0:
            raise AssertionError(r.stderr)
        return r.stdout

    def commit(self, rel, body, msg, date, agent=None):
        path = self.repo / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(body)
        self.git("add", "--", rel)
        text = msg + "\n"
        if agent:
            text += "\n" + "".join(f"Agent: {a}\n" for a in agent)
        f = self.tmp / "m"
        f.write_text(text)
        self.git("commit", "-q", "-F", str(f), date=date)
        return self.git("rev-parse", "HEAD").strip()

    def report(self):
        r = subprocess.run([sys.executable, str(REPORT), "--repo", str(self.repo)],
                           capture_output=True, text=True, env=self.env, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr)
        return r.stdout

    def test_counts_and_follow_up_rates(self):
        opus = "anthropic/claude-opus-5-5 effort=high role=main harness=claude/2.1 session=s paths=1"
        haiku = "anthropic/claude-haiku-5-5 effort=medium role=worker harness=claude/2.1 session=s paths=1"
        # Two opus commits in 2026-09: the first is reverted, the second is untouched.
        first = self.commit("a.txt", "1\n", "feat a", "2026-09-01T10:00:00+00:00", [opus])
        self.commit("b.txt", "1\n", "feat b", "2026-09-05T10:00:00+00:00", [opus])
        self.git("revert", "--no-edit", first, date="2026-09-03T10:00:00+00:00")
        # One haiku commit in 2026-10 that is re-touched by a later commit within 14 days.
        self.commit("c.txt", "1\n", "feat c", "2026-10-01T10:00:00+00:00", [haiku])
        self.commit("c.txt", "2\n", "fix c", "2026-10-05T10:00:00+00:00")
        out = self.report()
        lines = out.splitlines()
        self.assertEqual(lines[0].split(), ["model", "effort", "month", "commits", "files",
                                            "follow-up"])
        rows = {tuple(line.split()[:3]): line.split()[3:] for line in lines[1:]}
        # opus 2026-09: 2 commits, 2 files, 1 of 2 follow-up (the revert hits commit one).
        self.assertEqual(rows[("anthropic/claude-opus-5-5", "high", "2026-09")],
                         ["2", "2", "50%"])
        # haiku 2026-10: 1 commit, 1 file, followed by the same-path commit.
        self.assertEqual(rows[("anthropic/claude-haiku-5-5", "medium", "2026-10")],
                         ["1", "1", "100%"])

    def test_no_trailers_reports_nothing(self):
        self.commit("a.txt", "1\n", "plain", "2026-09-01T10:00:00+00:00")
        self.assertIn("no Agent: trailers", self.report())

    def test_follow_up_outside_window_does_not_count(self):
        opus = "anthropic/claude-opus-5-5 effort=high role=main harness=claude/2.1 session=s paths=1"
        self.commit("a.txt", "1\n", "feat a", "2026-09-01T10:00:00+00:00", [opus])
        self.commit("a.txt", "2\n", "late fix", "2026-09-30T10:00:00+00:00")
        out = self.report()
        self.assertIn("0%", out)


if __name__ == "__main__":
    unittest.main()
