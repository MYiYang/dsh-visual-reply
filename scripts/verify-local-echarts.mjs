#!/usr/bin/env node
/**
 * 验收脚本：确认「ECharts 本地化」在运行中的 DSH 里真的生效。
 *
 * 判据有三条，逐条打印：
 *   1. `assets/echarts.min.js` 在包里（本地文件）；
 *   2. Host 侧静态路由已注册——注意要分清三种状态：
 *        200 → 路由已挂且可匿名访问；
 *        401 → 路由已挂，但这层 Web 载体要求登录（说明 host 已重载）；
 *        404 → 路由没挂，插件还是旧的，需要重启 DSH；
 *   3. 客户端 bundle 里已经带上新逻辑（读 client.js 找标记字符串）。
 *
 * 用法：node scripts/verify-local-echarts.mjs [origin]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const origin = process.argv[2] ?? process.env.DSH_ORIGIN ?? 'http://127.0.0.1:50587'
const ROUTE = '/dsh-visual-reply/echarts.min.js'

let failures = 0

function line(label, ok, detail) {
  const mark = ok ? 'ok  ' : 'FAIL'
  if (!ok) failures += 1
  console.log(`${mark} ${label}${detail === undefined ? '' : ` — ${detail}`}`)
}

// 1. 本地资源
const vendor = path.join(root, 'assets', 'echarts.min.js')
let vendorOk = false
try {
  const size = statSync(vendor).size
  vendorOk = size > 900_000
  line('assets/echarts.min.js', vendorOk, `${size} 字节`)
} catch {
  line('assets/echarts.min.js', false, '文件缺失')
}

// 2. Host 路由
let routeState = 'unreachable'
try {
  const response = await fetch(origin + ROUTE, { method: 'GET' })
  if (response.ok) {
    const body = await response.arrayBuffer()
    routeState = 'live'
    line('Host 路由', true, `200，${body.byteLength} 字节`)
  } else if (response.status === 401 || response.status === 403) {
    routeState = 'live'
    line('Host 路由', true, `${response.status}（路由已挂，匿名请求需要登录——沙箱里同源请求会带上登录态）`)
  } else if (response.status === 404) {
    line('Host 路由', false, '404 —— 插件尚未重载，重启 DSH 后再跑一次')
  } else {
    line('Host 路由', false, `HTTP ${response.status}`)
  }
} catch (error) {
  line('Host 路由', false, `连不上 ${origin}（${String(error)}）`)
}

// 3. 客户端 bundle 的新逻辑
let clientOk = false
try {
  const source = readFileSync(path.join(root, 'client.js'), 'utf8')
  const marks = [
    ['本地库路由', 'ECHARTS_ROUTE'],
    ['取库函数', 'loadEcharts'],
    ['四路候选', 'libraryCandidates'],
    ['统一图体', 'function Figure'],
    ['图体主题', 'vr-theme'],
    ['操作收敛', 'copyImage'],
    ['口径行', 'captionOf'],
    ['高度上限', 'maxHeight'],
    ['轮末投影', 'visualsDefinition'],
    ['轮末槽位', 'conversation.chat.turnTail'],
    ['工具卡降级', 'tailReady'],
  ]
  const missing = marks.filter(([, token]) => !source.includes(token)).map(([name]) => name)
  clientOk = missing.length === 0
  line('client.js 新逻辑', clientOk, clientOk ? marks.map(([name]) => name).join('、') : `缺少 ${missing.join('、')}`)
} catch (error) {
  line('client.js 新逻辑', false, String(error))
}

// 4. Host 侧启动痕迹：能区分「没跑到」「没服务」「注册失败」
try {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  const trailPath = path.join(home, 'dsh-visual-reply', 'boot-trail.jsonl')
  const rows = readFileSync(trailPath, 'utf8').trim().split('\n').filter(Boolean).slice(-4)
  console.log('     boot-trail 最近几行：')
  for (const row of rows) console.log(`       ${row}`)
} catch {
  console.log('     boot-trail：尚未生成 —— host 侧这份新代码还没被加载过（要重启 DSH）')
}

// 5. 客户端诊断：noteDiag 会把痕迹写进 localStorage，Electron 落盘在 leveldb 里
try {
  const appData = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming')
  const lsDir = path.join(appData, '@deepseek-ai', 'dsh-desktop', 'Local Storage', 'leveldb')
  let trail = ''
  for (const name of readdirSync(lsDir)) {
    const raw = readFileSync(path.join(lsDir, name)).toString('latin1')
    const at = raw.indexOf('vr-diag')
    if (at < 0) continue
    const chunk = raw.slice(at, at + 160).replace(/[^ -~]/g, ' ').replace(/\s+/g, ' ').trim()
    if (chunk.length > trail.length) trail = chunk
  }
  line('客户端诊断（localStorage）', trail !== '', trail === '' ? '尚无 vr-diag 记录' : trail)
} catch (error) {
  line('客户端诊断（localStorage）', false, `读不到 leveldb：${String(error).slice(0, 80)}`)
}

console.log('')
if (failures === 0) {
  console.log('全部就绪：本地 ECharts、统一图体与轮末挂图都在运行中的 DSH 里生效了。')
} else {
  console.log(`还有 ${failures} 项没过；若只有 Host 路由一项是 404，重启 DSH 即可。`)
  process.exitCode = 1
}
