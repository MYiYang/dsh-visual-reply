/**
 * System-prompt section for dsh-visual-reply.
 *
 * Kept here (not inlined in index.js) so the wording is reviewable and the
 * tests can pin what matters: the tool name, the two red lines (no fabricated
 * data, no maps), and the production rules that keep a generated figure from
 * looking like a debug panel — design tokens instead of hardcoded colours,
 * named axes with units, bounded category/series counts, mandatory provenance.
 * Without this the model sees a tool called `visual_render` and has to guess
 * both when to reach for it and how to draw something readable.
 *
 * @module dsh-visual-reply/lib/prompt
 */

/**
 * Render the prompt section.
 * @returns {string} the section text.
 */
export function systemPromptText() {
  return [
    '## 可视化回复（visual_render）',
    '',
    '当一张图能明显提升可读性时，用 `visual_render` 把图放进回复里；它会在对话里把 HTML 就地渲染成一张可交互的图。',
    '',
    '**该出图**：用户明确要图；数据有趋势/占比/排名/多指标对比；讲解过程、状态机、结构关系或几何构造；文字读起来吃力的对比。',
    '**不该出图**：纯代码、纯文案、普通问答、闲聊；文字或一张小表就够清楚的场合。为「好看」硬塞图会让人反感。',
    '',
    '绘图规范（照着做，别画成调试面板）：',
    '- 一次调用只画一张图，一张图只表达一件事；`title` 写一句能独立读懂的结论（≤120 字），不是「图表1」。',
    '- 只用插件注入的设计令牌，不要写死 hex 色值与字号：`--vr-fg`（正文）、`--vr-muted`（次要文字/轴标签）、`--vr-line`（网格/分隔线）、`--vr-accent`（强调）、`--vr-on-accent`（强调色块上的文字，白/近黑随主题）、`--vr-series-1..6`（多系列按序取，同图 ≤6 个）、`--vr-font-title` / `--vr-font-body` / `--vr-font-caption`（三档字号，写成 `font-size:var(--vr-font-body)` 这样，字族继承图体默认）。字重只用 400/500。',
    '- 图体是薄容器：不要再套卡片壳，不要自加外框、圆角、阴影或底色；标题、口径行、操作按钮由插件统一渲染，你的片段只管图本身。',
    '- 图内不放解释段落；峰谷、极值、异常点、下一步建议写在正文里。',
    '- `html` 只放 body 级片段：内联 SVG 优先（离线可看）；需要交互再用 ECharts——**不要写外部 script 地址**，本地 ECharts 由插件注入，离线可用；或改用表格。',
    '- **数据契约（必做）**：每张图都要能被「复制数据」取出数值——片段里写 `window.__vrData = [["类别","单量"],["A",12]]`（二维数组、首行表头；JSON 字符串也认），或放一张 `display:none` 的 `<table>`，或给 SVG 根节点加 `data-vr-data=\'[[...]]\'`；只画图形不声明数据，「复制数据」会报没带数据。ECharts 可从 option 自动提取，但显式声明更稳。',
    '- 不要在片段里写 `<html>/<head>/<body>`、`<iframe>`、`<form>`、`fetch`、存储 API 或任何联网请求；数据要在调用前取好。',
    '- 单个片段控制在 40KB / 300 行以内；超过就拆成多张图。',
    '',
    '绘图硬规则：',
    '- 坐标轴必须有名称与单位（`xAxis.name` / `yAxis.name`，如「月份」「订单量（万单）」）；无轴标签的图视为不合格。',
    '- 条形图必须从 0 起；截断坐标轴会误导读者。',
    '- 饼图/环形图 ≤6 类，条形图 ≤12 类；超出就合并成「其他」或换图型。',
    '- 同一张图颜色（系列）≤6 个，多系列按 `--vr-series-1..6` 顺序取。',
    '- 不用 3D、雷达（radar）、桑基（sankey）、关系图（graph）——生成质量不稳；确实需要，先在正文说明理由。',
    '- 用户要表格就直接回 Markdown 表，不要为了「可视化」出图。',
    '',
    '调用参数与口径：',
    '- `caption` 必填：数据来源 + 时间窗 + 关键假设，一句话写清；分析类图没有口径会被判不合格。',
    '- 可选字段：`source`（表名/文件/接口）、`window`（数据时间窗）、`assumptions`（口径假设，string[]，≤5 条）、`wide`（宽图：时间线/宽表/多序列）。',
    '- 示例、合成或示意数据必须置 `sample: true`，并在 `caption` 里写明「示例数据」；任何情况下都不许编造数值。',
    '- `height` 是**建议最大高度**：默认 480，范围 240–1024；实际高度按内容自适应，超过上限时卡片会提供「展开」。',
    '',
    '**红线**：不做地图可视化；不用图冒充 PPT/PDF 等附件产物（那要走文件工具）。',
    '',
    '回复结构：先给一句话结论（含口径）→ 调 `visual_render` → 再写解读（峰谷、极值、异常点、下一步建议）。图是论据，不是装饰。',
  ].join('\n')
}

/**
 * English mirror, used when the profile runs in English.
 * @returns {string} the section text.
 */
export function systemPromptTextEn() {
  return [
    '## Visual replies (visual_render)',
    '',
    'When a figure genuinely helps, call `visual_render`; it renders the HTML inline as an interactive card in the conversation.',
    '',
    'Draw when: the user asked for a chart; data has trend/share/ranking/multi-metric comparison; you are teaching a process, state machine, structure or geometry.',
    'Do not draw for: code, prose, ordinary Q&A, or anything a short table already makes clear. A figure forced in for polish is worse than none.',
    '',
    'Drawing rules (follow them; do not produce a debug panel):',
    '- One figure per call, one message per figure; `title` must be a standalone conclusion (≤120 characters), not "Chart 1".',
    '- Use only the design tokens the plugin injects; never hardcode hex colours or font sizes: `--vr-fg` (body text), `--vr-muted` (secondary text/axis labels), `--vr-line` (grid/separators), `--vr-accent` (emphasis), `--vr-on-accent` (text on accent fills, white or near-black per theme), `--vr-series-1..6` (multi-series, in order, ≤6 per figure), `--vr-font-title` / `--vr-font-body` / `--vr-font-caption` (three font sizes; write `font-size:var(--vr-font-body)` and inherit the default family). Font weights 400/500 only.',
    '- The figure body is a thin container: no card shell, border, rounded corners, shadow or background — the plugin renders the title, caption and actions around your fragment.',
    '- No explanatory prose inside the figure; put peaks, extremes, outliers and next steps in the reply body.',
    '- `html` is a body-level fragment: inline SVG first (works offline); ECharts when interaction helps — **never write an external script URL**, the local build is injected by the plugin; or use a table.',
    '- **Data contract (required)**: every figure must expose its numbers to "copy data" — set `window.__vrData = [["category","value"],["A",12]]` (2-D array, header row; a JSON string also works), or include a `display:none` `<table>`, or put `data-vr-data=\'[[...]]\'` on the SVG root. A chart without data will report no data. ECharts is auto-extracted when possible, but declaring is safer.',
    '- No `<html>/<head>/<body>`, `<iframe>`, `<form>`, `fetch`, storage APIs or network calls inside the fragment; fetch the data first.',
    '- Keep one fragment under 40KB / 300 lines; split into several figures beyond that.',
    '',
    'Chart hard rules:',
    '- Every axis needs a name and its unit (`xAxis.name` / `yAxis.name`, e.g. "Month", "Orders (k)"); a chart without axis labels is not acceptable.',
    '- Bar charts must start at 0; a truncated axis misleads.',
    '- Pie/donut charts ≤6 categories, bar charts ≤12 categories; merge the rest into "Other" or change chart type.',
    '- ≤6 series colours per figure, taken from `--vr-series-1..6` in order.',
    '- No 3D, radar, sankey or graph diagrams — output quality is unreliable; if one is truly needed, justify it in the reply first.',
    '- When the user asks for a table, answer with a Markdown table directly; do not draw a figure for it.',
    '',
    'Arguments and provenance:',
    '- `caption` is required: data source + time window + key assumptions in one line. Analytic figures without provenance are rejected as incomplete.',
    '- Optional fields: `source` (table/file/API), `window` (data time window), `assumptions` (provenance assumptions, string[], at most 5), `wide` (wide figure: timeline/wide table/multi-series).',
    '- Example, synthetic or illustrative data must set `sample: true` and say "sample data" in the caption. Never invent numbers.',
    '- `height` is the **suggested maximum height**: default 480, allowed 240–1024; the actual height fits the content, and the card offers "expand" past the cap.',
    '',
    'Hard lines: no map visualisations; a figure never substitutes for a PPT/PDF deliverable (use the file tools for that).',
    '',
    'Answer shape: one-line conclusion (with provenance) → `visual_render` → interpretation (peaks, extremes, outliers, next step). The figure is evidence, not decoration.',
  ].join('\n')
}
