/**
 * Client half: slot contract + Figure behaviour, with no browser and no real
 * React. A tiny stateful fake React renders components twice so interaction
 * (collapse/expand, height/status messages, fullscreen) can be asserted; the
 * factory is loaded inside a `new Function` sandbox supplying browser globals.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { runtimeSource as libRuntimeSource } from '../lib/srcdoc.js'

/** Captured `window.__ModuleLoader__.load` definition. */
let loaded

/**
 * Build a stateful fake React: hook slots survive re-renders, effects are
 * recorded so the test can run them by hand.
 * @returns {any} the fake React plus test helpers.
 */
function makeReact() {
  const slots = []
  const effects = []
  const refs = []
  let cursor = 0

  const api = {
    useState(init) {
      const i = cursor++
      if (!(i in slots)) slots[i] = typeof init === 'function' ? init() : init
      return [
        slots[i],
        (next) => {
          slots[i] = typeof next === 'function' ? next(slots[i]) : next
        },
      ]
    },
    useRef(init) {
      const i = cursor++
      if (!(i in slots)) slots[i] = { current: init }
      return slots[i]
    },
    useEffect(fn) {
      cursor++
      effects.push(fn)
    },
    useMemo(fn) {
      const i = cursor++
      if (!(i in slots)) slots[i] = fn()
      return slots[i]
    },
    createElement(type, props, ...children) {
      const element = {
        type,
        props: props ?? {},
        children: children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false),
      }
      if (props !== null && typeof props === 'object' && props.ref) refs.push({ element, ref: props.ref })
      return element
    },
  }

  return {
    api,
    effects,
    refs,
    reset() {
      cursor = 0
      effects.length = 0
      refs.length = 0
    },
    hardReset() {
      slots.length = 0
      cursor = 0
      effects.length = 0
      refs.length = 0
    },
  }
}

/**
 * Depth-first search over the fake element tree.
 * @param {any} node - element, string or number.
 * @param {(node: any) => boolean} predicate - matcher.
 * @returns {any[]} matches.
 */
function findAll(node, predicate) {
  const out = []
  const visit = (current) => {
    if (current === null || typeof current !== 'object') {
      if (predicate(current)) out.push(current)
      return
    }
    if (predicate(current)) out.push(current)
    for (const child of current.children ?? []) visit(child)
  }
  visit(node)
  return out
}

/** Collect the text of every string leaf. */
function textOf(node) {
  return findAll(node, (n) => typeof n === 'string').join(' ')
}

/** Button labels inside a tree. */
function buttonLabels(node) {
  return findAll(node, (n) => n?.type === 'button').map((b) => b.children?.[0]).filter((x) => typeof x === 'string')
}

// ── sandbox: globals a browser would provide ───────────────────────────────
const listeners = []
const window = {
  __ModuleLoader__: {
    load(definition) {
      loaded = definition
    },
  },
  addEventListener(type, listener) {
    listeners.push({ type, listener })
  },
  removeEventListener(type, listener) {
    const i = listeners.findIndex((entry) => entry.type === type && entry.listener === listener)
    if (i >= 0) listeners.splice(i, 1)
  },
}
const document = {
  documentElement: { lang: 'zh' },
  head: { appendChild() {} },
  body: { appendChild() {} },
  createElement() {
    return {
      setAttribute() {},
      remove() {},
      click() {},
      style: {},
      textContent: '',
    }
  },
  execCommand() {
    return true
  },
}

const code = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
// eslint-disable-next-line no-new-func
const load = new Function('window', 'document', 'navigator', 'console', code)
load(window, document, { clipboard: undefined }, console)

assert.ok(loaded, 'client.js 没有调用 __ModuleLoader__.load')
assert.equal(loaded.id, 'dsh-visual-reply')

const fake = makeReact()
const requireStub = (id) => {
  if (id === 'react') return fake.api
  if (id === 'react-dom') return { createPortal: null }
  throw new Error(`unexpected require(${id})`)
}
// 模块表外壳会挂一条包资产通道：模拟出来，好验取库候选顺序。
requireStub.asset = () => '/plugins/dsh-visual-reply/assets/echarts.min.js'
const moduleExports = loaded.factory(requireStub)
const internals = moduleExports.__internals
assert.ok(internals, 'factory 没有暴露 __internals（仅供测试）')

const t = (key) => key

/**
 * 干净状态渲染 Figure。
 * @param {any} card - cardOf() 的结果。
 * @returns {any} 元素树。
 */
function renderFigure(card) {
  fake.hardReset()
  return internals.Figure({ card, t, variant: 'tail' })
}

/**
 * 保留 hook 状态再渲染 Figure（模拟交互后的重渲染）。
 * @param {any} card - cardOf() 的结果。
 * @returns {any} 元素树。
 */
function rerenderFigure(card) {
  fake.reset()
  return internals.Figure({ card, t, variant: 'tail' })
}

/** 跑一遍当前记录的副作用（注册监听、订阅主题等）。 */
function runEffects() {
  const cleanups = []
  for (const effect of fake.effects) {
    const cleanup = effect()
    if (typeof cleanup === 'function') cleanups.push(cleanup)
  }
  return cleanups
}

/** 向所有已注册的 message 监听器派发一条消息。 */
function emit(data, source) {
  for (const entry of listeners) {
    if (entry.type === 'message') entry.listener({ data, source })
  }
}

/** 给指定 iframe 元素挂上 contentWindow，并返回它。 */
function attachFrame(tree) {
  const frame = findAll(tree, (n) => n?.type === 'iframe')[0]
  assert.ok(frame, '找不到 iframe')
  const refEntry = fake.refs.find((entry) => entry.element === frame)
  assert.ok(refEntry, 'iframe 没有 ref')
  const contentWindow = {}
  refEntry.ref.current = { contentWindow }
  return { frame, contentWindow }
}

/** 取 srcDoc 里的 nonce。 */
function nonceOf(frame) {
  const match = /var ID="([^"]*)"/.exec(frame.props.srcDoc)
  assert.ok(match, 'srcDoc 没有 ID')
  return match[1]
}

/** 渲染 Figure 元素并返回它真正画出的树。 */
function materializeFigure(element) {
  fake.hardReset()
  return internals.Figure(element.props)
}

const sampleCard = (overrides = {}) => internals.cardOf({
  title: '各省订单量',
  html: '<svg></svg>',
  height: 320,
  caption: '口径：示例',
  source: 'etl_dws.dws_order',
  window: '2026-10',
  assumptions: ['含退单'],
  sample: true,
  ...overrides,
}, 'call-1', 1)

// ── 1. slot 注册契约 ──────────────────────────────────────────────────────
{
  const registered = []
  const injected = []
  const ctx = {
    effect(fn) {
      fn()
      return () => {}
    },
    locale: { register() {}, bind: () => (key) => `t:${key}` },
    slots: {
      inject(name, fn) {
        injected.push(name)
        if (name === 'tool.call.toolview') fn()
      },
      register(definition, component) {
        registered.push({ definition, component })
        return () => {}
      },
    },
  }
  moduleExports.apply(ctx)
  assert.deepEqual(injected, ['tool.call.toolview'], '没有 uiConversation 时只挂工具卡')
  assert.equal(registered.length, 1)
  assert.equal(registered[0].definition.name, 'tool.call.toolview')
  assert.equal(registered[0].definition.key, 'visual_render')
  assert.equal(registered[0].definition.locale, 'visual-reply')
  assert.equal(typeof registered[0].component, 'function')
}

// ── 2. 轮末槽与事件投影：投影注册成功才挂 turnTail ───────────────────────
{
  const registered = []
  const injected = []
  const projections = []
  const ctx = {
    effect(fn) {
      fn()
      return () => {}
    },
    locale: { register() {}, bind: () => (key) => `t:${key}` },
    get(name) {
      if (name === 'uiConversation') {
        return { events: { register: (definition) => projections.push(definition) } }
      }
      return undefined
    },
    slots: {
      inject(name, fn) {
        injected.push(name)
        fn()
      },
      register(definition, component) {
        registered.push({ definition, component })
        return () => {}
      },
    },
  }
  moduleExports.apply(ctx)
  assert.equal(projections.length, 1, '应注册一个事件投影')
  assert.equal(projections[0].kind, internals.VISUALS_KIND)
  assert.equal(injected.includes('conversation.chat.turnTail'), true)
  assert.equal(registered.length, 2)
  assert.equal(registered[1].definition.name, 'conversation.chat.turnTail')
  assert.equal(registered[1].definition.id, 'dsh-visual-reply')
}

// ── 2b. 会话 UI 晚到：软依赖等到再挂，不抢先放弃 ─────────────────────────
{
  const registered = []
  const injected = []
  const projections = []
  const pending = []
  const ctx = {
    effect(fn) {
      fn()
      return () => {}
    },
    locale: { register() {}, bind: () => (key) => `t:${key}` },
    inject(deps, callback) {
      pending.push({ deps, callback })
    },
    get() {
      return undefined // 此刻 uiConversation 还没就绪
    },
    slots: {
      inject(name, fn) {
        injected.push(name)
        fn()
      },
      register(definition, component) {
        registered.push({ definition, component })
        return () => {}
      },
    },
  }
  moduleExports.apply(ctx)
  assert.deepEqual(pending[0]?.deps, ['uiConversation'], '应以软依赖等会话 UI')
  assert.equal(projections.length, 0, '没到齐之前不许注册投影')
  assert.deepEqual(injected, ['tool.call.toolview'], '先只有工具卡，图仍可见')
  pending[0].callback({
    uiConversation: { events: { register: (definition) => projections.push(definition) } },
  })
  assert.equal(projections.length, 1, '会话 UI 到了就补挂投影')
  assert.equal(injected.includes('conversation.chat.turnTail'), true)
  assert.equal(registered.at(-1).definition.name, 'conversation.chat.turnTail')
}


{
  const card = internals.cardOf({ title: ' 结论 ', html: '<svg></svg>', height: 99999 }, 'c', 1)
  assert.equal(card.title, '结论')
  assert.equal(card.maxHeight, 1024)
  assert.equal(card.height, 1024)
  assert.equal(card.sample, false)
  assert.equal(internals.cardOf({ title: 't', html: '<svg></svg>', height: 10 }, 'c', 1).maxHeight, 240)
  assert.equal(internals.cardOf({ title: 't', html: '<svg></svg>', wide: true }, 'c', 1).maxHeight, 1024)
  const rich = internals.cardOf({
    title: 't',
    html: '<svg></svg>',
    source: ' db.t ',
    window: ' 2026.10 ',
    sample: true,
    assumptions: [' a ', '', 'b', 'c', 'd', 'e', 'f'],
  }, 'c', 1)
  assert.equal(rich.source, 'db.t')
  assert.equal(rich.window, '2026.10')
  assert.equal(rich.sample, true)
  assert.equal(rich.assumptions.length, 5, 'assumptions 最多 5 条')
  assert.equal(internals.cardOf({ title: '', html: '<svg></svg>' }, 'c', 1), null)
}

// ── 4. captionOf：caption + 来源 + 时间窗 + 假设，带英文标签也成立 ────────
{
  const card = sampleCard()
  const text = internals.captionOf(card)
  assert.equal(text.includes('口径：示例'), true)
  assert.equal(text.includes('来源：etl_dws.dws_order'), true)
  assert.equal(text.includes('时间窗：2026-10'), true)
  assert.equal(text.includes('假设：含退单'), true)
  const en = internals.captionOf(card, { source: 'Source', window: 'Window', assumptions: 'Assumptions' })
  assert.equal(en.includes('Source：etl_dws.dws_order'), true)
  assert.equal(en.includes('Window：2026-10'), true)
  assert.equal(internals.captionOf(null), '')
}

// ── 5. Figure 首帧：薄容器、标题、骨架、操作条、无徽标 ───────────────────
{
  const card = sampleCard()
  const tree = renderFigure(card)
  const frames = findAll(tree, (n) => n?.type === 'iframe')
  assert.equal(frames.length, 1)
  assert.equal(frames[0].props.sandbox, 'allow-scripts')
  assert.equal(frames[0].props.style.height, '320px')
  assert.equal(frames[0].props.srcDoc.includes(internals.CSP_POLICY), true)
  assert.equal(frames[0].props.srcDoc.includes('<svg></svg>'), true)
  assert.equal(textOf(tree).includes('各省订单量'), true)
  assert.equal(textOf(tree).includes('口径：示例'), true)
  assert.equal(textOf(tree).includes('sampleData'), true, '示例数据 chip 用词典文案')
  // 薄容器：没有 badge、没有卡片外框 class；操作条 hover 才出现。
  assert.equal(findAll(tree, (n) => n?.props?.className === 'vr-badge').length, 0)
  assert.equal(findAll(tree, (n) => n?.props?.className === 'vr-figure-title').length, 1)
  assert.equal(findAll(tree, (n) => n?.props?.className === 'vr-loading').length, 1)
  assert.equal(internals.CSS.includes('.vr-loading{position:absolute'), true)
  assert.equal(/\.vr-figure:hover \.vr-toolbar/.test(internals.CSS), true)
  // 常驻两枚 + ⋯ 菜单里的动作。
  const labels = buttonLabels(tree)
  assert.equal(labels.includes('copyImage'), true)
  assert.equal(labels.includes('fullscreen'), true)
  assert.equal(labels.includes('downloadPng'), true)
  assert.equal(labels.includes('downloadPdf'), true, '菜单要有 PDF 导出')
  assert.equal(labels.includes('downloadHtml'), true)
  assert.equal(labels.includes('copyData'), true)
  assert.equal(labels.includes('openWindow'), false, '新窗口已取消')
  assert.equal(labels.includes('source'), true)
  assert.equal(labels.includes('collapse'), true)
}

// ── 6. 高度消息：只认自己 iframe；上限夹取；超限出「展开」 ───────────────
{
  const card = sampleCard({ height: 480 })
  let tree = renderFigure(card)
  const { frame, contentWindow } = attachFrame(tree)
  const nonce = nonceOf(frame)
  runEffects()

  // 别的窗口发来的同形消息必须被忽略。
  emit({ __vr: 'height', id: nonce, height: 900 }, {})
  tree = rerenderFigure(card)
  assert.equal(findAll(tree, (n) => n?.type === 'iframe')[0].props.style.height, '480px')

  emit({ __vr: 'height', id: nonce, height: 700 }, contentWindow)
  tree = rerenderFigure(card)
  assert.equal(findAll(tree, (n) => n?.type === 'iframe')[0].props.style.height, '480px', '超过上限按上限显示')
  assert.equal(buttonLabels(tree).includes('expand'), true, '超上限应给展开按钮')

  // 小图按内容收：量到内容之后不再被 240px 的占位高度撑住（底部留白）。
  const short = sampleCard({ height: 1024, html: '<svg></svg>' })
  let tree2 = renderFigure(short)
  const attached2 = attachFrame(tree2)
  const nonce2 = nonceOf(attached2.frame)
  runEffects()
  emit({ __vr: 'height', id: nonce2, height: 100 }, attached2.contentWindow)
  tree2 = rerenderFigure(short)
  assert.equal(findAll(tree2, (n) => n?.type === 'iframe')[0].props.style.height, '100px', '短图按内容收，不留 240px 空白')
  emit({ __vr: 'height', id: nonce2, height: 512 }, attached2.contentWindow)
  tree2 = rerenderFigure(short)
  assert.equal(findAll(tree2, (n) => n?.type === 'iframe')[0].props.style.height, '512px')
}

// ── 7. 失败态：空白 / 脚本错误 / CSP 拦截都有可读提示与兜底 ──────────────
{
  const card = sampleCard()
  let tree = renderFigure(card)
  const { frame, contentWindow } = attachFrame(tree)
  const nonce = nonceOf(frame)
  runEffects()
  emit({ __vr: 'blank', id: nonce }, contentWindow)
  tree = rerenderFigure(card)
  assert.equal(textOf(tree).includes('blankFigure'), true)

  const card2 = sampleCard({ callId: 'call-2' })
  let tree2 = renderFigure(card2)
  const attached2 = attachFrame(tree2)
  const nonce2 = nonceOf(attached2.frame)
  runEffects()
  emit({ __vr: 'error', id: nonce2, message: 'boom' }, attached2.contentWindow)
  tree2 = rerenderFigure(card2)
  assert.equal(textOf(tree2).includes('scriptError'), true)
  assert.equal(textOf(tree2).includes('boom'), true)

  const card3 = sampleCard({ callId: 'call-3' })
  let tree3 = renderFigure(card3)
  const attached3 = attachFrame(tree3)
  const nonce3 = nonceOf(attached3.frame)
  runEffects()
  emit({ __vr: 'csp', id: nonce3, blocked: 'inline', directive: 'script-src' }, attached3.contentWindow)
  tree3 = rerenderFigure(card3)
  assert.equal(textOf(tree3).includes('cspBlocked'), true)
  assert.equal(textOf(tree3).includes('script-src'), true)

  // 图元点击：runtime 的 window.vrPick → 父级出一枚「追问」chip（点击复制成一句追问）。
  const card4 = sampleCard({ callId: 'call-4' })
  let tree4 = renderFigure(card4)
  const attached4 = attachFrame(tree4)
  const nonce4 = nonceOf(attached4.frame)
  runEffects()
  emit({ __vr: 'pick', id: nonce4, payload: '2026 Q3' }, attached4.contentWindow)
  tree4 = rerenderFigure(card4)
  assert.equal(textOf(tree4).includes('followupPrefix'), true)
  assert.equal(textOf(tree4).includes('2026 Q3'), true)
}

// ── 8. 收起可逆：收起后只剩展开按钮，再展开图回来 ────────────────────────
{
  const card = sampleCard()
  let tree = renderFigure(card)
  const collapse = findAll(tree, (n) => n?.type === 'button' && n.children?.[0] === 'collapse')[0]
  assert.ok(collapse, '找不到收起按钮')
  collapse.props.onClick()
  tree = rerenderFigure(card)
  assert.equal(findAll(tree, (n) => n?.type === 'iframe').length, 0)
  assert.equal(textOf(tree).includes('collapsedHint'), true)
  const expand = findAll(tree, (n) => n?.type === 'button' && n.children?.[0] === 'expand')[0]
  assert.ok(expand, '收起后必须有展开按钮')
  expand.props.onClick()
  tree = rerenderFigure(card)
  assert.equal(findAll(tree, (n) => n?.type === 'iframe').length, 1)
}

// ── 9. 全屏：绝对定位填满，Esc 可关 ──────────────────────────────────────
{
  const card = sampleCard()
  let tree = renderFigure(card)
  const fullscreen = findAll(tree, (n) => n?.type === 'button' && n.children?.[0] === 'fullscreen')[0]
  assert.ok(fullscreen, '找不到全屏按钮')
  fullscreen.props.onClick()
  tree = rerenderFigure(card)
  const overlayFrames = findAll(tree, (n) => n?.type === 'iframe' && typeof n.props.className === 'string' && n.props.className.includes('vr-overlay-frame'))
  assert.equal(overlayFrames.length, 1)
  assert.equal(overlayFrames[0].props.style.position, 'absolute')
  assert.equal(overlayFrames[0].props.style.height, '100%')
  assert.equal(buttonLabels(tree).includes('exitFullscreen'), true)
  // 放大视图是新建的 iframe：加载完必须把当前色板推进去，否则会沿用旧主题。
  assert.equal(typeof overlayFrames[0].props.onLoad, 'function')
  const overlayRef = fake.refs.find((entry) => entry.element === overlayFrames[0])
  assert.ok(overlayRef, '放大 iframe 没有 ref')
  const posted = []
  overlayRef.ref.current = { contentWindow: { postMessage: (message) => posted.push(message) } }
  overlayFrames[0].props.onLoad()
  assert.equal(posted.length >= 1, true, '放大 iframe onLoad 应推一次主题')
  assert.equal(posted[0].__vr, 'theme')
  assert.equal(typeof posted[0].palette, 'object')
  runEffects()
  const keydown = listeners.find((entry) => entry.type === 'keydown')
  assert.ok(keydown, '全屏应注册 Esc 监听')
}

// ── 10. 工具卡：解析失败、拒绝、回执异常、轮末注脚 ───────────────────────
{
  fake.hardReset()
  const broken = internals.VisualCard({ t, block: { phase: 'start', argsRaw: '{not json' } })
  assert.equal(findAll(broken, (n) => n?.type === 'iframe').length, 0)
  assert.equal(textOf(broken).includes('parseFailed'), true)
  assert.equal(findAll(broken, (n) => n?.type === 'pre').length >= 1, true)

  const rejected = internals.VisualCard({
    t,
    callId: 'call-r',
    block: {
      kind: 'tool-call',
      call: { argsRaw: JSON.stringify({ title: '被拒', html: '<svg></svg>' }) },
      content: [{ type: 'text', text: '可视化未渲染：vr/forbidden-tag：不允许出现 <iframe>。这里是气泡内。' }],
      isError: false,
    },
  })
  assert.equal(findAll(rejected, (n) => n?.type === 'iframe').length, 0)
  assert.equal(textOf(rejected).includes('vr/forbidden-tag'), false)
  assert.equal(textOf(rejected).includes('rejectedPrefix'), true)
  assert.deepEqual(buttonLabels(rejected), ['source'], '拒绝时只剩查看源码')

  const withFigure = internals.VisualCard({
    t,
    callId: 'call-ok',
    block: {
      kind: 'tool-call',
      call: { argsRaw: JSON.stringify({ title: '正常', html: '<svg></svg>' }) },
      content: [],
      isError: true,
      error: { message: 'value is not lossless JSON' },
    },
  })
  assert.equal(findAll(withFigure, (n) => n?.type === internals.Figure).length, 1)
  assert.equal(textOf(withFigure).includes('receiptError'), true)
  assert.equal(textOf(withFigure).includes('value is not lossless JSON'), true)

  internals.markTailRendered([{ callId: 'call-t' }])
  fake.hardReset()
  const compact = internals.VisualCard({
    t,
    callId: 'call-t',
    block: { phase: 'start', argsRaw: JSON.stringify({ title: '轮末图', html: '<svg></svg>' }) },
  })
  assert.equal(findAll(compact, (n) => n?.type === internals.CompactRow).length, 1)
  // 只登记了这一张：别的卡照旧画全图，轮末投影失灵时不至于丢图。
  fake.hardReset()
  const other = internals.VisualCard({
    t,
    callId: 'call-other',
    block: { phase: 'start', argsRaw: JSON.stringify({ title: '过程区图', html: '<svg></svg>' }) },
  })
  assert.equal(findAll(other, (n) => n?.type === internals.Figure).length, 1)
  internals.resetTailRendered()
}

// ── 11. 轮末注脚：标题可点、保留源码兜底 ─────────────────────────────
{
  const card = sampleCard()
  fake.hardReset()
  const row = internals.CompactRow({ card, t, srcdoc: '<html></html>', html: card.html })
  assert.equal(textOf(row).includes('各省订单量'), true)
  assert.equal(textOf(row).includes('atTurnEnd'), true)
  assert.deepEqual(buttonLabels(row), ['各省订单量', 'source'])
  const titleButton = findAll(row, (n) => n?.type === 'button' && n.children?.[0] === '各省订单量')[0]
  assert.ok(titleButton)
  titleButton.props.onClick() // 测试环境没有 getElementById：不得抛
}

// ── 12. 轮末槽：有图才渲染、Figure 逐张画、提交后登记 ────────────────────
{
  const card = sampleCard()
  fake.hardReset()
  internals.resetTailRendered()
  const tree = internals.VisualsTail({ turn: { data: { get: () => ({ cards: [card] }) } } })
  assert.equal(findAll(tree, (n) => n?.type === internals.Figure).length, 1)
  const id = findAll(tree, (n) => typeof n?.props?.id === 'string' && n.props.id.startsWith('vr-fig-'))[0]
  assert.equal(id.props.id, 'vr-fig-call-1')
  // 渲染期不许写登记（React 渲染副作用）；提交后 effect 才登记。
  assert.equal(internals.tailRenderedIds().length, 0)
  runEffects()
  assert.deepEqual(internals.tailRenderedIds(), ['call-1'])
  assert.equal(internals.VisualsTail({ turn: { data: { get: () => undefined } } }), null)
  assert.equal(internals.VisualsTail({}), null)
  internals.resetTailRendered()
}

// ── 12b. 冷加载顺序：工具卡先画图，轮末提交后自动收敛成注脚 ──────────────
{
  fake.hardReset()
  internals.resetTailRendered()
  const block = { phase: 'start', argsRaw: JSON.stringify({ title: '冷加载', html: '<svg></svg>' }) }
  // 1) 首帧：过程区先渲染，此时还不知道轮末会出图。
  const before = internals.VisualCard({ t, callId: 'call-cold', block })
  assert.equal(findAll(before, (n) => n?.type === internals.Figure).length, 1)
  runEffects() // 工具卡订阅「轮末已出图」的变化
  // 2) 轮末随后提交：登记这一张，并通知订阅者。
  fake.reset()
  const coldCard = internals.cardOf({ title: '冷加载', html: '<svg></svg>' }, 'call-cold', 1)
  internals.VisualsTail({ turn: { data: { get: () => ({ cards: [coldCard] }) } } })
  runEffects()
  assert.deepEqual(internals.tailRenderedIds(), ['call-cold'])
  // 3) 工具卡重渲染：见到登记在案，退成注脚——不靠父级再渲染一次。
  fake.reset()
  const after = internals.VisualCard({ t, callId: 'call-cold', block })
  assert.equal(findAll(after, (n) => n?.type === internals.CompactRow).length, 1)
  internals.resetTailRendered()
}


{
  const def = internals.visualsDefinition
  assert.equal(def.kind, internals.VISUALS_KIND)
  assert.deepEqual(def.match({ type: 'turn/start', data: { turn: 3 } }), { id: '3', role: 'start' })
  assert.deepEqual(def.match({ type: 'tool/call', data: { turn: 3, name: 'visual_render' } }), { id: '3', role: 'update' })
  assert.equal(def.match({ type: 'tool/call', data: { turn: 3, name: 'bash' } }), null)
  assert.equal(def.match(null), null)

  let state = def.start()
  const args = JSON.stringify({ title: '图一', html: '<svg></svg>', height: 300, caption: '口径', source: 'db.t' })
  const call = (callId, payload) => ({
    event: { type: 'tool/call', seq: 9, data: { turn: 3, callId, name: 'visual_render', arguments: payload } },
  })
  state = def.update({ state }, call('c1', args))
  assert.equal(state.cards.length, 1)
  assert.equal(state.cards[0].maxHeight, 300)
  assert.equal(state.cards[0].source, 'db.t')
  assert.equal(def.update({ state }, call('c1', args)).cards.length, 1)
  assert.equal(def.update({ state }, call('c2', '{oops')).cards.length, 1)

  const located = def.buildLocationData({ state }, 'turn', undefined)
  assert.equal(located?.kind, 'turn')
  assert.equal(located?.key, internals.VISUALS_KIND)
  assert.equal(located?.value.cards.length, 1)
  assert.equal(def.buildLocationData({ state: { turn: 1, cards: [] } }, 'turn', undefined), null)
  assert.equal(def.buildLocationData({ state }, 'session', undefined), null)
}

// ── 14. 取库候选与主题兜底 ───────────────────────────────────────────────
{
  const savedLocation = globalThis.location
  globalThis.location = { origin: 'http://127.0.0.1:50587' }
  try {
    const urls = internals.libraryCandidates()
    assert.equal(urls.length, 2)
    assert.equal(urls[0], 'http://127.0.0.1:50587/plugins/dsh-visual-reply/assets/echarts.min.js')
    assert.equal(urls[1], 'http://127.0.0.1:50587/dsh-visual-reply/echarts.min.js')
  } finally {
    if (savedLocation === undefined) delete globalThis.location
    else globalThis.location = savedLocation
  }
  assert.equal(internals.PALETTE_FALLBACK.accent, '#4176e6')
  assert.equal(internals.PALETTE_FALLBACK.onAccent, '#ffffff')
  assert.equal(internals.PALETTE_FALLBACK.series.length >= 6, true)
  // 深色主题下 brand-primary 是近白 neutral：必须夹回蓝色，否则白字白块。
  assert.equal(internals.accentFor('#ffffff', true), '#5686fe')
  assert.equal(internals.accentFor('#f9fafb', true), '#5686fe')
  assert.equal(internals.accentFor('#7aaaff', true), '#5686fe')
  assert.equal(internals.accentFor('#5686fe', true), '#5686fe')
  assert.equal(internals.accentFor('#0f1115', false), '#4176e6')
  assert.equal(internals.accentFor('#4176e6', false), '#4176e6')
  assert.equal(internals.onAccentFor('#5686fe'), '#ffffff')
  assert.equal(internals.onAccentFor('#fbbf24'), '#0f1115')
  assert.equal(internals.luminanceOf('#ffffff') > 0.9, true)
  assert.equal(internals.luminanceOf('not-a-color'), null)
  const fallback = internals.readPalette()
  assert.equal(fallback.fg, internals.PALETTE_FALLBACK.fg)
  assert.equal(fallback.onAccent, '#ffffff')
  assert.equal(fallback.series.length >= 6, true)
  assert.equal(internals.buildSrcdoc({ html: '<svg></svg>', nonce: 'x' }).includes('--vr-on-accent:#ffffff'), true)
  assert.equal(internals.buildSrcdoc({ html: '<svg></svg>', nonce: 'x' }).includes('--vr-series-1:#4176e6'), true)
  assert.equal(internals.runtimeSource('x1').includes('window.vrPick'), true)
}

// ── 15. CSP / CSS 改版不变量 ─────────────────────────────────────────────
{
  assert.equal(internals.CSP_POLICY.includes("script-src 'unsafe-inline' https://cdn.jsdelivr.net"), true)
  assert.equal(internals.CSP_POLICY.includes('connect-src \'none\''), true)
  assert.equal(internals.CSS.includes('.vr-toolbar{position:absolute'), true)
  assert.equal(internals.CSS.includes('.vr-figure:hover .vr-toolbar'), true)
  assert.equal(internals.CSS.includes('.vr-overlay-body{position:relative'), true)
  // 放大视图固定大小；图体有自己的 surface 底色；不再有「新窗口」相关文案。
  assert.equal(/\.vr-overlay-card\{[^}]*width:min\(1080px,92vw\)/.test(internals.CSS), true)
  assert.equal(/\.vr-overlay-card\{[^}]*height:min\(760px,86vh\)/.test(internals.CSS), true)
  assert.equal(internals.CSS.includes('.vr-frame-wrap{position:relative;width:100%;overflow:hidden;border-radius:8px;'), true)
  assert.equal(internals.CSS.includes('background:var(--dsw-alias-bg-layer-1,#fff)}'), true)
  assert.equal(internals.zh.openWindow === undefined, true)
  // 导出 PNG 前会把 CSS 变量与计算样式逐元素内联，避免 var() 在图片里失效变成黑白。
  const exported = internals.buildSrcdoc({ html: '<svg></svg>', nonce: 'x' })
  assert.equal(exported.includes('function themeVars'), true)
  assert.equal(exported.includes('function paintAttrs'), true)
  assert.equal(exported.includes('clone.setAttribute("style",theme)'), true)
  assert.equal(exported.includes('function echartsData'), true)
  assert.equal(exported.includes('data-vr-data'), true)
  assert.equal(internals.CSS.includes('.vr-caption{'), true)
  assert.equal(internals.CSS.includes('.vr-badge'), false, '徽标已移除')
}


// ── 16. 导出：卡片合成 + PDF 包装 ────────────────────────────────────────
{
  // 折行：空格优先断词；比整行还宽的 token（CJK 长句）逐字断。
  const measure = (text) => text.length * 10
  assert.deepEqual(internals.wrapLines(measure, 'alpha beta', 200), ['alpha beta'])
  assert.deepEqual(internals.wrapLines(measure, 'alpha beta', 60), ['alpha', 'beta'])
  assert.deepEqual(internals.wrapLines(measure, '数据可视化测试', 40), ['数据可视', '化测试'])
  assert.deepEqual(internals.wrapLines(measure, '   ', 80), [])

  // PDF：单页、内嵌 JPEG、xref 偏移自洽，页面尺寸按 96dpi 换 pt。
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
  const pdf = internals.buildPdf(jpeg, 1600, 900)
  const text = new TextDecoder().decode(pdf)
  assert.equal(text.startsWith('%PDF-1.4'), true)
  assert.equal(text.includes('/Type /Catalog'), true)
  assert.equal(text.includes('/MediaBox [0 0 1200 675]'), true)
  assert.equal(text.includes('/Filter /DCTDecode'), true)
  assert.equal(text.includes('/Width 1600 /Height 900'), true)
  assert.equal(text.trimEnd().endsWith('%%EOF'), true)
  const startxref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)[1])
  assert.equal(text.slice(startxref, startxref + 4), 'xref')
  const entries = text.slice(startxref).split('\n')
  for (let id = 1; id <= 5; id += 1) {
    const offset = Number(entries[id + 2].slice(0, 10))
    assert.equal(text.slice(offset, offset + `${id} 0 obj`.length), `${id} 0 obj`, `对象 ${id} 的 xref 偏移`)
  }
  assert.equal(Buffer.from(pdf).indexOf(Buffer.from(jpeg)) > 0, true, 'JPEG 字节应原样进入流')

  // 运行时：canvas/svg 都取不到时退回 HTML 栅格化，而不是直接报「没有图」。
  const runtime = internals.runtimeSource('x1')
  assert.equal(runtime.includes('function htmlPng'), true)
  assert.equal(runtime.includes('foreignObject'), true)
  assert.equal(runtime.includes('xmlText'), true)
  assert.equal(runtime.includes('htmlPng(function(dataUrl,error){send('), true, 'exportPng 必须有 HTML 兜底')
  // 两份 runtime 必须逐字一致：lib/srcdoc.js 是同一份 builder 的镜像。
  assert.equal(runtime, libRuntimeSource('x1'), 'client.js 与 lib/srcdoc.js 的 runtime 不一致')

  // 词典：两种语言都要有 PDF 与导出失败文案。
  for (const dict of [internals.zh, internals.en]) {
    assert.equal(typeof dict.downloadPdf, 'string')
    assert.equal(typeof dict.exportFailed, 'string')
    assert.equal(typeof dict.downloadedPng, 'string')
  }
}

console.log('client.test.js: ok')
