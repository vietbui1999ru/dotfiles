"""`bench log` implementation."""
import sys
from pathlib import Path

from . import events

RUNS = Path(__file__).resolve().parent.parent.parent / "bench" / "runs"


def run_dir(run_id, runs=RUNS):
    return Path(runs) / run_id


def log(run_id, etype, text, runs=RUNS):
    if etype not in events.TYPES:
        sys.stderr.write(f"bench: unknown event type '{etype}' (one of {', '.join(events.TYPES)})\n")
        return 2
    events.append(run_dir(run_id, runs) / "events.jsonl", etype, text, source="manual")
    return 0
