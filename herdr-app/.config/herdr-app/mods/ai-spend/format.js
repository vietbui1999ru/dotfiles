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
