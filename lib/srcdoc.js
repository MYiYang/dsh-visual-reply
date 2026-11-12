/**
 * The sandbox document that hosts one visual fragment.
 *
 * Mirrors the Client half's builder (a plain browser bundle cannot `import`
 * this module). `test/srcdoc.test.js` pins the invariants both copies must
 * satisfy — CSP present, fragment untouched, height/status reporters wired —
 * so they cannot drift apart silently.
 *
 * 2026-11 改版：CSP 收紧到「内联 + jsdelivr 兜底」，主题令牌与系列色板
 * 由宿主实取后注入；运行时不只报高度，还报 ready/blank/overflow/csp/error，
 * 并接主题消息、导出 PNG/数据、回传图元点击。
 *
 * @module dsh-visual-reply/lib/srcdoc
 */

/** 片段文档统一 CSP；与 Client half 的 CSP_POLICY 同源。 */
export const CSP_POLICY = [
      "default-src 'none'",
      "script-src 'unsafe-inline' https://cdn.jsdelivr.net",
      "style-src 'unsafe-inline'",
      'img-src data: blob: https:',
      'font-src data:',
      "connect-src 'none'",
      "frame-src 'none'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      'media-src data:',
    ].join('; ')

/**
 * 主题兜底色板。iframe 里的 prefers-color-scheme 跟的是操作系统，不是
 * DSH 主题；客户端会把宿主实取值注入进来，这份只作兜底。
 */
export const PALETTE_FALLBACK = {
      fg: '#0f1115',
      muted: '#61666b',
      accent: '#4176e6',
      line: '#00000029',
      bg: '#ffffff',
      grid: '#0000001a',
      onAccent: '#ffffff',
      dark: false,
      series: ['#4176e6', '#2ea88a', '#f59e0b', '#e5573f', '#8b5cf6', '#0ea5e9', '#64748b', '#d946ef'],
    }


/** 深色主题下更亮的系列色。 */
const SERIES_DARK = ['#6b93ee', '#4bc3a6', '#fbbf24', '#f07a62', '#a78bfa', '#38bdf8', '#94a3b8', '#e879f9']

/** 片段文档的基础样式；设计令牌先给默认值，宿主实取色板随后覆盖。 */
export const BASE_STYLE = [
      ':root{',
      '--vr-fg:#0f1115;--vr-bg:#ffffff;--vr-line:#00000029;--vr-muted:#61666b;--vr-accent:#4176e6;',
      '--vr-on-accent:#ffffff;--vr-grid:#0000001a;--vr-axis:#61666b;',
      '--vr-series-1:#4176e6;--vr-series-2:#2ea88a;--vr-series-3:#f59e0b;--vr-series-4:#e5573f;',
      '--vr-series-5:#8b5cf6;--vr-series-6:#0ea5e9;--vr-series-7:#64748b;--vr-series-8:#d946ef;',
      '--vr-font-title:15px;--vr-font-body:13px;--vr-font-caption:12px;--vr-radius:12px}',
      '@media (prefers-color-scheme:dark){:root{',
      '--vr-fg:#f9fafb;--vr-bg:#1b1d21;--vr-line:#ffffff3d;--vr-muted:#cfd3d6;--vr-accent:#5686fe;',
      '--vr-grid:#ffffff26;--vr-axis:#9aa1a8;',
      '--vr-series-1:#6b93ee;--vr-series-2:#4bc3a6;--vr-series-3:#fbbf24;--vr-series-4:#f07a62;',
      '--vr-series-5:#a78bfa;--vr-series-6:#38bdf8;--vr-series-7:#94a3b8;--vr-series-8:#e879f9}}',
      'html,body{margin:0;padding:0;background:var(--vr-bg);color:var(--vr-fg);',
      'font:var(--vr-font-body)/1.6 -apple-system,"Segoe UI",system-ui,"PingFang SC","Microsoft YaHei",sans-serif}',
      'h1,h2,h3,h4{margin:0 0 8px;font-weight:500;line-height:1.4}',
      'p{margin:0 0 8px}',
      'strong,b{font-weight:500}',
      'svg,canvas{display:block;max-width:100%;height:auto}',
      'table{border-collapse:collapse;width:100%;font-size:var(--vr-font-caption)}',
      'th,td{padding:4px 8px;border-bottom:1px solid var(--vr-line);text-align:left}',
      'th{color:var(--vr-muted);font-weight:500}',
      '@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.001ms!important;',
      'animation-iteration-count:1!important;transition-duration:.001ms!important}}',
    ].join('')

/** Host-served local ECharts build（与 index.js / Client 同值）。 */
export const ECHARTS_ROUTE = '/dsh-visual-reply/echarts.min.js'

/** 模型手写的外部 `<script src>` 对；本地库注入后一并摘掉。 */
/** 模型手写的外部 `<script src>` 对；本地库注入后一并摘掉。 */
export const EXTERNAL_SCRIPT = /<script\b[^>]*\bsrc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)[^>]*>\s*<\/script>/gi

function cssValue(value, fallback) {
      const text = typeof value === 'string' ? value.trim() : ''
      if (text === '' || /[;{}<>]/.test(text)) return fallback
      return text
    }


/** 把色板拼成 :root 声明（含 --vr-series-*）；与 Client half 同源。 */
export function paletteVars(palette) {
      const p = palette ?? PALETTE_FALLBACK
      const series = Array.isArray(p.series) && p.series.length > 0 ? p.series : PALETTE_FALLBACK.series
      const vars = [
        `--vr-fg:${cssValue(p.fg, PALETTE_FALLBACK.fg)};`,
        `--vr-bg:${cssValue(p.bg, '#ffffff')};`,
        `--vr-line:${cssValue(p.line, PALETTE_FALLBACK.line)};`,
        `--vr-muted:${cssValue(p.muted, PALETTE_FALLBACK.muted)};`,
        `--vr-accent:${cssValue(p.accent, PALETTE_FALLBACK.accent)};`,
        `--vr-on-accent:${cssValue(p.onAccent, PALETTE_FALLBACK.onAccent)};`,
        `--vr-grid:${cssValue(p.grid, PALETTE_FALLBACK.grid)};`,
        `--vr-axis:${cssValue(p.muted, PALETTE_FALLBACK.muted)};`,
      ]
      series.forEach((value, index) => {
        const fallback = PALETTE_FALLBACK.series[index % PALETTE_FALLBACK.series.length]
        vars.push(`--vr-series-${index + 1}:${cssValue(value, fallback)};`)
      })
      return `:root{${vars.join('')}}`
    }


/** 片段运行时：量高 / 状态 / 主题 / 导出 / 图元点击。与 Client half 同源。 */
export function runtimeSource(id) {
      const ID = JSON.stringify(id)
      return [
        '(function(){',
        "'use strict';",
        `var ID=${ID};var lastHeight=-1;var lastOverflow=null;var ready=false;var timer=0;`,
        'function send(msg){try{msg.__vr=msg.__vr||"";msg.id=ID;parent.postMessage(msg,"*")}catch(e){}}',
        'function bodyHeight(){try{var el=document.body;if(!el)return 0;return Math.ceil(el.getBoundingClientRect().height)||0}catch(e){return 0}}',
        'function hasVisible(){try{var b=document.body;if(!b)return false;',
        'if(b.innerText&&b.innerText.trim()!=="")return true;',
        'return !!document.querySelector("svg,canvas,img,table,pre,code")}catch(e){return false}}',
        'function checkOverflow(){try{var d=document.documentElement;if(!d)return;',
        'var over=(d.scrollWidth-d.clientWidth)>2;if(over!==lastOverflow){lastOverflow=over;send({__vr:"overflow",overflow:over})}}catch(e){}}',
        'function measure(){var h=bodyHeight();if(h>0&&Math.abs(h-lastHeight)>1){lastHeight=h;send({__vr:"height",height:h})}',
        'if(!ready&&h>0){ready=true;send({__vr:"ready",height:h})}checkOverflow();',
        'if(!ready&&h<=2&&!hasVisible())send({__vr:"blank"})}',
        'function schedule(){clearTimeout(timer);timer=setTimeout(measure,100)}',
        'function applyTheme(p){if(!p)return;try{var r=document.documentElement;',
        'var map={fg:"--vr-fg",muted:"--vr-muted",accent:"--vr-accent",onAccent:"--vr-on-accent",line:"--vr-line",bg:"--vr-bg",grid:"--vr-grid"};',
        'for(var k in map){if(typeof p[k]==="string"&&p[k])r.style.setProperty(map[k],p[k])}',
        'if(p.muted)r.style.setProperty("--vr-axis",p.muted);',
        'if(Array.isArray(p.series)){for(var i=0;i<p.series.length;i++){if(p.series[i])r.style.setProperty("--vr-series-"+(i+1),p.series[i])}}',
        'r.setAttribute("data-vr-dark",p.dark?"true":"false");',
        'try{var ce=new CustomEvent("vr-theme",{detail:p});document.dispatchEvent(ce);window.dispatchEvent(ce)}catch(e){}',
        'schedule()}catch(e){}}',
        'function backgroundOf(){try{var v=getComputedStyle(document.documentElement).getPropertyValue("--vr-bg").trim();',
        'if(v&&v!=="transparent"&&v!=="rgba(0, 0, 0, 0)")return v;',
        'var c=getComputedStyle(document.body).backgroundColor;',
        'if(!c||c==="transparent"||c==="rgba(0, 0, 0, 0)")return document.documentElement.getAttribute("data-vr-dark")==="true"?"#1b1d21":"#ffffff";',
        'return c}catch(e){return "#ffffff"}}',
        'function themeVars(){try{var names=["--vr-fg","--vr-muted","--vr-accent","--vr-line","--vr-bg","--vr-grid","--vr-axis"];',
        'for(var i=1;i<=8;i++)names.push("--vr-series-"+i);var out=[];var s=getComputedStyle(document.documentElement);',
        'for(var j=0;j<names.length;j++){var v=s.getPropertyValue(names[j]).trim();if(v)out.push(names[j]+":"+v)}',
        'return out.join(";")}catch(e){return ""}}',
        'function paintAttrs(src,dst){try{var cs=getComputedStyle(src);',
        'var props=["fill","stroke","stroke-width","stroke-dasharray","stroke-linecap","stroke-linejoin",',
        '"opacity","fill-opacity","stroke-opacity","font-size","font-family","font-weight","font-style","text-anchor","dominant-baseline"];',
        'for(var i=0;i<props.length;i++){var v=cs.getPropertyValue(props[i]);',
        'if(v&&v!=="none"&&v!=="normal"&&v!=="auto"){try{dst.setAttribute(props[i],v)}catch(e){}}}}catch(e){}}',
        'function canvasPng(){try{var list=document.querySelectorAll("canvas");if(!list.length)return null;',
        'var w=0,h=0,i;for(i=0;i<list.length;i++){w=Math.max(w,list[i].width);h+=list[i].height}',
        'if(w<=0||h<=0)return null;var out=document.createElement("canvas");out.width=w;out.height=h;',
        'var ctx=out.getContext("2d");if(!ctx)return null;ctx.fillStyle=backgroundOf();ctx.fillRect(0,0,w,h);',
        'var y=0;for(i=0;i<list.length;i++){ctx.drawImage(list[i],0,y);y+=list[i].height}',
        'return out.toDataURL("image/png")}catch(e){return null}}',
        'function svgPng(svg,done){try{var clone=svg.cloneNode(true);',
        'if(!clone.getAttribute("xmlns"))clone.setAttribute("xmlns","http://www.w3.org/2000/svg");',
        'var theme=themeVars();if(theme)clone.setAttribute("style",theme);',
        'var srcList=[svg];var dstList=[clone];',
        'var sNodes=svg.querySelectorAll("*");var dNodes=clone.querySelectorAll("*");',
        'for(var n=0;n<sNodes.length&&n<dNodes.length;n++){srcList.push(sNodes[n]);dstList.push(dNodes[n])}',
        'for(var n2=0;n2<srcList.length;n2++)paintAttrs(srcList[n2],dstList[n2]);',
        'var box=svg.getBoundingClientRect();var w=Math.max(1,Math.round(box.width)||600);var h=Math.max(1,Math.round(box.height)||360);',
        'clone.setAttribute("width",String(w));clone.setAttribute("height",String(h));',
        'var scale=2;var text=new XMLSerializer().serializeToString(clone);',
        'var blob=new Blob(["<?xml version=\\"1.0\\" encoding=\\"UTF-8\\"?>"+text],{type:"image/svg+xml"});',
        'var url=URL.createObjectURL(blob);var img=new Image();',
        'img.onload=function(){try{var c=document.createElement("canvas");c.width=w*scale;c.height=h*scale;',
        'var ctx=c.getContext("2d");if(ctx){ctx.fillStyle=backgroundOf();ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(img,0,0,c.width,c.height)}',
        'URL.revokeObjectURL(url);done(c.toDataURL("image/png"),"")}catch(e){URL.revokeObjectURL(url);done(null,String(e.message||"svg export failed"))}};',
        'img.onerror=function(){URL.revokeObjectURL(url);done(null,"SVG 转 PNG 失败")};img.src=url}catch(e){done(null,String(e.message||"svg export failed"))}}',
        'function jsonRows(raw){try{var arr=JSON.parse(String(raw));if(!Array.isArray(arr))return null;var rows=[];',
        'for(var i=0;i<arr.length;i++){var r=arr[i];if(Array.isArray(r)){rows.push(r.map(function(c){return c==null?"":String(c).replace(/\\s+/g," ")}).join("\\t"))}else{rows.push(String(r==null?"":r))}}',
        'return rows.length?rows.join("\\n"):null}catch(e){return null}}',
        'function echartsData(){try{if(!window.echarts||typeof window.echarts.getInstanceByDom!=="function")return null;',
        'var nodes=document.querySelectorAll("div,section,main");',
        'for(var i=0;i<nodes.length;i++){var inst=window.echarts.getInstanceByDom(nodes[i]);if(!inst)continue;',
        'var opt=inst.getOption();if(!opt)continue;var series=opt.series||[];if(!series.length)continue;',
        'var cats=(opt.xAxis&&opt.xAxis[0]&&opt.xAxis[0].data)||[];var names=[];',
        'for(var s=0;s<series.length;s++){names.push(String(series[s].name||("系列"+(s+1))))}',
        'var n=cats.length;for(var k=0;k<series.length;k++){n=Math.max(n,(series[k].data||[]).length)}',
        'var rows=[(["类别"].concat(names)).join("\\t")];',
        'for(var j=0;j<n;j++){var line=[cats.length?String(cats[j]):String(j+1)];',
        'for(var t=0;t<series.length;t++){var d=(series[t].data||[])[j];',
        'var v=d&&typeof d==="object"?(d.value!=null?d.value:""):(d==null?"":d);line.push(String(v))}',
        'rows.push(line.join("\\t"))}return rows.join("\\n")}return null}catch(e){return null}}',
        'function tableData(){try{var table=document.querySelector("table");if(table){',
        'var rows=[];var trs=table.querySelectorAll("tr");for(var i=0;i<trs.length;i++){var cells=trs[i].querySelectorAll("th,td");var line=[];',
        'for(var j=0;j<cells.length;j++){line.push(String(cells[j].innerText||"").replace(/\\s+/g," ").trim())}rows.push(line.join("\\t"))}',
        'return rows.length?rows.join("\\n"):null}',
        'var raw=window.__vrData;if(typeof raw==="string"&&raw.trim())return raw;',
        'if(Array.isArray(raw)){var out=[];for(var i=0;i<raw.length;i++){var r=raw[i];',
        'if(Array.isArray(r)){out.push(r.map(function(c){return c==null?"":String(c)}).join("\\t"))}',
        'else if(r&&typeof r==="object"){var keys=Object.keys(r);if(i===0)out.push(keys.join("\\t"));',
        'out.push(keys.map(function(k){return r[k]==null?"":String(r[k])}).join("\\t"))}else{out.push(String(r))}}',
        'if(out.length)return out.join("\\n")}',
        'var svg=document.querySelector("svg");if(svg){var attr=svg.getAttribute("data-vr-data");if(attr){var parsed=jsonRows(attr);if(parsed)return parsed}}',
        'var ec=echartsData();if(ec)return ec;',
        'return null}catch(e){return null}}',
        'function xmlText(v){return String(v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}',
        'function htmlPng(done){try{var body=document.body;if(!body)return done(null,"没有可导出的图");',
        'var w=Math.ceil(body.getBoundingClientRect().width);var h=Math.ceil(body.getBoundingClientRect().height);',
        'if(!(w>1&&h>1))return done(null,"没有可导出的图");',
        'var styles="";var sheets=document.querySelectorAll("style");for(var i=0;i<sheets.length;i++)styles+=sheets[i].textContent||"";',
        'var markup=new XMLSerializer().serializeToString(body).replace(/^<body[^>]*>/i,"").replace(/<\\/body>$/i,"");',
        'var bg=backgroundOf();var fg=(getComputedStyle(document.documentElement).getPropertyValue("--vr-fg")||"").trim()||"#111111";',
        'var svg="<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'" + w + "\' height=\'" + h + "\'><foreignObject width=\'100%\' height=\'100%\'><div xmlns=\'http://www.w3.org/1999/xhtml\' style=\'width:" + w + "px;height:" + h + "px;margin:0;padding:0;background:" + bg + ";color:" + fg + "\'><style>" + xmlText(styles) + "</style>" + markup + "</div></foreignObject></svg>";',
        'var img=new Image();img.onload=function(){try{var c=document.createElement("canvas");c.width=w*2;c.height=h*2;',
        'var ctx=c.getContext("2d");if(!ctx)return done(null,"canvas unavailable");',
        'ctx.fillStyle=bg;ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(img,0,0,c.width,c.height);',
        'done(c.toDataURL("image/png"),"")}catch(e){done(null,String(e&&e.message||"html export failed"))}};',
        'img.onerror=function(){done(null,"html export failed")};',
        'img.src="data:image/svg+xml;charset=utf-8,"+encodeURIComponent(svg)',
        '}catch(e){done(null,String(e&&e.message||"html export failed"))}}',
        'function exportPng(requestId){var data=canvasPng();if(data){send({__vr:"export-result",requestId:requestId,format:"png",ok:true,data:data,error:""});return}',
        'var svg=document.querySelector("svg");if(svg){svgPng(svg,function(dataUrl,error){send({__vr:"export-result",requestId:requestId,format:"png",ok:!!dataUrl,data:dataUrl||"",error:error||""})});return}',
        'htmlPng(function(dataUrl,error){send({__vr:"export-result",requestId:requestId,format:"png",ok:!!dataUrl,data:dataUrl||"",error:error||""})})}',
        'window.vrPick=function(payload){send({__vr:"pick",payload:String(payload==null?"":payload).slice(0,300)})};',
        'window.addEventListener("message",function(e){var d=e.data;if(!d||typeof d!=="object")return;',
        'if(d.__vr==="theme"){applyTheme(d.palette);return}',
        'if(d.__vr==="export"&&d.requestId){if(d.format==="png"){exportPng(d.requestId);return}',
        'if(d.format==="data"){var out=tableData();send({__vr:"export-result",requestId:d.requestId,format:"data",ok:!!out,data:out||"",error:out?"":"这张图没带数据：window.__vrData / data-vr-data / table 三者皆无"});return}',
        'send({__vr:"export-result",requestId:d.requestId,format:d.format,ok:false,data:"",error:"不支持的导出格式"})}});',
        'window.addEventListener("error",function(e){send({__vr:"error",message:String(e&&e.message||"script error").slice(0,200)})});',
        'window.addEventListener("unhandledrejection",function(e){send({__vr:"error",message:String(e&&e.reason||"unhandled rejection").slice(0,200)})});',
        'document.addEventListener("securitypolicyviolation",function(e){send({__vr:"csp",directive:String(e&&(e.effectiveDirective||e.violatedDirective)||""),blocked:String(e&&e.blockedURI||"").slice(0,160)})});',
        'addEventListener("load",schedule);',
        'if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",schedule);else schedule();',
        'if(window.ResizeObserver){try{new ResizeObserver(schedule).observe(document.body)}catch(e){}}',
        'setTimeout(measure,400);setTimeout(function(){if(!ready)send({__vr:"stalled"})},4000);',
        '})();',
      ].join('')
    }


/**
 * 造一个只在本次挂载有效的 nonce。
 * @returns {string} the nonce.
 */
export function makeNonce() {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID().slice(0, 8)
  return Math.random().toString(36).slice(2, 10)
}

/**
 * Wrap a fragment into a full sandbox document.
 * @param {{html: string, nonce: string, palette?: any, echarts?: string}} input - fragment, nonce, palette, library.
 * @returns {string} the document to hand to `iframe.srcdoc`.
 */
export function buildSrcdoc({ html, nonce, palette = PALETTE_FALLBACK, echarts = '' }) {
  const id = String(nonce).replace(/[^A-Za-z0-9_-]/g, '')
  const source = typeof echarts === 'string' && echarts !== ''
    ? `<script>${echarts.replace(/<\/script/gi, '<\\/script')}</script>${html.replace(EXTERNAL_SCRIPT, '')}`
    : html
  return [
    '<!doctype html><html data-vr-dark="',
    palette?.dark === true ? 'true' : 'false',
    '"><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${CSP_POLICY}">`,
    `<style>${BASE_STYLE}</style>`,
    `<style>${paletteVars(palette)};html,body{background:var(--vr-bg)}</style>`,
    '</head><body>',
    source,
    `<script>${runtimeSource(id)}</script>`,
    '</body></html>',
  ].join('')
}
