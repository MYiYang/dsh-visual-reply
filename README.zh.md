# dsh-visual-reply · 图文分析回复

让 DSH 的分析类回答**正文里长出图**：模型调一次 `visual_render`，图就以「薄容器」的样子落在本轮正文之后、动作行之前——标题 15px/500、图体无框透明、口径行贴在图下；鼠标移上去才出现【复制图片】【全屏】，其余动作收进 `⋯`。不再是甩一段 HTML 代码块，也不是一个像调试面板的工具卡。

这是对「图文分析回复」的复刻与一次 2026-11 设计改版：**技能管「该不该出图、怎么画」；客户端把图落进会话流；取数工具管「数据真不真」**——三者配合，图才不是装饰。

## 长什么样

```
助手：华东占 41%，华南同比 +18%，是唯一双升的区……（见下图）
┌──────────────────────────────────────────────┐
│ 各省订单量：华东占 41%                        │  ← 15px/500，结论式
│  ┌────────────────────────────────────────┐  │
│  │        （可交互的 ECharts / SVG 图）      │  │  ← 无框、同宽
│  └────────────────────────────────────────┘  │
│ 口径：2026-10 订单表，含退单 · 来源：etl_dws…  │  ← 12px，可带「示例数据」chip
└──────────────────────────────────────────────┘
助手：峰谷在……下一步建议……
```

常驻操作只有两枚（复制图片 / 全屏放大），其余在 `⋯`：复制数据、下载 PNG、下载 HTML、查看源码、收起。图太高时右下角出【展开】；放大是一个固定上限的对话框（1080×760 内），不再铺满整屏。

图体自带宿主 surface 底色（浅色白 / 深色 `#1b1d21`），不是透明浮在对话底上；复制/下载 PNG 时会把主题色与底色一起烧进图片，不再是黑白。

## 组成

| 半侧 | 文件 | 干什么 |
| --- | --- | --- |
| Host | `index.js` | 注册 `visual_render` 工具（9 个参数）+ 系统提示段；校验片段、可选归档 |
| Host | `lib/validate.js` | 纯函数策略：体积/文档结构/危险 API/脚本白名单/地图红线，外加 8 条设计质量 lint（只警告） |
| Host | `lib/prompt.js` | 「何时画、画成什么样」的系统提示：设计令牌、轴/单位、类别数、口径字段 |
| Client | `client.js` | 统一 `<Figure>` + `tool.call.toolview` + `conversation.chat.turnTail`：沙箱 iframe、hover 操作、主题热切换、失败三态 |
| 技能 | `skills/visual-reply/SKILL.md` | 何时出图、图型选择、令牌与模板、自检清单；随插件安装到 `$DSH_HOME/skills/` |
| 文档 | `docs/demo.html` | 由 `scripts/build-demo.mjs` 从 `lib/srcdoc.js` 生成，就是图 iframe 里那份文档，可离线预览 |

## 安装

需要 DeepSeek Harness `0.2.2-rc.1` 或更高版本。

从 npm 安装（推荐）：

```bash
dsh plugin --profile web add dsh-visual-reply
# 锁定版本：dsh plugin --profile web add dsh-visual-reply@0.2.0
```

本地开发（本仓库 checkout）：

```bash
dsh plugin --profile web add link:<绝对路径>
```

手工方式：在 `~/.dsh/profiles/web/package.json` 的 `dependencies` 加
`"dsh-visual-reply": "link:<绝对路径>"`（或 `"^0.2.0"`），并把包名加进 `dsh.profile.bundles`，然后重启 DSH。
装好后**刷新一次页面**，客户端半侧才会载入。

## 使用

直接要图即可，例如：

> 把这张表的月度趋势画出来，标出峰值和拐点，给我结论。

模型会先取数、再调 `visual_render`，然后写解读。也可以自己点名：

> 用 visual_render 画一张各省订单量条形图，caption 写清口径。

工具参数（模型侧）：

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `title` | 是 | 一句话结论，≤120 字 |
| `html` | 是 | body 级片段，优先内联 SVG；ECharts 只写容器与配置（本地库由插件注入） |
| `height` | 否 | **建议最大高度**，默认 480，夹在 240–1024；实际高度按内容自适应 |
| `caption` | 否 | 口径：数据来源、时间窗、假设；分析类图建议必填 |
| `source` | 否 | 数据来源（表/文件/接口），例：`etl_dws.dws_order` |
| `window` | 否 | 数据时间窗，例：`2026-10-01~2026-10-31` |
| `sample` | 否 | 示例/合成数据置 `true`，图下会标「示例数据」 |
| `assumptions` | 否 | 口径假设，≤5 条、每条 ≤300 字 |
| `wide` | 否 | 宽图（时间线/宽表/多序列） |

图会直接落在**本轮正文之后、动作行之前**——不塞进「已调用工具」的折叠里；工具调用处只留一行「图见本轮末尾」，点标题可滚到图。

## 安全边界

- 片段跑在 `iframe sandbox="allow-scripts"`（**不给** `allow-same-origin`）里，读不到宿主 cookie / localStorage / DOM；
- 片段自带 CSP：`default-src 'none'`、`connect-src 'none'`、`object-src/frame-src/form-action/base-uri 'none'`；脚本只放行内联与 `cdn.jsdelivr.net`（仅作本地库缺失时的兜底），不再用 `https:` 通配；
- ECharts 内置在客户端 bundle（gzip+base64，约 335 KB），渲染时用 `DecompressionStream` 解出即用，零网络；`assets/echarts.min.js` 留作可读原件，Host 静态路由与 CDN 作退路；
- 工具侧校验器直接拒绝：`<iframe>/<object>/<embed>/<form>/<base>`、`document.cookie`、`localStorage`、`fetch`、`XMLHttpRequest`、`WebSocket`、`window.top/parent`、`javascript:` URL、非白名单脚本域名、超过 `maxHtmlBytes` 的片段；
- 设计质量 lint 只警告不拦：无坐标轴名/单位、类别过多、颜色过多、高风险图型、双轴未命名、缺口径、示例数据未标注；
- 插件只写自己的状态目录：`$DSH_HOME/dsh-visual-reply/`（启动痕迹，超过 256KB 轮转；`archive: true` 时的片段副本）与 `$DSH_HOME/skills/visual-reply/`（随插件安装的技能）；不是自己装进去的 `SKILL.md` 一律不覆盖。除此不写用户内容。

## 配置

`~/.dsh/profiles/<profile>/cordis.patch.yml`（或 Settings → Plugins → 该 bundle）：

```yaml
- id: visual-reply
  config:
    enabled: true            # 总开关：关闭后工具不注册，历史卡片仍按通用卡片显示
    maxHtmlBytes: 204800     # 片段体积上限（字节）
    defaultHeight: 480       # 未给 height 时的建议最大高度（240–1024）
    allowedScriptHosts: ['cdn.jsdelivr.net']
    archive: false           # 是否落一份快照
    injectPrompt: true       # 是否注入「何时出图」系统提示
```

## 关闭与卸载

1. Settings → Plugins 关掉该 bundle（或 `enabled: false`）→ 工具不再注册；
2. `dsh plugin --profile web remove dsh-visual-reply`；
3. 删 `$DSH_HOME/skills/visual-reply`（如不再需要那份技能）。

历史会话不受影响：卡片从会话事件里的工具参数重建；插件移除后这些调用退化为通用「工具调用 · visual_render」一行。

## 测试

以下命令需在仓库 checkout 里跑——发布包刻意不带 `test/` 与 `scripts/`：

```bash
npm test          # validate / srcdoc / skill / skill-install / client / integration，六套
                  # docs/demo.html 与 lib/srcdoc.js 漂移也会失败

# 运行中的 DSH：路由 / 客户端 bundle / 启动痕迹
node scripts/verify-local-echarts.mjs http://127.0.0.1:58484
```

真 React 18 + jsdom 冒烟（轮末两张图、高度回传、全屏 Esc、注脚、拒绝态）由作者在包外单独维护。

## 已知限制

- iframe 需要宿主页面不设 `frame-src 'none'` 的 CSP；被拦时用「全屏」弹窗兜底；
- ECharts 已内置，断网可用；每张 ECharts 图会在自己的 iframe 里解析一份库，一轮多图时成本线性上升（后续再做懒挂载/小构建）；
- 换主题走 `postMessage` 热更新（不重建 srcdoc），但 ECharts 的 canvas 颜色需要模型在 `vr-theme` 事件里自己 `setOption`（技能里已写）；
- 复制图片走 SVG/Canvas → PNG 的本地栅格化：先把主题变量与计算样式内联进 SVG，再带 surface 底色画到 canvas，所以彩色的图不会变黑白；
- 图位置固定在「本轮正文之后」，不能落到第三段之后——DSH 当前没有正文内 Markdown 扩展点，覆写 shipped 节点风险太高；
- 模板文件 `html` 进入工具参数会占上下文，技能里已限 40KB / 300 行。

## 许可

MIT，见 [`LICENSE`](./LICENSE)。

内置 Apache ECharts 5.6.0（Apache-2.0），归属与许可证全文见 [`THIRD-PARTY-LICENSES.md`](./THIRD-PARTY-LICENSES.md)。
