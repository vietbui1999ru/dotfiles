"""`bench prepare`: a fresh worktree at a task's base, the archived spec as input, an empty event log."""
import json
import os
import re
import shlex
import subprocess
import time
from pathlib import Path

from . import arms

ROOT = Path(__file__).resolve().parent.parent.parent
RUNS = ROOT / "bench" / "runs"
TASKS_FILE = ROOT / "scripts" / "bench_data" / "tasks.json"


class PrepareError(RuntimeError):
    pass


def load_tasks(path=TASKS_FILE):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def worktrees_root():
    return Path(os.environ.get("BENCH_WORKTREES", Path.home() / ".cache" / "wf-bench"))


def run_id(task, arm, n):
    return f"{task}-{arm}-{n}"


def git(repo, *args):
    r = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True)
    if r.returncode != 0:
        raise PrepareError(f"git {' '.join(args)} failed: {r.stderr.strip()}")
    return r.stdout.strip()


def resolve_base(repo, base):
    try:
        return git(repo, "rev-parse", "--verify", f"{base}^{{commit}}")
    except PrepareError as exc:
        raise PrepareError(f"base '{base}' does not resolve in {repo}") from exc


def set_status_approved(text):
    """Rewrite the front-matter status to approved; add it if absent."""
    if not text.startswith("---"):
        return "---\nstatus: approved\n---\n" + text
    end = text.index("\n---", 3)
    head, rest = text[:end], text[end:]
    if re.search(r"^status:", head, re.M):
        head = re.sub(r"^status:.*$", "status: approved", head, count=1, flags=re.M)
    else:
        head = head + "\nstatus: approved"
    return head + rest


# The first message of every Pi run. Identical across arms; collect never counts it as steering.
INITIAL_PROMPT = ("Implement the approved SPEC.md in this directory. Work only toward its AC ids, "
                  "obey its Boundaries, and commit as you go.")


def dispatch_command(rid, arm_cfg, worktree):
    """The implementer step, in the plan-handoff pueue form. Printed, never run here."""
    if arm_cfg.get("builder"):
        return f"send-it arm: start Claude in {worktree} with /send-it on and the same first message: {INITIAL_PROMPT}"
    implementer = arm_cfg.get("implementer", arms.load()["review_defaults"]["implementer"])
    pi_view = Path.home() / "dotfiles" / "scripts" / "pi-view"
    inner = (f"{pi_view} --tui pi --model {implementer} --session-id bench-{rid} "
             f"-p {shlex.quote(INITIAL_PROMPT)} < /dev/null")
    return (f"pueue add -i --print-task-id --label bench-{rid} -w {shlex.quote(str(worktree))} -- "
            f"{shlex.quote(inner)}")


def prepare(task, arm, n, repo=ROOT, runs=RUNS, wt_root=None, tasks=None, arm_data=None):
    tasks = tasks or load_tasks()
    if task not in tasks:
        raise PrepareError(f"unknown task '{task}'")
    cfg = arms.resolve(arm, arm_data)
    rid = run_id(task, arm, n)
    t = tasks[task]
    base = resolve_base(repo, t["base"])

    spec_src = Path(repo) / t["spec"]
    if not spec_src.exists():
        raise PrepareError(f"archived spec missing: {t['spec']}")

    wt = Path(wt_root or worktrees_root()) / rid
    if wt.exists():
        raise PrepareError(f"worktree already exists: {wt}")
    wt.parent.mkdir(parents=True, exist_ok=True)
    git(repo, "worktree", "add", "--detach", str(wt), base)

    (wt / "SPEC.md").write_text(set_status_approved(spec_src.read_text(encoding="utf-8")), encoding="utf-8")

    run_dir = Path(runs) / rid
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "events.jsonl").write_text("", encoding="utf-8")
    meta = {"task": task, "arm": arm, "run": n, "run_id": rid, "base": base,
            "worktree": str(wt), "created": time.strftime("%Y-%m-%dT%H:%M:%S%z")}
    (run_dir / "meta.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    return {"run_id": rid, "worktree": str(wt), "base": base, "command": dispatch_command(rid, cfg, wt)}
