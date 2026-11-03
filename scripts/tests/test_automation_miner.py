"""Tests for scripts/automation-miner. Standard library only; every fixture
lives in a temp dir, and gh/pi/skill-vendor are stubbed with shell scripts."""

from __future__ import annotations

import importlib.machinery
import importlib.util
import io
import json
import os
import stat
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parents[1]
MINER_PATH = SCRIPTS / "automation-miner"
NOW = datetime(2026, 5, 20, 12, 0, tzinfo=timezone.utc)


def load_miner():
    loader = importlib.machinery.SourceFileLoader("automation_miner", str(MINER_PATH))
    spec = importlib.util.spec_from_loader("automation_miner", loader)
    if spec is None:
        raise RuntimeError(f"cannot load {MINER_PATH}")
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


miner = load_miner()


def iso(days_ago: float = 0, base: datetime = NOW) -> str:
    return (base - timedelta(days=days_ago)).isoformat()


def write_jsonl(path: Path, rows: list) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(json.dumps(r) for r in rows) + "\n")


def bash_entry(session: str, cmd: str, when: str, cwd: str = "/work/proj") -> dict:
    return {
        "sessionId": session,
        "cwd": cwd,
        "timestamp": when,
        "type": "assistant",
        "message": {"content": [{"type": "tool_use", "name": "Bash", "input": {"command": cmd}}]},
    }


def user_prompt(session: str, text: str, when: str, cwd: str = "/work/proj") -> dict:
    return {"sessionId": session, "cwd": cwd, "timestamp": when, "type": "user", "message": {"content": text}}


def edit_entry(session: str, path: str, when: str, name: str = "Edit") -> dict:
    return {
        "sessionId": session,
        "cwd": "/work/proj",
        "timestamp": when,
        "type": "assistant",
        "message": {"content": [{"type": "tool_use", "name": name, "input": {"file_path": path}}]},
    }


class FixtureCase(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.home = Path(self._tmp.name) / "home"
        self.home.mkdir()
        self.addCleanup(self._tmp.cleanup)

    def write_bash_session(self, session: str, commands: list[str], day: float) -> None:
        base = NOW - timedelta(days=day)
        rows = []
        for i, cmd in enumerate(commands):
            rows.append(bash_entry(session, cmd, (base + timedelta(seconds=i)).isoformat()))
        write_jsonl(self.home / ".claude" / "projects" / "-work-proj" / f"{session}.jsonl", rows)

    def run_with_events(self, cands: dict) -> None:
        state = self.home / ".claude" / "state" / "automation-candidates.json"
        with mock.patch.object(miner, "collect", return_value=[e for c in cands.values() for e in c.events]), \
                mock.patch.object(miner, "now_utc", return_value=NOW), \
                redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            miner.main(["--home", str(self.home), "--state", str(state)])

    def stub_gh(self, issues: list) -> Path:
        path = Path(self._tmp.name) / "gh"
        log = Path(self._tmp.name) / "gh.log"
        issues_file = Path(self._tmp.name) / "issues.json"
        issues_file.write_text(json.dumps(issues))
        script = f"""#!/bin/sh
echo "$@" >> "{log}"
case "$1 $2" in
  "issue list") cat "{issues_file}" ;;
  "issue create")
    body=""
    while [ $# -gt 0 ]; do
      if [ "$1" = "--body-file" ]; then body="$2"; fi
      shift
    done
    [ -n "$body" ] && cp "$body" "{log}.body"
    echo "https://github.com/vietbui1999ru/agent-events/issues/1" ;;
  *) ;;
esac
"""
        path.write_text(script)
        path.chmod(path.stat().st_mode | stat.S_IEXEC)
        return path

    def gh_calls(self, gh: Path, prefix: str) -> list[str]:
        log = Path(self._tmp.name) / "gh.log"
        if not log.exists():
            return []
        return [line for line in log.read_text().splitlines() if line.startswith(prefix)]

    def stub_pi(self, body: str) -> Path:
        path = Path(self._tmp.name) / "pi"
        path.write_text(f"#!/bin/sh\ncat <<'EOF'\n{body}\nEOF\n")
        path.chmod(path.stat().st_mode | stat.S_IEXEC)
        return path



class BashSequenceTests(FixtureCase):
    def test_bash_sequence_repeated_across_sessions_is_candidate(self) -> None:
        seq = ["git status", "git add -p /Users/vietquocbui/x.py", "git commit -m 'wip 42'"]
        self.write_bash_session("s1", seq, 1)
        self.write_bash_session("s2", ["git status", "git add -p /Users/other/y.py", "git commit -m 'wip 7'"], 2)
        self.write_bash_session("s3", ["git status", "git add -p /home/z/a.py", "git commit -m 'wip 9'"], 3)
        events = miner.detect_bash_sequence(self.home)
        cands = miner.group_candidates(events, self.home)
        ranked = miner.rank_candidates(cands, NOW)
        self.assertEqual(len(ranked), 1)
        self.assertEqual(ranked[0].detector, "bash_sequence")
        self.assertEqual(ranked[0].tier_to, "script")
        self.assertEqual(ranked[0].tier_from, "claude")

    def test_bash_sequence_single_session_does_not_qualify(self) -> None:
        for _ in range(3):
            self.write_bash_session("only", ["ls", "pwd", "whoami"], 1)
        cands = miner.group_candidates(miner.detect_bash_sequence(self.home), self.home)
        self.assertEqual(miner.rank_candidates(cands, NOW), [])

    def test_bash_sequence_normalizes_paths_numbers_and_strings(self) -> None:
        a = miner.normalize("cp /Users/vietquocbui/a.txt 12 'x y'", self.home)
        b = miner.normalize("cp /Users/other/b.txt 99 'zz'", self.home)
        self.assertEqual(a, b)


class PromptShapeTests(FixtureCase):
    def write_history(self, rows: list[dict]) -> None:
        write_jsonl(self.home / ".claude" / "history.jsonl", rows)

    def test_prompt_shape_matches_after_normalization(self) -> None:
        rows = []
        for i, text in enumerate([
            "run tests for /Users/vietquocbui/proj 3 times 'alpha'",
            "run tests for /home/bob/other 7 times 'beta'",
            "Run tests for /Users/x/z 11 times \"gamma\"",
        ]):
            rows.append({"display": text, "project": f"/work/p{i}", "timestamp": int((NOW - timedelta(days=i + 1)).timestamp() * 1000)})
        self.write_history(rows)
        cands = miner.group_candidates(miner.detect_prompt_shape(self.home), self.home)
        ranked = miner.rank_candidates(cands, NOW)
        self.assertEqual(len(ranked), 1)
        self.assertEqual(ranked[0].detector, "prompt_shape")
        self.assertEqual(ranked[0].tier_to, "claude")

    def test_prompt_shape_slash_command_proposes_script(self) -> None:
        rows = [
            {"display": "/loop 5m", "project": f"/w/{i}", "timestamp": int((NOW - timedelta(days=i + 1)).timestamp() * 1000)}
            for i in range(3)
        ]
        self.write_history(rows)
        cands = miner.group_candidates(miner.detect_prompt_shape(self.home), self.home)
        ranked = miner.rank_candidates(cands, NOW)
        self.assertEqual(ranked[0].tier_to, "script")

    def test_prompt_shape_single_day_is_one_session(self) -> None:
        stamp = int((NOW - timedelta(days=1)).timestamp() * 1000)
        rows = [{"display": "same prompt", "project": "/w/p", "timestamp": stamp + i} for i in range(4)]
        self.write_history(rows)
        cands = miner.group_candidates(miner.detect_prompt_shape(self.home), self.home)
        self.assertEqual(miner.rank_candidates(cands, NOW), [])


class ClaudeBoundedEditTests(FixtureCase):
    def test_claude_bounded_edit_three_files_is_candidate(self) -> None:
        for n, session in enumerate(["a", "b", "c"]):
            rows = [
                user_prompt(session, f"rename the constant in config {n}", iso(n + 1)),
                edit_entry(session, "/Users/v/proj/src/config.py", iso(n + 1)),
                edit_entry(session, "/Users/v/proj/src/app.py", iso(n + 1), name="Write"),
            ]
            write_jsonl(self.home / ".claude" / "projects" / "p" / f"{session}.jsonl", rows)
        events = miner.detect_claude_bounded_edit(self.home)
        ranked = miner.rank_candidates(miner.group_candidates(events, self.home), NOW)
        self.assertEqual(len(ranked), 1)
        self.assertEqual(ranked[0].tier_from, "claude")
        self.assertEqual(ranked[0].tier_to, "pi")

    def test_claude_bounded_edit_ignores_turns_with_other_tools(self) -> None:
        for session in ["a", "b", "c"]:
            rows = [
                user_prompt(session, "fix the thing", iso(1)),
                edit_entry(session, "/v/a.py", iso(1)),
                {"type": "assistant", "timestamp": iso(1), "sessionId": session,
                 "message": {"content": [{"type": "tool_use", "name": "Bash", "input": {"command": "ls"}}]}},
            ]
            write_jsonl(self.home / ".claude" / "projects" / "p" / f"{session}.jsonl", rows)
        self.assertEqual(miner.detect_claude_bounded_edit(self.home), [])

    def test_claude_bounded_edit_rejects_more_than_three_files(self) -> None:
        rows = [user_prompt("a", "big refactor", iso(1))]
        rows += [edit_entry("a", f"/v/f{i}.py", iso(1)) for i in range(4)]
        write_jsonl(self.home / ".claude" / "projects" / "p" / "a.jsonl", rows)
        self.assertEqual(miner.detect_claude_bounded_edit(self.home), [])


class PiDispatchTests(FixtureCase):
    def write_pi_session(self, name: str, first_text: str, day: float) -> None:
        rows = [
            {"type": "session", "cwd": "/work/proj", "timestamp": iso(day)},
            {"type": "message", "message": {"role": "system", "content": [{"type": "text", "text": "sys"}]}},
            {"type": "message", "message": {"role": "user", "content": [{"type": "text", "text": first_text}]}},
            {"type": "message", "message": {"role": "assistant", "content": [{"type": "text", "text": "ok"}]}},
        ]
        write_jsonl(self.home / ".pi" / "agent" / "sessions" / "--work-proj--" / f"{name}.jsonl", rows)

    def test_pi_dispatch_same_shape_three_times_is_candidate(self) -> None:
        self.write_pi_session("s1", "Run lint on /Users/v/a 4 files", 1)
        self.write_pi_session("s2", "Run lint on /Users/v/b 9 files", 2)
        self.write_pi_session("s3", "run lint on /home/c/x 2 files", 3)
        events = miner.detect_pi_dispatch(self.home)
        ranked = miner.rank_candidates(miner.group_candidates(events, self.home), NOW)
        self.assertEqual(len(ranked), 1)
        self.assertEqual(ranked[0].detector, "pi_dispatch")
        self.assertEqual(ranked[0].tier_from, "pi")
        self.assertEqual(ranked[0].tier_to, "script")

    def test_pi_dispatch_uses_first_user_message_only(self) -> None:
        self.write_pi_session("s1", "same first", 1)
        self.write_pi_session("s2", "same first", 2)
        self.write_pi_session("s3", "same first", 3)
        events = miner.detect_pi_dispatch(self.home)
        self.assertTrue(all(e.evidence == "same first" for e in events))


class ZshHistoryTests(FixtureCase):
    def test_zsh_history_plain_and_extended_both_parse(self) -> None:
        now_epoch = int(NOW.timestamp())
        text = (
            "git status\n"
            f": {now_epoch - 100}:0;git add -A\n"
            "git commit -m hi\n"
            "echo \\\n"
            "  continued\n"
        )
        parsed = miner.parse_zsh_history(text, NOW)
        cmds = [c for _, c in parsed]
        self.assertEqual(cmds[0], "git status")
        self.assertEqual(cmds[1], "git add -A")
        self.assertIn("continued", cmds[3])
        self.assertEqual(len(parsed), 4)

    def test_zsh_history_repeated_sequence_is_candidate(self) -> None:
        base = int((NOW - timedelta(days=2)).timestamp())
        lines = []
        for session in range(3):
            start = base + session * 86400
            for i, cmd in enumerate(["make build", "make test", "make push"]):
                lines.append(f": {start + i * 10}:0;{cmd}")
        (self.home / ".zsh_history").write_text("\n".join(lines) + "\n")
        events = miner.detect_zsh_history(self.home, NOW)
        ranked = miner.rank_candidates(miner.group_candidates(events, self.home), NOW)
        self.assertEqual(len(ranked), 1)
        self.assertEqual(ranked[0].detector, "zsh_history")
        self.assertEqual(ranked[0].tier_from, "human")
        self.assertEqual(ranked[0].tier_to, "script")


class ThresholdAndStateTests(FixtureCase):
    def test_threshold_and_state_below_threshold_kept_not_filed(self) -> None:
        self.write_bash_session("s1", ["a", "b", "c"], 1)
        self.write_bash_session("s2", ["a", "b", "c"], 2)
        cands = miner.group_candidates(miner.detect_bash_sequence(self.home), self.home)
        self.assertEqual(miner.rank_candidates(cands, NOW), [])
        state: dict = {}
        miner.merge_state(state, cands, NOW, self.home)
        self.assertEqual(len(state), 1)
        entry = next(iter(state.values()))
        self.assertEqual(entry["count"], 2)
        self.assertEqual(entry["sessions"], 2)

    def test_threshold_and_state_qualifies_on_later_run(self) -> None:
        state_path = self.home / ".claude" / "state" / "automation-candidates.json"
        self.write_bash_session("s1", ["a", "b", "c"], 1)
        self.write_bash_session("s2", ["a", "b", "c"], 2)
        cands = miner.group_candidates(miner.detect_bash_sequence(self.home), self.home)
        state = miner.load_state(state_path)
        miner.merge_state(state, cands, NOW, self.home)
        miner.save_state(state_path, state)
        self.assertEqual(miner.rank_candidates(cands, NOW), [])

        self.write_bash_session("s3", ["a", "b", "c"], 3)
        cands = miner.group_candidates(miner.detect_bash_sequence(self.home), self.home)
        state = miner.load_state(state_path)
        miner.merge_state(state, cands, NOW, self.home)
        miner.save_state(state_path, state)
        self.assertEqual(len(miner.rank_candidates(cands, NOW)), 1)
        self.assertEqual(next(iter(state.values()))["count"], 3)

    def test_threshold_and_state_window_excludes_old_events(self) -> None:
        self.write_bash_session("s1", ["a", "b", "c"], 40)
        self.write_bash_session("s2", ["a", "b", "c"], 41)
        self.write_bash_session("s3", ["a", "b", "c"], 42)
        cands = miner.group_candidates(miner.detect_bash_sequence(self.home), self.home)
        self.assertEqual(miner.rank_candidates(cands, NOW), [])

    def test_threshold_and_state_corrupt_state_file_is_ignored(self) -> None:
        path = self.home / "state.json"
        path.write_text("{not json")
        self.assertEqual(miner.load_state(path), {})


class RedactionTests(FixtureCase):
    def test_redaction_strips_home_and_user_paths(self) -> None:
        out = miner.redact(f"cat {self.home}/notes.md /Users/bob/x /home/al/y", self.home)
        self.assertNotIn(str(self.home), out)
        self.assertNotIn("/Users/bob", out)
        self.assertNotIn("/home/al", out)

    def test_redaction_masks_secret_shapes(self) -> None:
        text = (
            "key sk-abcdefghijklmnopqrstuv "
            "gh ghp_abcdefghijklmnopqrstuvwxyz0123 "
            "pat github_pat_abcdefghijklmnopqrstu "
            "aws AKIAABCDEFGHIJKLMNOP "
            "slack xoxb-1234-abcd "
            "API_TOKEN=supersecret MY_SECRET=hunter2 PASSWORD=pw123"
        )
        out = miner.redact(text, self.home)
        for leaked in ("sk-abc", "ghp_abc", "github_pat_abc", "AKIAABC", "xoxb-1234", "supersecret", "hunter2", "pw123"):
            self.assertNotIn(leaked, out)
        self.assertIn("<secret>", out)

    def assert_masked(self, text: str, leaked: str) -> None:
        for fn in (miner.redact, miner.evidence_text):
            out = fn(text, self.home)
            self.assertNotIn(leaked, out, f"{fn.__name__} leaked {leaked!r}: {out!r}")

    def test_redaction_masks_bearer_and_authorization(self) -> None:
        self.assert_masked("curl -H Authorization: Bearer abc.def.ghi x", "abc.def")
        self.assert_masked("curl -H Authorization: tok3nvalue x", "tok3nvalue")
        self.assert_masked("curl -H Basic dXNlcjpwYXNz x", "dXNlcjpwYXNz")

    def test_redaction_masks_secret_flags(self) -> None:
        self.assert_masked("mysql --password=hunter22 db", "hunter22")
        self.assert_masked("gh auth login --with-token s3cretvalue", "s3cretvalue")
        self.assert_masked("tool --api-key abc123 run", "abc123")

    def test_redaction_masks_url_userinfo(self) -> None:
        self.assert_masked("git clone https://bob:pa55word@example.com/r.git", "pa55word")

    def test_redaction_masks_jwt(self) -> None:
        self.assert_masked("echo eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOjF9.c2lnbmF0dXJl", "eyJhbGci")

    def test_redaction_masks_more_token_prefixes(self) -> None:
        for tok in ("gho_", "ghs_", "ghu_", "ghr_"):
            self.assert_masked(f"x {tok}abcdefghijklmnopqrstuvwx1 y", f"{tok}abcdef")
        self.assert_masked("x glpat-abcdefghijklmnopqrst12 y", "glpat-abc")

    def test_redaction_masks_high_entropy_tokens(self) -> None:
        self.assert_masked("export X=1 && run Zq8vT3mK9pLx2RwN7bYc4 now", "Zq8vT3mK9pLx2RwN7bYc4")
        out = miner.redact("cat docs/plans/2026-11-03-automation-miner.md", self.home)
        self.assertIn("automation-miner", out)

    def test_redaction_evidence_is_normalized_shape(self) -> None:
        out = miner.evidence_text("curl -d 'pw=hunter22' -u x /etc/hosts 8080", self.home)
        for leaked in ("hunter22", "/etc/hosts", "8080"):
            self.assertNotIn(leaked, out)

    def test_redaction_candidate_shape_uses_evidence_gate(self) -> None:
        for s, n in (("s1", 1), ("s2", 2), ("s3", 3)):
            self.write_bash_session(s, ["curl -d 'pw=hunter22' a", "b", "c"], n)
        cands = miner.group_candidates(miner.detect_bash_sequence(self.home), self.home)
        shape = next(iter(cands.values())).shape
        self.assertNotIn("hunter22", shape)

    def test_redaction_truncates_long_literals(self) -> None:
        out = miner.redact("x" * 500, self.home)
        self.assertIn("…<truncated>", out)
        self.assertLess(len(out), 100)

    def test_redaction_applies_to_sent_evidence(self) -> None:
        self.write_bash_session("s1", ["curl -H sk-abcdefghijklmnopqrstuvwx a", "b", "c"], 1)
        self.write_bash_session("s2", ["curl -H sk-abcdefghijklmnopqrstuvwx a", "b", "c"], 2)
        self.write_bash_session("s3", ["curl -H sk-abcdefghijklmnopqrstuvwx a", "b", "c"], 3)
        cands = miner.group_candidates(miner.detect_bash_sequence(self.home), self.home)
        ranked = miner.rank_candidates(cands, NOW)
        evidence = [miner.redact(e.evidence, self.home) for e in ranked[0].events]
        for item in evidence:
            self.assertNotIn("sk-abcdef", item)


class RankingAndCapTests(FixtureCase):
    def test_ranking_and_cap_orders_by_score(self) -> None:
        # bash sequence: 3 events, minutes 2, jump claude->script = 2 -> 12
        for s in ("s1", "s2", "s3"):
            self.write_bash_session(s, ["x", "y", "z"], 1)
        # zsh: 3 events, minutes 1, jump human->script = 3 -> 9
        base = int((NOW - timedelta(days=2)).timestamp())
        lines = [f": {base + i}:0;{c}" for i, c in enumerate(["q", "w", "e"])]
        lines += [f": {base + 86400 + i}:0;{c}" for i, c in enumerate(["q", "w", "e"])]
        lines += [f": {base + 2 * 86400 + i}:0;{c}" for i, c in enumerate(["q", "w", "e"])]
        (self.home / ".zsh_history").write_text("\n".join(lines) + "\n")
        cands = miner.group_candidates(
            miner.detect_bash_sequence(self.home) + miner.detect_zsh_history(self.home, NOW), self.home
        )
        ranked = miner.rank_candidates(cands, NOW)
        self.assertEqual([c.detector for c in ranked], ["bash_sequence", "zsh_history"])

    def test_ranking_and_cap_files_at_most_three(self) -> None:
        self.assertEqual(miner.TOP_N, 3)
        cands = {}
        for i in range(5):
            cand = miner.Candidate(f"fp{i}", "bash_sequence", "claude", "script", f"shape {i}")
            cand.events = [
                miner.Event(f"fp{i}", "bash_sequence", f"s{k}", NOW - timedelta(days=1), "/p", "e", "claude", "script")
                for k in range(3)
            ]
            cands[cand.fingerprint] = cand
        self.assertEqual(len(miner.rank_candidates(cands, NOW)), 5)
        # cap is applied in cmd_run; check the constant path via a stubbed run below
        gh = self.stub_gh(issues=[])
        with mock.patch.dict(os.environ, {"AUTOMATION_MINER_GH": str(gh), "AUTOMATION_MINER_PI": "/nonexistent-pi", "AUTOMATION_MINER_SKILL_VENDOR": "/nonexistent-vendor"}):
            self.run_with_events(cands)
        creates = self.gh_calls(gh, "issue create")
        self.assertEqual(len(creates), 3)


class SuppressionTests(FixtureCase):
    def test_suppression_open_and_rejected_block_refiling(self) -> None:
        issues = [
            {"number": 1, "state": "OPEN", "labels": [{"name": "automation-candidate"}], "body": "x\n<!-- fp:aaa111 -->"},
            {"number": 2, "state": "CLOSED", "labels": [{"name": "automation-candidate"}, {"name": "rejected"}], "body": "<!-- fp:bbb222 -->"},
            {"number": 3, "state": "CLOSED", "labels": [{"name": "automation-candidate"}], "body": "<!-- fp:ccc333 -->"},
            {"number": 4, "state": "CLOSED", "labels": [{"name": "lean"}], "body": "<!-- fp:lean:skill:foo -->"},
        ]
        gh = self.stub_gh(issues=issues)
        with mock.patch.dict(os.environ, {"AUTOMATION_MINER_GH": str(gh)}):
            blocked = miner.existing_markers()
        self.assertIn("aaa111", blocked)
        self.assertIn("bbb222", blocked)
        self.assertNotIn("ccc333", blocked)
        self.assertNotIn("lean:skill:foo", blocked)

    def test_suppression_run_skips_blocked_fingerprint(self) -> None:
        self.write_bash_session("s1", ["a", "b", "c"], 1)
        self.write_bash_session("s2", ["a", "b", "c"], 2)
        self.write_bash_session("s3", ["a", "b", "c"], 3)
        cands = miner.group_candidates(miner.detect_bash_sequence(self.home), self.home)
        fp = next(iter(cands))
        cand = cands[fp]
        issues = [{"number": 1, "state": "OPEN", "labels": [{"name": "automation-candidate"}], "body": f"<!-- fp:{fp} -->"}]
        gh = self.stub_gh(issues=issues)
        with mock.patch.dict(os.environ, {"AUTOMATION_MINER_GH": str(gh), "AUTOMATION_MINER_PI": "/nonexistent-pi", "AUTOMATION_MINER_SKILL_VENDOR": "/nonexistent-vendor"}):
            self.run_with_events({fp: cand})
        self.assertEqual(self.gh_calls(gh, "issue create"), [])


class PlanDraftingTests(FixtureCase):
    def _candidate(self):
        cand = miner.Candidate("planfp", "bash_sequence", "claude", "script", "git status | git add <path>")
        cand.events = [miner.Event("planfp", "bash_sequence", f"s{k}", NOW - timedelta(days=1), "/work/proj", "git status", "claude", "script") for k in range(3)]
        return cand

    def test_plan_drafting_uses_pi_output_when_it_has_all_headings(self) -> None:
        body = "\n\n".join(f"{h}\ntext" for h in miner.PLAN_HEADINGS)
        pi = self.stub_pi(body)
        with mock.patch.dict(os.environ, {"AUTOMATION_MINER_PI": str(pi)}):
            plan = miner.draft_plan(self._candidate(), ["git status"], self.home)
        for heading in miner.PLAN_HEADINGS:
            self.assertIn(heading, plan)
        self.assertNotIn("Plan drafting failed", plan)

    def test_plan_drafting_falls_back_to_template_on_missing_headings(self) -> None:
        pi = self.stub_pi("just some prose")
        with mock.patch.dict(os.environ, {"AUTOMATION_MINER_PI": str(pi)}):
            plan = miner.draft_plan(self._candidate(), ["git status"], self.home)
        for heading in miner.PLAN_HEADINGS:
            self.assertIn(heading, plan)
        self.assertIn("Plan drafting failed", plan)

    def test_plan_drafting_falls_back_when_pi_missing(self) -> None:
        with mock.patch.dict(os.environ, {"AUTOMATION_MINER_PI": "/definitely/not/here"}):
            plan = miner.draft_plan(self._candidate(), ["git status"], self.home)
        self.assertIn("Plan drafting failed", plan)
        for heading in miner.PLAN_HEADINGS:
            self.assertIn(heading, plan)

    def test_plan_drafting_falls_back_on_pi_failure_exit(self) -> None:
        path = Path(self._tmp.name) / "pi-fail"
        path.write_text("#!/bin/sh\nexit 3\n")
        path.chmod(path.stat().st_mode | stat.S_IEXEC)
        with mock.patch.dict(os.environ, {"AUTOMATION_MINER_PI": str(path)}):
            plan = miner.draft_plan(self._candidate(), ["git status"], self.home)
        self.assertIn("Plan drafting failed", plan)


class LeanDetectorTests(FixtureCase):
    def _stub_vendor(self, payload: dict) -> Path:
        path = Path(self._tmp.name) / "skill-vendor"
        path.write_text(f"#!/bin/sh\ncat <<'EOF'\n{json.dumps(payload)}\nEOF\n")
        path.chmod(path.stat().st_mode | stat.S_IEXEC)
        return path

    def test_lean_detector_reads_audit_and_picks_one(self) -> None:
        vendor = self._stub_vendor({
            "unused_skills": [{"name": "old-a", "last_used": None}, {"name": "old-b", "last_used": None}],
            "session_start_bytes": {"big@mkt": 5000, "small@mkt": 100},
        })
        warnings: list[str] = []
        items = miner.detect_lean(self.home, str(vendor), warnings)
        self.assertEqual(warnings, [])
        fps = [i["fingerprint"] for i in items]
        self.assertIn("lean:skill:old-a", fps)
        self.assertIn("lean:startup:big@mkt", fps)
        self.assertNotIn("lean:startup:small@mkt", fps)

    def test_lean_detector_files_at_most_one_outside_cap(self) -> None:
        vendor = self._stub_vendor({
            "unused_skills": [{"name": "old-a", "last_used": None}, {"name": "old-b", "last_used": None}],
            "session_start_bytes": {},
        })
        gh = self.stub_gh(issues=[])
        env = {"AUTOMATION_MINER_GH": str(gh), "AUTOMATION_MINER_PI": "/nonexistent-pi", "AUTOMATION_MINER_SKILL_VENDOR": str(vendor)}
        with mock.patch.dict(os.environ, env), redirect_stdout(io.StringIO()):
            miner.main(["--home", str(self.home), "--state", str(self.home / "s.json")])
        creates = self.gh_calls(gh, "issue create")
        self.assertEqual(len(creates), 1)
        self.assertIn("--label lean", creates[0])

    def test_lean_detector_vendor_failure_warns_and_continues(self) -> None:
        path = Path(self._tmp.name) / "bad-vendor"
        path.write_text("#!/bin/sh\nexit 2\n")
        path.chmod(path.stat().st_mode | stat.S_IEXEC)
        warnings: list[str] = []
        self.assertEqual(miner.detect_lean(self.home, str(path), warnings), [])
        self.assertTrue(warnings)


class DryRunTests(FixtureCase):
    def test_dry_run_prints_table_and_makes_no_calls(self) -> None:
        for s in ("s1", "s2", "s3"):
            self.write_bash_session(s, ["a", "b", "c"], 1)
        marker = Path(self._tmp.name) / "called"
        bad = Path(self._tmp.name) / "boom"
        bad.write_text(f"#!/bin/sh\ntouch {marker}\nexit 1\n")
        bad.chmod(bad.stat().st_mode | stat.S_IEXEC)
        state = self.home / "state.json"
        env = {"AUTOMATION_MINER_GH": str(bad), "AUTOMATION_MINER_PI": str(bad), "AUTOMATION_MINER_SKILL_VENDOR": str(bad)}
        out = io.StringIO()
        with mock.patch.dict(os.environ, env), redirect_stdout(out), mock.patch.object(miner, "now_utc", return_value=NOW):
            rc = miner.main(["--home", str(self.home), "--dry-run", "--state", str(state)])
        self.assertEqual(rc, 0)
        self.assertFalse(marker.exists())
        self.assertFalse(state.exists())
        self.assertIn("bash_sequence", out.getvalue())
        self.assertIn("score", out.getvalue())


class LabelsAndRepoTests(FixtureCase):
    def test_labels_and_repo_created_idempotently_before_filing(self) -> None:
        cand = miner.Candidate("labelfp", "bash_sequence", "claude", "script", "shape")
        cand.events = [miner.Event("labelfp", "bash_sequence", f"s{k}", NOW - timedelta(days=1), "/Users/v/work/my-repo", "x", "claude", "script") for k in range(3)]
        gh = self.stub_gh(issues=[])
        pi = self.stub_pi("\n".join(miner.PLAN_HEADINGS))
        env = {"AUTOMATION_MINER_GH": str(gh), "AUTOMATION_MINER_PI": str(pi), "AUTOMATION_MINER_SKILL_VENDOR": "/nonexistent-vendor"}
        with mock.patch.dict(os.environ, env):
            self.run_with_events({"labelfp": cand})
        labels = self.gh_calls(gh, "label create")
        self.assertTrue(any("automation-candidate" in line and "--force" in line for line in labels))
        self.assertTrue(any("tier:script" in line for line in labels))
        creates = self.gh_calls(gh, "issue create")
        self.assertEqual(len(creates), 1)
        self.assertIn("-R vietbui1999ru/agent-events", creates[0])
        self.assertIn("tier:script", creates[0])
        self.assertIn("repo:my-repo", creates[0])
        self.assertIn("automation-candidate", creates[0])

    def test_labels_and_repo_unknown_when_no_cwd(self) -> None:
        cand = miner.Candidate("nofp", "bash_sequence", "claude", "script", "shape")
        cand.events = [miner.Event("nofp", "bash_sequence", f"s{k}", NOW - timedelta(days=1), "", "x", "claude", "script") for k in range(3)]
        self.assertEqual(miner.repo_target(cand.events[0]), "unknown")


class FingerprintMarkerTests(FixtureCase):
    def test_body_ends_with_fingerprint_marker(self) -> None:
        cand = miner.Candidate("markfp", "bash_sequence", "claude", "script", "shape")
        cand.events = [miner.Event("markfp", "bash_sequence", f"s{k}", NOW - timedelta(days=1), "/p", "x", "claude", "script") for k in range(3)]
        gh = self.stub_gh(issues=[])
        pi = self.stub_pi("\n".join(miner.PLAN_HEADINGS))
        env = {"AUTOMATION_MINER_GH": str(gh), "AUTOMATION_MINER_PI": str(pi), "AUTOMATION_MINER_SKILL_VENDOR": "/nonexistent-vendor"}
        with mock.patch.dict(os.environ, env):
            self.run_with_events({"markfp": cand})
        body = (Path(self._tmp.name) / "gh.log.body").read_text()
        self.assertTrue(body.rstrip().endswith("<!-- fp:markfp -->"))
        state = json.loads((self.home / ".claude" / "state" / "automation-candidates.json").read_text())
        self.assertEqual(state["markfp"]["filed_issue"], "https://github.com/vietbui1999ru/agent-events/issues/1")


if __name__ == "__main__":
    unittest.main()
