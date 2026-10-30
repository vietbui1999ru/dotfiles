"""The review loop's stop rule (D5). Pure: no I/O."""

CONTINUE = "continue"
STOP_PASSED = "stop:passed"
STOP_NITS = "stop:nits"
STOP_CAP = "stop:cap"


def next_action(rounds, max_rounds):
    """Decide what follows the latest round. `rounds` is a list of round dicts, oldest first.

    Each round has `verdict` ("pass" or "fail") and `findings` (a list of dicts with `severity`).
    """
    if not rounds:
        return CONTINUE
    last = rounds[-1]
    if last["verdict"] == "pass":
        return STOP_PASSED
    findings = last.get("findings", [])
    if findings and all(f.get("severity") == "nit" for f in findings):
        return STOP_NITS
    if len(rounds) >= max_rounds:
        return STOP_CAP
    return CONTINUE
