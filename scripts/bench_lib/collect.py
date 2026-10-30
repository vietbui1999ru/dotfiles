"""`bench collect`: derive steer events and usage from a Pi session, and capture the final diff."""
import json
from pathlib import Path

from . import events, review

REVIEW_MARK = "[bench-review]"
DERIVED = "derived"
SESSIONS = Path.home() / ".pi" / "agent" / "sessions"


def find_session(run_id, sessions=SESSIONS):
    """The session file whose name carries the bench session id for this run."""
    needle = f"bench-{run_id}"
    hits = [p for p in Path(sessions).rglob("*.jsonl") if needle in p.name]
    if not hits:
        return None
    return max(hits, key=lambda p: p.stat().st_mtime)


def _text(message):
    content = message.get("content", "")
    if isinstance(content, str):
        return content
    return "".join(part.get("text", "") for part in content if isinstance(part, dict))


def read_session(path):
    """Return (steers, tokens, cost) from a session file. Unparseable lines are skipped."""
    steers, tokens, cost, seen_first_user = [], 0, 0.0, False
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            continue
        if rec.get("type") != "message":
            continue
        msg = rec.get("message", {})
        role = msg.get("role")
        if role == "user":
            text = _text(msg)
            if not seen_first_user:
                seen_first_user = True
                continue
            if text.lstrip().startswith(REVIEW_MARK):
                continue
            steers.append(text.strip())
        elif role == "assistant":
            usage = msg.get("usage") or {}
            tokens += int(usage.get("totalTokens") or 0)
            c = usage.get("cost") or {}
            cost += float(c.get("total") or 0.0)
    return steers, tokens, cost


def collect(run_id, runs, sessions=SESSIONS):
    run_dir = Path(runs) / run_id
    meta_path = run_dir / "meta.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    ev_path = run_dir / "events.jsonl"

    session = find_session(run_id, sessions)
    if session is None:
        raise FileNotFoundError(f"no Pi session named bench-{run_id} under {sessions}")
    steers, tokens, cost = read_session(session)

    # Idempotent: drop previously derived events, keep manual ones.
    kept = [e for e in events.read(ev_path) if e.get("source") != DERIVED or e["type"] not in ("steer",)]
    ev_path.write_text("".join(json.dumps(e, ensure_ascii=False) + "\n" for e in kept), encoding="utf-8")
    for s in steers:
        events.append(ev_path, "steer", s, source=DERIVED)

    diff = review.diff_of(meta["worktree"], meta["base"])
    (run_dir / "final.diff").write_text(diff, encoding="utf-8")

    meta["tokens"] = tokens
    meta["cost"] = round(cost, 6)
    meta["session"] = str(session)
    meta_path.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    return {"steers": len(steers), "tokens": tokens, "cost": cost, "session": str(session)}
