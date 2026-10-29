"""Per-run event log: append-only JSON lines in bench/runs/<run-id>/events.jsonl."""
import json
import time
from pathlib import Path

TYPES = ("steer", "review_round", "finding", "test_iteration", "reject", "note")


class UnknownType(ValueError):
    """Raised for an event type outside the D7 list."""


def append(path, etype, detail, source="manual", ts=None):
    if etype not in TYPES:
        raise UnknownType(etype)
    record = {
        "ts": ts or time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "type": etype,
        "detail": detail,
        "source": source,
    }
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(record, ensure_ascii=False) + "\n")
    return record


def read(path):
    path = Path(path)
    if not path.exists():
        return []
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            out.append(json.loads(line))
    return out
