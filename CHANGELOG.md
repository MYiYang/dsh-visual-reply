# Changelog

All notable changes to `dsh-visual-reply`. This project follows
[Semantic Versioning](https://semver.org/).

## [0.2.0] — 2026-11-12

First public release.

### Added

- `visual_render` tool: a model-facing way to render a chart/dashboard into the reply
  body. Nine parameters (`title`, `html`, `height`, `caption`, `source`, `window`,
  `sample`, `assumptions`, `wide`), a compact receipt for the model, and structured
  provenance fields.
- Client half: one shared `<Figure>` behind both `tool.call.toolview` and
  `conversation.chat.turnTail` — sandboxed `srcdoc` iframe (`allow-scripts`, no
  same-origin), hover actions (copy image / fullscreen), a `⋯` menu (copy data,
  download PNG/HTML, open in window, view source, collapse), live theme updates via
  `postMessage`, and explicit failure states (blank / script error / CSP / overflow).
- Bundled skill `visual-reply`, installed to `$DSH_HOME/skills/` on activation: when a
  figure earns its place, chart choice, design tokens, templates and self-checks.
- Safety validator: rejects document-level HTML, `iframe`/`object`/`embed`/`form`/`base`,
  cookie/storage APIs, network APIs, `javascript:` URLs, off-allowlist script hosts and
  oversized fragments. Design lint warns (never blocks) on missing axis names/units,
  too many categories or colours, risky chart types (3D / radar / Sankey / graph),
  missing provenance and unmarked sample data.
- Local ECharts 5.6.0: gzip+base64 copy embedded in the client bundle and injected
  inline (zero network); `assets/echarts.min.js` served at
  `/dsh-visual-reply/echarts.min.js` as a fallback, with the CDN allowlist as a last
  resort.
- `archive` option: write a copy of each rendered visual under
  `$DSH_HOME/dsh-visual-reply/visuals/`.
- Host boot trail (`$DSH_HOME/dsh-visual-reply/boot-trail.jsonl`) for diagnostics.

### Notes

- Requires DSH `>= 0.2.2-rc.1`.
- No runtime npm dependencies.
- Bundles Apache ECharts 5.6.0 (Apache-2.0); see `THIRD-PARTY-LICENSES.md`.
