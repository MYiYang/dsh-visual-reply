/**
 * dsh-visual-reply — host half.
 *
 * One model-facing tool (`visual_render`) plus one system-prompt section. The
 * tool does no drawing itself: it validates the fragment the model wrote,
 * optionally archives it, and hands a compact receipt back. The Client half
 * picks the `tool/call` args out of the session events and renders the card,
 * so a reload, a reconnect or a session replay all reproduce the figure
 * without the host holding any state.
 *
 * Why a tool instead of rewriting the Markdown renderer: the assistant-step
 * node is shipped UI (`replaceRisk: shadows-shipped-ui`), while a keyed
 * `tool.call.toolview` entry keyed by the wire name is the sanctioned seam for
 * a business-owned visual.
 *
 * @module dsh-visual-reply
 */

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { MAX_HEIGHT, MIN_HEIGHT, resolveConfig } from './lib/config.js'
import { systemPromptText } from './lib/prompt.js'
import { installBundledSkills, stateDir } from './lib/skill-install.js'
import { validateVisual } from './lib/validate.js'

export const name = 'visual-reply'

/**
 * Where the bundled ECharts build is served from.
 *
 * The Client half fetches this path (same origin, so the Web carrier's
 * authentication carries over), caches the text and inlines it into the
 * sandbox document. Nothing about a rendered figure then needs the network —
 * which is the whole point: a CDN outage used to leave a blank card.
 */
export const ECHARTS_ROUTE = '/dsh-visual-reply/echarts.min.js'

/**
 * Services this plugin needs. `loader` resolves the in-box `defineTool`
 * factory (a linked plugin has no node_modules of its own); `tools` is the
 * registry itself. `systemPrompt` is read optionally so a minimal composition
 * still mounts the tool.
 */
export const inject = ['tools', 'loader']

/**
 * Serve the bundled ECharts build to the Web shell.
 *
 * Registered as a `WebResourceRoute` so it answers with a plain `Response` and
 * no socket fiddling. The body is read once and kept in memory; the immutable
 * cache header makes every later card a browser-cache hit.
 *
 * A missing file is not fatal: the route answers 404, the Client half's fetch
 * fails, and the fragment keeps whatever `<script src>` the model wrote — the
 * CDN fallback stays intact for a stripped-down package.
 * @param {any} ctx - cordis plugin context.
 * @param {(level: string, message: string) => void} log - logger sink.
 * @returns {void}
 */
function serveEcharts(ctx, log, trail) {
  const file = fileURLToPath(new URL('./assets/echarts.min.js', import.meta.url))
  /** @type {Buffer | null} */
  let body = null
  const resource = async (request) => {
    const method = request?.method ?? 'GET'
    if (method !== 'GET' && method !== 'HEAD') {
      return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } })
    }
    if (body === null) {
      try {
        body = readFileSync(file)
      } catch {
        return new Response('echarts bundle not packaged', { status: 404 })
      }
    }
    return new Response(method === 'HEAD' ? null : body, {
      status: 200,
      headers: {
        'content-type': 'text/javascript; charset=utf-8',
        'cache-control': 'public, max-age=31536000, immutable',
      },
    })
  }
  const mount = (scope) => {
    const server = scope?.webServer ?? scope?.get?.('webServer')
    if (!server || typeof server.register !== 'function') {
      trail?.('no-webServer')
      log('warn', 'webServer unavailable; fragments keep the CDN fallback')
      return
    }
    try {
      scope.effect(
        () => server.register({ kind: 'exact', path: ECHARTS_ROUTE, resource }),
        'visual-reply: echarts asset',
      )
      trail?.('route-mounted', { route: ECHARTS_ROUTE })
      log('info', `local echarts served at ${ECHARTS_ROUTE}`)
    } catch (error) {
      trail?.('route-failed', { error: String(error) })
      log('warn', `echarts route registration failed (${String(error)}); CDN fallback stays`)
    }
  }
  // `webServer` 由 web-runtime 行提供，可能晚于本插件就绪：用软依赖等它，
  // 而不是在 apply 这一刻 `get` 一次就作罢——那正是先前一直 404 的根源。
  if (typeof ctx.inject === 'function') ctx.inject(['webServer'], mount)
  else mount(ctx)
}

/**
 * Load the in-box `defineTool` through the loader seam.
 *
 * It adds schema validation of model-generated arguments plus presentation
 * hooks. If the loader cannot provide it, the plain definition still
 * registers — one safety net degrades instead of the plugin breaking.
 * @param {any} ctx - cordis plugin context.
 * @param {(level: string, message: string) => void} log - logger sink.
 * @returns {Promise<(definition: any) => any>} the factory, or identity.
 */
async function loadDefineTool(ctx, log) {
  try {
    const pkg = await ctx.loader.import('@deepseek-ai/dsh-tools')
    const factory = pkg?.defineTool ?? pkg?.default?.defineTool
    if (typeof factory === 'function') return factory
    log('warn', 'loader import of @deepseek-ai/dsh-tools had no defineTool; registering without schema validation')
  } catch (error) {
    log('warn', `cannot import @deepseek-ai/dsh-tools (${String(error)}); registering without schema validation`)
  }
  return (definition) => definition
}

/**
 * Turn a title into a filesystem-safe slug.
 * @param {string} title - the card title.
 * @returns {string} a short slug.
 */
function slugOf(title) {
  const ascii = title
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return (ascii || 'visual').slice(0, 48)
}

/**
 * Write one archived copy of a rendered visual.
 * @param {{html: string, title: string, caption: string}} payload - validated payload.
 * @param {string} home - `$DSH_HOME` override from config (may be empty).
 * @param {(level: string, message: string) => void} log - logger sink.
 * @returns {string | null} the written path, or null.
 */
function archiveVisual(payload, home, log) {
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const dir = path.join(stateDir(home), 'visuals')
    mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `${stamp}-${slugOf(payload.title)}.html`)
    const doc = [
      '<!doctype html><html><head><meta charset="utf-8">',
      `<title>${payload.title.replace(/[<>&]/g, '')}</title>`,
      '</head><body>',
      payload.html,
      payload.caption ? `<p style="font:12px/1.6 system-ui;color:#646a73">${payload.caption}</p>` : '',
      '</body></html>',
    ].join('')
    writeFileSync(file, doc, 'utf8')
    return file
  } catch (error) {
    log('warn', `archive failed: ${String(error)}`)
    return null
  }
}

/**
 * Apply the plugin.
 * @param {any} ctx - cordis plugin context.
 * @param {Record<string, unknown>} [config] - loader row config.
 * @returns {Promise<void>}
 */
export async function apply(ctx, config = {}) {
  const log = (level, message) => {
    try {
      ctx.logger?.[level]?.(`visual-reply: ${message}`)
    } catch {
      /* logging must never throw */
    }
  }
  const cfg = resolveConfig(config)

  /**
   * 留一行启动痕迹：`$DSH_HOME/visual-reply/boot-trail.jsonl`。
   *
   * 排查「host 半侧到底有没有跑到这一步」时，日志往往拿不到，而这一步
   * 写盘最多几字节；写失败也只是少一行诊断，永不打断主流程。
   * @param {string} stage - 阶段名。
   * @param {Record<string, unknown>} [extra] - 附加字段。
   * @returns {void}
   */
  const trail = (stage, extra = {}) => {
    try {
      const dir = stateDir(cfg.dshHome)
      mkdirSync(dir, { recursive: true })
      appendFileSync(
        path.join(dir, 'boot-trail.jsonl'),
        `${JSON.stringify({ at: new Date().toISOString(), stage, ...extra })}\n`,
        'utf8',
      )
    } catch {
      /* 诊断不许影响主流程 */
    }
  }
  trail('apply', { enabled: cfg.enabled })

  // The skill ships with the plugin, and installing it is cheap and harmless,
  // so it happens even while the tool is switched off — reading the instructions
  // is how someone learns the feature exists.
  try {
    const installed = installBundledSkills(log, cfg.dshHome)
    if (installed.length > 0) log('info', `bundled skill(s) installed: ${installed.join(', ')}`)
  } catch (error) {
    log('warn', `bundled skill install failed: ${String(error)}`)
  }

  if (!cfg.enabled) {
    log('info', 'disabled by config; visual_render is not registered')
    return
  }

  serveEcharts(ctx, log, trail)

  const defineTool = await loadDefineTool(ctx, log)

  const tool = defineTool({
    name: 'visual_render',
    description: [
      '把一张图表/看板渲染进回复正文（对话里显示为可交互卡片）。',
      '需要图示时调用：数据趋势/占比/排名/多指标对比、过程与状态机讲解、结构关系、几何构造。',
      '`html` 只放 body 级片段：优先内联 SVG；要做 ECharts 交互图时只写容器与配置脚本，不要写外部 script 地址——本地 ECharts 由插件注入，离线可用。数据必须事先取好。',
      '禁止：html/head/body 文档结构、iframe、fetch/存储等联网 API、地图可视化、超过 40KB 的片段。',
      '优先用插件提供的 --vr-* 设计令牌（颜色/字号/线条），坐标轴要有名称与单位，分析类图必须给 `caption`（建议同时给 `source`）。',
      '一次调用只画一张图；`height` 是建议最大高度，实际高度按内容自适应；正文仍然要给结论和解读。',
    ].join(' '),
    parameters: {
      title: {
        type: 'string',
        required: true,
        description: '卡片标题，一句话结论（例：「各省订单量：华东占 41%」），不超过 120 字。',
      },
      html: {
        type: 'string',
        required: true,
        description: '可视化的 HTML 片段：内联 SVG / ECharts 容器加脚本 / 表格。不要包含 <html>/<head>/<body>。',
      },
      height: {
        type: 'integer',
        description: `建议最大高度，默认 ${cfg.defaultHeight}px，夹在 ${MIN_HEIGHT}–${MAX_HEIGHT} 之间；实际高度按内容自适应，超过上限时卡片提供展开。`,
      },
      caption: {
        type: 'string',
        description: '图下口径：数据来源、时间窗、假设；分析类图必填。',
      },
      source: {
        type: 'string',
        description: '数据来源（表名/文件/接口），例：etl_dws.dws_order。',
      },
      window: {
        type: 'string',
        description: '数据时间窗，例：2026-10-01~2026-10-31。',
      },
      sample: {
        type: 'boolean',
        description: '置 true 表示示例/合成数据，图下会标「示例数据」。',
      },
      assumptions: {
        type: 'array',
        items: { type: 'string' },
        description: '口径假设，最多 5 条、每条不超过 300 字。',
      },
      wide: {
        type: 'boolean',
        description: '宽图（时间线/宽表/多序列），建议最大高度放宽到 1024。',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          ok: { type: 'boolean' },
          title: { type: 'string' },
          bytes: { type: 'integer' },
          height: { type: 'integer' },
          caption: { type: 'string' },
          source: { type: 'string' },
          window: { type: 'string' },
          sample: { type: 'boolean' },
          assumptions: { type: 'array', items: { type: 'string' } },
          wide: { type: 'boolean' },
          warnings: { type: 'array' },
          scriptHosts: { type: 'array' },
          archived: { type: 'string' },
          hint: { type: 'string' },
        },
      },
      /**
       * What the model reads back. Deliberately short: the figure lives in the
       * card, so echoing the HTML would double the token cost for nothing.
       * @param {any} _args - raw arguments (unused).
       * @param {any} value - the execute() return value.
       * @returns {Array<{type: string, text: string}>} content blocks.
       */
      render: (_args, value) => {
        if (!value || value.ok !== true) {
          return [{ type: 'text', text: `可视化未渲染：${value?.hint ?? '参数不合法'}` }]
        }
        const lines = [`已渲染可视化「${value.title}」（${value.bytes} 字节，建议高度 ${value.height}px）。`]
        if (Array.isArray(value.warnings) && value.warnings.length > 0) {
          lines.push(`注意：${value.warnings.join('；')}`)
        }
        lines.push('正文继续给结论、口径与解读；不要再把 HTML 贴进回答。')
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    /**
     * Validate one fragment and answer with a receipt.
     * @param {any} args - model arguments.
     * @returns {Promise<Record<string, unknown>>} the receipt.
     */
    async execute(args) {
      const verdict = validateVisual(args, {
        maxHtmlBytes: cfg.maxHtmlBytes,
        defaultHeight: cfg.defaultHeight,
        allowedScriptHosts: cfg.allowedScriptHosts,
      })
      if (verdict.ok !== true) {
        // A rejection is a normal outcome the model can fix, so it answers
        // with the code, the reason and one concrete next step.
        return {
          ok: false,
          code: verdict.code,
          hint: `${verdict.code}：${verdict.message}。${verdict.hint}`,
        }
      }
      const archived = cfg.archive ? archiveVisual(verdict, cfg.dshHome, log) : null
      /** @type {Record<string, unknown>} */
      const receipt = {
        ok: true,
        title: verdict.title,
        bytes: verdict.bytes,
        height: verdict.height,
        caption: verdict.caption,
        warnings: verdict.warnings,
        scriptHosts: verdict.scriptHosts,
      }
      // Structured 口径 fields land in the receipt only when they carry a
      // value: the output schema is lossless-JSON-checked, and an empty string
      // or `false` told the model nothing it did not already know.
      if (typeof verdict.source === 'string' && verdict.source !== '') receipt.source = verdict.source
      if (typeof verdict.window === 'string' && verdict.window !== '') receipt.window = verdict.window
      if (verdict.sample === true) receipt.sample = true
      if (Array.isArray(verdict.assumptions) && verdict.assumptions.length > 0) {
        receipt.assumptions = verdict.assumptions
      }
      if (verdict.wide === true) receipt.wide = true
      // The tool executor demands lossless JSON: a present-but-undefined key
      // (the old `archived: archived ?? undefined`) is rejected outright, and
      // the whole call fails after the work is already done. Omit it instead.
      if (archived !== null && archived !== undefined) receipt.archived = archived
      return receipt
    },
  })

  ctx.effect(() => ctx.tools.register(tool), 'visual-reply: visual_render')

  const systemPrompt = ctx.get('systemPrompt')
  if (cfg.injectPrompt && systemPrompt?.section !== undefined) {
    // `getSectionOrder` only answers for the centrally owned key table, and an
    // unknown key resolves to undefined — which makes `section()` throw
    // ("order must be a finite number") and takes the whole row down with it.
    // Anchor on the last built-in tool section instead and step past it:
    // TOOL_COMPUTER_USE is 3000, MCP_SERVERS is 3100.
    let order = 3050
    try {
      const anchor = systemPrompt.getSectionOrder?.('TOOL_COMPUTER_USE')
      if (Number.isFinite(anchor)) order = anchor + 50
    } catch {
      /* a composition without the table keeps the literal default */
    }
    ctx.effect(
      () =>
        systemPrompt.section({
          name: 'tool:visual-reply',
          order,
          text: systemPromptText(),
        }),
      'visual-reply: systemPrompt',
    )
  }

  log('info', `ready (maxHtmlBytes=${cfg.maxHtmlBytes}, defaultHeight=${cfg.defaultHeight}, archive=${cfg.archive})`)
}
