/**
 * Host half wiring test: a stub cordis context stands in for the real one, so
 * the tool contract (schema + receipt), the rejection path, the receipt text,
 * the system-prompt section and the bundled-skill install can all be checked
 * without touching a live profile.
 *
 * Contract under test: `height` is a *suggested maximum* (default 480, clamped
 * to 240–1024), and the structured 口径 fields (`caption`, `source`, `window`,
 * `sample`, `assumptions`, `wide`) are validated by lib/validate.js and echoed
 * back in the receipt only when they carry a value.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/** Isolate $DSH_HOME so the skill install lands in a temp dir. */
const fakeHome = mkdtempSync(path.join(tmpdir(), 'vr-home-'))
process.env.DSH_HOME = fakeHome

const { ECHARTS_ROUTE, apply } = await import('../index.js')

/**
 * Build a stub context.
 * @param {{noLoader?: boolean}} [options] - loader behaviour.
 * @returns {any} the stub plus capture arrays.
 */
function makeCtx(options = {}) {
  const tools = []
  const sections = []
  const effects = []
  const ctx = {
    logger: { info() {}, warn() {}, debug() {} },
    effect(fn) {
      effects.push(fn)
      const disposer = fn()
      return typeof disposer === 'function' ? disposer : () => {}
    },
    get(name) {
      if (name === 'systemPrompt') {
        return {
          section(definition) {
            sections.push(definition)
            return () => {}
          },
          getSectionOrder(key) {
            // 与内置键表一致：只认自己那张表里的键，别的一律 undefined。
            return key === 'TOOL_COMPUTER_USE' ? 3000 : undefined
          },
        }
      }
      return undefined
    },
    loader: {
      async import() {
        if (options.noLoader) throw new Error('no loader in this composition')
        return { defineTool: (definition) => definition }
      },
    },
    tools: {
      register(tool) {
        tools.push(tool)
        return () => {}
      },
    },
  }
  return { ctx, tools, sections, effects }
}

// ── enabled: tool + prompt + skill ─────────────────────────────────────────
{
  const { ctx, tools, sections } = makeCtx()
  await apply(ctx, { enabled: true, maxHtmlBytes: 100000 })

  assert.equal(tools.length, 1)
  const tool = tools[0]
  assert.equal(tool.name, 'visual_render')
  assert.equal(typeof tool.execute, 'function')

  // ── schema 契约 ──
  // 新口径字段全部进入 parameters；必填仍然只有 title/html。
  assert.deepEqual(
    Object.keys(tool.parameters).sort(),
    ['assumptions', 'caption', 'height', 'html', 'sample', 'source', 'title', 'wide', 'window'],
  )
  assert.equal(tool.parameters.title.required, true)
  assert.equal(tool.parameters.html.required, true)
  for (const key of ['caption', 'height', 'source', 'window', 'sample', 'assumptions', 'wide']) {
    assert.equal(tool.parameters[key].required === true, false, `${key} 应为可选参数`)
  }
  assert.equal(tool.parameters.height.type, 'integer')
  assert.equal(tool.parameters.caption.type, 'string')
  assert.equal(tool.parameters.source.type, 'string')
  assert.equal(tool.parameters.window.type, 'string')
  assert.equal(tool.parameters.sample.type, 'boolean')
  assert.equal(tool.parameters.wide.type, 'boolean')
  assert.equal(tool.parameters.assumptions.type, 'array')
  assert.equal(tool.parameters.assumptions.items.type, 'string')

  // 输出 schema 也要能描述新回执字段，免得执行器把回执裁掉/校验失败。
  const outProps = tool.output.schema.properties
  assert.equal(outProps.source.type, 'string')
  assert.equal(outProps.window.type, 'string')
  assert.equal(outProps.sample.type, 'boolean')
  assert.equal(outProps.assumptions.type, 'array')
  assert.equal(outProps.assumptions.items.type, 'string')
  assert.equal(outProps.wide.type, 'boolean')

  // height 语义已从「初始高度」改成「建议最大高度」：默认 480，范围 240–1024。
  const heightDoc = tool.parameters.height.description
  assert.equal(heightDoc.includes('建议最大高度'), true)
  assert.equal(heightDoc.includes('480'), true)
  assert.equal(heightDoc.includes('240'), true)
  assert.equal(heightDoc.includes('1024'), true)
  assert.equal(heightDoc.includes('自适应'), true)

  // 工具描述补齐设计约束（令牌 / 轴 / 分析类图口径）。
  assert.equal(tool.description.includes('--vr-*'), true)
  assert.equal(tool.description.includes('caption'), true)
  assert.equal(tool.description.includes('source'), true)
  assert.equal(tool.description.includes('坐标轴'), true)

  // ── 正常一路：结构化口径字段回填，默认高度 480 ──
  const ok = await tool.execute({
    title: '各省订单量',
    html: '<svg></svg>',
    caption: '口径：示例数据，按支付时间归月',
    source: 'etl_dws.dws_order',
    window: '2026-10-01~2026-10-31',
    sample: true,
    assumptions: ['按支付时间归月'],
    wide: true,
  })
  assert.equal(ok.ok, true)
  assert.equal(ok.height, 480)
  assert.equal(ok.bytes > 0, true)
  assert.equal(Array.isArray(ok.warnings), true)
  assert.equal(ok.caption, '口径：示例数据，按支付时间归月')
  assert.equal(ok.source, 'etl_dws.dws_order')
  assert.equal(ok.window, '2026-10-01~2026-10-31')
  assert.equal(ok.sample, true)
  assert.deepEqual(ok.assumptions, ['按支付时间归月'])
  assert.equal(ok.wide, true)

  // 回执必须是无损 JSON：带一个 undefined 值就会被执行器整单拒收
  // （线上真踩过：archived: undefined 让一次成功的渲染以报错收场）。
  assert.equal(Object.values(ok).every((value) => value !== undefined), true)
  assert.deepEqual(JSON.parse(JSON.stringify(ok)), ok)

  const rendered = tool.output.render({}, ok)
  assert.equal(Array.isArray(rendered), true)
  assert.equal(rendered[0].type, 'text')
  assert.equal(rendered[0].text.includes('已渲染可视化'), true)
  assert.equal(rendered[0].text.includes('建议高度 480px'), true)
  assert.equal(rendered[0].text.includes('不要再把 HTML 贴进回答'), true)

  // 没有新口径字段时，receipt 不出现空键（undefined / 空串都不行）。
  const bare = await tool.execute({ title: '各省订单量', html: '<svg></svg>' })
  assert.equal(bare.ok, true)
  for (const key of ['source', 'window', 'sample', 'assumptions', 'wide']) {
    assert.equal(Object.hasOwn(bare, key), false, `空值字段 ${key} 不应出现在回执里`)
  }
  assert.equal(Object.values(bare).every((value) => value !== undefined), true)
  assert.deepEqual(JSON.parse(JSON.stringify(bare)), bare)

  // height 显式值时原样回给模型（实际高度由客户端按内容自适应收敛）。
  const sized = await tool.execute({ title: '各省订单量', html: '<svg></svg>', height: 600, caption: '口径：示例' })
  assert.equal(sized.ok, true)
  assert.equal(sized.height, 600)

  // 拒绝一路：不抛异常，回执里带 code 与可执行的下一步
  const rejected = await tool.execute({ title: '', html: '<svg></svg>' })
  assert.equal(rejected.ok, false)
  assert.equal(rejected.code, 'vr/invalid-title')
  assert.match(rejected.hint, /title/)

  assert.equal(Object.values(rejected).every((value) => value !== undefined), true)
  assert.deepEqual(JSON.parse(JSON.stringify(rejected)), rejected)

  const renderedRejected = tool.output.render({}, rejected)
  assert.equal(renderedRejected[0].text.startsWith('可视化未渲染：'), true)

  // 系统提示段
  assert.equal(sections.length, 1)
  assert.equal(sections[0].name, 'tool:visual-reply')
  assert.equal(sections[0].order, 3050)
  assert.equal(sections[0].text.includes('visual_render'), true)

  // 随插件落地的技能
  const skillFile = path.join(fakeHome, 'skills', 'visual-reply', 'SKILL.md')
  assert.equal(existsSync(skillFile), true)
  assert.equal(readFileSync(skillFile, 'utf8').includes('visual_render'), true)
}

// ── 未知键 / 无键表：order 仍然是有限数（曾因此整行挂载失败）─────────────
{
  const { ctx, sections } = makeCtx()
  const original = ctx.get
  ctx.get = (name) => {
    if (name !== 'systemPrompt') return original(name)
    return {
      section(definition) {
        sections.push(definition)
        return () => {}
      },
      // 表里没有我们的键，也不给兜底值
      getSectionOrder() {
        return undefined
      },
    }
  }
  await apply(ctx, { enabled: true })
  assert.equal(sections.length, 1)
  assert.equal(Number.isFinite(sections[0].order), true)
  assert.equal(sections[0].order, 3050)
}

// ── disabled: nothing registers, skill still installs ──────────────────────
{
  const { ctx, tools, sections } = makeCtx()
  await apply(ctx, { enabled: false })
  assert.equal(tools.length, 0)
  assert.equal(sections.length, 0)
}

// ── loader missing: register the plain definition instead of failing ───────
{
  const { ctx, tools } = makeCtx({ noLoader: true })
  await apply(ctx, { enabled: true })
  assert.equal(tools.length, 1)
  assert.equal(tools[0].name, 'visual_render')
}

// ── archive: writes into our own state dir ─────────────────────────────────
{
  const { ctx, tools } = makeCtx()
  await apply(ctx, { enabled: true, archive: true })
  const result = await tools[0].execute({ title: '归档测试', html: '<svg></svg>' })
  assert.equal(result.ok, true)
  assert.equal(typeof result.archived, 'string')
  assert.equal(existsSync(result.archived), true)
  assert.equal(readFileSync(result.archived, 'utf8').includes('<svg></svg>'), true)
}

// ── config clamps ──────────────────────────────────────────────────────────
{
  const { ctx, tools } = makeCtx()
  await apply(ctx, { enabled: true, maxHtmlBytes: 1, defaultHeight: 9999 })
  // maxHtmlBytes 被夹到下限 4096，所以用超长片段触发拒绝。
  const tooBig = await tools[0].execute({ title: 't', html: `<svg></svg>${'x'.repeat(5000)}` })
  assert.equal(tooBig.ok, false)
  assert.equal(tooBig.code, 'vr/too-large')
  // defaultHeight 9999 被夹到上限 1024，仍照常渲染。
  const tall = await tools[0].execute({ title: 't', html: '<svg></svg>' })
  assert.equal(tall.ok, true)
  assert.equal(tall.height, 1024)
  // 模型显式给 99999 也夹到 1024；给 1 夹到下限 240。
  const explicitTall = await tools[0].execute({ title: 't', html: '<svg></svg>', height: 99999 })
  assert.equal(explicitTall.height, 1024)
  const explicitShort = await tools[0].execute({ title: 't', html: '<svg></svg>', height: 1 })
  assert.equal(explicitShort.height, 240)
}

// ── 本地 ECharts 路由：注册 exact 路由，且真的回一份能用的脚本 ──────────
{
  const { ctx } = makeCtx()
  const routes = []
  const originalGet = ctx.get.bind(ctx)
  ctx.get = (name) => (name === 'webServer'
    ? { register(route) { routes.push(route); return () => {} } }
    : originalGet(name))
  await apply(ctx, { enabled: true })

  assert.equal(routes.length, 1, '应只注册一条路由')
  assert.equal(routes[0].kind, 'exact')
  assert.equal(routes[0].path, ECHARTS_ROUTE)

  const response = await routes[0].resource({ method: 'GET' })
  assert.equal(response.status, 200)
  const body = Buffer.from(await response.arrayBuffer())
  assert.equal(body.length > 900000, true, '应回出体量对得上的本地 ECharts')
  assert.equal(body.subarray(0, 400).toString('utf8').includes('Licensed to the Apache'), true)
  assert.equal(String(response.headers.get('content-type')).startsWith('text/javascript'), true)

  // HEAD 不给 body；非 GET/HEAD 明确 405，免得被当成动态路由。
  const head = await routes[0].resource({ method: 'HEAD' })
  assert.equal(head.status, 200)
  assert.equal(await head.text(), '')
  assert.equal((await routes[0].resource({ method: 'POST' })).status, 405)
}

rmSync(fakeHome, { recursive: true, force: true })
console.log('integration.test.js: ok')
