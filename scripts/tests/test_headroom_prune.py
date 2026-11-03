"""headroom-prune sets ~/.headroom private and deletes stale debug_400 dumps (AC-18)."""
import os
import shutil
import stat
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

PRUNE = Path(__file__).resolve().parent.parent / "headroom-prune"
DAY = 86_400


class HeadroomPrune(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.root = self.tmp / "headroom"
        self.dumps = self.root / "logs" / "debug_400"
        self.dumps.mkdir(parents=True)

    def run_prune(self):
        env = {**os.environ, "HEADROOM_DIR": str(self.root)}
        return subprocess.run([str(PRUNE)], env=env, capture_output=True, text=True)

    def age(self, path, days):
        t = time.time() - days * DAY
        os.utime(path, (t, t))

    def mode(self, path):
        return stat.S_IMODE(path.stat().st_mode)

    def test_modes_are_tightened(self):
        (self.root / "config.json").write_text("{}")
        (self.root / "config.json").chmod(0o644)
        (self.root / "logs").chmod(0o755)
        r = self.run_prune()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.mode(self.root), 0o700)
        self.assertEqual(self.mode(self.root / "logs"), 0o700)
        self.assertEqual(self.mode(self.root / "config.json"), 0o600)

    def test_eight_day_old_dump_is_deleted_and_one_day_old_is_kept(self):
        old = self.dumps / "old.json"
        new = self.dumps / "new.json"
        old.write_text("{}")
        new.write_text("{}")
        self.age(old, 8)
        self.age(new, 1)
        self.assertEqual(self.run_prune().returncode, 0)
        self.assertFalse(old.exists())
        self.assertTrue(new.exists())

    def test_missing_directory_exits_zero(self):
        shutil.rmtree(self.root)
        r = self.run_prune()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual((r.stdout, r.stderr), ("", ""))

    def test_success_prints_nothing(self):
        r = self.run_prune()
        self.assertEqual((r.returncode, r.stdout, r.stderr), (0, "", ""))


if __name__ == "__main__":
    unittest.main()
