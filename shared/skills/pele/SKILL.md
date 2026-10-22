---
name: pele
description: Render Mermaid diagrams to standalone, themeable SVG with pele (pele-render CLI). Use when drawing system design, architecture, sequence, state, ER, C4 or flow diagrams for docs, wiki pages, design specs, or technical presentation slides, or when the user asks for a diagram as an SVG file.
allowed-tools: "Bash,Read,Write"
---

# pele — Mermaid to SVG

pele (obsidianmd/pele, MIT) renders Mermaid 12.1.0 syntax to SVG in Node with no browser and no runtime
dependencies. This skill folder pins it (`package.json` + `bun.lock`); `scripts/bootstrap-dirs.sh`
runs `bun ci` here and links `render.mjs` to `~/.local/bin/pele-render`.

## Render

```bash
pele-render diagram.mmd -o diagram.svg          # file in, file out
printf 'flowchart LR\n A-->B' | pele-render     # stdin in, SVG on stdout
pele-render diagram.mmd -o d.svg --max-width 640 --padding 16
```

Exit codes: 0 rendered, 1 Mermaid parse/render error (message on stderr, includes the line), 2 bad arguments.
On exit 1, fix the source and re-run; do not hand back an unrendered diagram.

If `pele-render` is missing, run `~/dotfiles/scripts/bootstrap-dirs.sh` (needs node from mise).

## Workflow

1. Keep the Mermaid source next to its output (`docs/diagrams/x.mmd` + `x.svg`) so it stays editable and diffable.
2. Pick the diagram type for the question being answered:
   - components and their connections: `flowchart LR` or `architecture-beta`
   - request/response over time: `sequenceDiagram`
   - system context for a non-technical audience: `C4Context`
   - lifecycle of one entity: `stateDiagram-v2`
   - data model: `erDiagram`
3. Render, then look at the result (open the SVG or screenshot it) before claiming it is done.

## Slides and pages

- The SVG carries inline colour fallbacks, so it works standalone (`<img src>`, Keynote, Google Slides import).
- Inlined into HTML, it is themed by CSS variables on `.pele` or a parent: `--pele-bg`, `--pele-fg`, `--pele-line`,
  `--pele-surface`, `--pele-border`, `--pele-accent`, `--pele-font`, `--pele-series-1..8`. Dark mode is just a
  different set of these variables; no re-render needed.
- For slides, prefer `flowchart LR` (wide aspect) and keep to about 7 nodes per diagram; split larger systems.
- No `--dark` flag yet. Add one to `render.mjs` only when a standalone dark SVG is actually needed.

## When not to use

- Neovim inline mermaid previews are off: mermaid-cli (`mmdc`) was removed and nothing replaces it.
- Freeform or hand-drawn layouts: use the Excalidraw MCP instead.

## Upgrading

`bun add --cwd ~/dotfiles/shared/skills/pele pele@<version>` then commit `package.json` and
`bun.lock`. Wiki: `[[entities/pele]]` in ~/repos/llm-wiki.
