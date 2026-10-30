"""Tests for scripts/pi-queue: the pueue work queue (SPEC.md on feat/pi-queue).

Run: python3 scripts/tests/test_pi_queue.py

Every external command goes through a stub binary named by the plan's env seam
(PI_QUEUE_PUEUE, PI_QUEUE_GH, PI_QUEUE_HERDR, PI_QUEUE_CLAUDE, ...), so the tests
never touch the real pueue daemon, GitHub, herdr or a live Claude session.
"""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent.parent
PI_QUEUE = REPO / "scripts" / "pi-queue"

# One stub binary template: record every argv as JSONL, then run the command's body.
STUB = """#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
root = Path(os.environ["PI_TEST_STUB"])
with (root / "{name}.calls").open("a") as f:
    f.write(json.dumps(sys.argv[1:]) + "\\n")
args = sys.argv[1:]
def fixture(file, default=None):
    path = root / file
    return json.loads(path.read_text()) if path.exists() else default
def save(file, value):
    (root / file).write_text(json.dumps(value))
{body}
"""

PUEUE = """
tasks = fixture("tasks.json", {})
groups = fixture("groups.json", {"default": {"status": "Running", "parallel_tasks": 3}})
if args[:2] == ["group", "add"]:
    if args[2] in groups:
        sys.exit(1)
    groups[args[2]] = {"status": "Running", "parallel_tasks": 1}
    save("groups.json", groups)
    sys.exit(0)
if args[:1] == ["group"]:
    if "--json" in args:
        print(json.dumps(groups))
        sys.exit(0)
    print(" ".join(groups))
    sys.exit(0)
if args[:1] == ["parallel"]:
    group = args[args.index("--group") + 1] if "--group" in args else "default"
    groups.setdefault(group, {})["parallel_tasks"] = int(args[1])
    save("groups.json", groups)
    sys.exit(0)
if args[:1] == ["add"]:
    nid = max([int(key) for key in tasks] + [0]) + 1
    label = args[args.index("--label") + 1] if "--label" in args else None
    group = args[args.index("--group") + 1] if "--group" in args else "default"
    command = " ".join(args[args.index("--") + 1:]) if "--" in args else ""
    status = {"Stashed": {"enqueued_at": "2026-10-30T00:00:00Z"}} if "--stashed" in args else {"Queued": {"enqueued_at": "2026-10-30T00:00:00Z"}}
    tasks[str(nid)] = {"id": nid, "label": label, "path": str(Path.cwd()), "group": group, "command": command, "status": status}
    save("tasks.json", tasks)
    print(nid)
    sys.exit(0)
if args[:1] == ["enqueue"]:
    ids = [word for word in args[1:] if word.isdigit()]
    with (root / "enqueued.log").open("a") as f:
        for word in ids:
            f.write(word + "\\n")
    for word in ids:
        if word in tasks:
            tasks[word]["status"] = {"Queued": {"enqueued_at": "2026-10-30T00:00:00Z"}}
    save("tasks.json", tasks)
    sys.exit(0)
if args[:2] == ["status", "--json"]:
    print(json.dumps({"tasks": tasks, "groups": groups}))
    sys.exit(0)
sys.exit(0)
"""

HERDR = """
if args[:2] == ["pane", "list"]:
    print(json.dumps({"result": {"panes": fixture("panes.json", [])}}))
    sys.exit(0)
sys.exit(0)
"""

CLAUDE = """
sys.exit(fixture("claude.code", 0))
"""

PI_VIEW = """
sys.exit(fixture("pi-view.code", 0))
"""

GH = """
print(json.dumps(fixture("gh.json", {"state": "OPEN"})))
sys.exit(fixture("gh.code", 0))
"""


class PiQueue(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.bin = self.tmp / "bin"
        self.stub = self.tmp / "stub"
        self.state = self.tmp / "state"
        self.home = self.tmp / "home"
        for directory in (self.bin, self.stub, self.state, self.home):
            directory.mkdir(parents=True)
        for name, body in (
            ("pueue", PUEUE),
            ("herdr", HERDR),
            ("claude", CLAUDE),
            ("pi-view", PI_VIEW),
            ("gh", GH),
        ):
            path = self.bin / name
            path.write_text(STUB.format(name=name, body=body))
            path.chmod(0o755)
        self.env = dict(os.environ)
        self.env.update({
            "HOME": str(self.home),
            "PI_QUEUE_PUEUE": str(self.bin / "pueue"),
            "PI_QUEUE_HERDR": str(self.bin / "herdr"),
            "PI_QUEUE_CLAUDE": str(self.bin / "claude"),
            "PI_QUEUE_PI_VIEW": str(self.bin / "pi-view"),
            "PI_QUEUE_GH": str(self.bin / "gh"),
            "PI_QUEUE_STATE": str(self.state),
            "PI_TEST_STUB": str(self.stub),
        })

    def tearDown(self):
        self._tmp.cleanup()

    # --- helpers -----------------------------------------------------------

    def fixture(self, name, value):
        (self.stub / name).write_text(json.dumps(value))

    def calls(self, name):
        path = self.stub / f"{name}.calls"
        if not path.exists():
            return []
        return [json.loads(line) for line in path.read_text().splitlines() if line]

    def enqueued(self):
        path = self.stub / "enqueued.log"
        if not path.exists():
            return []
        return [int(line) for line in path.read_text().splitlines() if line]

    def tasks(self):
        path = self.stub / "tasks.json"
        return json.loads(path.read_text()) if path.exists() else {}

    def events(self):
        path = self.state / "events.jsonl"
        if not path.exists():
            return []
        return [json.loads(line) for line in path.read_text().splitlines() if line]

    def run_queue(self, *args):
        return subprocess.run(
            [sys.executable, str(PI_QUEUE), *args],
            env=self.env,
            capture_output=True,
            text=True,
            timeout=60,
        )

    def add(self, template, *values):
        result = self.run_queue("add", template, *values)
        self.assertEqual(result.returncode, 0, result.stderr)
        created = {}
        for line in result.stdout.splitlines():
            if not line.strip():
                continue
            label, task_id = line.rsplit(" ", 1)
            created[label] = int(task_id)
        return created

    def step_files(self):
        directory = self.state / "steps"
        files = {}
        for path in sorted(directory.glob("*.json")) if directory.exists() else []:
            step = json.loads(path.read_text())
            files[step["label"]] = step
        return files

    def write_step(self, step):
        directory = self.state / "steps"
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / f"{step['label'].replace(':', '-')}.json"
        path.write_text(json.dumps(step))
        return path

    def run_step(self, step):
        return subprocess.run(
            [sys.executable, str(PI_QUEUE), "run-step", str(self.write_step(step))],
            env=self.env,
            capture_output=True,
            text=True,
            timeout=60,
        )

    def assert_event(self, event, **fields):
        found = [item for item in self.events() if item.get("event") == event]
        self.assertTrue(found, f"no {event} event in {self.events()}")
        last = found[-1]
        for key, value in fields.items():
            self.assertEqual(last.get(key), value, f"{key} in {last}")
        for key in ("time", "session", "workflow", "template", "step", "executor", "task"):
            self.assertIn(key, last, f"{key} missing from {last}")

    # --- AC-13 (Task 1, kept) ----------------------------------------------

    def test_commandr_unhooked(self):
        # AC-13: Commandr's task bus is retired; the pueue queue replaces it.
        defaults = (REPO / "shared" / "agent-workflow.default.json").read_text()
        self.assertIs(json.loads(defaults).get("commandr"), False)
        self.assertNotIn("repos/Commandr", defaults)
        settings = (REPO / "claude" / ".claude" / "settings.json").read_text()
        self.assertNotIn("commandr", settings.lower())
        repo_ts = (REPO / "session-band-plugin" / "hooks" / "repo.ts").read_text()
        self.assertNotIn(".agents/claimed", repo_ts)
        agents = (REPO / "shared" / "AGENTS.md").read_text()
        self.assertNotIn("Commandr is", agents)

    # --- AC-6 --------------------------------------------------------------

    def test_templates_expand(self):
        # AC-6: each template expands into labelled, stashed steps plus a wait in `waits`.
        templates = {
            "pr-merge": (
                ["pr=7", "repo=/repo", "post=echo one; echo two"],
                ["wait-pr-merged", "pull", "post-1", "post-2"],
            ),
            "spec-approved": (
                ["spec=SPEC.md", "worktree=/wt", "brief=/wt/brief.md"],
                ["wait-spec-approved", "plan", "dispatch"],
            ),
            "pi-run-done": (
                ["task=3", "worktree=/wt", "branch=feat/x", "brief=/wt/brief.md"],
                ["wait-outcome", "review", "push-pr"],
            ),
            "review-decided": (
                ["worktree=/wt", "run=run-1", "session=s1", "message=/tmp/message.txt"],
                ["wait-review", "send"],
            ),
            "checks-exhausted": (
                ["task=3"],
                ["wait-checks", "notify"],
            ),
        }
        for template, (values, names) in templates.items():
            with self.subTest(template=template):
                created = self.add(template, "session=s1", *values)
                labels = [f"q:s1:{template}:{name}" for name in names]
                self.assertEqual(sorted(created), sorted(labels))
                for label, task_id in created.items():
                    self.assertIsInstance(task_id, int, label)

                # The wait is first in the template but created last, once its targets exist.
                wait_label, first_label = labels[0], labels[1]
                tasks = self.tasks()
                for label, task_id in created.items():
                    task = tasks[str(task_id)]
                    self.assertEqual(task["label"], label)
                    if label == wait_label:
                        self.assertEqual(task["group"], "waits")
                        self.assertIn("Queued", task["status"])
                    else:
                        self.assertIn("Stashed", task["status"], label)

                # The wait releases the first step; each step releases the next.
                wait_command = tasks[str(created[wait_label])]["command"]
                self.assertEqual(wait_command.split(" --release ", 1)[1].split()[0], str(created[first_label]))
                files = self.step_files()
                for index, label in enumerate(labels[1:]):
                    step = files[label]
                    expected = [] if index + 1 == len(labels) - 1 else [created[labels[index + 2]]]
                    self.assertEqual(step["release"], expected, label)

                # Wait tasks sit in the waits group pi-queue made, with its own slot count.
                groups = json.loads((self.stub / "groups.json").read_text())
                self.assertIn("waits", groups)
                self.assertEqual(groups["waits"]["parallel_tasks"], 20)

    # --- AC-7 --------------------------------------------------------------

    def test_executor_per_step(self):
        # AC-7: every step names exactly one executor; shell has no model.
        self.add("pr-merge", "session=s1", "pr=7", "repo=/repo")
        self.add("spec-approved", "session=s1", "spec=SPEC.md", "worktree=/wt", "brief=/wt/brief.md")
        self.add("pi-run-done", "session=s1", "task=3", "worktree=/wt", "branch=feat/x", "brief=/wt/brief.md")
        self.add("review-decided", "session=s1", "worktree=/wt", "run=r1", "message=/tmp/m.txt")
        self.add("checks-exhausted", "session=s1", "task=3")
        files = self.step_files()
        self.assertTrue(files)

        for label, step in files.items():
            self.assertIn(step["executor"], {"shell", "pi", "claude"}, label)
            if step["executor"] == "shell":
                self.assertTrue(step["cmd"], label)
                self.assertNotIn("model", step, label)
            elif step["executor"] == "pi":
                self.assertTrue(step["model"], label)
                self.assertTrue(step["brief"].endswith(".md"), label)
                self.assertNotIn("cmd", step, label)
            else:
                self.assertTrue(step["brief"], label)
                self.assertIn(step["fallback"], {"wait", "sonnet", "opus"}, label)

        # The plan's pi dispatch names its default model and the claude review waits.
        dispatch = files["q:s1:spec-approved:dispatch"]
        self.assertEqual(dispatch["model"], "opencode-go/deepseek-v4.1-flash:medium")
        self.assertEqual(files["q:s1:spec-approved:plan"]["fallback"], "wait")
        self.assertEqual(files["q:s1:pi-run-done:review"]["fallback"], "wait")

        # Seams: template shell steps call the configured gh and herdr, not the bare names.
        push = files["q:s1:pi-run-done:push-pr"]
        self.assertTrue(any(str(self.bin / "gh") in command for command in push["cmd"]), push)
        notify = files["q:s1:checks-exhausted:notify"]
        self.assertTrue(any(str(self.bin / "herdr") in command for command in notify["cmd"]), notify)
        send = files["q:s1:review-decided:send"]
        self.assertTrue(any(str(self.bin / "herdr") in command for command in send["cmd"]), send)

    # --- AC-8 --------------------------------------------------------------

    def claude_step(self, **overrides):
        step = {
            "label": "q:s1:spec-approved:plan",
            "session": "s1",
            "workflow": "gated",
            "template": "spec-approved",
            "step": "plan",
            "executor": "claude",
            "brief": str(self.tmp / "brief.md"),
            "fallback": "wait",
            "worktree": str(self.tmp),
            "release": [],
            "timeout": 0.3,
            "interval": 0.05,
            "task": 5,
        }
        step.update(overrides)
        (self.tmp / "brief.md").write_text("write the plan")
        return step

    def test_claude_step_routing(self):
        # AC-8: idle pane gets typed, busy pane is not, sonnet runs headless instead of waiting.
        panes = [{"pane_id": "wB:p5", "agent": "claude", "agent_status": "idle",
                  "agent_session": {"value": "s1"}}]
        self.fixture("panes.json", panes)
        result = self.run_step(self.claude_step())
        self.assertEqual(result.returncode, 0, result.stderr)
        calls = self.calls("herdr")
        self.assertIn(["pane", "send-text", "wB:p5", "write the plan"], calls)
        self.assertIn(["pane", "send-keys", "wB:p5", "Enter"], calls)
        self.assertEqual(self.calls("claude"), [])
        self.assert_event("picked-up", executor="claude")

        # A busy pane is never typed into; the step notifies once, then times out.
        self.fixture("panes.json", [dict(panes[0], agent_status="working")])
        (self.stub / "herdr.calls").unlink()
        result = self.run_step(self.claude_step())
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse([call for call in self.calls("herdr") if call[1] == "send-text"])
        self.assertEqual([event for event in self.events() if event["event"] == "notified"].__len__(), 1)
        self.assertEqual(self.calls("claude"), [])

        # fallback: sonnet runs the brief headless instead of waiting for a pane.
        self.fixture("panes.json", [])
        result = self.run_step(self.claude_step(fallback="sonnet"))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.calls("claude")[-1], ["-p", "--model", "sonnet", "write the plan"])
        self.assertFalse([call for call in self.calls("herdr") if call[1] == "send-text"])

    # --- AC-9 --------------------------------------------------------------

    def pi_step(self, **overrides):
        step = {
            "label": "q:s1:spec-approved:dispatch",
            "session": "s1",
            "workflow": "gated",
            "template": "spec-approved",
            "step": "dispatch",
            "executor": "pi",
            "model": "opencode-go/deepseek-v4.1-flash:medium",
            "brief": str(self.tmp / "plan.md"),
            "worktree": str(self.tmp / "wt"),
            "release": [],
            "task": 6,
        }
        step.update(overrides)
        (self.tmp / "plan.md").write_text("implement the plan")
        (self.tmp / "wt").mkdir(exist_ok=True)
        return step

    def test_worktree_guard(self):
        # AC-9: a worktree with a running pueue task refuses without starting Pi.
        self.fixture("tasks.json", {"4": {"id": 4, "label": "pi", "path": str(self.tmp / "wt"),
                                         "group": "default", "command": "pi ...",
                                         "status": {"Running": {"start": "2026-10-30T00:00:00Z"}}}})
        result = self.run_step(self.pi_step())
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.calls("pi-view"), [])
        self.assert_event("failed", executor="pi", step="dispatch")

        # Free worktree: the same step dispatches through pi-view with the template's model.
        self.fixture("tasks.json", {})
        result = self.run_step(self.pi_step())
        self.assertEqual(result.returncode, 0, result.stderr)
        argv = self.calls("pi-view")[-1]
        self.assertIn("--tui", argv)
        self.assertEqual(argv[argv.index("--model") + 1], "opencode-go/deepseek-v4.1-flash:medium")
        self.assertIn("implement the plan", argv)
        self.assert_event("done", executor="pi", step="dispatch")

        # The step is itself a running pueue task, often started from the same worktree:
        # its own task (pi-queue run-step <this step file>) must not count as busy.
        step = self.pi_step()
        own = self.write_step(step)
        self.fixture("tasks.json", {"6": {"id": 6, "label": step["label"], "path": str(self.tmp / "wt"),
                                         "group": "default",
                                         "command": f"{sys.executable} pi-queue run-step {own}",
                                         "status": {"Running": {"start": "2026-10-30T00:00:00Z"}}}})
        before = len(self.calls("pi-view"))
        result = self.run_step(step)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(self.calls("pi-view")), before + 1)

    # --- AC-10 -------------------------------------------------------------

    def test_unknown_template_refused(self):
        # AC-10: only a known template can queue steps.
        result = self.run_queue("add", "free-form", "session=s1", "cmd=rm -rf /")
        self.assertEqual(result.returncode, 2)
        self.assertEqual(self.calls("pueue"), [])
        self.assertEqual(self.step_files(), {})

    # --- AC-11 -------------------------------------------------------------

    def test_event_log(self):
        # AC-11: every wait and step event is one JSON line with the workflow fields.
        self.fixture("gh.json", {"state": "MERGED"})
        wait = subprocess.run(
            [sys.executable, str(PI_QUEUE), "wait", "pr-merged", "7", "--release", "9",
             "--session", "s1", "--workflow", "gated", "--template", "pr-merge", "--step", "wait-pr-merged"],
            env=self.env, capture_output=True, text=True, timeout=30,
        )
        self.assertEqual(wait.returncode, 0, wait.stderr)
        self.assert_event("released", executor="wait", template="pr-merge", step="wait-pr-merged", workflow="gated", session="s1")

        failed = {**self.pi_step(), "executor": "shell", "cmd": ["false"], "release": [42], "task": 7}
        failed.pop("model")
        failed.pop("brief")
        result = self.run_step(failed)
        self.assertNotEqual(result.returncode, 0)
        self.assert_event("failed", executor="shell", task="7", workflow="gated", session="s1")
        self.assertEqual(self.enqueued(), [9])

        # A Pi step's events carry the check round once the run has a check record.
        checks = self.home / ".local" / "state" / "pi-checks"
        checks.mkdir(parents=True, exist_ok=True)
        dispatch = self.pi_step()
        session_id = "pueue-s1-spec-approved-dispatch"
        (checks / f"{session_id}.json").write_text(json.dumps({"round": 2}))
        result = self.run_step(dispatch)
        self.assertEqual(result.returncode, 0, result.stderr)
        done = [event for event in self.events() if event["event"] == "done" and event["executor"] == "pi"][-1]
        self.assertEqual(done["round"], 2)

    # --- AC-12 -------------------------------------------------------------

    def test_waits_group(self):
        # AC-12: the waits group is created when missing, and reused when present.
        self.add("pr-merge", "session=s1", "pr=7", "repo=/repo")
        calls = self.calls("pueue")
        self.assertIn(["group", "add", "waits"], calls)
        self.assertIn(["parallel", "20", "--group", "waits"], calls)

        (self.stub / "pueue.calls").unlink()
        self.add("pr-merge", "session=s2", "pr=8", "repo=/repo")
        calls = self.calls("pueue")
        self.assertNotIn(["group", "add", "waits"], calls)
        groups = json.loads((self.stub / "groups.json").read_text())
        self.assertIn("waits", groups)

    # --- step failures and independent adds --------------------------------

    def test_step_failure_releases_nothing(self):
        step = {"label": "q:s1:pr-merge:pull", "session": "s1", "workflow": "gated",
                "template": "pr-merge", "step": "pull", "executor": "shell",
                "worktree": str(self.tmp), "cmd": ["false"], "release": [42], "task": 8}
        result = self.run_step(step)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.enqueued(), [])
        self.assert_event("failed", executor="shell", task="8")

    def test_two_adds_are_independent(self):
        first = self.add("pr-merge", "session=s1", "pr=7", "repo=/repo")
        second = self.add("pr-merge", "session=s1", "pr=7", "repo=/repo")
        self.assertFalse(set(first.values()) & set(second.values()))

        tasks = self.tasks()
        for created, other in ((first, second), (second, first)):
            wait_label = "q:s1:pr-merge:wait-pr-merged"
            released = tasks[str(created[wait_label])]["command"].split(" --release ", 1)[1].split()[0]
            self.assertIn(int(released), set(created.values()))
            self.assertNotIn(int(released), set(other.values()))


if __name__ == "__main__":
    unittest.main()
