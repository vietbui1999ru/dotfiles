"""Phase 1 tests for scripts/headroom-workflow (SPEC: feat/headroom, AC-1..AC-3).

Every case runs the CLI with a temporary HOME, stub `headroom`/`claude`/`codex`
binaries and a loopback HTTP fixture, so no real provider, config, auth file or
paid inference is touched. Stdlib only.
"""
import json
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent
CLI = SCRIPTS / "headroom-workflow"

HEALTHY = {
    "/livez": (200, {"service": "headroom-proxy", "status": "healthy",
                     "alive": True, "version": "0.24.0"}),
    "/readyz": (200, {"service": "headroom-proxy", "status": "healthy",
                      "ready": True, "version": "0.24.0"}),
}
UNRELATED = {
    "/livez": (200, {"service": "some-other-service", "alive": True}),
    "/readyz": (200, {"service": "some-other-service", "ready": True}),
}
UNREADY = {
    "/livez": (200, {"service": "headroom-proxy", "alive": True, "version": "0.24.0"}),
    "/readyz": (503, {"service": "headroom-proxy", "ready": False,
                      "version": "0.24.0"}),
}

STUB = '''#!/usr/bin/env python3
import json, os, sys
watched = ("ANTHROPIC_BASE_URL", "OPENAI_BASE_URL", "HOME", "CODEX_HOME")
payload = {"argv": sys.argv[1:],
           "env": {k: os.environ.get(k) for k in watched},
           "present": sorted(k for k in os.environ if k.startswith(("HEADROOM_", "ANTHROPIC_", "OPENAI_")))}
with open(os.environ["STUB_OUT"], "w", encoding="utf-8") as fh:
    json.dump(payload, fh)
sys.exit(int(os.environ.get("STUB_EXIT", "0")))
'''


class Fixture:
    """Loopback HTTP fixture with per-path (status, json body) responses."""

    def __init__(self, routes):
        fixture = self
        self.requests = []

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                path = self.path.split("?", 1)[0]
                fixture.requests.append(path)
                status, body = routes.get(path, (404, {"error": "not found"}))
                raw = json.dumps(body).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

            def log_message(self, format, *args):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    @property
    def url(self):
        return f"http://127.0.0.1:{self.port}"

    def stop(self):
        self.server.shutdown()
        self.server.server_close()


def free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class HeadroomWorkflow(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="headroom-workflow-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.home = self.tmp / "home"
        self.home.mkdir()
        self.bin = self.tmp / "bin"
        self.bin.mkdir()
        self.stub_out = self.tmp / "stub.json"
        self.addCleanup(self._stop_fixtures)
        self.fixtures = []

    def _stop_fixtures(self):
        for fixture in self.fixtures:
            fixture.stop()

    # -- helpers ---------------------------------------------------------
    def fixture(self, routes):
        fixture = Fixture(routes)
        self.fixtures.append(fixture)
        return fixture

    def stub(self, name, exit_code=0):
        path = self.bin / name
        path.write_text(STUB, encoding="utf-8")
        path.chmod(0o755)
        self.stub_exit = exit_code
        return path

    def run_cli(self, *args, env=None, stub_exit=0):
        base = {
            "HOME": str(self.home),
            "PATH": f"{self.bin}:{Path(sys.executable).parent}:/usr/bin:/bin",
            "STUB_OUT": str(self.stub_out),
            "STUB_EXIT": str(stub_exit),
            "TMPDIR": str(self.tmp / "tmp"),
        }
        (self.tmp / "tmp").mkdir(exist_ok=True)
        base.update(env or {})
        return subprocess.run([sys.executable, str(CLI), *args], env=base,
                              capture_output=True, text=True, timeout=60)

    def stub_payload(self):
        self.assertTrue(self.stub_out.exists(), "stub child never ran")
        return json.loads(self.stub_out.read_text())

    def snapshot(self):
        return {str(p.relative_to(self.home)): p.read_bytes()
                for p in sorted(self.home.rglob("*")) if p.is_file()}

    # -- AC-1: proxy policy ---------------------------------------------
    def test_proxy_policy(self):
        self.stub("headroom")
        before = self.snapshot()
        r = self.run_cli("proxy")
        self.assertEqual(r.returncode, 0, r.stderr)
        argv = self.stub_payload()["argv"]
        self.assertEqual(argv, [
            "proxy", "--host", "127.0.0.1", "--port", "8787",
            "--mode", "cache", "--workers", "1",
            "--no-cache", "--no-telemetry",
        ])
        for forbidden in ("--memory", "--learn", "--log-messages", "--telemetry"):
            self.assertNotIn(forbidden, argv)
        env = self.stub_payload()["env"]
        self.assertEqual(env["HOME"], str(self.home))
        present = self.stub_payload()["present"]
        self.assertNotIn("HEADROOM_LOG_MESSAGES", present)
        self.assertNotIn("HEADROOM_PROXY_EXTENSIONS", present)
        self.assertEqual(self.snapshot(), before)

        # The configured port is honoured, the bind host stays loopback.
        self.stub_out.unlink()
        r = self.run_cli("proxy", env={"HEADROOM_WORKFLOW_URL": "http://127.0.0.1:9123"})
        self.assertEqual(r.returncode, 0, r.stderr)
        argv = self.stub_payload()["argv"]
        self.assertEqual(argv[argv.index("--port") + 1], "9123")
        self.assertEqual(argv[argv.index("--host") + 1], "127.0.0.1")

        # An existing listener is refused instead of double-binding.
        self.stub_out.unlink()
        fixture = self.fixture(HEALTHY)
        r = self.run_cli("proxy", env={"HEADROOM_WORKFLOW_URL": fixture.url})
        self.assertEqual(r.returncode, 1)
        self.assertIn("already listening", r.stderr)
        self.assertFalse(self.stub_out.exists())

        # Inherited feature switches are refused before launch.
        r = self.run_cli("proxy", env={"HEADROOM_LOG_MESSAGES": "1"})
        self.assertEqual(r.returncode, 1)
        self.assertIn("HEADROOM_LOG_MESSAGES", r.stderr)
        r = self.run_cli("proxy", env={"HEADROOM_PROXY_EXTENSIONS": "rtk"})
        self.assertEqual(r.returncode, 1)
        self.assertIn("HEADROOM_PROXY_EXTENSIONS", r.stderr)
        r = self.run_cli("proxy", env={"ANTHROPIC_TARGET_API_URL": "https://elsewhere.example"})
        self.assertEqual(r.returncode, 1)
        self.assertIn("ANTHROPIC_TARGET_API_URL", r.stderr)
        self.assertFalse(self.stub_out.exists())
        self.assertEqual(self.snapshot(), before)

    # -- AC-2: provider launchers ---------------------------------------
    def test_provider_launchers(self):
        fixture = self.fixture(HEALTHY)
        url = fixture.url
        before = self.snapshot()

        self.stub("claude")
        r = self.run_cli("claude", "--resume", "sess-1", "hello there",
                         env={"HEADROOM_WORKFLOW_URL": url}, stub_exit=7)
        self.assertEqual(r.returncode, 7, r.stderr)
        payload = self.stub_payload()
        self.assertEqual(payload["argv"], ["--resume", "sess-1", "hello there"])
        self.assertEqual(payload["env"]["ANTHROPIC_BASE_URL"], url)
        self.assertEqual(payload["env"]["HOME"], str(self.home))
        self.assertEqual(self.snapshot(), before)

        self.stub_out.unlink()
        self.stub("codex")
        r = self.run_cli("codex", "exec", "fix it", "--model", "gpt-5",
                         env={"HEADROOM_WORKFLOW_URL": url}, stub_exit=5)
        self.assertEqual(r.returncode, 5, r.stderr)
        payload = self.stub_payload()
        self.assertEqual(payload["argv"], [
            "-c", f'openai_base_url="{url}/v1"',
            "-c", f'chatgpt_base_url="{url}/backend-api/"',
            "exec", "fix it", "--model", "gpt-5",
        ])
        self.assertEqual(payload["env"]["HOME"], str(self.home))
        self.assertEqual(self.snapshot(), before)

        # Conflicting inherited routing is refused, never silently bypassed.
        self.stub_out.unlink()
        r = self.run_cli("claude", "hi",
                         env={"HEADROOM_WORKFLOW_URL": url,
                              "ANTHROPIC_BASE_URL": "https://api.anthropic.com"})
        self.assertEqual(r.returncode, 1)
        self.assertIn("ANTHROPIC_BASE_URL", r.stderr)
        self.assertFalse(self.stub_out.exists())

        r = self.run_cli("codex", "hi",
                         env={"HEADROOM_WORKFLOW_URL": url,
                              "OPENAI_BASE_URL": "https://api.openai.com/v1"})
        self.assertEqual(r.returncode, 1)
        self.assertIn("OPENAI_BASE_URL", r.stderr)
        self.assertFalse(self.stub_out.exists())

        # Conflicting Codex config bytes are reported, not edited.
        codex_dir = self.home / ".codex"
        codex_dir.mkdir()
        config = codex_dir / "config.toml"
        config.write_text('model = "gpt-5"\n'
                          'openai_base_url = "https://api.openai.com/v1"\n',
                          encoding="utf-8")
        before = self.snapshot()
        r = self.run_cli("codex", "hi", env={"HEADROOM_WORKFLOW_URL": url})
        self.assertEqual(r.returncode, 1)
        self.assertIn("openai_base_url", r.stderr)
        self.assertFalse(self.stub_out.exists())
        self.assertEqual(self.snapshot(), before)

        config.write_text('model_provider = "custom"\n', encoding="utf-8")
        before = self.snapshot()
        r = self.run_cli("codex", "hi", env={"HEADROOM_WORKFLOW_URL": url})
        self.assertEqual(r.returncode, 1)
        self.assertIn("model_provider", r.stderr)
        self.assertFalse(self.stub_out.exists())
        self.assertEqual(self.snapshot(), before)

        # A user argument that would undo the command-scoped override is refused.
        r = self.run_cli("codex", "-c", "openai_base_url=https://api.openai.com/v1",
                         env={"HEADROOM_WORKFLOW_URL": url})
        self.assertEqual(r.returncode, 1)
        self.assertIn("openai_base_url", r.stderr)
        self.assertFalse(self.stub_out.exists())
        r = self.run_cli("codex", "--config=chatgpt_base_url=https://chatgpt.com/backend-api/",
                         env={"HEADROOM_WORKFLOW_URL": url})
        self.assertEqual(r.returncode, 1)
        self.assertIn("chatgpt_base_url", r.stderr)
        self.assertFalse(self.stub_out.exists())

        # Claude settings that pin another upstream are reported, not edited.
        claude_dir = self.home / ".claude"
        claude_dir.mkdir()
        settings = claude_dir / "settings.json"
        settings.write_text(json.dumps({"env": {"ANTHROPIC_BASE_URL": "https://api.anthropic.com"}}),
                            encoding="utf-8")
        before = self.snapshot()
        r = self.run_cli("claude", "hi", env={"HEADROOM_WORKFLOW_URL": url})
        self.assertEqual(r.returncode, 1)
        self.assertIn("ANTHROPIC_BASE_URL", r.stderr)
        self.assertFalse(self.stub_out.exists())
        self.assertEqual(self.snapshot(), before)

    # -- AC-3: proxy validation -----------------------------------------
    def test_proxy_validation(self):
        # Nothing listening: a clear recovery command, no silent direct traffic.
        dead = free_port()
        r = self.run_cli("status", env={"HEADROOM_WORKFLOW_URL": f"http://127.0.0.1:{dead}"})
        self.assertEqual(r.returncode, 1)
        self.assertIn("headroom-workflow proxy", r.stderr)

        self.stub("claude")
        r = self.run_cli("claude", "hi", env={"HEADROOM_WORKFLOW_URL": f"http://127.0.0.1:{dead}"})
        self.assertEqual(r.returncode, 1)
        self.assertFalse(self.stub_out.exists())

        # Healthy proxy: status is ready and does not dump stats or config.
        fixture = self.fixture(HEALTHY)
        r = self.run_cli("status", env={"HEADROOM_WORKFLOW_URL": fixture.url})
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("ready", r.stdout)
        self.assertNotIn("checks", r.stdout)
        self.assertNotIn("config", r.stdout)

        # An unrelated listener on the port is not accepted as Headroom.
        other = self.fixture(UNRELATED)
        r = self.run_cli("status", env={"HEADROOM_WORKFLOW_URL": other.url})
        self.assertEqual(r.returncode, 1)
        self.assertIn("not Headroom", r.stderr)
        self.stub_out.unlink(missing_ok=True)
        r = self.run_cli("claude", "hi", env={"HEADROOM_WORKFLOW_URL": other.url})
        self.assertEqual(r.returncode, 1)
        self.assertFalse(self.stub_out.exists())

        # Headroom that is alive but not ready fails clearly too.
        unready = self.fixture(UNREADY)
        r = self.run_cli("status", env={"HEADROOM_WORKFLOW_URL": unready.url})
        self.assertEqual(r.returncode, 1)
        self.assertIn("not ready", r.stderr)

        # Non-loopback and malformed URLs are rejected before any probe.
        bad_urls = [
            "http://10.1.2.3:8787",
            "https://127.0.0.1:8787",
            "http://127.0.0.1",
            "http://127.0.0.1:8787/v1",
            "http://user:pw@127.0.0.1:8787",
            "http://127.0.0.1:8787?x=1",
            "http://127.0.0.1:8787#frag",
            "http://127.0.0.1:99999",
            "not-a-url",
        ]
        for bad in bad_urls:
            r = self.run_cli("status", env={"HEADROOM_WORKFLOW_URL": bad})
            self.assertEqual(r.returncode, 1, f"{bad} was accepted")
            self.assertIn("HEADROOM_WORKFLOW_URL", r.stderr)


if __name__ == "__main__":
    unittest.main()
