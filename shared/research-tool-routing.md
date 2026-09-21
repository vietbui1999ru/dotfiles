# Research Tool Routing

Use one primary research tool per question. Do not query all three by default.

| Need | Primary tool | Boundary |
|---|---|---|
| Official library, framework, SDK, CLI, or cloud-service documentation | **Context7** | API syntax, configuration, migrations, version-specific behavior, and official examples |
| Real implementation examples from public repositories | **Ketch** (`ketch code` only) | Cross-repo source search, idioms, and how projects call an API in practice |
| General web research or page extraction | **Firecrawl** | URLs, articles, news, current events, broad search, site maps, crawling, and JavaScript-rendered pages |

## Decision order

1. Named package or API documentation question → Context7.
2. Request for real code usage or public-repository examples → `ketch code`.
3. URL, current event, comparison, product research, or general web question → Firecrawl.

Use a second tool only when the primary tool cannot answer, or when the user asks
for corroboration. State the fallback reason instead of silently duplicating work.

## Fallbacks

- Context7 has no matching library or lacks the needed topic → Firecrawl official docs.
- Ketch returns no useful source examples → Firecrawl GitHub/web search.
- Firecrawl finds a package whose API details matter → Context7 before implementation.

Do not use `ketch search`, `ketch scrape`, or `ketch docs`. Those surfaces overlap
with Firecrawl and Context7; `ketch code` is the only approved Ketch command.

## Post-run Verification

- Leave LSP tools available for explicit use, but do not proactively call
  `lsp_diagnostics`. Use `lens_diagnostics` only at turn/final boundaries or
  when explicitly requested.
- Let the post-run verifier own formatting, linting, checking, and focused tests
  after a run settles; never verify inline with a write/edit.
- Run tests only for changed behavioral/output/return/result contracts when
  nearby existing coverage is present. Do not scaffold tests just because a
  file changed.
- Make at most three automatic repair loops, then stop and report the exact
  failing commands and bounded output. Report unavailable tools, skipped stages,
  timeouts, and other degradation honestly.
- Pi-lens project `.pi-lens.json` mutation controls can override the global
  format/autofix defaults. Treat a trusted repo override as explicit project
  policy; otherwise the boundary verifier owns all mutations.
