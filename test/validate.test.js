/**
 * Validator policy tests — every rule is a pure function, so this file is the
 * whole safety net for what may reach the iframe.
 */
import assert from 'node:assert/strict'

import { CODES, byteLength, validateVisual } from '../lib/validate.js'

/** Options the host would pass. */
const OPTIONS = { maxHtmlBytes: 204800, defaultHeight: 480, allowedScriptHosts: ['cdn.jsdelivr.net'] }

const SVG = '<svg viewBox="0 0 10 10"><rect width="10" height="4"/></svg>'
const CHART = '<div class="chart"></div>'

/** Run the validator and return the verdict. */
function check(args, options = OPTIONS) {
  return validateVisual(args, options)
}

/** A chart fragment: a visual marker plus one inline ECharts option script. */
function optionHtml(config) {
  return `${CHART}<script>var option=${config}</script>`
}

/** Lint one fragment with a caption, so the provenance rule stays quiet. */
function lint(html, extra = {}) {
  return check({ title: 't', html, caption: '口径：数据来自内部报表', ...extra })
}

/** Category labels as an ECharts `data: [...]` array. */
function labels(count) {
  return JSON.stringify(Array.from({ length: count }, (_, index) => `c${index}`))
}

/** Pie/ring slices as `{name, value}` objects. */
function slices(count) {
  return Array.from({ length: count }, (_, index) => `{name:'s${index}',value:${index + 1}}`).join(',')
}

// ── pass ────────────────────────────────────────────────────────────────────
{
  const verdict = check({ title: '各省订单量', html: SVG, caption: '口径：示例数据' })
  assert.equal(verdict.ok, true)
  assert.equal(verdict.title, '各省订单量')
  assert.equal(verdict.height, 480)
  assert.deepEqual(verdict.warnings, [])
  assert.equal(verdict.bytes, byteLength(SVG))
  // 新口径字段全部有归一化默认值，调用方不用再判 undefined。
  assert.equal(verdict.source, '')
  assert.equal(verdict.window, '')
  assert.equal(verdict.sample, false)
  assert.deepEqual(verdict.assumptions, [])
  assert.equal(verdict.wide, false)
}

{
  const verdict = check({
    title: '趋势',
    html: `<div id="c" style="height:200px"></div><script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"></script><script>var c=1</script>`,
  })
  assert.equal(verdict.ok, true)
  assert.deepEqual(verdict.scriptHosts, ['cdn.jsdelivr.net'])
}

{
  // 协议相对 URL 与大小写域名都应归一化后放行。
  const verdict = check({ title: 't', html: `${SVG}<script src="//CDN.JSDELIVR.NET/x.js"></script>` })
  assert.equal(verdict.ok, true)
  assert.deepEqual(verdict.scriptHosts, ['cdn.jsdelivr.net'])
}

{
  // 高度夹取与缺省：240–1024，默认 480（config.js 的新口径）。
  assert.equal(check({ title: 't', html: SVG, height: 9999 }).height, 1024)
  assert.equal(check({ title: 't', html: SVG, height: 10 }).height, 240)
  assert.equal(check({ title: 't', html: SVG, height: 'abc' }).height, 480)
  assert.equal(check({ title: 't', html: SVG, height: 240 }).height, 240)
  assert.equal(check({ title: 't', html: SVG, height: 1024 }).height, 1024)
  assert.equal(check({ title: 't', html: SVG, height: 512 }).height, 512)
  // 宿主配置的默认高度只在 height 缺省时生效。
  assert.equal(check({ title: 't', html: SVG }, { ...OPTIONS, defaultHeight: 600 }).height, 600)
}

{
  // caption 截断、空白裁剪。
  const verdict = check({ title: '  t  ', html: SVG, caption: `  ${'x'.repeat(500)}  ` })
  assert.equal(verdict.ok, true)
  assert.equal(verdict.title, 't')
  assert.equal(verdict.caption.length, 400)
  assert.equal(verdict.caption.endsWith('x'), true)
}

// ── reject: shape ───────────────────────────────────────────────────────────
{
  const verdict = check({ title: '   ', html: SVG })
  assert.equal(verdict.ok, false)
  assert.equal(verdict.code, CODES.INVALID_TITLE)
}
{
  const verdict = check({ title: 'x'.repeat(121), html: SVG })
  assert.equal(verdict.ok, false)
  assert.equal(verdict.code, CODES.INVALID_TITLE)
}
{
  const verdict = check({ title: 't', html: '   ' })
  assert.equal(verdict.ok, false)
  assert.equal(verdict.code, CODES.EMPTY_HTML)
}
{
  const verdict = check({ title: 't', html: SVG }, { ...OPTIONS, maxHtmlBytes: 10 })
  assert.equal(verdict.ok, false)
  assert.equal(verdict.code, CODES.TOO_LARGE)
  assert.match(verdict.hint, /拆成多张图/)
}

// ── reject: forbidden tags ─────────────────────────────────────────────────
for (const [snippet, label] of [
  ['<iframe src="https://example.com"></iframe>', '<iframe>'],
  ['<FORM action="/x"><input></FORM>', '<form>'],
  ['<object data="x"></object>', '<object>'],
  ['<embed src="x">', '<embed>'],
  ['<base href="https://evil/">', '<base>'],
]) {
  const verdict = check({ title: 't', html: `${SVG}${snippet}` })
  assert.equal(verdict.ok, false, `${label} 应被拒`)
  assert.equal(verdict.code, CODES.FORBIDDEN_TAG)
  assert.match(verdict.message, new RegExp(label.replace(/[<>\s]/g, '.'), 'i'))
}

// ── reject: forbidden APIs ─────────────────────────────────────────────────
for (const snippet of [
  '<script>document.cookie="a=1"</script>',
  '<script>localStorage.setItem("a","1")</script>',
  '<script>fetch("/api")</script>',
  '<script>new XMLHttpRequest()</script>',
  '<script>window.top.location="https://evil"</script>',
  '<script>window.parent.postMessage(1,"*")</script>',
  '<a href="javascript:alert(1)">x</a>',
]) {
  const verdict = check({ title: 't', html: `${SVG}${snippet}` })
  assert.equal(verdict.ok, false, `${snippet} 应被拒`)
  assert.equal(verdict.code, CODES.FORBIDDEN_API)
}

// ── reject: untrusted script hosts ────────────────────────────────────────
for (const src of [
  'https://evil.example/x.js',
  'https://unpkg.com/echarts@5',
  'x.js',
  '',
]) {
  const verdict = check({ title: 't', html: `<script src="${src}"></script>` })
  assert.equal(verdict.ok, false, `src="${src}" 应被拒`)
  assert.equal(verdict.code, CODES.UNTRUSTED_SCRIPT_HOST)
}

// ── 无引号 / 混合引号的 src 也必须过白名单 ────────────────────────────────
for (const snippet of [
  '<script src=//evil.example/x.js></script>',
  "<script src='https://unpkg.com/x.js'></script>",
  '<script type="text/javascript" src=https://evil.example/x.js></script>',
  '<script src=""></script>',
]) {
  const verdict = check({ title: 't', html: snippet })
  assert.equal(verdict.ok, false, `${snippet} 应被拒`)
  assert.equal(verdict.code, CODES.UNTRUSTED_SCRIPT_HOST)
}
// 白名单域名（三种引号写法）都应放行
for (const snippet of [
  '<script src="https://cdn.jsdelivr.net/x.js"></script>',
  "<script src='https://cdn.jsdelivr.net/x.js'></script>",
  '<script src=https://cdn.jsdelivr.net/x.js></script>',
]) {
  const verdict = check({ title: 't', html: snippet })
  assert.equal(verdict.ok, true, `${snippet} 应放行`)
  assert.deepEqual(verdict.scriptHosts, ['cdn.jsdelivr.net'])
}

// ── warnings：原有安全告警保持 ─────────────────────────────────────────────
{
  const verdict = check({ title: 't', html: '<p>只有一段文字</p>' })
  assert.equal(verdict.ok, true)
  assert.equal(verdict.warnings.some((warning) => /svg/.test(warning)), true)
}
{
  const verdict = check({ title: 't', html: `${SVG}<div class="map">L.map('x')</div>` })
  assert.equal(verdict.ok, true)
  assert.equal(verdict.warnings.some((warning) => warning.includes('地图')), true)
}
{
  const verdict = check({ title: 't', html: '<html><body><svg></svg></body></html>' })
  assert.equal(verdict.ok, true)
  assert.equal(verdict.warnings.some((warning) => warning.includes('html/head/body')), true)
}
{
  // ECharts 用 div 容器 + echarts.init 也是图，不该误报「没检测到图」。
  const verdict = check({
    title: 't',
    caption: '示例',
    html: '<div id="c" style="height:240px"></div><script>var chart=echarts.init(document.getElementById("c"));chart.setOption({});</script>',
  })
  assert.equal(verdict.ok, true)
  assert.equal(verdict.warnings.some((warning) => warning.includes('没检测到')), false)
}

// ── 超限提醒：host 提前告知客户端不会内联渲染 ────────────────────────────
{
  const verdict = check({ title: 't', html: `<svg></svg>${'x'.repeat(60001)}` })
  assert.equal(verdict.ok, true)
  assert.equal(verdict.warnings.some((warning) => warning.includes('60000')), true)
}

// ── lint 1：有 series 但无坐标轴 ──────────────────────────────────────────
{
  const verdict = lint(optionHtml("{series:[{type:'bar',data:[1,2]}]}"))
  assert.equal(verdict.ok, true, 'lint 只提示，绝不阻断渲染')
  assert.equal(verdict.warnings.length, 1)
  assert.match(verdict.warnings[0], /xAxis/)
}
{
  // 补上带 name 的坐标轴就不该再提示。
  const verdict = lint(optionHtml("{xAxis:{name:'月份'},yAxis:{name:'单量'},series:[{type:'bar',data:[1,2]}]}"))
  assert.deepEqual(verdict.warnings, [])
}
{
  // 饼/环等无轴图型不该误报。
  const verdict = lint(optionHtml("{series:[{type:'pie',data:[{name:'A',value:1}]}]}"))
  assert.equal(verdict.warnings.some((warning) => warning.includes('xAxis')), false)
}
{
  // 纯表格 / 纯 SVG 不该误报「有 series 无轴」。
  assert.deepEqual(lint('<table><tr><th>地区</th><th>单量</th></tr></table>').warnings, [])
  assert.deepEqual(lint(SVG).warnings, [])
}

// ── lint 2：坐标轴缺 name（单位/名称） ────────────────────────────────────
{
  const verdict = lint(optionHtml("{xAxis:{type:'category'},yAxis:{type:'value'},series:[{type:'bar',data:[1]}]}"))
  assert.equal(verdict.ok, true)
  assert.equal(verdict.warnings.length, 1)
  assert.match(verdict.warnings[0], /name/)
  assert.match(verdict.warnings[0], /xAxis/)
}
{
  const verdict = lint(optionHtml("{xAxis:{type:'category',name:'月份'},yAxis:{type:'value',name:'单量（件）'},series:[{type:'bar',data:[1]}]}"))
  assert.deepEqual(verdict.warnings, [])
}

// ── lint 3：分类过多（条形 ≤12、饼/环 ≤6） ───────────────────────────────
{
  const verdict = lint(optionHtml(`{xAxis:{name:'地区',data:${labels(13)}},yAxis:{name:'单量'},series:[{type:'bar',data:[1]}]}`))
  assert.equal(verdict.ok, true)
  assert.equal(verdict.warnings.length, 1)
  assert.match(verdict.warnings[0], /分类 13 类/)
}
{
  const verdict = lint(optionHtml(`{xAxis:{name:'地区',data:${labels(12)}},yAxis:{name:'单量'},series:[{type:'bar',data:[1]}]}`))
  assert.deepEqual(verdict.warnings, [])
}
{
  // 7 类没超条形阈值，但超过饼/环的 6 类上限。
  const verdict = lint(optionHtml(`{series:[{type:'pie',data:[${slices(7)}]}]}`))
  assert.equal(verdict.warnings.length, 1)
  assert.match(verdict.warnings[0], /饼\/环/)
}
{
  const verdict = lint(optionHtml(`{series:[{type:'pie',data:[${slices(6)}]}]}`))
  assert.deepEqual(verdict.warnings, [])
}

// ── lint 4：颜色常量过多 ──────────────────────────────────────────────────
{
  const fills = Array.from({ length: 9 }, (_, index) => `<rect fill="#${String(index + 1).repeat(6)}"/>`).join('')
  const verdict = lint(`<svg>${fills}</svg>`)
  assert.equal(verdict.ok, true)
  assert.equal(verdict.warnings.length, 1)
  assert.match(verdict.warnings[0], /颜色常量 9 种/)
}
{
  const fills = Array.from({ length: 8 }, (_, index) => `<rect fill="#${String(index + 1).repeat(6)}"/>`).join('')
  assert.deepEqual(lint(`<svg>${fills}</svg>`).warnings, [])
}
{
  // 同一颜色的 #fff / #ffffff / rgb() 三种写法只算一种。
  const verdict = lint('<svg><rect fill="#fff"/><rect fill="#ffffff"/><rect fill="rgb(255,255,255)"/></svg>')
  assert.deepEqual(verdict.warnings, [])
}

// ── lint 5：高风险图型 ────────────────────────────────────────────────────
for (const type of ['radar', 'sankey', 'graph', 'sunburst', 'treemap', 'globe']) {
  const verdict = lint(optionHtml(`{series:[{type:'${type}'}]}`))
  assert.equal(verdict.ok, true)
  assert.equal(verdict.warnings.some((warning) => warning.includes('高风险图型')), true, `${type} 应提示高风险图型`)
}
{
  // 3D 也要提示（带坐标轴，避免同时命中 lint 1）。
  const verdict = lint(optionHtml("{xAxis:{name:'x'},yAxis:{name:'y'},series:[{type:'bar3d',data:[1]}]}"))
  assert.equal(verdict.warnings.some((warning) => warning.includes('高风险图型')), true)
}
{
  // class="graph" 只是容器类名，不是 ECharts 关系图，不该误报。
  const verdict = lint(`<div class="graph"></div><script>var option={xAxis:{name:'x'},yAxis:{name:'y'},series:[{type:'bar',data:[1]}]}</script>`)
  assert.deepEqual(verdict.warnings, [])
}

// ── lint 6：双 y 轴未命名 ─────────────────────────────────────────────────
{
  const verdict = lint(optionHtml("{xAxis:{name:'月份'},yAxis:[{type:'value'},{type:'value'}],series:[{type:'bar',data:[1]},{type:'line',yAxisIndex:1,data:[2]}]}"))
  assert.equal(verdict.ok, true)
  assert.equal(verdict.warnings.length, 1)
  assert.match(verdict.warnings[0], /双 y 轴/)
}
{
  const verdict = lint(optionHtml("{xAxis:{name:'月份'},yAxis:[{type:'value',name:'销量（件）'},{type:'value',name:'同比（%）'}],series:[{type:'bar',data:[1]}]}"))
  assert.deepEqual(verdict.warnings, [])
}
{
  // 单 y 轴缺 name 走 lint 2，不算双轴。
  const verdict = lint(optionHtml("{xAxis:{name:'月份'},yAxis:{type:'value'},series:[{type:'bar',data:[1]}]}"))
  assert.equal(verdict.warnings.some((warning) => warning.includes('双 y 轴')), false)
  assert.equal(verdict.warnings.some((warning) => warning.includes('name')), true)
}

// ── lint 7：caption / source 口径缺失 ────────────────────────────────────
{
  const verdict = check({ title: 't', html: SVG })
  assert.equal(verdict.ok, true)
  assert.equal(verdict.warnings.length, 1)
  assert.match(verdict.warnings[0], /caption/)
}
{
  // caption 或 source 二选一有内容就不提示。
  assert.deepEqual(check({ title: 't', html: SVG, caption: '口径：示例' }).warnings, [])
  assert.deepEqual(check({ title: 't', html: SVG, source: '来源：内部报表' }).warnings, [])
}

// ── lint 8：示例数据未标注 ────────────────────────────────────────────────
{
  const verdict = check({ title: 't', html: SVG, caption: '口径：近 30 天', sample: true })
  assert.equal(verdict.ok, true)
  assert.equal(verdict.warnings.length, 1)
  assert.match(verdict.warnings[0], /示例/)
}
{
  assert.deepEqual(check({ title: 't', html: SVG, caption: '口径：示例数据，仅演示', sample: true }).warnings, [])
  assert.deepEqual(check({ title: 't', html: SVG, caption: '口径：近 30 天', sample: false }).warnings, [])
}

// ── warnings 不重复：多条规则同时命中也只各说一句 ─────────────────────────
{
  const palette = Array.from({ length: 9 }, (_, index) => `'#${String(index + 1).repeat(6)}'`).join(',')
  const verdict = lint(optionHtml(`{color:[${palette}],series:[{type:'pie',data:[${slices(9)}]}]}`))
  assert.deepEqual([...new Set(verdict.warnings)], verdict.warnings)
  assert.equal(verdict.warnings.some((warning) => warning.includes('分类')), true)
  assert.equal(verdict.warnings.some((warning) => warning.includes('颜色')), true)
}

// ── 口径字段归一化 ───────────────────────────────────────────────────────
{
  const verdict = check({
    title: 't',
    html: SVG,
    caption: '口径：示例数据',
    source: `  ${'s'.repeat(300)}  `,
    window: ` ${'w'.repeat(200)} `,
    sample: true,
    wide: true,
    assumptions: [' 先排除测试账号 ', '', 42, '  ', ' 口径 B ', '假设 C', '假设 D', '假设 E', '假设 F'],
  })
  assert.equal(verdict.source.length, 200)
  assert.equal(verdict.source.startsWith('s'), true)
  assert.equal(verdict.window.length, 120)
  assert.equal(verdict.sample, true)
  assert.equal(verdict.wide, true)
  assert.deepEqual(verdict.assumptions, ['先排除测试账号', '口径 B', '假设 C', '假设 D', '假设 E'])
  assert.deepEqual(verdict.warnings, [])
}
{
  // 单条 assumption 上限 300 字；非数组直接归一成空数组。
  const long = check({ title: 't', html: SVG, caption: '口径', assumptions: ['x'.repeat(400), 'ok', null] })
  assert.deepEqual(long.assumptions.map((entry) => entry.length), [300, 2])
  assert.deepEqual(check({ title: 't', html: SVG, caption: '口径', assumptions: 'not-an-array' }).assumptions, [])
}
{
  // sample / wide 只认严格布尔值，字符串 "true" 不算。
  const verdict = check({ title: 't', html: SVG, caption: '口径', sample: 'true', wide: 1 })
  assert.equal(verdict.sample, false)
  assert.equal(verdict.wide, false)
}

// ── byte length ────────────────────────────────────────────────────────────
{
  assert.equal(byteLength('中'), 3)
  assert.equal(byteLength('abc'), 3)
  assert.equal(byteLength(''), 0)
}

console.log('validate.test.js: ok')
