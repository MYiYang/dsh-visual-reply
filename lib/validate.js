/**
 * Validator for one `visual_render` payload.
 *
 * Pure functions only: no `ctx`, no filesystem, no DOM — so the whole policy
 * is unit-testable and the Host has nothing to roll back if a check fails.
 *
 * Three outcomes per rule set:
 *   - **reject** — the payload cannot be rendered safely (too large, document
 *     level, an escape hatch, an untrusted script host);
 *   - **warn** — renderable but questionable, surfaced to the model so it can
 *     correct itself. Two families live here:
 *       - safety: no figure at all, near the client inline limit, map
 *         keywords, stray `<body>` (unchanged policy);
 *       - design lint: axis presence/names, category count, colour count,
 *         risky chart types, dual-axis labelling, missing provenance, sample
 *         data without a label. **Advisory only — a design lint never rejects.**
 *   - **pass** — silently fine.
 *
 * Design lint runs on the raw fragment with deliberately restrained regexes:
 * a plain `<table>` or hand-drawn `<svg>` must not be mistaken for an ECharts
 * option object, and `series`/axis probes only fire on `key: [...]`-shaped
 * config, never on prose.
 *
 * @module dsh-visual-reply/lib/validate
 */

import { DEFAULT_CONFIG, MAX_HEIGHT, MAX_TITLE_CHARS, MIN_HEIGHT } from './config.js'

/** Rejection codes, stable enough for the model to branch on. */
export const CODES = Object.freeze({
  INVALID_TITLE: 'vr/invalid-title',
  EMPTY_HTML: 'vr/empty-html',
  TOO_LARGE: 'vr/too-large',
  FORBIDDEN_TAG: 'vr/forbidden-tag',
  FORBIDDEN_API: 'vr/forbidden-api',
  UNTRUSTED_SCRIPT_HOST: 'vr/untrusted-script-host',
})

/**
 * Tags that must never appear: they either nest a browsing context, submit a
 * form, or re-base every relative URL inside the fragment.
 * @type {Array<{pattern: RegExp, label: string}>}
 */
const FORBIDDEN_TAGS = [
  { pattern: /<\s*iframe\b/i, label: '<iframe>' },
  { pattern: /<\s*object\b/i, label: '<object>' },
  { pattern: /<\s*embed\b/i, label: '<embed>' },
  { pattern: /<\s*form\b/i, label: '<form>' },
  { pattern: /<\s*base\b/i, label: '<base>' },
]

/**
 * Browser APIs the fragment has no business calling: the sandbox already
 * denies same-origin, so these can only be attempts to escape or exfiltrate.
 * @type {Array<{pattern: RegExp, label: string}>}
 */
const FORBIDDEN_APIS = [
  { pattern: /document\s*\.\s*cookie/i, label: 'document.cookie' },
  { pattern: /\blocalStorage\b/i, label: 'localStorage' },
  { pattern: /\bsessionStorage\b/i, label: 'sessionStorage' },
  { pattern: /\bindexedDB\b/i, label: 'indexedDB' },
  { pattern: /\bfetch\s*\(/i, label: 'fetch()' },
  { pattern: /\bXMLHttpRequest\b/i, label: 'XMLHttpRequest' },
  { pattern: /\bWebSocket\b/i, label: 'WebSocket' },
  { pattern: /\bsendBeacon\b/i, label: 'navigator.sendBeacon' },
  { pattern: /\bwindow\s*\.\s*top\b/i, label: 'window.top' },
  { pattern: /\bwindow\s*\.\s*parent\b/i, label: 'window.parent' },
  { pattern: /\b(?:top|parent)\s*\.\s*location\b/i, label: 'top/parent.location' },
  { pattern: /\bjavascript\s*:/i, label: 'javascript: URL' },
]

/**
 * The client only renders a fragment inline up to this many characters; beyond
 * it the card shows an explanation instead. The host cannot see the client's
 * decision, so it warns early — otherwise a 200KB "successful" call would land
 * in the conversation as a card that refuses to draw.
 */
export const CLIENT_RENDER_LIMIT = 60000

/** Something that looks like a chart rather than a paragraph. */
const VISUAL_MARKER = /<\s*(?:svg|canvas|table)\b|\becharts\s*\.\s*init\s*\(|class\s*=\s*["'][^"']*\b(?:chart|graph|viz|visual)\b/i

/** Map keywords — the one red line the reference products share with us. */
const MAP_MARKER = /\bleaflet\b|\bmapbox\b|\btileLayer\b|\bL\.map\s*\(|\becharts\b[^\n]{0,80}\bgeo\b|\bamap\b|\bBMap\b/i

/** Document-level structure that belongs to a page, not a fragment. */
const DOC_MARKER = /<\/?\s*(?:html|head|body)\b/i

/**
 * `<script src="...">` — the only external dependency we gate.
 *
 * The value may be double-quoted, single-quoted or bare: a bare
 * `src=//evil.example/x.js` used to slip past a quote-only pattern, and the
 * fragment CSP allows any https script host as its backstop, so the validator
 * has to be the one that says no.
 */
const SCRIPT_SRC = /<script\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi

// ── design-lint probes ─────────────────────────────────────────────────────
//
// Everything below is heuristics on the raw fragment text. All of them only
// ever add a warning; a mis-fire costs one advisory line, never a rejection —
// so the patterns stay readable instead of trying to parse JavaScript.

/** ECharts option object keys, quoted or bare (`series: [`, `"xAxis": {`). */
const SERIES_DECL = /\bseries\b['"]?\s*:\s*\[/
const X_AXIS_DECL = /\bxAxis\b['"]?\s*:\s*[\[{]/
const Y_AXIS_DECL = /\byAxis\b['"]?\s*:\s*[\[{]/

/**
 * Series types that legitimately have no `xAxis`/`yAxis`: relationship and
 * polar-ish charts use their own coordinate system, so "add an axis" would be
 * the wrong advice. Used to keep lint #1 off pie/radar/sankey figures.
 */
const AXIS_FREE_SERIES =
  /\btype\s*:\s*['"](?:pie|doughnut|gauge|funnel|radar|graph|sankey|sunburst|treemap|tree|map|calendar|chord|themeRiver|wordCloud)['"]/i

/** Non-Cartesian coordinate systems that also make xAxis/yAxis optional. */
const AXIS_FREE_CONTEXT = /\b(?:parallelAxis|angleAxis|radiusAxis|singleAxis|polar|radar|calendar|geo)\b/i

/** Pie / ring family — the category budget is tighter than for a bar chart. */
const PIE_SERIES = /\btype\s*:\s*['"](?:pie|doughnut)['"]/i

/**
 * Chart types whose rendered quality is systematically shaky (3D projections,
 * relationship networks, hierarchical trees). `graph` is only matched as an
 * ECharts series type, so `class="graph"` on a container does not trip it.
 */
const RISKY_CHART =
  /\b(?:radar|sankey|sunburst|treemap|globe)\b|\btype\s*:\s*['"](?:graph|radar|sankey|sunburst|treemap|globe|[a-z]*3d)['"]|\b3d\b/i

/** Words that mark a caption as deliberately illustrative rather than real. */
const SAMPLE_MARKER = /示例|模拟|合成|示意/

/**
 * The card column a fragment renders into is roughly this wide. An inline SVG
 * with `width="100%"` is scaled by `cardWidth / viewBoxWidth`, so a canvas
 * designed at 360 doubles every font size and every padding — the figure then
 * reads as "full of margins" even though the fragment is fine.
 */
const CARD_WIDTH = 700

/** `<svg>` tags, in source order (only the first one is linted). */
const SVG_TAG = /<svg\b[^>]*>/i
/** A fixed numeric `width` pins the drawing, so scaling is not a problem. */
const FIXED_WIDTH = /\bwidth\s*=\s*["'](\d+(?:\.\d+)?)(?:px)?["']/i
/** Below this viewBox width the stretch is visible (>1.4x on the real card). */
const SMALL_VIEWBOX = 480

/** Upper bounds for the structured provenance fields. */
const SOURCE_MAX_CHARS = 200
const WINDOW_MAX_CHARS = 120
const ASSUMPTION_MAX_CHARS = 300
const ASSUMPTION_MAX_ITEMS = 5

/**
 * Byte length of a string as UTF-8.
 * @param {string} text - the string.
 * @returns {number} byte length.
 */
export function byteLength(text) {
  return new TextEncoder().encode(text).length
}

/**
 * Host name of one `src` value, or a rejection reason.
 * @param {string} src - the raw attribute value.
 * @returns {{host: string} | {relative: true} | {invalid: true}} parsed form.
 */
function hostOf(src) {
  const value = src.trim()
  if (value === '' || value.startsWith('data:') || value.startsWith('blob:')) return { invalid: true }
  const withScheme = value.startsWith('//') ? `https:${value}` : value
  try {
    const url = new URL(withScheme, 'https://fragment.invalid')
    if (url.host === 'fragment.invalid') return { relative: true }
    return { host: url.host.toLowerCase() }
  } catch {
    return { invalid: true }
  }
}

/**
 * Index of the closing quote of the string literal that starts at `start`.
 * Escaped characters are skipped so `'\''` does not end the literal early.
 * @param {string} text - source text.
 * @param {number} start - index of the opening quote.
 * @returns {number} index of the closing quote (last index when unterminated).
 */
function endOfString(text, start) {
  const quote = text[start]
  let index = start + 1
  while (index < text.length) {
    if (text[index] === '\\') {
      index += 2
      continue
    }
    if (text[index] === quote) return index
    index += 1
  }
  return text.length - 1
}

/**
 * The balanced `[...]` or `{...}` literal that starts at `start`.
 * String literals are skipped, so a `]` inside a label cannot close it early.
 * @param {string} text - source text.
 * @param {number} start - index of the opening bracket.
 * @returns {string} the literal, or the remainder when it never closes.
 */
function balancedSlice(text, start) {
  const open = text[start]
  const close = open === '[' ? ']' : open === '{' ? '}' : ''
  if (close === '') return ''
  let depth = 0
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (char === '"' || char === "'" || char === '`') {
      index = endOfString(text, index)
      continue
    }
    if (char === open) depth += 1
    else if (char === close) {
      depth -= 1
      if (depth === 0) return text.slice(start, index + 1)
    }
  }
  return text.slice(start)
}

/**
 * Top-level comma-separated elements of one `[...]` literal, trimmed.
 * Nested arrays/objects/calls are kept inside their element; the closing `]`
 * of the array itself is not returned.
 * @param {string} arrayText - an array literal.
 * @returns {string[]} raw element texts.
 */
function arrayElements(arrayText) {
  const items = []
  let start = 1
  let brackets = 0
  let braces = 0
  let end = arrayText.length
  for (let index = 1; index < arrayText.length; index += 1) {
    const char = arrayText[index]
    if (char === '"' || char === "'" || char === '`') {
      index = endOfString(arrayText, index)
      continue
    }
    if (char === '[' || char === '(') {
      brackets += 1
      continue
    }
    if (char === ')') {
      if (brackets > 0) brackets -= 1
      continue
    }
    if (char === ']') {
      if (brackets > 0) {
        brackets -= 1
        continue
      }
      end = index
      break
    }
    if (char === '{') {
      braces += 1
      continue
    }
    if (char === '}') {
      if (braces > 0) braces -= 1
      continue
    }
    if (char === ',' && brackets === 0 && braces === 0) {
      const item = arrayText.slice(start, index).trim()
      if (item !== '') items.push(item)
      start = index + 1
    }
  }
  const tail = arrayText.slice(start, end).trim()
  if (tail !== '' && tail !== ']') items.push(tail)
  return items
}

/**
 * Every `xAxis` / `yAxis` declaration in the fragment, with whether that
 * declaration carries a `name` (axis title / unit) anywhere inside it.
 * @param {string} html - validated fragment.
 * @returns {Array<{axis: string, missingName: boolean}>} declarations in source order.
 */
function axisDeclarations(html) {
  const declarations = []
  const pattern = /\b(xAxis|yAxis)\b['"]?\s*:\s*([\[{])/g
  let match = pattern.exec(html)
  while (match !== null) {
    const literal = balancedSlice(html, match.index + match[0].length - 1)
    declarations.push({ axis: match[1], missingName: !/\bname\s*:/.test(literal) })
    match = pattern.exec(html)
  }
  return declarations
}

/**
 * Detect a dual y-axis and count how many of its axes are named.
 *
 * ECharts expresses dual axes either as `yAxis: [{...}, {...}]` (one key, two
 * objects) or, in hand-written option-patch code, as two `yAxis` mentions —
 * both are covered. `yAxisIndex` is not confused with `yAxis`.
 * @param {string} html - validated fragment.
 * @returns {{isDual: boolean, namedAxes: number}} dual-axis shape.
 */
function dualYAxis(html) {
  const tokenCount = (html.match(/\byAxis\b/g) || []).length
  const pattern = /\byAxis\b['"]?\s*:\s*([\[{])/g
  let axes = 0
  let namedAxes = 0
  let match = pattern.exec(html)
  while (match !== null) {
    const literal = balancedSlice(html, match.index + match[0].length - 1)
    if (match[1] === '[') {
      const objects = arrayElements(literal).filter((item) => item.startsWith('{')).length
      if (objects > axes) axes = objects
    } else if (axes === 0) {
      axes = 1
    }
    namedAxes += (literal.match(/\bname\s*:/g) || []).length
    match = pattern.exec(html)
  }
  return { isDual: axes >= 2 || tokenCount >= 2, namedAxes }
}

/**
 * Largest number of categorical items found in any `data: [...]` array.
 *
 * A category is a top-level string element (`['华东', '华南']`) or a plain
 * object with a `name` (`{name: '华东', value: 62}`) — the two shapes ECharts
 * accepts for category and pie data. Numeric-only series do not count.
 * @param {string} html - validated fragment.
 * @returns {number} category count of the widest data array (0 when none).
 */
function categoryCount(html) {
  let widest = 0
  const pattern = /\bdata\b['"]?\s*:\s*\[/g
  let match = pattern.exec(html)
  while (match !== null) {
    const literal = balancedSlice(html, match.index + match[0].length - 1)
    let count = 0
    for (const item of arrayElements(literal)) {
      if (item.startsWith('"') || item.startsWith("'") || item.startsWith('`')) count += 1
      else if (item.startsWith('{') && /\bname\s*:/.test(item)) count += 1
    }
    if (count > widest) widest = count
    match = pattern.exec(html)
  }
  return widest
}

/**
 * Distinct colour constants (`#rgb`, `#rrggbb`, `rgb()`, `rgba()`) in the
 * fragment. Short hex is expanded and `rgb()` is canonicalised, so writing the
 * same colour three ways still counts as one.
 * @param {string} html - validated fragment.
 * @returns {number} number of distinct colours.
 */
function colorCount(html) {
  const colors = new Set()
  const hexPattern = /#([0-9a-f]{3,8})\b/gi
  let match = hexPattern.exec(html)
  while (match !== null) {
    const hex = match[1].toLowerCase()
    if (hex.length === 3 || hex.length === 4) {
      colors.add(`#${[...hex].map((char) => char + char).join('')}`)
    } else if (hex.length === 6 || hex.length === 8) {
      colors.add(`#${hex}`)
    }
    match = hexPattern.exec(html)
  }
  const rgbPattern = /\brgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\b/gi
  match = rgbPattern.exec(html)
  while (match !== null) {
    const channels = [1, 2, 3].map((index) => Math.min(255, Number(match[index])))
    colors.add(`#${channels.map((value) => value.toString(16).padStart(2, '0')).join('')}`)
    match = rgbPattern.exec(html)
  }
  return colors.size
}

/**
 * Coerce the optional `assumptions` argument into a bounded string list:
 * non-strings and blanks dropped, at most five entries, each at most 300 chars.
 * @param {unknown} value - raw tool argument.
 * @returns {string[]} normalized assumptions.
 */
function normalizeAssumptions(value) {
  if (!Array.isArray(value)) return []
  const assumptions = []
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const text = entry.trim()
    if (text === '') continue
    assumptions.push(text.slice(0, ASSUMPTION_MAX_CHARS))
    if (assumptions.length === ASSUMPTION_MAX_ITEMS) break
  }
  return assumptions
}

/**
 * Clamp one requested height into the configured range.
 * @param {number} value - finite height request.
 * @returns {number} integer within [MIN_HEIGHT, MAX_HEIGHT].
 */
function clampHeight(value) {
  return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(value)))
}

/**
 * Detect an inline SVG drawn on a canvas much narrower than the card.
 *
 * `width="100%"` scales a whole coordinate system to the container width, so a
 * viewBox of 360 in a ~700px column doubles type size and every padding at
 * once. The fix is advisory (design it at the real width), never a rejection:
 * a small fixed-width SVG is a deliberate choice and stays quiet.
 * @param {string} html - validated fragment.
 * @returns {string} one warning line, or an empty string.
 */
function stretchWarning(html) {
  const tag = SVG_TAG.exec(html)
  if (tag === null) return ''
  const viewBox = /\bviewBox\s*=\s*["']([^"']*)["']/i.exec(tag[0])
  if (viewBox === null) return ''
  const parts = viewBox[1].trim().split(/[\s,]+/).map(Number)
  if (parts.length !== 4 || !parts.every((value) => Number.isFinite(value)) || parts[2] <= 0) return ''
  const width = parts[2]
  if (width >= SMALL_VIEWBOX) return ''
  if (FIXED_WIDTH.test(tag[0])) return ''
  const scale = (CARD_WIDTH / width).toFixed(1)
  return `SVG 画布只有 ${Math.round(width)} 宽（viewBox），会按 100% 撑到卡片宽度 ≈${CARD_WIDTH}px，整体放大约 ${scale} 倍——字号与留白一起变大，看起来像图到处是边距；请把 viewBox 宽度按 ≈${CARD_WIDTH} 设计，或给 <svg> 写死 width。`
}

/**
 * Design-quality lint for one renderable fragment.
 *
 * Every returned line is advisory: none of these can reject a renderable
 * fragment, they are handed back to the model as one-line fix-it hints.
 * Overlapping probes are de-duplicated so the model never reads the same
 * advice twice.
 * @param {string} html - validated fragment.
 * @param {{caption: string, source: string, sample: boolean}} provenance - normalized 口径 fields.
 * @returns {string[]} Chinese one-line warnings in a stable order.
 */
function designWarnings(html, provenance) {
  const warnings = []
  /** @param {string} text - warning line. */
  const add = (text) => {
    if (!warnings.includes(text)) warnings.push(text)
  }

  const dual = dualYAxis(html)
  const axes = axisDeclarations(html)

  // 1. A series without any Cartesian axis is usually a broken ECharts option.
  //    Pie/radar/sankey and polar/parallel layouts are legitimately axis-free.
  if (SERIES_DECL.test(html) && !X_AXIS_DECL.test(html) && !Y_AXIS_DECL.test(html)) {
    const axisFree = AXIS_FREE_SERIES.test(html) || AXIS_FREE_CONTEXT.test(html)
    if (!axisFree) {
      add('检测到 series 但没有 xAxis/yAxis——柱/折/散点等坐标图请补 xAxis 与 yAxis（含 name），否则读者没有量纲参照。')
    }
  }

  // 2. An axis without a name gives no unit and no meaning.
  const missingNames = []
  for (const entry of axes) {
    if (!entry.missingName) continue
    // Dual y-axis gets its own more specific warning below — don't say it twice.
    if (entry.axis === 'yAxis' && dual.isDual) continue
    if (!missingNames.includes(entry.axis)) missingNames.push(entry.axis)
  }
  if (missingNames.length > 0) {
    add(`坐标轴缺少 name（名称/单位）：${missingNames.join(' / ')}——给对应轴补 name（如 name: '月份'、name: '单量（件）'），读者才知道量纲。`)
  }

  // 3. Too many categories on one axis: the labels collide and the reader gets
  //    a ranked list, not a comparison. Pie/ring budgets are tighter.
  const categories = categoryCount(html)
  const categoryLimit = PIE_SERIES.test(html) ? 6 : 12
  if (categories > categoryLimit) {
    add(`分类 ${categories} 类，超过建议上限 ${categoryLimit}（条形/折线 ≤12，饼/环 ≤6）——请合并小类或只保留 Top ${categoryLimit}，其余放进正文。`)
  }

  // 4. Every hand-picked colour is a token the theme cannot restyle; past ~6
  //    series colours the figure also stops being readable.
  const colors = colorCount(html)
  if (colors > 8) {
    add(`颜色常量 ${colors} 种（hex/rgb），超过 8——同一张图建议 ≤6 个系列色，轴/网格/文字用主题令牌而不是写死颜色。`)
  }

  // 5. Chart types whose rendered result is systematically unreliable.
  if (RISKY_CHART.test(html)) {
    add('高风险图型（radar / 3D / globe / sankey / graph / sunburst / treemap）：这些图型渲染与可读性不稳，建议换柱/折/饼/散点等基础图型，或把关系用文字说清。')
  }

  // 6. Dual y-axes without names invite the reader to compare the wrong lines.
  if (dual.isDual && dual.namedAxes < 2) {
    add('检测到双 y 轴但至少一根没有 name——请分别写清 yAxis[0] / yAxis[1] 的含义与单位（如「销量（件）」「同比（%）」）。')
  }

  // 7. No provenance at all: the figure is not reproducible and may be invented.
  if (provenance.caption === '' && provenance.source === '') {
    add('caption 与 source 都为空——分析类图请补 caption（口径）或 source（来源）+ window（时间窗），不要只给一张没有口径的图。')
  }

  // 8. Illustrative data must say it is illustrative.
  if (provenance.sample && !SAMPLE_MARKER.test(provenance.caption)) {
    add('sample=true 但 caption 没标示例——请在 caption 写明「示例数据/模拟数据，非真实统计」，避免读者把示意当成真实数据。')
  }

  // 9. A narrow SVG canvas is stretched to the card width: type, stroke width
  //    and padding all scale together, which is what "the figure has margins"
  //    usually means in practice.
  const stretch = stretchWarning(html)
  if (stretch !== '') add(stretch)

  return warnings
}

/**
 * Validate one payload.
 * @param {{title?: unknown, html?: unknown, height?: unknown, caption?: unknown,
 *   source?: unknown, window?: unknown, sample?: unknown, assumptions?: unknown,
 *   wide?: unknown}} args - raw tool arguments.
 * @param {{maxHtmlBytes?: number, defaultHeight?: number, allowedScriptHosts?: string[]}} [options] - effective config.
 * @returns {{ok: true, title: string, html: string, caption: string, height: number,
 *   bytes: number, warnings: string[], scriptHosts: string[], source: string,
 *   window: string, sample: boolean, assumptions: string[], wide: boolean}
 *   | {ok: false, code: string, message: string, hint: string}} the verdict.
 */
export function validateVisual(args, options = {}) {
  const maxBytes = Number.isFinite(options.maxHtmlBytes) ? options.maxHtmlBytes : 204800
  const defaultHeight = Number.isFinite(options.defaultHeight) ? options.defaultHeight : DEFAULT_CONFIG.defaultHeight
  const allowedHosts = Array.isArray(options.allowedScriptHosts) ? options.allowedScriptHosts : []

  const title = typeof args?.title === 'string' ? args.title.trim() : ''
  if (title === '') {
    return {
      ok: false,
      code: CODES.INVALID_TITLE,
      message: 'title 不能为空',
      hint: '给这张图一句能独立读懂的标题，最好直接是结论（例：「各省订单量：华东占 41%」）。',
    }
  }
  if (title.length > MAX_TITLE_CHARS) {
    return {
      ok: false,
      code: CODES.INVALID_TITLE,
      message: `title 超过 ${MAX_TITLE_CHARS} 字`,
      hint: '把长句挪到正文或 caption，标题压到一句话。',
    }
  }

  const html = typeof args?.html === 'string' ? args.html.trim() : ''
  if (html === '') {
    return {
      ok: false,
      code: CODES.EMPTY_HTML,
      message: 'html 不能为空',
      hint: 'html 要放可视化的片段（SVG / ECharts 容器 + 内联脚本 / 表格），不是 Markdown。',
    }
  }

  const bytes = byteLength(html)
  if (bytes > maxBytes) {
    return {
      ok: false,
      code: CODES.TOO_LARGE,
      message: `html 体积 ${bytes} 字节，超过上限 ${maxBytes}`,
      hint: '拆成多张图分别调用，或去掉重复的内联样式与注释；不要把整页模板贴进来。',
    }
  }

  for (const rule of FORBIDDEN_TAGS) {
    if (rule.pattern.test(html)) {
      return {
        ok: false,
        code: CODES.FORBIDDEN_TAG,
        message: `不允许出现 ${rule.label}`,
        hint: '这里是气泡内的一段可视化片段，不要嵌套浏览上下文、表单或 base。',
      }
    }
  }

  for (const rule of FORBIDDEN_APIS) {
    if (rule.pattern.test(html)) {
      return {
        ok: false,
        code: CODES.FORBIDDEN_API,
        message: `不允许调用 ${rule.label}`,
        hint: '取数在调用工具之前完成；片段里只做纯渲染，不联网、不读写存储、不碰顶层窗口。',
      }
    }
  }

  const scriptHosts = []
  SCRIPT_SRC.lastIndex = 0
  let match = SCRIPT_SRC.exec(html)
  while (match !== null) {
    const src = match[1] ?? match[2] ?? match[3] ?? ''
    const parsed = hostOf(src)
    if ('relative' in parsed || 'invalid' in parsed) {
      return {
        ok: false,
        code: CODES.UNTRUSTED_SCRIPT_HOST,
        message: `外部脚本必须来自白名单域名，收到：${src || '(空)'}`,
        hint: `只允许 ${allowedHosts.length > 0 ? allowedHosts.join(', ') : '(无)'}；优先内联 SVG，不依赖 CDN。`,
      }
    }
    if (!allowedHosts.includes(parsed.host)) {
      return {
        ok: false,
        code: CODES.UNTRUSTED_SCRIPT_HOST,
        message: `外部脚本域名不在白名单：${parsed.host}`,
        hint: `可用域名：${allowedHosts.length > 0 ? allowedHosts.join(', ') : '(无)'}。`,
      }
    }
    if (!scriptHosts.includes(parsed.host)) scriptHosts.push(parsed.host)
    match = SCRIPT_SRC.exec(html)
  }

  // ── normalized payload (new provenance fields included) ──────────────────
  const caption = typeof args?.caption === 'string' ? args.caption.trim().slice(0, 400) : ''
  const source = typeof args?.source === 'string' ? args.source.trim().slice(0, SOURCE_MAX_CHARS) : ''
  const timeWindow = typeof args?.window === 'string' ? args.window.trim().slice(0, WINDOW_MAX_CHARS) : ''
  const sample = args?.sample === true
  const wide = args?.wide === true
  const assumptions = normalizeAssumptions(args?.assumptions)

  const rawHeight =
    args?.height === undefined || args?.height === null ? Number.NaN : Number(args.height)
  const height = clampHeight(Number.isFinite(rawHeight) ? rawHeight : defaultHeight)

  // ── warnings: safety first, then design lint (advisory, never blocking) ──
  const warnings = []
  /** @param {string} text - warning line. */
  const warn = (text) => {
    if (!warnings.includes(text)) warnings.push(text)
  }
  if (!VISUAL_MARKER.test(html)) {
    warn('没检测到 svg / canvas / table / chart 容器——确认这确实是一张图，而不是大段文字。')
  }
  if (html.length > CLIENT_RENDER_LIMIT) {
    warn(`片段 ${html.length} 字符超过客户端内联渲染上限 ${CLIENT_RENDER_LIMIT}，卡片将只显示说明——请拆成多张图。`)
  }
  if (MAP_MARKER.test(html)) {
    warn('命中地图相关关键词：地图可视化是红线，请改成非地图表达。')
  }
  if (DOC_MARKER.test(html)) {
    warn('片段里出现了 html/head/body 结构——只要 body 级内容，避免样式冲突。')
  }
  for (const text of designWarnings(html, { caption, source, sample })) warn(text)

  return {
    ok: true,
    title,
    html,
    caption,
    height,
    bytes,
    warnings,
    scriptHosts,
    source,
    window: timeWindow,
    sample,
    assumptions,
    wide,
  }
}
