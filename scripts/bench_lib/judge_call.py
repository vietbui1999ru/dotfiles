"""`bench judge`: fills the judge half of each item's grades through the same pi call as review."""
import json
from pathlib import Path

from . import review

ROOT = Path(__file__).resolve().parent.parent.parent
PROMPT = ROOT / "scripts" / "bench_data" / "prompts" / "judge.md"
JUDGE_MODEL = "opencode-go/qwen3.8-max"


def grade_item(item_dir, caller=review.call_pi):
    diff = (Path(item_dir) / "diff.patch").read_text(encoding="utf-8")
    findings = json.loads((Path(item_dir) / "findings.json").read_text(encoding="utf-8"))
    prompt = (PROMPT.read_text(encoding="utf-8") + "\n\n## Diff\n```diff\n" + diff + "\n```\n\n## Findings\n"
              + json.dumps(findings, indent=2, ensure_ascii=False) + "\n")
    text = caller(JUDGE_MODEL, prompt)
    import re
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        raise ValueError("judge returned no JSON object")
    return json.loads(m.group(0))


def judge_all(grading, caller=review.call_pi):
    done = 0
    for item in sorted(Path(grading).iterdir()):
        if not item.is_dir():
            continue
        out = grade_item(item, caller)
        path = item / "grades-template.json"
        tpl = json.loads(path.read_text(encoding="utf-8"))
        tpl["judge"]["rubric"] = out.get("rubric", {})
        tpl["judge"]["findings"] = out.get("findings", {})
        path.write_text(json.dumps(tpl, indent=2) + "\n", encoding="utf-8")
        done += 1
    return done
