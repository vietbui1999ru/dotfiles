"""The always-loaded agent rules keep git inside an isolated worktree.

Claude Code guards a session that entered a worktree (EnterWorktree,
isolation: "worktree", or a background job). The guard refuses git that it
cannot prove stays in that worktree. A machine without stowed dotfiles imports
only shared/style/rules.md and shared/workflow.md, so those two files must
carry the rules. See docs/workflows/worktree-guard-bandaid.md.

guard_refusal() models the refusal classes seen from the guard. The refused
examples below were each refused by Claude Code in a live guarded session.
"""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RULES = ROOT / "shared" / "style" / "rules.md"
WORKFLOW = ROOT / "shared" / "workflow.md"
BARE_IMPORTS = (RULES, WORKFLOW)
SECTION = "## Git in an isolated worktree"

_PATTERNS = (
    ("git -C", re.compile(r"\bgit\b[^;&|]*\s-C\s")),
    ("--git-dir", re.compile(r"--git-dir\b")),
    ("GIT_DIR", re.compile(r"\bGIT_(DIR|WORK_TREE)=")),
    ("cd before git", re.compile(r"\bcd\s+\S+\s*(&&|;)[^\n]*\bgit\b")),
    ("tilde path", re.compile(r"\bgit\b[^;&|]*\s~")),
    ("git in a loop", re.compile(r"\b(for|while)\b[^\n]*\bgit\b")),
    ("git in a substitution", re.compile(r"\$\([^)]*\bgit\b")),
    ("source or eval", re.compile(r"(^|[;&|]\s*)(source|eval|\.)\s")),
    ("rtk git", re.compile(r"\brtk\s+(proxy\s+)?git\b")),
)
_PROHIBITION = re.compile(r"\b(do not|never|no|refuses?|not)\b", re.IGNORECASE)


def guard_refusal(cmd: str) -> str | None:
    """Return the refusal class the guard applies to cmd, or None."""
    for name, pattern in _PATTERNS:
        if pattern.search(cmd):
            return name
    return None


def code_spans(path: Path):
    """Yield (line number, line, span) for each inline code span in path."""
    for n, line in enumerate(path.read_text().splitlines(), 1):
        for span in re.findall(r"`([^`]+)`", line):
            yield n, line, span


def section(text: str, heading: str) -> str:
    start = text.index(heading)
    end = text.find("\n## ", start + len(heading))
    return text[start:] if end == -1 else text[start:end]


class GuardModel(unittest.TestCase):
    def test_refused_shapes(self):
        refused = {
            "git -C ~/repos/agent-harness/dotfiles status -sb": "git -C",
            "for wt in $(git worktree list --porcelain | awk '{print $2}'); "
            "do git -C \"$wt\" branch --show-current; done": "git -C",
            "cd /home/u/repos/dotfiles && git status -sb": "cd before git",
            "git --git-dir=/r/.git log": "--git-dir",
            "GIT_DIR=/r/.git git log": "GIT_DIR",
            "git worktree add ~/repos/x-worktrees/1-a": "tilde path",
            "for b in a b; do git log $b; done": "git in a loop",
            "echo $(git rev-parse HEAD)": "git in a substitution",
            "source env.sh && git push": "source or eval",
            "rtk git status": "rtk git",
        }
        for cmd, reason in refused.items():
            with self.subTest(cmd=cmd):
                self.assertEqual(guard_refusal(cmd), reason)

    def test_allowed_shapes(self):
        for cmd in ("git status -sb", "git worktree list", "git branch -vv",
                    "git push origin fix/wt-guard", "git commit -F msg.txt",
                    "gh pr create --body-file body.md", "git log --oneline -5 | head"):
            with self.subTest(cmd=cmd):
                self.assertIsNone(guard_refusal(cmd))


class BareImports(unittest.TestCase):
    def test_no_instructed_command_is_refused(self):
        for path in BARE_IMPORTS:
            for n, line, span in code_spans(path):
                if _PROHIBITION.search(line):
                    continue
                with self.subTest(file=path.name, line=n, span=span):
                    self.assertIsNone(guard_refusal(span))

    def test_paths_use_home_not_tilde(self):
        for path in BARE_IMPORTS:
            for n, _line, span in code_spans(path):
                with self.subTest(file=path.name, line=n):
                    self.assertFalse(span.startswith("~/"), f"{span}: write $HOME")

    def test_workflow_has_the_isolated_worktree_rules(self):
        text = WORKFLOW.read_text()
        self.assertIn(SECTION, text)
        body = section(text, SECTION)
        for token in ("EnterWorktree", "`git -C`", "`cd <path> &&`", "`GIT_DIR`",
                      "`$HOME`", "`~`", "`source`", "`eval`", "`git commit -F`",
                      "--body-file`", "`git worktree list`", "`git branch -vv`",
                      "`ExitWorktree`"):
            with self.subTest(token=token):
                self.assertIn(token, body)

    def test_isolated_sessions_leave_other_worktrees_alone(self):
        body = section(WORKFLOW.read_text(), SECTION)
        self.assertRegex(body, r"Do not create, enter or remove another worktree")
        self.assertRegex(body, r"stop and report")

    def test_flow_marks_worktree_steps_as_main_checkout_only(self):
        flow = section(WORKFLOW.read_text(), "## Flow per issue")
        self.assertRegex(flow, r"isolated worktree does not do steps 1 and 10")

    def test_rules_stay_under_the_word_budget(self):
        body = section(WORKFLOW.read_text(), SECTION)
        self.assertLessEqual(len(body.split()), 200)


class StowedSetup(unittest.TestCase):
    def test_stowed_claude_md_imports_the_workflow(self):
        claude_md = (ROOT / "claude" / ".claude" / "CLAUDE.md").read_text()
        self.assertIn("@~/.claude/rules/workflow.md", claude_md)
        link = ROOT / "claude" / ".claude" / "rules" / "workflow.md"
        self.assertEqual(link.resolve(), WORKFLOW.resolve())


if __name__ == "__main__":
    unittest.main()
