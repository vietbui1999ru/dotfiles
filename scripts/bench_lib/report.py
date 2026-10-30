"""`bench report`: refuses until both graders have graded, then unseals and summarises per arm (D9)."""
import json
from pathlib import Path
from statistics import mean

from . import anonymize, events

GRADERS = ("human", "judge")
COUNTERS = ("steers", "review_rounds", "test_iterations", "rejects")
TYPE_FOR = {"steers": "steer", "review_rounds": "review_round", "test_iterations": "test_iteration",
            "rejects": "reject"}


class NotGraded(RuntimeError):
    pass


def _graded(item_dir):
    tpl = json.loads((item_dir / "grades-template.json").read_text(encoding="utf-8"))
    for g in GRADERS:
        if any(v is None for v in tpl[g]["rubric"].values()):
            return False
        if any(v not in anonymize.CLASSES for v in tpl[g]["findings"].values()):
            return False
    return True


def _check_all_graded(grading):
    if not Path(grading).is_dir():
        raise NotGraded("no grading items: run bench anonymize first")
    items = [d for d in sorted(Path(grading).iterdir()) if d.is_dir()]
    if not items:
        raise NotGraded("no grading items found")
    missing = [d.name for d in items if not _graded(d)]
    if missing:
        raise NotGraded(f"{len(missing)} item(s) lack both graders' grades: {', '.join(missing)}")


def _counts(run_dir):
    recs = events.read(run_dir / "events.jsonl")
    return {name: sum(1 for r in recs if r.get("type") == etype) for name, etype in TYPE_FOR.items()}


def summarize(grading, sealed, runs):
    _check_all_graded(grading)
    seal = json.loads(Path(sealed).read_text(encoding="utf-8"))
    per_arm = {}
    for item_id, run_id in seal.items():
        item = Path(grading) / item_id
        run_dir = Path(runs) / run_id
        meta = json.loads((run_dir / "meta.json").read_text(encoding="utf-8"))
        arm = per_arm.setdefault(meta["arm"], {"runs": [], "classes": dict.fromkeys(anonymize.CLASSES, 0),
                                               "rubric": {g: {k: [] for k in anonymize.RUBRIC} for g in GRADERS},
                                               "tokens": [], "cost": []})
        arm["runs"].append(_counts(run_dir))
        arm["tokens"].append(meta.get("tokens"))
        arm["cost"].append(meta.get("cost"))
        tpl = json.loads((item / "grades-template.json").read_text(encoding="utf-8"))
        for g in GRADERS:
            for k, v in tpl[g]["rubric"].items():
                arm["rubric"][g][k].append(v)
            for v in tpl[g]["findings"].values():
                arm["classes"][v] += 1
    return per_arm


def _spread(xs):
    return f"{mean(xs):.2f} ({min(xs)}-{max(xs)})" if xs else "n/a"


def render(per_arm):
    lines = []
    for arm in sorted(per_arm):
        a = per_arm[arm]
        lines.append(f"== {arm} ({len(a['runs'])} runs)")
        for c in COUNTERS:
            lines.append(f"  {c:16} {_spread([r[c] for r in a['runs']])}")
        lines.append("  finding classes: " + ", ".join(f"{c}={n}" for c, n in a["classes"].items()))
        for g in GRADERS:
            means = {k: (round(mean(v), 2) if v else None) for k, v in a["rubric"][g].items()}
            lines.append(f"  rubric ({g}): " + ", ".join(f"{k}={v}" for k, v in means.items()))
        toks = [t for t in a["tokens"] if t is not None]
        cost = [c for c in a["cost"] if c is not None]
        lines.append(f"  tokens: {_spread(toks)}  cost: {_spread(cost)}")
    return "\n".join(lines) + "\n"


def report(grading, sealed, runs):
    return render(summarize(grading, sealed, runs))
