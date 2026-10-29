"""Resolve arm configurations from scripts/bench_data/arms.json."""
import copy
import json
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "bench_data"
REVIEW_ARMS = ("council", "single-gpt", "single-deepseek")


def load(path=DATA / "arms.json"):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def resolve(name, data=None):
    """Return the full config for an arm: review_defaults merged under the arm's own keys."""
    data = data or load()
    if name not in data["arms"]:
        raise KeyError(name)
    arm = copy.deepcopy(data["arms"][name])
    if name in REVIEW_ARMS:
        merged = copy.deepcopy(data["review_defaults"])
        merged.update(arm)
        return merged
    return arm
