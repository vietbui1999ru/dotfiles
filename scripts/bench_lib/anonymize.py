"""`bench anonymize`: blind grading items. Model and arm names stay out of the item; the map is sealed."""
import json
import random
import re
import secrets
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
RUNS = ROOT / "bench" / "runs"
GRADING = ROOT / "bench" / "grading"
SEALED = GRADING / ".sealed-map.json"
CLASSES = ("real", "nit", "stale", "wrong")
RUBRIC = ("correctness", "readability", "unrequested_scope", "over_defensive")
MODEL_RE = re.compile(r"(openai-codex|opencode-go|anthropic|claude|gpt|deepseek|glm|qwen|haiku|sonnet|opus)[\w.:/-]*", re.I)


def scrub(text, names):
    """Remove model names and every arm or run identifier from a string."""
    out = MODEL_RE.sub("[model]", text)
    for n in names:
        if n:
            out = out.replace(n, "[arm]")
    return out


def _ids(meta):
    names = [meta.get("arm", ""), meta.get("run_id", ""), meta.get("task", "")]
    return [n for n in names if n] + [meta.get("arm", "").replace("-", " ")]


def _findings_for(run_dir):
    items = []
    for path in sorted(run_dir.glob("findings-*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        for f in data.get("findings", []):
            items.append(f)
    return items


def anonymize(runs=RUNS, grading=GRADING, sealed=SEALED, rng=None):
    rng = rng or random.Random()
    grading = Path(grading)
    runs = Path(runs)
    if not runs.is_dir():
        return 0
    run_dirs = [d for d in sorted(runs.iterdir()) if (d / "final.diff").exists()]
    rng.shuffle(run_dirs)
    seal = {}
    grading.mkdir(parents=True, exist_ok=True)
    for run_dir in run_dirs:
        meta = json.loads((run_dir / "meta.json").read_text(encoding="utf-8"))
        item_id = secrets.token_hex(4)
        while (grading / item_id).exists():
            item_id = secrets.token_hex(4)
        names = _ids(meta)
        item = grading / item_id
        item.mkdir()
        diff = (run_dir / "final.diff").read_text(encoding="utf-8")
        (item / "diff.patch").write_text(scrub(diff, names), encoding="utf-8")
        findings = [{**dict(f), "id": f"f{i}"} for i, f in enumerate(_findings_for(run_dir), 1)]
        clean = [{**f, "failure_scenario": scrub(str(f.get("failure_scenario", "")), names)} for f in findings]
        (item / "findings.json").write_text(json.dumps(clean, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        template = {
            "classes": list(CLASSES),
            "human": {"rubric": dict.fromkeys(RUBRIC), "findings": dict.fromkeys(f["id"] for f in clean)},
            "judge": {"rubric": dict.fromkeys(RUBRIC), "findings": dict.fromkeys(f["id"] for f in clean)},
        }
        (item / "grades-template.json").write_text(json.dumps(template, indent=2) + "\n", encoding="utf-8")
        seal[item_id] = run_dir.name
    sealed = Path(sealed)
    sealed.parent.mkdir(parents=True, exist_ok=True)
    sealed.write_text(json.dumps(seal, indent=2) + "\n", encoding="utf-8")
    return len(seal)
