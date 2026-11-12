# dsh-visual-reply

Rich visual replies for DeepSeek Harness: the model calls one tool (`visual_render`) and the answer grows an inline figure — a 15px/500 conclusion title, an unframed interactive chart at body width, and a 12px source/method line. Hover the figure for the two primary actions (copy image / fullscreen); the rest live in `⋯` (copy data, download PNG/HTML, open in window, view source, collapse). Instead of a pasted HTML code block, a dead screenshot, or a tool card that looks like a debug panel.

This is a reconstruction of the "text + figure" analysis replies seen in WorkBuddy / Doubao Work, redesigned in 2026-11 against how Claude, ChatGPT/Codex and the open-source ecosystem do it: a **skill** decides when a figure earns its place, a **client Figure** puts it into the conversation flow, and **data tools** keep the numbers honest.

## Layout

| Side | File | Role |
| --- | --- | --- |
| Host | `index.js` | Registers the `visual_render` tool (9 parameters), a system-prompt section, and the bundled skill |
| Host | `lib/validate.js` | Pure policy: size, document structure, escaping APIs, script allowlist, map red line, plus 8 design-quality lint rules (warnings only) |
| Host | `lib/prompt.js` | "When to draw / how to draw" prompt: design tokens, axes and units, category caps, provenance fields |
| Client | `client.js` | One shared `<Figure>` behind `tool.call.toolview` and `conversation.chat.turnTail`: sandboxed iframe, hover actions, fullscreen, live theme, explicit failure states |
| Skill | `skills/visual-reply/SKILL.md` | When to draw, chart choice, tokens/templates, self-check |

## Install

Requires DeepSeek Harness `0.2.2-rc.1` or newer.

From npm (recommended):

```bash
dsh plugin --profile web add dsh-visual-reply
# pin a version: dsh plugin --profile web add dsh-visual-reply@0.2.0
```

Local development from a checkout of this repo:

```bash
dsh plugin --profile web add link:<absolute path to this package>
```

Then refresh the Web UI once so the client half loads.

## Tool contract

| Parameter | Required | Meaning |
| --- | --- | --- |
| `title` | yes | One-line conclusion, ≤120 chars |
| `html` | yes | Body-level fragment; inline SVG first, ECharts container + config (the local build is injected) |
| `height` | no | **Suggested maximum** height, default 480, clamped 240–1024; the real height follows content |
| `caption` | no | Method / assumptions; recommended for analysis figures |
| `source` | no | Data source, e.g. `etl_dws.dws_order` |
| `window` | no | Data time window |
| `sample` | no | Mark sample/synthetic data; renders a "Sample data" chip |
| `assumptions` | no | Up to 5 caveats, ≤300 chars each |
| `wide` | no | Wide figure (timeline / wide table / multi-series) |

## Safety

- Fragment runs in `<iframe sandbox="allow-scripts">` (no same-origin), so it cannot read host cookies, storage or DOM.
- Its document carries `default-src 'none'`, `connect-src 'none'`, `object-src` / `frame-src` / `form-action` / `base-uri` `'none'`; scripts are inline plus `cdn.jsdelivr.net` only as the local-build fallback (no `https:` wildcard).
- ECharts ships inside the client bundle (gzip+base64, ~335 KB): decoded at render time via `DecompressionStream`, inlined into the sandbox — zero network. `assets/echarts.min.js` stays as the readable original, with a Host route and the CDN as fallbacks.
- The figure lands **after the turn's reply, before the action row** — outside the "called tools" disclosure; the tool call keeps a one-line note that jumps to the figure.
- The host validator rejects `<iframe>/<object>/<embed>/<form>/<base>`, `document.cookie`, storage APIs, `fetch`, `XMLHttpRequest`, `WebSocket`, `window.top/parent`, `javascript:` URLs, off-allowlist script hosts, and oversized fragments.
- Design lint warns (never blocks) on missing axis names/units, too many categories or colours, risky chart types (3D/radar/Sankey/graph), unnamed dual axes, missing provenance, and unmarked sample data.
- The plugin writes only its own state: a boot trail under `$DSH_HOME/dsh-visual-reply/`, saved visual copies there when `archive: true`, and the bundled skill under `$DSH_HOME/skills/visual-reply/`. No user content is written otherwise.

## Config

```yaml
- id: visual-reply
  config:
    enabled: true
    maxHtmlBytes: 204800
    defaultHeight: 480       # suggested maximum; clamped 240–1024
    allowedScriptHosts: ['cdn.jsdelivr.net']
    archive: false
    injectPrompt: true
```

## Tests

Run from a repository checkout — the npm package intentionally ships without `test/` and `scripts/`.

```bash
npm test          # validate / srcdoc / skill / client / integration

# live DSH: local ECharts route, client bundle markers, boot trail
node scripts/verify-local-echarts.mjs http://127.0.0.1:58484
```

A real-DOM smoke test (React 18 + jsdom: two turn-tail figures, height messages, fullscreen Escape, compact note, rejected state) is maintained by the author outside the package.

## Known limits

- The host page must not set `frame-src 'none'`; use the fullscreen dialog instead.
- Every ECharts figure parses its own copy of the library inside its iframe; multiple figures per turn cost linearly (lazy mounting / a smaller build is future work).
- Theme switches are pushed via `postMessage`; ECharts canvas colours need the fragment to re-`setOption` on the `vr-theme` event (documented in the skill).
- Figures stay after the turn's prose — DSH has no inline Markdown extension point, and shadowing the shipped assistant node is too risky.
- `html` counts toward model context; the skill caps a fragment at 40 KB / 300 lines.

## License

MIT — see [`LICENSE`](./LICENSE).

Bundles Apache ECharts 5.6.0, licensed under Apache-2.0; see [`THIRD-PARTY-LICENSES.md`](./THIRD-PARTY-LICENSES.md).
