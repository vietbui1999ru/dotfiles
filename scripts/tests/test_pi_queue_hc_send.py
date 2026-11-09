"""review-decided sends to an hc terminal through `hc send`, and to a herdr pane as before.

The template shell is rendered the way pi-queue renders it ({{ and }} unescape, named
fields fill in), then run in zsh against a fake hc and herdr. Run:
python3 scripts/tests/test_pi_queue_hc_send.py
"""
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent
TEMPLATES = SCRIPTS / "pi-queue-templates.json"

STUB = """#!/bin/sh
printf '%s\\n' "$(basename "$0") $*" >> "$STUB_LOG"
"""


def rendered_send(session, message, herdr):
    template = json.loads(TEMPLATES.read_text())["review-decided"]["steps"][1]["cmd"][0]
    text = template.replace("{{", "{").replace("}}", "}")
    for key, value in {"session": session, "message": message, "herdr": herdr}.items():
        text = text.replace("{" + key + "}", value)
    return text


class ReviewDecidedSend(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="pqhc-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.bin = self.tmp / "bin"
        self.bin.mkdir()
        for name in ("hc", "herdr"):
            path = self.bin / name
            path.write_text(STUB)
            path.chmod(0o755)
        self.log = self.tmp / "calls.log"
        self.log.write_text("")
        self.run_dir = self.tmp / "pi-view"
        self.run_dir.mkdir()
        self.message = self.tmp / "message.txt"
        self.message.write_text("fix the nits")

    def send(self, pane_line):
        (self.run_dir / "pueue-s1.pane").write_text(pane_line + "\n")
        command = rendered_send("pueue-s1", str(self.message), str(self.bin / "herdr"))
        env = {
            "PATH": f"{self.bin}:/usr/bin:/bin",
            "TMPDIR": f"{self.tmp}/",
            "STUB_LOG": str(self.log),
            "HC_BIN_PATH": str(self.bin / "hc"),
        }
        return subprocess.run(["zsh", "-c", command], env=env, capture_output=True, text=True, timeout=20)

    def calls(self):
        return [line for line in self.log.read_text().splitlines() if line]

    def test_hc_pane_is_sent_through_hc_send(self):
        result = self.send("hc:t9")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.calls(), ["hc send t9 fix the nits"])

    def test_herdr_pane_keeps_send_text_and_enter(self):
        result = self.send("w1:p2")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.calls(), ["herdr pane send-text w1:p2 fix the nits", "herdr pane send-keys w1:p2 Enter"])


if __name__ == "__main__":
    unittest.main()
