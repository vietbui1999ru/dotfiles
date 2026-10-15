"""skill-prune: managed skills are never touched; idle unmanaged ones move aside and can be restored."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "skill-prune"
DAY = 86400


class SkillPruneCases(unittest.TestCase):
    def setUp(self):
        self.home = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.home, True)
        (self.home / ".claude/projects/p").mkdir(parents=True)
        (self.home / ".claude/skills").mkdir(parents=True)

    def skill(self, name, age_days, root=".agents/skills"):
        d = self.home / root / name
        d.mkdir(parents=True)
        md = d / "SKILL.md"
        md.write_text(f"---\nname: {name}\n---\n")
        t = time.time() - age_days * DAY
        os.utime(md, (t, t))
        return d

    def use(self, name, days_ago):
        ts = (datetime.now(timezone.utc) - timedelta(days=days_ago)).isoformat().replace("+00:00", "Z")
        rec = {"timestamp": ts, "message": {"content": [{"type": "tool_use", "name": "Skill", "input": {"skill": name}}]}}
        with (self.home / ".claude/projects/p/s.jsonl").open("a") as fh:
            fh.write(json.dumps(rec) + "\n")

    def run_cli(self, *args):
        env = {**os.environ, "SKILL_PRUNE_HOME": str(self.home)}
        return subprocess.run([sys.executable, str(SCRIPT), *args], env=env, capture_output=True, text=True)

    def test_idle_unused_skill_is_flagged_and_recent_ones_are_not(self):
        self.skill("old-unused", 90)
        self.skill("old-but-used-recently", 90)
        self.use("old-but-used-recently", 3)
        self.skill("old-used-long-ago", 90)
        self.use("old-used-long-ago", 60)
        self.skill("new-unused", 2)
        out = self.run_cli().stdout
        verdicts = {line.split()[0]: line.split()[-1] for line in out.splitlines() if line and not line.startswith(("skill", "dry"))}
        self.assertEqual(verdicts, {"old-unused": "IDLE", "old-but-used-recently": "keep",
                                    "old-used-long-ago": "IDLE", "new-unused": "keep"})

    def test_managed_skills_are_never_candidates(self):
        self.skill("in-kb", 90)
        (self.home / "dotfiles/shared/skills/in-kb").mkdir(parents=True)
        self.skill("on-keep-list", 90)
        keep = self.home / ".config/skill-prune/keep"
        keep.parent.mkdir(parents=True)
        keep.write_text("# kept by hand\non-keep-list\n")
        self.skill("curated-firecrawl", 90)
        fc = self.home / "dotfiles/shared/firecrawl-skills.txt"
        fc.write_text("curated-firecrawl\n")
        linked_target = self.home / "dotfiles/shared/skills/linked"
        linked_target.mkdir(parents=True)
        (linked_target / "SKILL.md").write_text("x")
        os.symlink(linked_target, self.home / ".agents/skills/linked") if (self.home / ".agents/skills").is_dir() else None
        out = self.run_cli().stdout
        for name in ("in-kb", "on-keep-list", "curated-firecrawl", "linked"):
            self.assertNotIn(name, out)

    def test_apply_moves_idle_skill_removes_dangling_link_and_restore_puts_it_back(self):
        d = self.skill("idle-one", 90)
        os.symlink(d, self.home / ".claude/skills/idle-one")
        self.skill("busy-one", 90)
        self.use("busy-one", 1)
        notice = self.home / ".local/state/skill-prune/notice"
        notice.parent.mkdir(parents=True)
        notice.write_text("1 unmanaged skill(s) idle 30+ days: idle-one\n")
        r = self.run_cli("--apply")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(notice.read_text(), "")
        self.assertFalse(d.exists())
        self.assertFalse((self.home / ".claude/skills/idle-one").is_symlink())
        self.assertTrue((self.home / ".agents/skills/busy-one").is_dir())
        pruned = list((self.home / ".agents/skills-disabled/pruned").glob("*/idle-one/SKILL.md"))
        self.assertEqual(len(pruned), 1)
        self.assertEqual(self.run_cli("--restore", "idle-one").returncode, 0)
        self.assertTrue((d / "SKILL.md").is_file())

    def test_restore_refuses_to_overwrite_and_unknown_name_fails(self):
        d = self.skill("again", 90)
        self.run_cli("--apply")
        self.skill("again", 1)
        self.assertNotEqual(self.run_cli("--restore", "again").returncode, 0)
        self.assertTrue((d / "SKILL.md").is_file())
        self.assertNotEqual(self.run_cli("--restore", "never-existed").returncode, 0)

    def test_check_is_silent_when_nothing_is_idle_and_one_line_otherwise(self):
        self.skill("fresh", 1)
        self.assertEqual(self.run_cli("--check").stdout, "")
        self.skill("stale", 90)
        out = self.run_cli("--check").stdout
        self.assertEqual(len(out.strip().splitlines()), 1)
        self.assertIn("stale", out)
        self.assertNotIn("fresh", out)


if __name__ == "__main__":
    unittest.main()
