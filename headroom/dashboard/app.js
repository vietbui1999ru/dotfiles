// Merged view of the two Headroom proxies. Per-boot numbers are per process and
// can be summed; lifetime numbers come from one shared ~/.headroom file, so they
// are read from the first proxy that answers and shown once.
const PROXIES = [
  { name: "Claude + Codex", port: 8787 },
  { name: "Zen Go + Pi", port: 8788 },
];
const fmt = (n) => (n == null ? "–" : Number(n).toLocaleString("en-US", { maximumFractionDigits: 1 }));

function boot(s) {
  const c = s.summary.compression;
  const caches = Object.values(s.prefix_cache?.by_provider ?? {});
  const sum = (k) => caches.reduce((t, p) => t + (p[k] ?? 0), 0);
  return {
    requests: s.summary.api_requests, byProvider: s.requests.by_provider,
    compressed: c.requests_compressed, avgPct: c.avg_compression_pct,
    saved: c.total_tokens_saved_all_layers, cacheReqs: sum("requests"),
    cacheHits: sum("hit_requests"), cacheRead: sum("cache_read_tokens"), busts: sum("bust_count"),
  };
}

function card(title, status, rows, link) {
  const el = document.createElement("section");
  el.className = "card";
  const h = el.appendChild(document.createElement("h2"));
  h.append(title);
  const st = h.appendChild(document.createElement(link ? "a" : "span"));
  st.textContent = status.text;
  st.className = status.cls;
  if (link) st.href = link;
  const dl = el.appendChild(document.createElement("dl"));
  for (const [k, v] of rows) {
    dl.appendChild(document.createElement("dt")).textContent = k;
    dl.appendChild(document.createElement("dd")).textContent = v;
  }
  return el;
}

function rows(b) {
  const providers = Object.entries(b.byProvider ?? {}).map(([p, n]) => `${p} ${n}`).join(", ") || "–";
  const hitRate = b.cacheReqs ? `${fmt((100 * b.cacheHits) / b.cacheReqs)}% (${b.cacheHits}/${b.cacheReqs})` : "–";
  return [
    ["Requests", fmt(b.requests)], ["By provider", providers],
    ["Compressed requests", fmt(b.compressed)], ["Avg compression", b.avgPct == null ? "–" : `${fmt(b.avgPct)}%`],
    ["Tokens saved", fmt(b.saved)], ["Cache hit rate", hitRate],
    ["Cache read tokens", fmt(b.cacheRead)], ["Cache busts", fmt(b.busts)],
  ];
}

async function stats(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/stats`, { signal: AbortSignal.timeout(4000) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

function addBoots(list) {
  const t = { byProvider: {} };
  for (const b of list) {
    for (const k of ["requests", "compressed", "saved", "cacheReqs", "cacheHits", "cacheRead", "busts"])
      t[k] = (t[k] ?? 0) + (b[k] ?? 0);
    for (const [p, n] of Object.entries(b.byProvider ?? {})) t.byProvider[p] = (t.byProvider[p] ?? 0) + n;
  }
  t.avgPct = null; // an average of averages would mislead; see each proxy's card
  return t;
}

async function refresh() {
  const results = await Promise.all(PROXIES.map((p) => stats(p.port)));
  const cards = [], boots = [];
  results.forEach((s, i) => {
    const p = PROXIES[i], dash = `http://127.0.0.1:${p.port}/dashboard`;
    if (!s) { cards.push(card(`${p.name} · ${p.port}`, { text: "down", cls: "down" }, [], null)); return; }
    const b = boot(s); boots.push(b);
    cards.push(card(`${p.name} · ${p.port}`, { text: `up · ${s.summary.mode} ↗`, cls: "up" }, rows(b), dash));
  });
  if (boots.length) cards.push(card("Combined (this boot)", { text: `${boots.length}/${PROXIES.length} up`, cls: "" }, rows(addBoots(boots)), null));
  const life = results.find(Boolean)?.persistent_savings?.lifetime;
  if (life) cards.push(card("Lifetime (all proxies)", { text: "", cls: "" }, [
    ["Requests", fmt(life.requests)], ["Tokens saved", fmt(life.tokens_saved)],
    ["Input tokens", fmt(life.total_input_tokens)], ["Compression savings", `$${fmt(life.compression_savings_usd)}`],
  ], null));
  document.getElementById("cards").replaceChildren(...cards);
  document.getElementById("foot").textContent = `Updated ${new Date().toLocaleTimeString()}`;
}

refresh();
setInterval(refresh, 10000);
