/**
 * The bundled skill and the system-prompt section are the part that decides
 * *when* a figure is worth drawing and *how* it must be drawn; pin their shape
 * so an edit cannot quietly drop the red lines, the design tokens, the
 * provenance fields or break the frontmatter DSH parses.
 *
 * Every assertion goes through ok()/eq() so the run reports how many checks
 * are covered — the count is part of the contract review.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { systemPromptText, systemPromptTextEn } from '../lib/prompt.js'

// 行尾归一：Windows 编辑器把 SKILL.md 存成 CRLF 不该让契约测试挂（DSH 两种都吃得下）
const CRLF = String.fromCharCode(13) + String.fromCharCode(10)
const LF = String.fromCharCode(10)
const skill = readFileSync(new URL('../skills/visual-reply/SKILL.md', import.meta.url), 'utf8')
  .split(CRLF).join(LF)

/** 断言计数：末尾打印，便于确认契约覆盖面没有缩水。 */
let checks = 0
function ok(value, message) {
  checks += 1
  assert.ok(value, message)
}
function eq(actual, expected, message) {
  checks += 1
  assert.equal(actual, expected, message)
}

// ── frontmatter：必须在最前，name / description 齐备 ─────────────────────
eq(skill.startsWith('---' + LF), true, 'SKILL.md frontmatter 必须在最前')
const end = skill.indexOf(LF + '---', 4)
ok(end > 0, 'SKILL.md frontmatter 必须闭合')
const front = skill.slice(4, end)
const nameMatch = /^name:\s*(.+)$/m.exec(front)
const descMatch = /^description:\s*(.+)$/m.exec(front)
ok(nameMatch, 'SKILL.md 缺 name')
eq(nameMatch?.[1]?.trim(), 'visual-reply', 'SKILL.md name 必须是 visual-reply')
ok(descMatch, 'SKILL.md 缺 description')
const desc = descMatch?.[1]?.trim() ?? ''
ok(desc.length > 30, 'description 太短，DSH 列表里说明不了用途')
ok(desc.length < 1200, 'description 太长，DSH 列表会截断')

// ── 正文结构与红线：四段保留，新增令牌/模板/主题段 ───────────────────────
for (const heading of ['## When to use', '## Steps', '## Pitfalls', '## Verification']) {
  ok(skill.includes(heading), `SKILL.md 缺 ${heading}`)
}
ok(skill.includes('## 设计令牌'), 'SKILL.md 缺设计令牌段')
ok(skill.includes('## 模板'), 'SKILL.md 缺模板段')
ok(skill.includes('## ECharts 主题'), 'SKILL.md 缺 ECharts 主题段')
ok(skill.includes('## 图元点击'), 'SKILL.md 缺图元点击段')
ok(skill.includes('visual_render'), 'SKILL.md 必须点名工具')
ok(skill.includes('地图'), 'SKILL.md 必须写地图红线')
ok(skill.includes('编造'), 'SKILL.md 必须写不许编造数值')
ok(skill.includes('window.__vrData'), 'SKILL.md 必须写数据契约 window.__vrData')

// ── 设计令牌：只用 --vr-*，不写死 hex/字号，字重只 400/500 ───────────────
const TOKENS = [
  '--vr-fg',
  '--vr-muted',
  '--vr-line',
  '--vr-accent',
  '--vr-on-accent',
  '--vr-series-1..6',
  '--vr-font-title',
  '--vr-font-body',
  '--vr-font-caption',
]
for (const token of TOKENS) {
  ok(skill.includes(token), `SKILL.md 缺设计令牌 ${token}`)
}
ok(skill.includes('写死'), 'SKILL.md 必须写「不要写死」色值/字号')
ok(skill.includes('hex'), 'SKILL.md 必须点名禁止写死 hex')
ok(skill.includes('400/500'), 'SKILL.md 必须限定字重只用 400/500')
ok(skill.includes('字号令牌'), 'SKILL.md 必须说明字体令牌是三档字号')
ok(skill.includes('font-size:var(--vr-font-body)'), 'SKILL.md 必须示范 font-size:var(--vr-font-*) 写法')
eq(skill.includes('`font` 简写'), false, 'SKILL.md 不能把字体令牌当 font 简写用')
ok(skill.includes('卡片壳'), 'SKILL.md 必须写「不要套卡片壳」')
ok(skill.includes('阴影'), 'SKILL.md 必须写「不要加阴影」')
ok(skill.includes('圆角'), 'SKILL.md 必须写「不要加圆角」')
ok(/≤\s*120\s*字/.test(skill), 'SKILL.md 必须写标题结论 ≤120 字')
ok(skill.includes('解释段落'), 'SKILL.md 必须写「图内不放解释段落」')
ok(skill.includes('一次调用只画一张图'), 'SKILL.md 必须写「一次调用只画一张图」')

// ── 硬规则：轴名+单位、基线、类别/系列上限、高风险图型、表格 ─────────────
ok(skill.includes('单位'), 'SKILL.md 必须要求坐标轴带单位')
ok(/从\s*0\s*起/.test(skill), 'SKILL.md 必须要求条形图从 0 起')
ok(/饼[^\n]*≤\s*6/.test(skill), 'SKILL.md 必须限制饼/环 ≤6 类')
ok(/条形[^\n]*≤\s*12/.test(skill), 'SKILL.md 必须限制条形 ≤12 类')
ok(/≤\s*6\s*个/.test(skill), 'SKILL.md 必须限制颜色/系列 ≤6 个')
for (const word of ['3D', '雷达', '桑基', '关系图']) {
  ok(skill.includes(word), `SKILL.md 必须点名不用 ${word}`)
}
ok(skill.includes('Markdown 表'), 'SKILL.md 必须写「表格请求直接回 Markdown 表」')

// ── 口径字段：caption 必填 + 可选 source/window/assumptions/wide/sample ──
ok(/caption[^\n]{0,6}（必填）|caption`（必填）/.test(skill), 'SKILL.md 必须写 caption 必填')
for (const field of ['source', 'window', 'assumptions', 'wide', 'sample']) {
  ok(skill.includes(field), `SKILL.md 缺口径字段 ${field}`)
}
ok(skill.includes('示例'), 'SKILL.md 必须写示例数据要标注')

// ── height 语义：建议最大高度，默认 480，范围 240–1024；删掉过时说法 ────
ok(skill.includes('建议最大高度'), 'SKILL.md 必须写 height 是建议最大高度')
ok(/默认 480/.test(skill), 'SKILL.md 必须写 height 默认 480')
ok(/240\s*[–\-~]\s*1024/.test(skill), 'SKILL.md 必须写 height 范围 240–1024')
eq(skill.includes('默认 360'), false, '过时的「height 默认 360」必须删掉')
eq(/height[^\n]*按内容给/.test(skill), false, '过时的「height 按内容给」必须删掉')

// ── 保留的分步与坑：基线、viewBox、体积、脚本白名单 ─────────────────────
ok(skill.includes('基线'), 'SKILL.md 缺标签基线对齐规则')
ok(skill.includes('viewBox'), 'SKILL.md 缺 SVG 高度交给 viewBox 规则')
ok(skill.includes('viewBox="0 0 720 300"'), '模板画布必须按卡片宽度 ≈700 设计，避免整图被放大')
ok(skill.includes('40KB'), 'SKILL.md 缺 40KB 体积上限')
ok(skill.includes('300 行'), 'SKILL.md 缺 300 行上限')
ok(skill.includes('cdn.jsdelivr.net'), 'SKILL.md 缺外部脚本白名单')
ok(skill.includes('固定高度'), 'SKILL.md 缺 ECharts 容器固定高度提醒')

// ── ECharts 主题与可选图元点击：令牌读取 + vr-theme + vrPick ────────────
ok(skill.includes('getComputedStyle'), 'SKILL.md 缺 getComputedStyle 读令牌示例')
ok(skill.includes('vr-theme'), 'SKILL.md 缺 vr-theme 主题事件')
ok(skill.includes('data-vr-pick'), 'SKILL.md 缺 data-vr-pick 图元点击')
ok(skill.includes('vrPick'), 'SKILL.md 缺 window.vrPick 图元点击')

// ── 系统提示词：中英文都要点名工具、令牌、硬规则与口径 ───────────────────
const zh = systemPromptText()
const en = systemPromptTextEn()

for (const [label, text] of [['中文', zh], ['英文', en]]) {
  ok(text.includes('visual_render'), `${label}提示词必须点名 visual_render`)
  ok(text.includes('caption'), `${label}提示词必须写 caption`)
  ok(text.length > 400, `${label}提示词太短，写不下生产规范`)
  eq(text.includes('\r'), false, `${label}提示词不能含 CR`)
  for (const token of TOKENS) {
    ok(text.includes(token), `${label}提示词缺设计令牌 ${token}`)
  }
  for (const field of ['source', 'window', 'assumptions', 'wide', 'sample']) {
    ok(text.includes(field), `${label}提示词缺口径字段 ${field}`)
  }
  ok(text.includes('hex'), `${label}提示词必须禁止写死 hex`)
  ok(text.includes('400/500'), `${label}提示词必须限定字重 400/500`)
}

// 中文专有断言
ok(zh.includes('卡片壳'), '中文提示词必须写「不要套卡片壳」')
ok(zh.includes('阴影'), '中文提示词必须写「不要加阴影」')
ok(zh.includes('地图'), '中文提示词必须写地图红线')
ok(zh.includes('编造'), '中文提示词必须写不许编造数值')
ok(/≤\s*120\s*字/.test(zh), '中文提示词必须写标题结论 ≤120 字')
ok(zh.includes('解释段落'), '中文提示词必须写「图内不放解释段落」')
ok(zh.includes('一次调用只画一张图'), '中文提示词必须写「一次调用只画一张图」')
ok(zh.includes('单位'), '中文提示词必须要求坐标轴带单位')
ok(/从\s*0\s*起/.test(zh), '中文提示词必须要求条形图从 0 起')
ok(/饼[^\n]*≤\s*6/.test(zh), '中文提示词必须限制饼/环 ≤6 类')
ok(/条形[^\n]*≤\s*12/.test(zh), '中文提示词必须限制条形 ≤12 类')
ok(/≤\s*6\s*个/.test(zh), '中文提示词必须限制颜色/系列 ≤6 个')
for (const word of ['3D', '雷达', '桑基', '关系图']) {
  ok(zh.includes(word), `中文提示词必须点名不用 ${word}`)
}
ok(zh.includes('Markdown 表'), '中文提示词必须写「表格请求回 Markdown 表」')
ok(zh.includes('建议最大高度'), '中文提示词必须写 height 是建议最大高度')
ok(zh.includes('font-size:var(--vr-font-body)'), '中文提示词必须示范 font-size:var(--vr-font-*) 写法')
ok(/默认 480/.test(zh), '中文提示词必须写 height 默认 480')
ok(/240\s*[–\-~]\s*1024/.test(zh), '中文提示词必须写 height 范围 240–1024')

// 英文专有断言
ok(en.includes('card shell'), '英文提示词必须写「不要套卡片壳」')
ok(en.includes('shadow'), '英文提示词必须写「不要加阴影」')
ok(en.includes('map'), '英文提示词必须写地图红线')
ok(/Every axis needs a name/.test(en), '英文提示词必须要求坐标轴有名称与单位')
ok(/start at 0/.test(en), '英文提示词必须要求条形图从 0 起')
ok(/Pie\/donut charts ≤6/.test(en), '英文提示词必须限制饼/环 ≤6 类')
ok(/bar charts ≤12/.test(en), '英文提示词必须限制条形 ≤12 类')
ok(/≤6 series colours/.test(en), '英文提示词必须限制系列颜色 ≤6 个')
for (const word of ['3D', 'radar', 'sankey', 'graph']) {
  ok(en.includes(word), `英文提示词必须点名不用 ${word}`)
}
ok(en.includes('Markdown table'), '英文提示词必须写「表格请求回 Markdown 表」')
ok(en.includes('suggested maximum height'), '英文提示词必须写 height 是建议最大高度')
ok(en.includes('font-size:var(--vr-font-body)'), '英文提示词必须示范 font-size:var(--vr-font-*) 写法')
ok(/default 480/.test(en), '英文提示词必须写 height 默认 480')
ok(/240\s*[–\-~]\s*1024/.test(en), '英文提示词必须写 height 范围 240–1024')

console.log(`skill.test.js: ok — ${checks} 条断言`)
