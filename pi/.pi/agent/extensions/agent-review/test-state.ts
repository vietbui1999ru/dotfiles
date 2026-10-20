// Keeps tests off the real `list --global` registry: point XDG_STATE_HOME at a
// throwaway directory before any test file loads.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.XDG_STATE_HOME = mkdtempSync(join(tmpdir(), "agent-review-test-state-"));
