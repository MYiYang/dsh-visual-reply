/**
 * Sandbox-document invariants. The Client half keeps a mirror of this builder
 * (a browser bundle cannot `import`), and `test/client.test.js` pins the same
 * tokens on its copy so the two cannot drift silently.
 */
import assert from 'node:assert/strict'

import {
  BASE_STYLE,
  buildSrcdoc,
  CSP_POLICY,
  ECHARTS_ROUTE,
  EXTERNAL_SCRIPT,
  makeNonce,
  PALETTE_FALLBACK,
  paletteVars,
  runtimeSource,
} from '../lib/srcdoc.js'

// ── 1. 文档骨架与 CSP ──────────────────────────────────────────────────────
const doc = buildSrcdoc({ html: '<svg></svg>', nonce: 'n0nce-1' })
assert.equal(doc.startsWith('<!doctype html>'), true)
assert.equal(doc.includes(`content="${CSP_POLICY}"`), true)
assert.equal(doc.includes("default-src 'none'"), true)
assert.equal(doc.includes("connect-src 'none'"), true)
assert.equal(doc.includes("frame-src 'none'"), true)
assert.equal(doc.includes("object-src 'none'"), true)
assert.equal(doc.includes("base-uri 'none'"), true)
assert.equal(doc.includes("form-action 'none'"), true)
assert.equal(doc.includes("script-src 'unsafe-inline' https://cdn.jsdelivr.net"), true)
// 不再有 `https:` 通配：外部脚本只放行默认 CDN，域名权威在 Host 校验器。
assert.equal(/script-src[^;]*https:;/.test(CSP_POLICY), false, '不能再留 https: 通配')
assert.equal(doc.includes('src="http://') || doc.includes("src='http://") || doc.includes('src=http://'), false, '不得有明文 http 资源')
assert.equal(doc.includes('data-vr-dark="false"'), true)
assert.equal(BASE_STYLE.includes('height:auto'), true)
// 设计令牌：标题/正文/脚注与系列色板都必须是片段可用的 CSS 变量。
assert.equal(BASE_STYLE.includes('--vr-font-title:15px'), true)
assert.equal(BASE_STYLE.includes('--vr-font-caption:12px'), true)
assert.equal(BASE_STYLE.includes('--vr-series-1:#4176e6'), true)
assert.equal(BASE_STYLE.includes('--vr-radius:12px'), true)
// 图体有 surface 底色（不再透明），线条对比度也抬高了。
assert.equal(BASE_STYLE.includes('--vr-bg:#ffffff'), true)
assert.equal(BASE_STYLE.includes('--vr-line:#00000029'), true)
assert.equal(BASE_STYLE.includes('background:var(--vr-bg)'), true)
assert.equal(PALETTE_FALLBACK.bg, '#ffffff')
assert.equal(PALETTE_FALLBACK.line, '#00000029')
assert.equal(PALETTE_FALLBACK.onAccent, '#ffffff')
assert.equal(doc.includes('--vr-series-1:#4176e6'), true)

// ── 2. 片段原样保留、nonce 收紧 ───────────────────────────────────────────
assert.equal(doc.includes('<svg></svg>'), true)
assert.equal(doc.includes('var ID="n0nce-1"'), true)
const dirty = buildSrcdoc({ html: '<div>a</div>', nonce: 'a b"c' })
assert.equal(dirty.includes('var ID="abc"'), true)
assert.equal(dirty.includes('"a b'), false)
const empty = buildSrcdoc({ html: '', nonce: 'e' })
assert.equal(empty.includes('<body></body>'), false)
assert.equal(empty.startsWith('<!doctype html>'), true)

// ── 3. 运行时就位：高度、状态、主题、导出、图元点击 ──────────────────────
assert.equal(doc.includes('__vr:"height"'), true)
assert.equal(doc.includes('__vr:"ready"'), true)
assert.equal(doc.includes('__vr:"blank"'), true)
assert.equal(doc.includes('__vr:"overflow"'), true)
assert.equal(doc.includes('__vr:"csp"'), true)
assert.equal(doc.includes('__vr==="theme"'), true)
assert.equal(doc.includes('__vr==="export"'), true)
assert.equal(doc.includes('window.vrPick'), true)
assert.equal(doc.includes('securitypolicyviolation'), true)
assert.equal(doc.includes('ResizeObserver'), true)
assert.equal(doc.includes('setTimeout(measure,100)'), true)
assert.equal(doc.includes('getBoundingClientRect'), true)
// 导出 PNG：先把主题变量与每个元素的计算样式内联进 SVG 克隆，否则 var() 在
// 图片文档里失效，所有 fill 会回落成黑色（用户反馈的「复制图片是黑白」）。
assert.equal(doc.includes('function themeVars'), true)
assert.equal(doc.includes('function paintAttrs'), true)
assert.equal(doc.includes('clone.setAttribute("style",theme)'), true)
assert.equal(doc.includes('--vr-series-"+i'), true)
assert.equal(doc.includes('getComputedStyle(src)'), true)
assert.equal(doc.includes('backgroundOf()'), true)
assert.equal(doc.includes('--vr-on-accent:#ffffff'), true)
assert.equal(doc.includes('onAccent:"--vr-on-accent"'), true)
// 复制数据：ECharts option 自动提取、SVG data-vr-data、window.__vrData 三条路都要在。
assert.equal(doc.includes('function echartsData'), true)
assert.equal(doc.includes('function jsonRows'), true)
assert.equal(doc.includes('getInstanceByDom'), true)
assert.equal(doc.includes('data-vr-data'), true)
assert.equal(doc.includes('__vrData'), true)

// ── 4. 色板注入：写在 prefers-color-scheme 兜底之后，异常值不得捅穿 ──────
const themed = buildSrcdoc({
  html: '<svg></svg>',
  nonce: 't',
  palette: {
    fg: '#f9fafb',
    muted: '#cfd3d6',
    accent: '#5686fe',
    line: '#ffffff14',
    bg: '#16181c',
    grid: '#ffffff12',
    dark: true,
    series: ['#6b93ee', '#4bc3a6'],
  },
})
assert.equal(themed.includes('--vr-fg:#f9fafb'), true)
assert.equal(themed.includes('--vr-bg:#16181c'), true)
assert.equal(themed.includes('--vr-series-1:#6b93ee'), true)
assert.equal(themed.includes('data-vr-dark="true"'), true)
assert.equal(themed.includes('html,body{background:var(--vr-bg)}'), true)
assert.equal(themed.indexOf('--vr-fg:#f9fafb') > themed.indexOf('prefers-color-scheme'), true)
assert.equal(PALETTE_FALLBACK.accent, '#4176e6')
assert.equal(PALETTE_FALLBACK.series.length >= 6, true)
assert.equal(buildSrcdoc({ html: '', nonce: 't2' }).includes('--vr-accent:#4176e6'), true)

const dirtyPalette = buildSrcdoc({
  html: '',
  nonce: 'p2',
  palette: {
    fg: 'red;}</style><script>x</script>',
    muted: '',
    accent: null,
    line: undefined,
    bg: '}',
    grid: 'x;y',
    series: ['red;}', ''],
  },
})
assert.equal(dirtyPalette.includes('</style><script>x'), false)
assert.equal(dirtyPalette.includes('--vr-accent:#4176e6'), true)
assert.equal(dirtyPalette.includes('--vr-series-1:#4176e6'), true)
assert.equal(paletteVars(PALETTE_FALLBACK).includes('--vr-series-1'), true)

// ── 5. 本地库注入：先于片段、摘掉 CDN 脚本；无库时保留 CDN 兜底 ──────────
const lib = '<script>window.echarts={init:function(){}};</script>'
const local = buildSrcdoc({
  html: '<div id="c">x</div><script src="https://cdn.jsdelivr.net/npm/echarts/x.js"></script>',
  nonce: 'l',
  echarts: 'var lib = 1;',
})
assert.equal(local.includes('<script src='), false, '注入本地库后不应留下 CDN 脚本对')
assert.equal(local.includes('https://cdn.jsdelivr.net/npm/echarts/x.js'), false)
assert.equal(local.indexOf('var lib = 1;') >= 0 && local.indexOf('var lib = 1;') < local.indexOf('id="c"'), true)
const fallback = buildSrcdoc({ html: '<div id="c">x</div><script src="https://cdn.jsdelivr.net/npm/echarts/x.js"></script>', nonce: 'f' })
assert.equal(fallback.includes('https://cdn.jsdelivr.net/npm/echarts/x.js'), true)
assert.equal(fallback.includes(lib), false)
const risky = buildSrcdoc({ html: '', nonce: 'r', echarts: 'var x = "</script>";' })
assert.equal(risky.includes('<\\/script'), true)

// ── 6. 常量与工具 ─────────────────────────────────────────────────────────
assert.equal(ECHARTS_ROUTE, '/dsh-visual-reply/echarts.min.js')
assert.equal(EXTERNAL_SCRIPT.test('<script src="https://cdn.jsdelivr.net/a.js"></script>'), true)
assert.equal(/^\w{8}$/.test(makeNonce()), true)
assert.equal(runtimeSource('x1').includes('var ID="x1"'), true)

console.log('srcdoc.test.js: ok')
