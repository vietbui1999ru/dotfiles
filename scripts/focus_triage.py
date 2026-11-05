"""Read-only inventory of every worktree under the focus roots, for `scripts/focus triage`.

It never writes: no fetch, no index refresh (git status runs with --no-optional-locks), no
state file. gh is asked once per repo for its PR list and any failure shows as `?`.
Stdlib only; imported by scripts/focus.
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

GIT_TIMEOUT = 20
GH_TIMEOUT = 30


def _run(argv: list[str], cwd: Path | None = None, timeout: int = GIT_TIMEOUT) -> subprocess.CompletedProcess | None:
    try:
        return subprocess.run(argv, cwd=str(cwd) if cwd else None, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        return None


def repos_under(home: Path, roots: list[Path]) -> list[Path]:
    """Dotfiles plus every git repo directly under a root."""
    found: list[Path] = []
    dotfiles = home / "dotfiles"
    if (dotfiles / ".git").exists():
        found.append(dotfiles)
    for root in roots:
        if not root.is_dir():
            continue
        for child in sorted(root.iterdir()):
            if (child / ".git").exists() and child not in found:
                found.append(child)
    return found


def worktrees(repo: Path) -> list[dict]:
    out = _run(["git", "-C", str(repo), "worktree", "list", "--porcelain"])
    if out is None or out.returncode != 0:
        return []
    items: list[dict] = []
    current: dict = {}
    for line in out.stdout.splitlines() + [""]:
        if not line:
            if current.get("path"):
                items.append(current)
            current = {}
        elif line.startswith("worktree "):
            current["path"] = line[len("worktree "):]
        elif line.startswith("branch refs/heads/"):
            current["branch"] = line[len("branch refs/heads/"):]
        elif line == "detached":
            current["branch"] = "(detached)"
        elif line == "bare":
            current["bare"] = True
    return [item for item in items if not item.get("bare")]


def last_commit(path: Path) -> str:
    out = _run(["git", "-C", str(path), "log", "-1", "--format=%cs"])
    return out.stdout.strip() if out and out.returncode == 0 and out.stdout.strip() else "?"


def dirty(path: Path) -> bool:
    out = _run(["git", "-C", str(path), "--no-optional-locks", "status", "--porcelain"])
    return bool(out and out.returncode == 0 and out.stdout.strip())


def pr_states(repo: Path) -> dict[str, str]:
    """Branch to PR state, from one gh call per repo. Any gh failure gives an empty map."""
    out = _run(["gh", "pr", "list", "--state", "all", "--limit", "300", "--json", "headRefName,state"], cwd=repo, timeout=GH_TIMEOUT)
    if out is None or out.returncode != 0:
        return {}
    try:
        data = json.loads(out.stdout)
    except json.JSONDecodeError:
        return {}
    states: dict[str, str] = {}
    for pr in data if isinstance(data, list) else []:
        branch = pr.get("headRefName")
        state = str(pr.get("state", "")).lower()
        if branch and branch not in states:
            states[branch] = state
    return states


def collect(home: Path, roots: list[Path]) -> list[dict]:
    rows: list[dict] = []
    for repo in repos_under(home, roots):
        prs = pr_states(repo)
        for wt in worktrees(repo):
            path = Path(wt["path"])
            branch = wt.get("branch", "(detached)")
            rows.append({
                "repo": repo.name,
                "branch": branch,
                "path": str(path),
                "last_commit": last_commit(path),
                "dirty": dirty(path),
                "pr": prs.get(branch, "?" if not prs else "none"),
                "spec": (path / "SPEC.md").exists(),
            })
    return rows


def render(rows: list[dict]) -> str:
    if not rows:
        return "no worktrees found"
    headers = ["REPO", "BRANCH", "LAST", "DIRTY", "PR", "SPEC"]
    table = [[r["repo"], r["branch"], r["last_commit"], "yes" if r["dirty"] else "no", str(r["pr"]), "yes" if r["spec"] else "no"] for r in rows]
    widths = [max(len(row[i]) for row in [headers, *table]) for i in range(len(headers))]
    lines = ["  ".join(cell.ljust(widths[i]) for i, cell in enumerate(row)) for row in [headers, *table]]
    return "\n".join(lines)

