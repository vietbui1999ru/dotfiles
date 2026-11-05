"""`bench compare`: one file from every run of a task, side by side, under fresh blind ids (D11)."""
import json
import random
import secrets
import shlex
from pathlib import Path

from . import anonymize

ROOT = Path(__file__).resolve().parent.parent.parent
RUNS = ROOT / "bench" / "runs"
OUT = ROOT / "bench" / "grading" / "compare"


def _new_id(taken):
    while (new := secrets.token_hex(4)) in taken:
        pass
    taken.add(new)
    return new


def _task_runs(task, runs):
    metas = [json.loads(p.read_text(encoding="utf-8")) for p in Path(runs).glob("*/meta.json")]
    return [m for m in metas if m.get("task") == task]


def compare(task, path, grep=None, runs=RUNS, out_root=OUT, grading_map=anonymize.SEALED):
    """Copy `path` from each run's worktree under new ids; return the copies' dir, absent ids and nvim command."""
    taken = set(json.loads(Path(grading_map).read_text(encoding="utf-8"))) if Path(grading_map).exists() else set()
    out_dir = Path(out_root) / path.replace("/", "_")
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.iterdir():  # a rerun replaces the set; stale copies would not be in the new map
        old.unlink()
    metas = _task_runs(task, runs)
    random.shuffle(metas)
    sealed, copies, absent = {}, [], []
    for meta in metas:
        cid = _new_id(taken)
        sealed[cid] = meta["run_id"]
        src = Path(meta["worktree"]) / path
        if not src.exists():
            absent.append(cid)
            continue
        dest = out_dir / f"{cid}{src.suffix}"
        dest.write_bytes(src.read_bytes())
        copies.append(str(dest))
    (out_dir / ".sealed-map.json").write_text(json.dumps(sealed, indent=2) + "\n", encoding="utf-8")
    command = "nvim -O " + " ".join(shlex.quote(c) for c in copies)
    if grep:
        command += " -c " + shlex.quote(f"windo call search({json.dumps(grep)})")
    return {"dir": str(out_dir), "absent": absent, "command": command}
