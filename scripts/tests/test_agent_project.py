"""Behavioral fixtures for the read-only project documentation companion."""

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "agent-project"


class AgentProject(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = Path(self.tmp.name)
        self.main = self.base / "main"
        self.main.mkdir()
        self.git(self.main, "init", "-q")
        self.git(self.main, "config", "user.email", "test@example.invalid")
        self.git(self.main, "config", "user.name", "Fixture")
        (self.main / "docs/project/tasks").mkdir(parents=True)
        (self.main / "docs/project/tasks/alpha.md").write_text("# Alpha\n\n- Spec: [S](../../superpowers/specs/s.md)\n- Plan: [P](../../superpowers/plans/p.md)\n")
        (self.main / "docs/superpowers/specs").mkdir(parents=True)
        (self.main / "docs/superpowers/plans").mkdir(parents=True)
        (self.main / "docs/superpowers/specs/s.md").write_text("# Spec\n")
        (self.main / "docs/superpowers/plans/p.md").write_text("# Plan\n")
        self.commit_all()
        self.wt = self.base / "feature"
        self.git(self.main, "worktree", "add", "-qb", "feat/example", str(self.wt))

    def tearDown(self):
        self.tmp.cleanup()

    def git(self, cwd, *args):
        return subprocess.run(["git", "-C", str(cwd), *args], check=True, capture_output=True, text=True)

    def commit_all(self):
        self.git(self.main, "add", ".")
        self.git(self.main, "commit", "-qm", "fixture")

    def cli(self, *args, env=None):
        child_env = os.environ.copy()
        child_env.update(env or {})
        return subprocess.run(["python3", str(SCRIPT), *map(str, args)], cwd=self.wt, env=child_env, capture_output=True, text=True)

    def test_view_partitions_worktree_uses_common_root_and_marks_missing_sources(self):
        exclude = self.main / ".git/info/exclude"
        exclude.parent.mkdir(parents=True, exist_ok=True)
        exclude.write_text("/keep-existing/\n")
        task = self.wt / "docs/project/tasks/alpha.md"
        task.write_text("# Alpha\n")
        pending = self.wt / ".pi/agent-review/pending"
        pending.mkdir(parents=True)
        (pending / "review-1.json").write_text('{"id":"review-1"}')
        index = self.main / ".agents/sessions/index.json"
        index.parent.mkdir(parents=True)
        index.write_text('{"sessions": []}')
        out = self.cli("view", self.wt, "--task", "alpha")
        self.assertEqual(out.returncode, 0, out.stderr)
        views = list((self.main / ".agents/project-view").glob("*/current.md"))
        self.assertEqual(len(views), 1)
        body = views[0].read_text()
        self.assertIn("Observed at:", body)
        self.assertIn("alpha.md", body)
        self.assertIn("review-1.json", body)
        self.assertIn("age 0s", body)
        self.assertIn("file://", body)
        self.assertIn("feat/example", body)
        self.assertTrue(index.exists())
        exclude_text = exclude.read_text()
        self.assertIn("/keep-existing/", exclude_text)
        self.assertIn("/.agents/project-view/", exclude_text)

    def test_view_two_worktrees_share_main_storage_but_keep_reviews_local(self):
        second = self.base / "second"
        self.git(self.main, "worktree", "add", "-qb", "feat/second", str(second))
        for worktree, run_id in ((self.wt, "one"), (second, "two")):
            pending = worktree / ".pi/agent-review/pending"
            pending.mkdir(parents=True)
            (pending / f"{run_id}.json").write_text("{}")
            result = self.cli("view", worktree, "--task", "alpha")
            self.assertEqual(result.returncode, 0, result.stderr)
        views = list((self.main / ".agents/project-view").glob("*/current.md"))
        self.assertEqual(len(views), 2)
        contents = [path.read_text() for path in views]
        self.assertTrue(any("one.json" in text and "two.json" not in text for text in contents))
        self.assertTrue(any("two.json" in text and "one.json" not in text for text in contents))

    def test_view_marks_missing_sources_unknown(self):
        result = self.cli("view", self.wt, "--task", "alpha")
        self.assertEqual(result.returncode, 0, result.stderr)
        body = next((self.main / ".agents/project-view").glob("*/current.md")).read_text()
        self.assertIn("missing", body.lower())

    def test_view_filters_legacy_index_and_reports_pending_missing(self):
        index = self.main / ".agents/sessions/index.json"
        index.parent.mkdir(parents=True)
        index.write_text(json.dumps({"sessions": [
            {"task": "alpha", "branch": "feat/example"},
            {"task": "other", "branch": "feat/example"},
            {"task": "alpha", "branch": "feat/elsewhere"},
            {"task": "alpha"},
        ]}))
        os.utime(index, (1, 1))
        result = self.cli("view", self.wt, "--task", "alpha")
        self.assertEqual(result.returncode, 0, result.stderr)
        body = next((self.main / ".agents/project-view").glob("*/current.md")).read_text()
        self.assertIn("stale", body)
        self.assertIn("1 matching session(s)", body)
        self.assertIn("legacy/unknown", body)
        self.assertIn("Local pending reviews: missing", body)

    def test_view_reads_only_pi_outcome_fields_through_seam(self):
        stub = self.base / "pi-outcome"
        stub.write_text('#!/usr/bin/env python3\nimport json,sys\nprint(json.dumps({"id": 7, "outcome": "fixing", "reviewWaiting": True, "command": "secret"}))\n')
        stub.chmod(0o755)
        result = self.cli("view", self.wt, "--task", "alpha", "--pi-task", "7", env={"AGENT_PROJECT_PI_OUTCOME": str(stub)})
        self.assertEqual(result.returncode, 0, result.stderr)
        body = next((self.main / ".agents/project-view").glob("*/current.md")).read_text()
        self.assertIn("Pi task 7: fixing; review waiting=true", body)
        self.assertNotIn("secret", body)

    def test_view_reports_invalid_pi_outcome_as_unknown(self):
        stub = self.base / "bad-pi-outcome"
        stub.write_text("#!/bin/sh\necho invalid\n")
        stub.chmod(0o755)
        result = self.cli("view", self.wt, "--task", "alpha", "--pi-task", "7", env={"AGENT_PROJECT_PI_OUTCOME": str(stub)})
        self.assertEqual(result.returncode, 0, result.stderr)
        body = next((self.main / ".agents/project-view").glob("*/current.md")).read_text()
        self.assertIn("Pi task 7: unknown", body)

    def test_view_refuses_symlinked_output_components(self):
        self.cli("view", self.wt, "--task", "alpha")
        target = next((self.main / ".agents/project-view").glob("*/current.md"))
        saved = target.with_suffix(".saved")
        target.rename(saved)
        outside = self.base / "outside.md"
        outside.write_text("preserve\n")
        target.symlink_to(outside)
        result = self.cli("view", self.wt, "--task", "alpha")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(outside.read_text(), "preserve\n")

    def test_view_refuses_symlinked_project_view_directory(self):
        view_root = self.main / ".agents/project-view"
        view_root.parent.mkdir(parents=True)
        outside = self.base / "external"
        outside.mkdir()
        view_root.symlink_to(outside, target_is_directory=True)
        result = self.cli("view", self.wt, "--task", "alpha")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(list(outside.iterdir()), [])

    def test_view_rejects_task_traversal(self):
        out = self.cli("view", self.wt, "--task", "../secret")
        self.assertNotEqual(out.returncode, 0)

    def test_check_artifacts_requires_clean_head_bytes_and_emits_refs(self):
        artifact = self.wt / "docs/project/tasks/alpha.md"
        artifact.write_text("# Alpha\n")
        self.git(self.wt, "add", "docs/project/tasks/alpha.md")
        self.git(self.wt, "commit", "-qm", "clean artifact")
        out = self.cli("check-artifacts", self.wt, "--artifact", "docs/project/tasks/alpha.md")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertIn("docs/project/tasks/alpha.md", out.stdout)
        artifact.write_text("dirty\n")
        self.assertNotEqual(self.cli("check-artifacts", self.wt, "--artifact", "docs/project/tasks/alpha.md").returncode, 0)
        self.assertNotEqual(self.cli("check-artifacts", self.wt, "--artifact", "new.md").returncode, 0)

    def test_check_artifacts_rejects_tracked_symlink(self):
        target = self.wt / "target.md"
        target.write_text("# target\n")
        link = self.wt / "link.md"
        link.symlink_to(target)
        self.git(self.wt, "add", "target.md", "link.md")
        self.git(self.wt, "commit", "-qm", "symlink artifact")
        result = self.cli("check-artifacts", self.wt, "--artifact", "link.md")
        self.assertNotEqual(result.returncode, 0)

    def test_check_artifacts_rejects_symlink_escape(self):
        outside = self.base / "outside.md"
        outside.write_text("# outside\n")
        (self.wt / "escape.md").symlink_to(outside)
        self.assertNotEqual(self.cli("check-artifacts", self.wt, "--artifact", "escape.md").returncode, 0)

    def test_publish_check_allows_only_safe_allowlisted_pages_and_links(self):
        public = self.wt / "docs/guides/guide.md"
        public.parent.mkdir(parents=True, exist_ok=True)
        public.write_text("[task](../project/tasks/alpha.md)\n")
        self.git(self.wt, "add", "docs/guides/guide.md")
        self.git(self.wt, "commit", "-qm", "guide")
        manifest = self.wt / "manifest.json"
        manifest.write_text(json.dumps({"pages": ["docs/guides/guide.md", "docs/project/tasks/alpha.md"]}))
        self.assertNotEqual(self.cli("publish-check", self.wt, "--manifest", manifest.relative_to(self.wt)).returncode, 0)
        manifest.write_text(json.dumps({"pages": ["docs/guides/guide.md"]}))
        self.assertNotEqual(self.cli("publish-check", self.wt, "--manifest", manifest.relative_to(self.wt)).returncode, 0)
        public.write_text("# Guide\n")
        self.git(self.wt, "add", "docs/guides/guide.md")
        self.git(self.wt, "commit", "-qm", "remove private link")
        self.assertEqual(self.cli("publish-check", self.wt, "--manifest", manifest.relative_to(self.wt)).returncode, 0)
        self.assertNotEqual(self.cli("publish-check", self.wt, "--manifest", manifest).returncode, 0)

    def test_publish_check_normalizes_cross_doc_links_and_rejects_unsafe_schemes(self):
        guide = self.wt / "docs/guides/guide.md"
        reference = self.wt / "docs/reference/ref.md"
        guide.parent.mkdir(parents=True, exist_ok=True)
        reference.parent.mkdir(parents=True, exist_ok=True)
        guide.write_text("[reference](../reference/ref.md)\n")
        reference.write_text("# Reference\n")
        self.git(self.wt, "add", "docs/guides/guide.md", "docs/reference/ref.md")
        self.git(self.wt, "commit", "-qm", "public docs")
        manifest = self.wt / "manifest.json"
        manifest.write_text(json.dumps({"pages": ["docs/guides/guide.md", "docs/reference/ref.md"]}))
        self.assertEqual(self.cli("publish-check", self.wt, "--manifest", manifest.relative_to(self.wt)).returncode, 0)
        guide.write_text("[unsafe](javascript:alert(1))\n")
        self.git(self.wt, "add", "docs/guides/guide.md")
        self.git(self.wt, "commit", "-qm", "unsafe link")
        self.assertNotEqual(self.cli("publish-check", self.wt, "--manifest", manifest.relative_to(self.wt)).returncode, 0)

    def test_publish_check_rejects_dirty_pages(self):
        guide = self.wt / "docs/guides/guide.md"
        guide.parent.mkdir(parents=True, exist_ok=True)
        guide.write_text("# Guide\n")
        self.git(self.wt, "add", "docs/guides/guide.md")
        self.git(self.wt, "commit", "-qm", "guide")
        manifest = self.wt / "manifest.json"
        manifest.write_text(json.dumps({"pages": ["docs/guides/guide.md"]}))
        self.assertEqual(self.cli("publish-check", self.wt, "--manifest", "manifest.json").returncode, 0)
        guide.write_text("# Changed after commit\n")
        self.assertNotEqual(self.cli("publish-check", self.wt, "--manifest", "manifest.json").returncode, 0)

    def test_publish_check_requires_committed_asset_manifest_entry(self):
        guide = self.wt / "docs/guides/guide.md"
        asset = self.wt / "docs/assets/logo.png"
        guide.parent.mkdir(parents=True, exist_ok=True)
        asset.parent.mkdir(parents=True, exist_ok=True)
        guide.write_text("![logo](../assets/logo.png)\n")
        asset.write_bytes(b"png fixture")
        self.git(self.wt, "add", "docs/guides/guide.md", "docs/assets/logo.png")
        self.git(self.wt, "commit", "-qm", "guide and asset")
        manifest = self.wt / "manifest.json"
        manifest.write_text(json.dumps({"pages": ["docs/guides/guide.md"]}))
        self.assertNotEqual(self.cli("publish-check", self.wt, "--manifest", "manifest.json").returncode, 0)
        manifest.write_text(json.dumps({"pages": ["docs/guides/guide.md"], "assets": ["docs/assets/logo.png"]}))
        self.assertEqual(self.cli("publish-check", self.wt, "--manifest", "manifest.json").returncode, 0)
        asset.write_bytes(b"dirty")
        self.assertNotEqual(self.cli("publish-check", self.wt, "--manifest", "manifest.json").returncode, 0)

    def test_publish_check_supports_reference_definitions_and_safe_autolinks(self):
        guide = self.wt / "docs/guides/guide.md"
        reference = self.wt / "docs/reference/ref.md"
        guide.parent.mkdir(parents=True, exist_ok=True)
        reference.parent.mkdir(parents=True, exist_ok=True)
        guide.write_text("[ref]: ../reference/ref.md\n\n[Read][ref] <https://example.com> <mailto:docs@example.com>\n")
        reference.write_text("# Reference\n")
        self.git(self.wt, "add", "docs/guides/guide.md", "docs/reference/ref.md")
        self.git(self.wt, "commit", "-qm", "public refs")
        manifest = self.wt / "manifest.json"
        manifest.write_text(json.dumps({"pages": ["docs/guides/guide.md", "docs/reference/ref.md"]}))
        result = self.cli("publish-check", self.wt, "--manifest", "manifest.json")
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_publish_check_ignores_unsupported_syntax_inside_fenced_code(self):
        guide = self.wt / "docs/guides/guide.md"
        guide.parent.mkdir(parents=True, exist_ok=True)
        guide.write_text("```html\n<script>[[example]]</script>\n```\n\n# Guide\n")
        self.git(self.wt, "add", "docs/guides/guide.md")
        self.git(self.wt, "commit", "-qm", "guide")
        manifest = self.wt / "manifest.json"
        manifest.write_text(json.dumps({"pages": ["docs/guides/guide.md"]}))
        result = self.cli("publish-check", self.wt, "--manifest", "manifest.json")
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_publish_check_rejects_wikilinks_and_raw_html(self):
        guide = self.wt / "docs/guides/guide.md"
        guide.parent.mkdir(parents=True, exist_ok=True)
        self.git(self.wt, "add", "docs/guides/guide.md") if guide.exists() else None
        manifest = self.wt / "manifest.json"
        for body in ("[[private-note]]\n", "<script>alert(1)</script>\n", "<!-- hidden html -->", "<javascript:bad>"):
            guide.write_text(body)
            self.git(self.wt, "add", "docs/guides/guide.md")
            self.git(self.wt, "commit", "-qm", "unsupported syntax")
            manifest.write_text(json.dumps({"pages": ["docs/guides/guide.md"]}))
            self.assertNotEqual(self.cli("publish-check", self.wt, "--manifest", "manifest.json").returncode, 0, body)

    def test_publish_check_detects_symlink_to_private_page(self):
        public = self.wt / "docs/guides/guide.md"
        public.parent.mkdir(parents=True, exist_ok=True)
        private = self.wt / "docs/project/tasks/alpha.md"
        public.symlink_to(private)
        manifest = self.wt / "manifest.json"
        manifest.write_text(json.dumps({"pages": ["docs/guides/guide.md"]}))
        self.assertNotEqual(self.cli("publish-check", self.wt, "--manifest", manifest.relative_to(self.wt)).returncode, 0)

    def test_publish_check_rejects_private_pages_and_traversal(self):
        manifest = self.wt / "manifest.json"
        for page in ("docs/project/tasks/alpha.md", "docs/superpowers/plans/p.md", "../secret.md", "docs/random.md", "SPEC.md"):
            manifest.write_text(json.dumps({"pages": [page]}))
            self.assertNotEqual(self.cli("publish-check", self.wt, "--manifest", manifest.relative_to(self.wt)).returncode, 0, page)


if __name__ == "__main__":
    unittest.main()
