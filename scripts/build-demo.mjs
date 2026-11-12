/**
 * Regenerate `docs/demo.html` from the real sandbox builder.
 *
 * The demo is the document that actually goes into the figure iframe, so it
 * must be generated rather than hand-written: CSP, design tokens and the
 * height/status runtime all come from lib/srcdoc.js. `test/srcdoc.test.js`
 * re-generates the same string and compares, so the checked-in file cannot
 * drift from the renderer again.
 *
 * Usage: node scripts/build-demo.mjs
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { buildSrcdoc, PALETTE_FALLBACK } from '../lib/srcdoc.js'

/**
 * The sample fragment: an inline SVG bar chart drawn at the card's real width
 * (~700px). No external script, no fixed colors — only `--vr-*` tokens.
 */
export const DEMO_FRAGMENT = `<div style="color:var(--vr-fg);font-size:var(--vr-font-body)">
  <svg viewBox="0 0 720 300" width="100%" role="img" aria-label="各区域订单量（万单）">
    <line x1="56" y1="240" x2="700" y2="240" stroke="var(--vr-line)"/>
    <line x1="56" y1="24" x2="56" y2="240" stroke="var(--vr-line)"/>
    <text x="56" y="16" style="font-size:var(--vr-font-caption);fill:var(--vr-muted)">万单</text>
    <text x="380" y="288" text-anchor="middle" style="font-size:var(--vr-font-caption);fill:var(--vr-muted)">区域</text>
    <rect x="132" y="88" width="96" height="152" fill="var(--vr-series-1)"/>
    <rect x="332" y="24" width="96" height="216" fill="var(--vr-series-1)"/>
    <rect x="532" y="139" width="96" height="101" fill="var(--vr-series-1)"/>
    <text x="180" y="80" text-anchor="middle" style="font-size:var(--vr-font-caption);fill:var(--vr-fg)">62</text>
    <text x="380" y="16" text-anchor="middle" style="font-size:var(--vr-font-caption);fill:var(--vr-fg)">88</text>
    <text x="580" y="131" text-anchor="middle" style="font-size:var(--vr-font-caption);fill:var(--vr-fg)">41</text>
    <text x="180" y="262" text-anchor="middle" style="font-size:var(--vr-font-caption);fill:var(--vr-muted)">华东</text>
    <text x="380" y="262" text-anchor="middle" style="font-size:var(--vr-font-caption);fill:var(--vr-muted)">华南</text>
    <text x="580" y="262" text-anchor="middle" style="font-size:var(--vr-font-caption);fill:var(--vr-muted)">华北</text>
  </svg>
  <p style="margin:8px 0 0;font-size:var(--vr-font-caption);color:var(--vr-muted)">口径：示例数据，仅演示卡片渲染；数据契约见 window.__vrData</p>
  <script>window.__vrData = [['区域','单量'],['华东',62],['华南',88],['华北',41]]</script>
</div>`

/**
 * Build the demo document exactly as the Client half builds a figure.
 * @returns {string} the sandbox document.
 */
export function demoDocument() {
  return buildSrcdoc({
    html: DEMO_FRAGMENT,
    nonce: 'demo',
    palette: PALETTE_FALLBACK,
  })
}

/** Write `docs/demo.html`. */
export function writeDemo(target = fileURLToPath(new URL('../docs/demo.html', import.meta.url))) {
  writeFileSync(target, demoDocument(), 'utf8')
  return target
}

// Run only when invoked directly, so tests can import the builders.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = writeDemo()
  console.log(`wrote ${file} (${demoDocument().length} chars)`)
}
