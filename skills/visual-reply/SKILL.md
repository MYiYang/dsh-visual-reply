---
name: visual-reply
description: 当分析类回答需要配图时使用（趋势、占比、排名、多指标对比、过程与状态机、结构关系、几何构造），指导如何取好数据、选对图型、用 visual_render 输出可交互图表片段，并在正文里给出口径与解读；也用于判断什么场合不该出图。不适用于 PPT/PDF 等附件交付、地图可视化、海报类生图。
---

# 图文分析回复（visual-reply）

## When to use

命中任一条才出图：

1. 用户明确要图（画个图、直观一点、趋势/占比/排名）；
2. 数据本身有趋势、占比、排名、波动、相关性或多指标对比；
3. 讲解过程：算法步骤、状态迁移、参数变化如何影响结果；
4. 结构关系：组织、因果、时间线、流程，用基础图型表达；
5. 几何构造与证明，且图能显著降低理解成本。

**不要用**：纯代码、纯文案、普通问答、闲聊；文字或一张三线表就够清楚的场合。用户要的是表格就直接回 Markdown 表，不要为了「可视化」出图；为「好看」硬塞图是负分。

## 设计令牌（片段里只用这些）

插件在沙箱里注入一套设计令牌，主题切换时它们会跟着变。片段里**不要把色值和字号写死**，否则深色模式对不上、切换主题也不跟：

- 颜色：`--vr-fg`（正文）、`--vr-muted`（次要文字/轴标签）、`--vr-line`（网格/分隔线）、`--vr-accent`（强调/单系列）、`--vr-series-1..6`（多系列按序取，≤6 个）。
- 色块上的文字：强调色块里用 `--vr-on-accent`（深/浅主题会自动给白或近黑），不要硬写 `#fff`——宿主的强调色在深色主题下可能偏亮，白字压上去会看不见。其他系列色块也要保证对比：浅色块用 `--vr-fg` 深字，深色块用 `--vr-on-accent`。
- 字体：`--vr-font-title`（15px）/ `--vr-font-body`（13px）/ `--vr-font-caption`（12px）是三档**字号令牌**，写法是 `font-size:var(--vr-font-body)`；字族与行高继承图体默认，不要再写 `font:13px/…` 这类简写。
- 网格与轴：`--vr-grid`（网格线）、`--vr-axis`（轴文字）可用；没有对应令牌时退回 `--vr-line` / `--vr-muted`。
- 字重只用 400/500，不用 600/700。
- 图体是薄容器：**不要套卡片壳**，不要外框、圆角、阴影、底色；标题、口径行、操作按钮由插件统一渲染，片段里不要再写一遍大标题。
- 图内不放解释段落，也不要贴大段注释；峰谷、极值、异常点、下一步建议写在正文里。

## Steps

1. **先把数取齐**。图表数据必须来自真实取数（SQL / 文件 / 已核验来源）。取不到就画空态图或示例结构，并置 `sample: true`、在 `caption` 里写明「示例结构，未取得可靠数据」——**任何情况下都不许编造数值**。
2. **选图型**：趋势→折线/面积；占比→环形/堆叠条；排名→横向条；多维对比→分组条/热力；过程→步骤图/状态机；结构→树/分组块。一次调用只画一张图，一张图只表达一件事；3D/雷达/桑基/关系图默认不用，确需先在正文说明理由。
3. **写片段**：只写 body 级 HTML，只用设计令牌。坐标轴必须有 `name` 且带单位；条形图从 0 起；饼/环 ≤6 类、条形 ≤12 类、系列 ≤6 个；SVG 只写 `viewBox` 与 `width="100%"`（高度交给 viewBox；**viewBox 宽度按卡片 ≈700 设计**，别用 360 宽画布再撑满，否则整体放大、留白翻倍），文字 `y` 是基线、要对齐。优先内联 SVG（离线可看、无依赖）；需要交互才用 ECharts——不要写外部 script 地址，本地 ECharts 由插件注入，并给它固定高度的容器。表格是保底形态。
   **数据契约（必做）**：每张图都要能被「复制数据」取出原始数值。片段里加一行 `window.__vrData = [["季度","单量"],["一季度",62],["二季度",88]]`（二维数组、首行表头；写成 JSON 字符串也认），或放一张 `display:none` 的 `<table>`，或给 SVG 根节点加 `data-vr-data='[[...]]'`。只画图形不声明数据，「复制数据」就会报「没带数据」。ECharts 图会从 option 自动提取，但显式声明更稳。
4. **调用 `visual_render`**：
   - `title`：一句能独立读懂的结论（≤120 字），不是「图表1」。
   - `caption`（必填）：数据来源 + 时间窗 + 关键假设，一句话写清。
   - 可选：`source`（表名/文件/接口）、`window`（数据时间窗）、`assumptions`（口径假设，string[]，≤5 条）、`wide`（宽图：时间线/宽表/多序列）、`sample`（示例/合成数据置 `true`）。
   - `height` 是**建议最大高度**：默认 480，范围 240–1024；实际高度按内容自适应，超过上限时卡片会出「展开」。宽图用 `wide: true`（上限放宽到 1024），不要为了塞内容硬写大数值。
5. **正文收口**：图前一句话结论（含口径），图后写解读——峰谷、极值、异常点、下一步建议。图是论据，不是装饰。
6. **自检**（见下）通过再结束这一轮。

## 模板

内联 SVG 条形图（最稳，无外链；轴名与单位、基线对齐、viewBox 按卡片实际宽度设计，都在里面）：

```html
<div style="color:var(--vr-fg);font-size:var(--vr-font-body)">
  <svg viewBox="0 0 720 300" width="100%" role="img" aria-label="各区域订单量（万单）">
    <line x1="56" y1="240" x2="700" y2="240" stroke="var(--vr-line)"/>
    <line x1="56" y1="24" x2="56" y2="240" stroke="var(--vr-line)"/>
    <text x="56" y="16" style="font-size:var(--vr-font-caption);fill:var(--vr-muted)">万单</text>
    <text x="380" y="288" text-anchor="middle" style="font-size:var(--vr-font-caption);fill:var(--vr-muted)">区域</text>
    <!-- 条形从 0 起：高度 = 数值 / 量程 × 绘图区高度（216）；label 的 y 取条形顶 - 8（基线在条形上方） -->
    <rect x="132" y="88" width="96" height="152" fill="var(--vr-series-1)"/>
    <rect x="332" y="24" width="96" height="216" fill="var(--vr-series-1)"/>
    <rect x="532" y="139" width="96" height="101" fill="var(--vr-series-1)"/>
    <text x="180" y="80" text-anchor="middle" style="font-size:var(--vr-font-caption);fill:var(--vr-fg)">62</text>
    <text x="380" y="16" text-anchor="middle" style="font-size:var(--vr-font-caption);fill:var(--vr-fg)">88</text>
    <text x="580" y="131" text-anchor="middle" style="font-size:var(--vr-font-caption);fill:var(--vr-fg)">41</text>
    <text x="180" y="262" text-anchor="middle" style="font-size:var(--vr-font-caption);fill:var(--vr-muted)">华东</text>
    <text x="380" y="262" text-anchor="middle" style="font-size:var(--vr-font-caption);fill:var(--vr-muted)">华南</text>
    <text x="580" y="262" text-anchor="middle" style="font-size:var(--vr-font-caption);fill:var(--vr-muted)">华北</text>
  </svg>
</div>
```

**viewBox 的宽度决定缩放比**：卡片正文约 700px 宽，`width="100%"` 会把整块画布等比放大到卡片宽度。所以按 ~700 设计画布（`viewBox="0 0 720 300"`）；如果按 360 宽的小画布画完再撑满，字号和留白会一起被放大 ~2 倍（12px 变 25px、右边空出 30%），看着就像「图有边距」。

ECharts（要交互才用，务必带兜底；`echarts` 由插件本地注入，不要写 `<script src>` 外链）：

```html
<div id="vr-chart" style="width:100%;height:240px"></div>
<script>
(function () {
  var el = document.getElementById('vr-chart');
  if (!el || typeof echarts === 'undefined') { el.textContent = '图表未加载，数据见正文'; return; }
  var root = getComputedStyle(document.documentElement);
  function token(name, fallback) { return (root.getPropertyValue(name) || fallback).trim(); }
  // 字号令牌本身就是 px 值；字族继承图体默认，不写死
  var font = {
    fontFamily: getComputedStyle(document.body).fontFamily,
    fontSize: parseFloat(token('--vr-font-body', '13px'))
  };
  function seriesColors() {
    var colors = [];
    for (var i = 1; i <= 6; i++) {
      var c = token('--vr-series-' + i, '');
      if (c) colors.push(c);
    }
    return colors;
  }
  function render() {
    var chart = echarts.getInstanceByDom(el) || echarts.init(el);
    chart.setOption({
      color: seriesColors(),
      textStyle: font,
      grid: { left: 56, right: 16, top: 16, bottom: 44 },
      xAxis: { type: 'category', name: '区域', nameLocation: 'middle', nameGap: 30,
        data: ['华东', '华南', '华北'],
        axisLabel: { color: token('--vr-muted', '') },
        axisLine: { lineStyle: { color: token('--vr-line', '') } } },
      yAxis: { type: 'value', name: '订单量（万单）',
        axisLabel: { color: token('--vr-muted', '') },
        splitLine: { lineStyle: { color: token('--vr-line', '') } } },
      series: [{ type: 'bar', data: [62, 88, 41] }]
    });
  }
  render();
  // 主题切换：父级派发 vr-theme，重读令牌后重设
  document.addEventListener('vr-theme', function () {
    root = getComputedStyle(document.documentElement);
    render();
  });
})();
</script>
```

## ECharts 主题（用 ECharts 时照此写）

- 颜色不要写死：用 `getComputedStyle(document.documentElement).getPropertyValue('--vr-series-1')` 这类方式读令牌，按 1..6 顺序喂给 `color`。
- 字体同理：字号令牌就是 px 值，`parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--vr-font-body'))` 直接喂给 `textStyle.fontSize`；字族用 `getComputedStyle(document.body).fontFamily`，不要写死。
- 监听插件派发的主题事件，重读令牌后重新 `setOption`：`document.addEventListener('vr-theme', …)`（示例见上）；不要自己监听 `prefers-color-scheme`，沙箱里它跟的是操作系统而不是 DSH 主题。
- 容器必须给固定高度（如 `height:240px`），否则 `echarts.init` 拿到 0 高会画空白；图体外面不要再包卡片壳。

## 图元点击（可选，追问锚点）

插件支持后：调用 `window.vrPick(payload)`，父级会出一枚「追问：<payload>」chip（用户点 chip 才发消息，不会误触新轮次）。

- 内联 SVG：给可点图元标 `data-vr-pick="华东"`，再用一小段脚本绑定点击（`if (window.vrPick)` 保护，旧版插件里就是空操作）：
  ```html
  <script>
  document.querySelectorAll('[data-vr-pick]').forEach(function (el) {
    el.style.cursor = 'pointer';
    el.addEventListener('click', function () {
      if (window.vrPick) window.vrPick(el.getAttribute('data-vr-pick'));
    });
  });
  </script>
  ```
- ECharts：`chart.on('click', function (p) { if (window.vrPick) window.vrPick(p.name) })`。

不要自己实现弹窗、也不要替用户发消息；这层只负责把用户点到的名字交出去。

## Pitfalls

- 片段里写 `<html>/<head>/<body>`、`<iframe>`、`<form>`、`<base>` —— 一律被拒。
- 片段里 `fetch` / `XMLHttpRequest` / `localStorage` / `document.cookie` —— 一律被拒；沙箱本来就断网，写这些只会报错。
- 外部脚本只允许 `cdn.jsdelivr.net`，其他域名（unpkg、bootcdn、自建）会被拒；本地 ECharts 已注入，优先不写外链。
- 地图（Leaflet/Mapbox/echarts geo）是红线，会被要求改写。
- 单片段 > 40KB 或 > 300 行 → 拆图；不要塞整页模板、不要复制大段注释。
- 写死 hex 色值或字号 —— 深色模式/主题切换时对不上；一律用 `--vr-*` 令牌，字重只用 400/500。
- 给图套卡片壳（边框/圆角/阴影/白底），或自己再写一遍大标题 —— 看起来像调试面板；标题与口径由插件渲染。
- 坐标轴没名称或没单位、条形图不从 0 起 —— 读者会读错数；双轴图必须写清两条轴各自代表什么。
- 饼/环 >6 类、条形 >12 类、系列颜色 >6 个 —— 先合并成「其他」或换图型。
- 3D/雷达/桑基/关系图 —— 生成质量不稳，默认不用；确需先在正文说明理由。
- 用户要表却出图 —— 直接回 Markdown 表。
- `caption` 留空或只写「数据来源」—— 必须来源 + 时间窗 + 关键假设；示例/合成数据没置 `sample: true` 或没标「示例」就是编造嫌疑。
- 把 `height` 当固定高度 —— 它现在是**建议最大高度**（默认 480，范围 240–1024），实际高度自适应；宽图用 `wide: true`。
- 字号小于 12px、一屏多图共用「图1/图2」标题 —— 办公场景读不清，也对不上正文。
- ECharts 的 `echarts.init` 在容器高度为 0 时会画出空白，容器必须给固定高度。
- **条形图标签必须对齐**：SVG 里文字的 `y` 是**基线**不是中心，标签要对上条形就得写在 `条形 y + 高度/2 + 4`；差一行整张图就会「串行」，看起来像数据对错了。
- **SVG 高度交给 viewBox**：只写 `viewBox` 与 `width="100%"`，别写死 `height` 属性——卡片宽度大于 viewBox 宽度时，写死的高度会把图按比例撑高、底部被 iframe 裁掉（插件已兜底为 `height:auto`，但生成的图仍应自觉）。

## Verification

- 工具回执 `ok: true`，且 `warnings` 为空或已解释；
- 口径：`caption` 写了来源 + 时间窗 + 关键假设；示例/合成数据置了 `sample: true` 且在 caption 里标「示例」；需要时补 `source` / `window` / `assumptions`；
- 令牌：片段里搜不到写死的 hex 色值与字号（注释里说明的除外），字重只有 400/500；
- 硬规则：坐标轴都有 `name`（含单位）、条形从 0 起、饼/环 ≤6、条形 ≤12、系列 ≤6、没有 3D/雷达/桑基/关系图；
- 结构：没有卡片壳（边框/圆角/阴影/底色），没有 `<html>` / `<iframe>` / 网络 API / 外部 script；
- 尺寸：`height` 只当建议最大高度（默认 480，范围 240–1024），宽图用 `wide: true`；ECharts 容器有固定高度；
- 回复正文里：结论（含口径）在前，`visual_render` 调用在中，解读在后；
- 离线可见性：优先内联 SVG 的图断网也能看；移动端单列、不横向滚动、不重叠（缩窄窗口自检一次）。
