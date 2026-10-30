"""`bench review`: the harness-started reviewer calls (D3, D4), parsing (AC-4) and round logging."""
import json
import os
import re
import subprocess
from pathlib import Path

from . import arms, events, loop

ROOT = Path(__file__).resolve().parent.parent.parent
PROMPTS = ROOT / "scripts" / "bench_data" / "prompts"
RUNS = ROOT / "bench" / "runs"
ROUTING = ROOT / "bench" / "routing.env"
SEVERITIES = ("blocker", "major", "minor", "nit")
VOICE_GUIDE = {
    "acceptance-criteria": "whether every acceptance criterion is met by the diff",
    "code-quality": "correctness bugs, error handling and maintainability defects",
    "style": "consistency with the surrounding code and conventions",
    "security": "security defects: injection, secrets, unsafe input, privilege",
}


class ReviewError(RuntimeError):
    pass


def pi_bin():
    return os.environ.get("BENCH_PI_BIN") or "pi"


def read_acs(spec_text):
    """The `- AC-n: ...` lines of a SPEC.md, verbatim."""
    return [line.strip() for line in spec_text.splitlines() if re.match(r"^- AC-\d+:", line.strip())]


def build_prompt(template, acs, diff):
    return f"{template}\n\n## Acceptance criteria\n" + "\n".join(acs) + f"\n\n## Diff\n```diff\n{diff}\n```\n"


def call_pi(model, prompt, routing=None):
    """The only place a model is called. Runs $BENCH_PI_BIN with the bench routing file."""
    env = dict(os.environ)
    env["PI_ROUTING_FILE"] = str(routing or ROUTING)
    cmd = [pi_bin(), "--model", model, "-p", prompt, "--no-session", "--no-extensions", "--no-skills"]
    r = subprocess.run(cmd, capture_output=True, text=True, env=env)
    if r.returncode != 0:
        raise ReviewError(f"pi exited {r.returncode} for {model}: {r.stderr.strip()[:300]}")
    return r.stdout


def parse_findings(text):
    """Return (verdict, findings). Raises ValueError on any malformed output."""
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        raise ValueError("no JSON object in reviewer output")
    obj = json.loads(m.group(0))
    verdict = obj.get("verdict")
    if verdict not in ("pass", "fail"):
        raise ValueError("verdict must be pass or fail")
    raw = obj.get("findings")
    if not isinstance(raw, list):
        raise ValueError("findings must be a list")
    findings = []
    for f in raw:
        for key in ("file", "line", "severity", "ac", "failure_scenario"):
            if key not in f:
                raise ValueError(f"finding missing {key}")
        if f["severity"] not in SEVERITIES:
            raise ValueError(f"bad severity {f['severity']}")
        findings.append({k: f[k] for k in ("file", "line", "severity", "ac", "failure_scenario")})
    return verdict, findings


def review_once(model, template, acs, diff, caller=call_pi):
    """One reviewer call. Malformed output is a fail with no findings; the caller logs the note."""
    try:
        verdict, findings = parse_findings(caller(model, build_prompt(template, acs, diff)))
        return {"verdict": verdict, "findings": findings, "ok": True, "model": model}
    except (ValueError, json.JSONDecodeError) as exc:
        return {"verdict": "fail", "findings": [], "ok": False, "error": str(exc), "model": model}


def merge_council(votes):
    """Combine voices. votes: list of (name, role, result). Fail if majority of voices fail or veto fails."""
    voices = [(n, r) for n, role, r in votes if role == "voice"]
    veto = [r for n, role, r in votes if role == "veto"]
    fails = sum(1 for _, r in voices if r["verdict"] == "fail")
    failed = fails * 2 > len(voices) or any(r["verdict"] == "fail" for r in veto)
    findings = []
    for n, _role, r in votes:
        for f in r["findings"]:
            findings.append({**f, "voice": n})
    return {"verdict": "fail" if failed else "pass", "findings": findings}


# Files the harness puts in the worktree. They are never part of the implementation, and REVIEW.md
# holds earlier findings, so leaving it in would leak them to the next reviewer and to the graders.
HARNESS_FILES = ("REVIEW.md", "SPEC.md")


def diff_of(worktree, base):
    subprocess.run(["git", "-C", str(worktree), "add", "-N", "."], capture_output=True)
    excludes = [f":(exclude){name}" for name in HARNESS_FILES]
    r = subprocess.run(["git", "-C", str(worktree), "diff", base, "--", ".", *excludes],
                       capture_output=True, text=True)
    return r.stdout


def review(run_id, runs=RUNS, arm_data=None, caller=call_pi, prompts=PROMPTS):
    """Run one review round for a prepared run. Returns (round_index, action, result)."""
    run_dir = Path(runs) / run_id
    meta = json.loads((run_dir / "meta.json").read_text(encoding="utf-8"))
    cfg = arms.resolve(meta["arm"], arm_data)
    wt = Path(meta["worktree"])
    spec_text = (wt / "SPEC.md").read_text(encoding="utf-8")
    acs = read_acs(spec_text)
    diff = diff_of(wt, meta["base"])
    events_path = run_dir / "events.jsonl"
    prior = _prior_rounds(run_dir)
    idx = len(prior) + 1

    single = (prompts / "review-single.md").read_text(encoding="utf-8")
    reviewer = cfg["reviewer"]
    if reviewer["kind"] == "single":
        result = review_once(reviewer["model"], single, acs, diff, caller)
    else:
        votes = []
        for v in reviewer["voices"]:
            tmpl = (prompts / "review-voice.md").read_text(encoding="utf-8")
            tmpl = tmpl.replace("__DIMENSION__", v["name"]).replace("__DIMENSION_GUIDE__", VOICE_GUIDE[v["name"]])
            votes.append((v["name"], v["role"], review_once(v["model"], tmpl, acs, diff, caller)))
        result = merge_council(votes)
        for name, _role, r in votes:
            if not r["ok"]:
                events.append(events_path, "note", f"malformed output from {name}: {r['error']}", source="derived")

    if reviewer["kind"] == "single" and not result["ok"]:
        events.append(events_path, "note", f"malformed output: {result['error']}", source="derived")

    events.append(events_path, "review_round", f"round {idx}: {result['verdict']}, {len(result['findings'])} findings",
                  source="derived")
    for f in result["findings"]:
        events.append(events_path, "finding", json.dumps(f, ensure_ascii=False), source="derived")
    (run_dir / f"findings-{idx}.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")

    rounds = prior + [result]
    action = loop.next_action(rounds, cfg["max_rounds"])
    write_review_md(wt, idx, result, action)
    return idx, action, result


def _prior_rounds(run_dir):
    """Earlier rounds, oldest first, each read back from its own findings-<n>.json."""
    rounds = []
    while (path := Path(run_dir) / f"findings-{len(rounds) + 1}.json").exists():
        rounds.append(json.loads(path.read_text(encoding="utf-8")))
    return rounds


def write_review_md(wt, idx, result, action):
    lines = ["[bench-review]", f"Round {idx}: {result['verdict']}. Next: {action}.", ""]
    for f in result["findings"]:
        lines.append(f"- {f['file']}:{f['line']} [{f['severity']}] {f.get('ac') or 'no AC'}: {f['failure_scenario']}")
    if not result["findings"]:
        lines.append("No findings.")
    (Path(wt) / "REVIEW.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
