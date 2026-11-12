# Changelog

All notable changes to `dsh-visual-reply`. This project follows
[Semantic Versioning](https://semver.org/).

## [0.2.2] — 2026-11-12

### Added

- PNG/PDF exports are the composed card, not the bare iframe content: the
  conclusion title, the figure and the provenance line are re-drawn on the
  current theme surface at 2x before download/clipboard.
- `⋯ → Download PDF`: a hand-built single-page PDF wrapping that composed
  image as JPEG (no dependency, no network, one page).
- HTML/table fragments can be exported at all: when the frame has no canvas or
  SVG, the runtime serializes the body into an SVG `foreignObject`, rasterizes
  it and returns a PNG — previously the action failed with "nothing to export".

### Fixed

- Copying or downloading an image used to drop the title and provenance, so the
  exported file read as an orphan chart.
- `sample: true` no longer prepends "示例数据" when the caption already says it.

## [0.2.1] — 2026-11-12

### Fixed

- Short figures no longer sit in a 240px box: after the first height report the
  iframe follows the measured content (24px anti-collapse floor) instead of
  `min`-clamping to 240px, which left ~130px of dead space under a three-row
  table.
- The inline-SVG template is drawn at the card's real width (`viewBox` 720×300)
  instead of a 360px canvas stretched by `width="100%"`. A narrow canvas scaled
  every font size, stroke and padding by ~2x, which read as "the figure has
  margins". The prompt now states the rule and the validator warns (advisory)
  when a `viewBox` narrower than 480px is stretched.
- Activating the plugin no longer overwrites a hand-edited
  `$DSH_HOME/skills/visual-reply/SKILL.md`: the installer compares the on-disk
  copy with its own ledger and leaves foreign content alone (with a warning),
  while still upgrading copies it installed itself.
- `boot-trail.jsonl` rotates at 256 KiB, keeping the most recent 200 lines,
  instead of growing for the life of the profile.
- `docs/demo.html` is generated from `lib/srcdoc.js` and pinned by a test, so it
  carries the current CSP, design tokens and height runtime instead of the 0.1
  layout.
- Comments pointed `archive` output at `$DSH_HOME/visual-reply/`; the actual
  directory is `$DSH_HOME/dsh-visual-reply/`.

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
