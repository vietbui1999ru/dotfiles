"""Tests for scripts/sync-agents: OpenCode permission rendering and presets. Stdlib only."""
import importlib.machinery
import importlib.util
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "sync-agents"
loader = importlib.machinery.SourceFileLoader("sync_agents", str(SCRIPT))
spec = importlib.util.spec_from_loader("sync_agents", loader)
sync_agents = importlib.util.module_from_spec(spec)
loader.exec_module(sync_agents)

FIELDS = {"description": "d"}


class OpenCodePermissions(unittest.TestCase):
    def test_edit_pattern_map_renders_in_order(self):
        perm = {"edit": {"*": "deny", "docs/x/**": "allow"}, "bash": {"*": "deny"}}
        out = sync_agents.render_oc("a", FIELDS, "body", {"oc_permission": perm})
        self.assertIn('  edit:\n    "*": deny\n    "docs/x/**": allow\n', out)

    def test_scalar_rules_render_on_one_line(self):
        out = sync_agents.render_oc("a", FIELDS, "body", {"oc_permission": {"edit": "deny", "bash": "deny"}})
        self.assertIn("  edit: deny\n  bash: deny\n", out)

    def test_presets_start_with_deny_and_never_allow_a_leading_wildcard(self):
        # OpenCode applies the last matching rule, so "*" must come first, and a pattern
        # starting with "*" would allow any command line that merely contains the word.
        for name, preset in sync_agents.PRESETS.items():
            for key, rule in preset.get("oc_permission", {}).items():
                if not isinstance(rule, dict):
                    continue
                with self.subTest(agent=name, key=key):
                    self.assertEqual(next(iter(rule.items())), ("*", "deny"))
                    for pattern, action in list(rule.items())[1:]:
                        self.assertFalse(action == "allow" and pattern.startswith("*"), pattern)

    def test_chronicler_bash_allows_no_write_subcommands(self):
        bash = sync_agents.PRESETS["chronicler"]["oc_permission"]["bash"]
        for broad in ("git *", "gh *", "glab *"):
            self.assertNotIn(broad, bash)


if __name__ == "__main__":
    unittest.main()
