// Pure formatting for the AI spend band: no herdr or gpui imports, so the tests can load it.

const WINDOWS = { five_hour: "5h", primary: "5h", seven_day: "7d", secondary: "7d" };
const WINDOW_RANK = { "5h": 0, "7d": 1 };
const ORDER = ["claude", "chatgpt", "opencode-go", "other"];
const NAMES = { claude: "Claude", chatgpt: "ChatGPT", "opencode-go": "Go", other: "Other" };

export function quotaLabel(window) {
  return WINDOWS[window] ?? null;
}

// `cost` is { cost_usd, cost_source }. "≈" marks an estimate, not a reported bill.
export function costLabel(cost) {
  if (!cost || cost.cost_usd == null) return "$—";
  const amount = cost.cost_usd.toFixed(2);
  return cost.cost_source === "computed" ? `≈$${amount}` : `$${amount}`;
}

export function quotaView(q) {
  const label = quotaLabel(q.window);
  if (q.expired || q.used_pct == null) return { label, text: "—", level: "normal", dim: true };
  const pct = Math.round(q.used_pct);
  let level = "normal";
  if (pct >= 80) level = "error";
  else if (pct >= 60) level = "attention";
  if (q.stale) return { label, text: `${pct}%?`, level, dim: true };
  return { label, text: `${pct}%`, level, dim: false };
}

export function resetText(q, now) {
  const label = quotaLabel(q.window);
  if (q.expired) return `${label} expired`;
  const ms = new Date(q.resets_at).getTime() - now;
  const minutes = Math.max(0, Math.floor(ms / 60000));
  const hours = Math.floor(minutes / 60);
  if (hours >= 24) return `${label} resets in ${Math.floor(hours / 24)}d ${hours % 24}h`;
  return `${label} resets in ${hours}h ${minutes % 60}m`;
}

// Turns `claude-tui status --json` output into what the band draws: { message } or { groups }.
export function bandModel(code, stdout) {
  if (code !== 0) return { message: "Usage unavailable" };
  let data;
  try {
    data = JSON.parse(stdout);
  } catch {
    return { message: "Usage unavailable" };
  }
  if (data?.v !== 1) return { message: "Usage format changed" };
  if (!data.subscriptions || typeof data.subscriptions !== "object") return { message: "Usage unavailable" };

  const groups = [];
  for (const key of ORDER) {
    const sub = data.subscriptions[key];
    if (!sub) continue;
    const week = sub.last_7d ?? null;
    const quota = Array.isArray(sub.quota) ? sub.quota : [];
    const quotas = quota.filter((q) => quotaLabel(q.window)).sort((a, b) => WINDOW_RANK[quotaLabel(a.window)] - WINDOW_RANK[quotaLabel(b.window)]);
    // Nothing to show: no spend this week and no quota.
    if ((week?.cost_usd ?? 0) === 0 && quotas.length === 0) continue;
    groups.push({
      name: NAMES[key],
      quotas: quotas.map((q) => ({ ...quotaView(q), raw: q })),
      today: costLabel(sub.today),
      week: costLabel(week),
      raw: quotas,
    });
  }
  return { groups };
}

// The background Claude job a Herdr terminal is attached to. `psText` is `ps axeww -o command=`
// output, one process per line with its environment appended: the match is a `claude attach <job>`
// client whose environment has HC_TERMINAL_ID=<terminal>. Null when there is none.
export function attachedJob(psText, terminal) {
  if (!terminal || typeof psText !== "string") return null;
  for (const line of psText.split("\n")) {
    const m = /^(?:\S*\/)?claude attach ([A-Za-z0-9_-]+)(?:\s|$)/.exec(line);
    if (m && line.split(/\s+/).includes(`HC_TERMINAL_ID=${terminal}`)) return m[1];
  }
  return null;
}

// The session id in a job's ~/.claude/jobs/<job>/state.json (Claude Code's own, undocumented
// layout), or null when the file is missing, malformed or the id is not a plain name.
export function jobSession(text) {
  if (typeof text !== "string") return null;
  try {
    const id = JSON.parse(text)?.sessionId;
    return typeof id === "string" && /^[A-Za-z0-9_-]+$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

// A snapshot older than this is hidden: the Claude session that wrote it is no longer drawing.
export const TERMINAL_MAX_AGE_MS = 5 * 60 * 1000;

// The focused terminal's context, model and branch, from the status line's per-terminal snapshot
// (claude/.claude/statusline-command.sh). Returns null when the terminal has no usable snapshot:
// no focused terminal, a terminal id that is not a plain name, unreadable or malformed JSON, or a
// snapshot older than TERMINAL_MAX_AGE_MS. The band then shows none of these segments.
export function terminalSegments(terminal, text, now) {
  if (!terminal || !/^[A-Za-z0-9._-]+$/.test(terminal)) return null;
  if (typeof text !== "string" || text === "") return null;
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || typeof data.updated !== "number") return null;
  if (now - data.updated * 1000 > TERMINAL_MAX_AGE_MS) return null;
  return {
    ctx: typeof data.ctx === "number" ? `ctx ${Math.round(data.ctx)}%` : null,
    model: typeof data.model === "string" && data.model !== "" ? data.model : null,
    branch: typeof data.branch === "string" && data.branch !== "" ? data.branch : null,
    ctxPct: typeof data.ctx === "number" ? data.ctx : null,
  };
}
