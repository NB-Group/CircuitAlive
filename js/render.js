/* FieldFlow · render — SVG 场景渲染
 *
 * 分两层:
 *   syncStructure(model)  模型变了:边/符号/结点(按 edge.id 增量调和)
 *   syncSolution(model, sol)  解变了:电势着色/读数/光晕/E 箭头/电势标注
 * 粒子独立 rAF 循环,速度跟随 |I|,方向跟随电流符号,电子模式反向。
 *
 * 电势色阶:发散,OKLab 插值 群青(#2f62a8) ← 纸色 → 朱红(#c8451f),
 * 锚定 φ=0 对称 ±φmax(色阶已经 dataviz 校验器验证通过)。 */
(function (global) {
'use strict';

var FF = global.FF || (global.FF = {});
var T = FF.T;
var G = FF.GRID;

/* ---------- OKLab 颜色 ---------- */
function hexToRgb(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
function s2l(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function l2s(c) { return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055); }

function rgbToOklab(rgb) {
  var r = s2l(rgb[0]), g = s2l(rgb[1]), b = s2l(rgb[2]);
  var l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  var m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  var s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  var l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
  return [
    0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
  ];
}

function oklabToHex(lab) {
  var l_ = lab[0] + 0.3963377774 * lab[1] + 0.2158037573 * lab[2];
  var m_ = lab[0] - 0.1055613458 * lab[1] - 0.0638541728 * lab[2];
  var s_ = lab[0] - 0.0894841775 * lab[1] - 1.2914855480 * lab[2];
  var l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
  var r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  var g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  var b = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
  function ch(c) { c = Math.round(l2s(Math.min(1, Math.max(0, c)))); var h = c.toString(16); return h.length < 2 ? '0' + h : h; }
  return '#' + ch(r) + ch(g) + ch(b);
}

var PAPER = '#f7f2e5', VERMILION = '#c8451f', INDIGO = '#2f62a8';
var LAB_PAPER = rgbToOklab(hexToRgb(PAPER));
var LAB_HI = rgbToOklab(hexToRgb(VERMILION));
var LAB_LO = rgbToOklab(hexToRgb(INDIGO));

var phiMaxScale = 1;
var colorCache = new Map();

function phiColor(phi) {
  if (phi == null) return '#b4a996';
  var t = FF.clamp(phi / phiMaxScale, -1, 1);
  var key = Math.round(t * 128);
  var c = colorCache.get(key);
  if (c) return c;
  var lab = t >= 0 ? LAB_HI : LAB_LO, a = Math.abs(t);
  c = oklabToHex([
    LAB_PAPER[0] + (lab[0] - LAB_PAPER[0]) * a,
    LAB_PAPER[1] + (lab[1] - LAB_PAPER[1]) * a,
    LAB_PAPER[2] + (lab[2] - LAB_PAPER[2]) * a
  ]);
  colorCache.set(key, c);
  return c;
}
FF.phiColor = phiColor;
FF.setPhiScale = function (m) { phiMaxScale = Math.max(m, 0.05); };

/* ---------- 渲染器状态 ---------- */

var R = {
  svg: null,
  layers: {},
  model: null,
  sol: null,
  edgeEls: new Map(),      /* edgeId -> {group, sym, hit, hooks:{}} */
  version: 0,              /* solve 版本(defs id 用) */
  opts: { particles: true, electrons: false, potential: false, phiLabels: false, efield: false },
  view: { x: -60, y: -60, w: 920, h: 640 },
  probeKey: null,
  selKey: null,
  raf: null, lastT: 0
};

function w2(x) { return x * G; }   /* 格坐标 → 世界坐标 */

function edgeMid(e) { return [(e.a[0] + e.b[0]) / 2 * G, (e.a[1] + e.b[1]) / 2 * G]; }

/* ---------- 初始化:defs / 纸格 ---------- */

function buildDefs() {
  var defs = R.layers.defs;
  defs.innerHTML = '';

  /* 坐标格 pattern:5 格一粗线 */
  var pat = FF.svgEl('pattern', { id: 'grid', width: G * 5, height: G * 5, patternUnits: 'userSpaceOnUse' }, defs);
  var d = '';
  for (var i = 0; i < 5; i++) {
    d += 'M' + (i * G) + ' 0V' + (G * 5) + 'M0 ' + (i * G) + 'H' + (G * 5);
  }
  FF.svgEl('path', { d: d, stroke: '#dfe7ec', 'stroke-width': 1, fill: 'none' }, pat);
  FF.svgEl('path', { d: 'M0 0V' + (G * 5) + 'M0 0H' + (G * 5), stroke: '#cdd9e3', 'stroke-width': 1.2, fill: 'none' }, pat);

  /* 灯泡光晕(外晕 + 泛光模糊 + 白热核,伪 HDR 三层) */
  var grad = FF.svgEl('radialGradient', { id: 'lamp-glow' }, defs);
  FF.svgEl('stop', { offset: '0%', 'stop-color': '#ffdf9e', 'stop-opacity': 0.95 }, grad);
  FF.svgEl('stop', { offset: '45%', 'stop-color': '#ffc95e', 'stop-opacity': 0.5 }, grad);
  FF.svgEl('stop', { offset: '100%', 'stop-color': '#ffb347', 'stop-opacity': 0 }, grad);
  var core = FF.svgEl('radialGradient', { id: 'lamp-core' }, defs);
  FF.svgEl('stop', { offset: '0%', 'stop-color': '#fffdf2', 'stop-opacity': 1 }, core);
  FF.svgEl('stop', { offset: '55%', 'stop-color': '#ffe6a1', 'stop-opacity': 0.95 }, core);
  FF.svgEl('stop', { offset: '100%', 'stop-color': '#ffb347', 'stop-opacity': 0 }, core);
  var bloom = FF.svgEl('filter', { id: 'lamp-bloom', x: '-120%', y: '-120%', width: '340%', height: '340%' }, defs);
  FF.svgEl('feGaussianBlur', { stdDeviation: 2.8 }, bloom);

  R.gradGroup = FF.svgEl('g', { id: 'potential-grads' }, defs);
}

function buildPaper() {
  var g = R.layers.paper;
  g.innerHTML = '';
  FF.svgEl('rect', { x: -4000, y: -4000, width: 8000, height: 8000, fill: 'url(#grid)' }, g);
}

/* ---------- 结构渲染(模型变更) ---------- */

function syncStructure() {
  var m = R.model;
  var seen = new Set();

  m.edges.forEach(function (e) {
    seen.add(e.id);
    var angle = FF.symbols.angleOf(e.a, e.b);
    /* 符号局部坐标 [-HALF..+HALF] 以边中点为原点 —— 必须平移到中点,
       否则整条笔画偏半格,拐角处视觉断开 */
    var mx = w2((e.a[0] + e.b[0]) / 2), my = w2((e.a[1] + e.b[1]) / 2);
    var tr = 'translate(' + mx + ',' + my + ') rotate(' + angle + ')';
    var rec = R.edgeEls.get(e.id);
    if (rec && rec.type === e.type && rec.tr === tr) return;   /* 未变,跳过重建 */
    if (rec) { rec.group.remove(); rec.hit.remove(); }
    addEdgeGroup(e, angle, tr);
  });

  /* 删除消失的边 */
  R.edgeEls.forEach(function (rec, id) {
    if (!seen.has(id)) { rec.group.remove(); rec.hit.remove(); R.edgeEls.delete(id); }
  });

  buildJunctions();
  document.getElementById('empty-hint').style.display = m.edges.size ? 'none' : 'flex';
}

function collectHooks(sym) {
  var hooks = {};
  sym.querySelectorAll('[data-hook]').forEach(function (h) {
    hooks[h.getAttribute('data-hook')] = h;
  });
  return hooks;
}

function addEdgeGroup(e, angle, tr) {
  var sym = FF.symbols.build(e.type, angle, e.props);

  var group = FF.svgEl('g', { 'class': 'edge-group', transform: tr }, R.layers.edges);
  group.appendChild(sym);

  /* 命中区(透明粗线,捕捉指针事件);只传 key,事件时再查当前边,避免 undo 后引用陈旧 */
  var hit = FF.svgEl('line', {
    x1: -G / 2, y1: 0, x2: G / 2, y2: 0,
    'class': 'edge-hit', transform: tr
  }, R.layers.edges);

  var rec = { group: group, sym: sym, hit: hit, hooks: collectHooks(sym), type: e.type, tr: tr };
  R.edgeEls.set(e.id, rec);
}

/* 结点实心点:度 ≥ 3 的节点(拓扑概念,含断开关/电压表探针) */
function buildJunctions() {
  var g = R.layers.junctions;
  g.innerHTML = '';
  var deg = R.model.nodeDegrees();
  deg.forEach(function (d, key) {
    if (d < 3) return;
    var p = key.split(',');
    FF.svgEl('circle', { cx: w2(+p[0]), cy: w2(+p[1]), r: 3, 'class': 'junction-dot' }, g);
  });
}

/* ---------- 解渲染 ---------- */

function syncSolution() {
  var m = R.model, sol = R.sol;
  R.version++;
  FF.setPhiScale(Math.max(Math.abs(sol.phiMax), Math.abs(sol.phiMin)));
  colorCache.clear();

  /* 清掉上一版的动态层 */
  R.layers.underlay.innerHTML = '';
  R.layers.efield.innerHTML = '';
  R.layers.readings.innerHTML = '';
  R.gradGroup.innerHTML = '';

  /* 电场自适应参考:本电路无源元件的最大压降 */
  var efieldURef = 0.01;
  m.edges.forEach(function (e) {
    if (e.type === T.RESISTOR || e.type === T.LAMP || e.type === T.RHEOSTAT || e.type === T.SWITCH) {
      var Ux = FF.solver.edgeU(e, sol);
      if (Ux != null && Math.abs(Ux) > efieldURef) efieldURef = Math.abs(Ux);
    }
  });

  /* 灯泡亮度按绝对功率:P_ref = 3V 额定(9/R)。短路时唯一的灯也必须暗下去 */
  var lampP = new Map();
  m.edges.forEach(function (e) {
    if (e.type !== T.LAMP) return;
    var I = sol.edgeI.get(e.id);
    var U = FF.solver.edgeU(e, sol);
    var P = (I == null || U == null) ? 0 : Math.abs(U * I);
    lampP.set(e.id, P / (9 / FF.solver.rOf(e)));
  });

  m.edges.forEach(function (e) {
    var rec = R.edgeEls.get(e.id);
    if (!rec) return;
    var I = sol.edgeI.get(e.id);
    var phiA = sol.nodePhi.get(FF.nodeKey(e.a));
    var phiB = sol.nodePhi.get(FF.nodeKey(e.b));

    /* 动态部件 */
    if (e.type === T.SWITCH) FF.symbols.setLever(rec.hooks.lever, !!e.props.closed);
    if (e.type === T.RHEOSTAT) FF.symbols.setWiper(rec.hooks, e.props.wiper);
    if (e.type === T.LAMP) FF.symbols.setGlow(rec.hooks.glow, lampP.get(e.id) || 0);

    /* 仪表读数(符号下方/右侧,恒正立;画布上显示偏转幅值,带符号值见右侧面板) */
    if (e.type === T.AMMETER || e.type === T.VOLTMETER) {
      var val;
      if (e.type === T.AMMETER) val = (I == null) ? null : I;
      else val = (phiA == null || phiB == null) ? null : (phiB - phiA);
      var mid = edgeMid(e);
      var horiz = e.a[1] === e.b[1];
      var tx = mid[0] + (horiz ? 0 : 17), ty = mid[1] + (horiz ? 18 : 3);
      var t = FF.svgEl('text', { x: tx, y: ty, 'class': 'reading-text', 'text-anchor': 'middle' }, R.layers.readings);
      t.textContent = val == null ? '—' : FF.fmt(Math.abs(val), e.type === T.AMMETER ? 'A' : 'V');
    }

    /* 电势层:边色带平头、严格节点到节点(不越界);接头由节点圆盘补圆 */
    if (R.opts.potential) {
      var gid = 'eg' + e.id + 'v' + R.version;
      var lg = FF.svgEl('linearGradient', {
        id: gid, gradientUnits: 'userSpaceOnUse',
        x1: w2(e.a[0]), y1: w2(e.a[1]), x2: w2(e.b[0]), y2: w2(e.b[1])
      }, R.gradGroup);
      FF.svgEl('stop', { offset: '0%', 'stop-color': phiColor(phiA) }, lg);
      FF.svgEl('stop', { offset: '100%', 'stop-color': phiColor(phiB) }, lg);
      FF.svgEl('line', {
        x1: w2(e.a[0]), y1: w2(e.a[1]), x2: w2(e.b[0]), y2: w2(e.b[1]),
        stroke: 'url(#' + gid + ')', 'stroke-width': 9, 'stroke-linecap': 'butt', opacity: 0.92
      }, R.layers.underlay);
    }

    /* 电场箭头(只画无源元件;电池内的静电场方向与电流相反,不画) */
    if (R.opts.efield && (e.type === T.RESISTOR || e.type === T.LAMP || e.type === T.RHEOSTAT || e.type === T.SWITCH)) {
      var Ue = FF.solver.edgeU(e, sol);
      if (Ue != null && Math.abs(Ue) >= 0.01) drawEField(e, Ue, efieldURef);
    }
  });

  /* 电势节点盘:盖在平头色带的接头上(同色无缝),同时直观显示节点电势 */
  if (R.opts.potential) {
    var deg = m.nodeDegrees();
    deg.forEach(function (d, key) {
      var p = key.split(',');
      var phi = sol.nodePhi.get(key);
      FF.svgEl('circle', {
        cx: w2(+p[0]), cy: w2(+p[1]), r: 4.5,
        fill: phiColor(phi), opacity: 0.92
      }, R.layers.underlay);
    });
  }

  /* 电势数值标注 */
  if (R.opts.phiLabels) {
    sol.nodePhi.forEach(function (phi, key) {
      var p = key.split(',');
      var t = FF.svgEl('text', {
        x: w2(+p[0]) + 5, y: w2(+p[1]) - 6, 'class': 'phi-label'
      }, R.layers.readings);
      t.textContent = phi == null ? '—' : FF.fmt(phi, 'V', 2);
    });
  }

  syncParticles();
  applyProbeMarker();
  applySelection();
}

/* 电场箭头:方向 高电势 → 低电势。长度按本电路最大压降自适应,
   保证任何电路里箭头都明显可见 */
function drawEField(e, U, uRef) {
  var angle = FF.symbols.angleOf(e.a, e.b);
  var frac = FF.clamp(Math.abs(U) / uRef, 0.15, 1);
  var len = 8 + 18 * frac;
  var dir = (U > 0) ? 1 : -1;    /* U=φa−φb>0 ⇒ a 端高 ⇒ E 沿 a→b */
  var x0 = -len / 2 * dir, x1 = len / 2 * dir;
  var g = FF.svgEl('g', {
    'class': 'efield-arrow',
    transform: 'translate(' + w2((e.a[0] + e.b[0]) / 2) + ',' + w2((e.a[1] + e.b[1]) / 2) + ') rotate(' + angle + ')'
  }, R.layers.efield);
  FF.svgEl('line', { x1: x0, y1: 0, x2: x1 - 6 * dir, y2: 0, 'stroke-width': 1.5 }, g);
  FF.svgEl('polygon', {
    points: x1 + ',' + (-4) + ' ' + x1 + ',' + 4 + ' ' + (x1 - 7.5 * dir) + ',0'
  }, g);
}

/* ---------- 粒子 ---------- */

var pools = new Map();   /* edgeId -> {els[], phase[], count, speed, dir} */

function syncParticles() {
  var sol = R.sol;
  if (!sol) return;
  var layer = R.layers.particles;
  var Imax = Math.max(sol.Imax, 1e-9);
  var seen = new Set();

  if (!R.opts.potential) {
    layer.classList.remove('dimmed');
  } else {
    layer.classList.add('dimmed');
  }

  R.model.edges.forEach(function (e) {
    var I = sol.edgeI.get(e.id);
    if (!R.opts.particles || I == null || I === 0) return;
    seen.add(e.id);
    var ratio = Math.abs(I) / Imax;
    /* 匀速漂移(漂移速度不随电流剧变);电流强弱由粒子粗细表达 */
    var speed = 58;
    var dir = (I > 0 ? 1 : -1) * (R.opts.electrons ? -1 : 1);
    var radius = 1.9 + 1.9 * ratio;

    var p = pools.get(e.id);
    if (!p) {
      p = { els: [], phase: [], count: 2 };
      for (var i = 0; i < 2; i++) {
        var c = FF.svgEl('circle', { r: radius, 'class': 'particle' + (R.opts.electrons ? ' electron' : '') }, layer);
        p.els.push(c);
        p.phase.push(i / 2);
      }
      pools.set(e.id, p);
    }
    p.els.forEach(function (c) {
      c.setAttribute('class', 'particle' + (R.opts.electrons ? ' electron' : ''));
      c.setAttribute('r', radius.toFixed(2));
    });
    p.speed = speed;
    p.dir = dir;
    p.edge = e;
  });

  pools.forEach(function (p, id) {
    if (!seen.has(id)) {
      p.els.forEach(function (c) { c.remove(); });
      pools.delete(id);
    }
  });

  ensureRaf();
}

function tickParticles(now) {
  var dt = Math.min(0.05, (now - R.lastT) / 1000);
  R.lastT = now;
  pools.forEach(function (p) {
    var e = p.edge;
    var ax = w2(e.a[0]), ay = w2(e.a[1]), bx = w2(e.b[0]), by = w2(e.b[1]);
    var advance = p.speed * dt / G;
    for (var i = 0; i < p.count; i++) {
      p.phase[i] = (p.phase[i] + advance) % 1;
      /* dir=1: a→b;dir=-1: b→a */
      var t = p.dir > 0 ? p.phase[i] : 1 - p.phase[i];
      p.els[i].setAttribute('cx', FF.lerp(ax, bx, t));
      p.els[i].setAttribute('cy', FF.lerp(ay, by, t));
    }
  });
  if (pools.size) R.raf = requestAnimationFrame(tickParticles);
  else R.raf = null;
}

function ensureRaf() {
  if (!R.raf && pools.size && !document.hidden) {
    R.lastT = performance.now();
    R.raf = requestAnimationFrame(tickParticles);
  }
}

document.addEventListener('visibilitychange', function () {
  if (document.hidden && R.raf) { cancelAnimationFrame(R.raf); R.raf = null; }
  else ensureRaf();
});

/* ---------- 探针 / 选中 ---------- */

function applyProbeMarker() {
  var g = R.layers.overlay.querySelector('.probe-marker');
  if (g) g.remove();
  if (!R.probeKey) return;
  var e = R.model.edges.get(R.probeKey);
  if (!e) return;
  var mid = edgeMid(e);
  var angle = FF.symbols.angleOf(e.a, e.b);
  g = FF.svgEl('g', { 'class': 'probe-marker', transform: 'translate(' + mid[0] + ',' + mid[1] + ') rotate(' + angle + ')' }, R.layers.overlay);
  FF.svgEl('line', { x1: 0, y1: -9, x2: 0, y2: 9, stroke: '#c8451f', 'stroke-width': 2.5 }, g);
  FF.svgEl('circle', { cx: 0, cy: 0, r: 7.5, fill: 'none', stroke: '#c8451f', 'stroke-width': 1.2, 'stroke-dasharray': '3 3' }, g);
}

function applySelection() {
  var selId = null;
  R.model.edges.forEach(function (e) { if (e.key === R.selKey) selId = e.id; });
  R.edgeEls.forEach(function (rec, id) {
    rec.group.classList.toggle('selected', id === selId);
  });
  /* 选中标记 = 墨色蚂蚁线虚框(绝不用红,避免与电势/电流撞色) */
  var old = R.layers.overlay.querySelector('.sel-marker');
  if (old) old.remove();
  if (selId == null) return;
  R.model.edges.forEach(function (e) {
    if (e.id !== selId) return;
    var x1 = w2(e.a[0]), y1 = w2(e.a[1]), x2 = w2(e.b[0]), y2 = w2(e.b[1]);
    var pad = 11;
    FF.svgEl('rect', {
      'class': 'sel-marker',
      x: Math.min(x1, x2) - pad, y: Math.min(y1, y2) - pad,
      width: Math.abs(x2 - x1) + pad * 2, height: Math.abs(y2 - y1) + pad * 2,
      rx: 3
    }, R.layers.overlay);
  });
}

/* ---------- 视图(平移/缩放) ----------
 * 不变量:viewBox 宽高比永远等于 SVG 元素实际宽高比。
 * 否则 preserveAspectRatio 的 letterbox 会让"光标→世界坐标"整体偏移,
 * 表现为:预览画在一处、导线落在另一处,松手就"断开"。 */

function applyView() {
  var r = R.svg.getBoundingClientRect();
  if (r.width > 1 && r.height > 1) {
    R.view.h = R.view.w * (r.height / r.width);
  }
  R.svg.setAttribute('viewBox', R.view.x + ' ' + R.view.y + ' ' + R.view.w + ' ' + R.view.h);
}

function screenToWorld(clientX, clientY) {
  var r = R.svg.getBoundingClientRect();
  return {
    x: R.view.x + (clientX - r.left) / r.width * R.view.w,
    y: R.view.y + (clientY - r.top) / r.height * R.view.h
  };
}

function zoomAt(clientX, clientY, factor) {
  var r = R.svg.getBoundingClientRect();
  var w = screenToWorld(clientX, clientY);
  var nw = FF.clamp(R.view.w / factor, 200, 4000);
  var nh = nw * (r.height / r.width || 0.65);
  /* 缩放锚定在光标所在的世界点 */
  R.view.x = w.x - (clientX - r.left) / r.width * nw;
  R.view.y = w.y - (clientY - r.top) / r.height * nh;
  R.view.w = nw; R.view.h = nh;
  applyView();
}

function panBy(dx, dy) {
  R.view.x -= dx; R.view.y -= dy;
  applyView();
}

function fitView() {
  var m = R.model;
  if (!m.edges.size) { R.view = { x: -60, y: -60, w: 920, h: 640 }; applyView(); return; }
  var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  m.edges.forEach(function (e) {
    x0 = Math.min(x0, e.a[0], e.b[0]); x1 = Math.max(x1, e.a[0], e.b[0]);
    y0 = Math.min(y0, e.a[1], e.b[1]); y1 = Math.max(y1, e.a[1], e.b[1]);
  });
  var r = R.svg.getBoundingClientRect();
  var pad = 2.2;   /* 格数 */
  var w = (x1 - x0 + pad * 2) * G, h = (y1 - y0 + pad * 2) * G;
  var scale = Math.max(w / r.width, h / r.height);
  R.view.w = scale * r.width; R.view.h = scale * r.height;
  R.view.x = ((x0 + x1) / 2) * G - R.view.w / 2;
  R.view.y = ((y0 + y1) / 2) * G - R.view.h / 2;
  applyView();
}

/* ---------- 命中测试 ---------- */

/* 世界坐标 → 最近的边(key)与节点(存在则 [x,y]) */
function hitEdge(pt) {
  var gx = Math.round(pt.x / G), gy = Math.round(pt.y / G);
  var best = null, bestD = 15;
  var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (var i = 0; i < 4; i++) {
    var key = FF.edgeKey([gx, gy], [gx + dirs[i][0], gy + dirs[i][1]]);
    var e = R.model.edges.get(key);
    if (!e) continue;
    var d = distToEdge(pt, e);
    if (d < bestD) { bestD = d; best = key; }
  }
  return best;
}

/* 光标下最近的网格边(无论空否)——放置/预览用。
 * 空画布上也要能"看得见"放置目标,这是可用性的关键。 */
function gridEdgeAt(pt) {
  var gx = Math.round(pt.x / G), gy = Math.round(pt.y / G);
  var best = null, bestD = 18;
  var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (var i = 0; i < 4; i++) {
    var a2 = [gx, gy], b2 = [gx + dirs[i][0], gy + dirs[i][1]];
    var d = distToEdge(pt, { a: a2, b: b2 });
    if (d < bestD) { bestD = d; best = FF.edgeKey(a2, b2); }
  }
  return best;
}

/* 边键 → 两端点 */
function keyEnds(key) {
  var p = key.split('|');
  return [p[0].split(',').map(Number), p[1].split(',').map(Number)];
}

function distToEdge(pt, e) {
  var ax = w2(e.a[0]), ay = w2(e.a[1]), bx = w2(e.b[0]), by = w2(e.b[1]);
  var vx = bx - ax, vy = by - ay;
  var t = FF.clamp(((pt.x - ax) * vx + (pt.y - ay) * vy) / (vx * vx + vy * vy), 0, 1);
  var px = ax + vx * t, py = ay + vy * t;
  return Math.hypot(pt.x - px, pt.y - py);
}

function nodeAt(pt) {
  var gx = Math.round(pt.x / G), gy = Math.round(pt.y / G);
  var key = gx + ',' + gy;
  var adj = R.model.adjacency();
  if (adj.has(key) && Math.hypot(pt.x - w2(gx), pt.y - w2(gy)) < 10) return [gx, gy];
  return null;
}

/* ---------- 对外接口 ---------- */

FF.render = {
  init: function (svg) {
    R.svg = svg;
    ['defs', 'paper', 'underlay', 'edges', 'junctions', 'efield', 'readings', 'particles', 'overlay'].forEach(function (name) {
      R.layers[name] = document.getElementById('layer-' + name);
    });
    buildDefs();
    buildPaper();
    applyView();
    /* 窗口尺寸变化 → 保持 viewBox 与元素同比例(消 letterbox 偏移) */
    window.addEventListener('resize', applyView);
  },
  setModel: function (m) { R.model = m; },
  setSolution: function (sol) { R.sol = sol; },
  syncStructure: syncStructure,
  syncSolution: syncSolution,
  setOpts: function (opts) {
    Object.assign(R.opts, opts);
    if (R.sol) syncSolution();
  },
  opts: function () { return R.opts; },
  select: function (key) { R.selKey = key; applySelection(); },
  selectedKey: function () { return R.selKey; },
  probe: function (key) {
    if (key === undefined) return R.probeKey;
    R.probeKey = key;
    applyProbeMarker();
  },
  overlay: function () { return R.layers.overlay; },
  view: function () { return R.view; },
  screenToWorld: screenToWorld,
  setView: function (x, y, w) {
    R.view.x = x; R.view.y = y;
    R.view.w = FF.clamp(w, 200, 4000);
    applyView();
  },
  zoomAt: zoomAt,
  panBy: panBy,
  fitView: fitView,
  hitEdge: hitEdge,
  gridEdgeAt: gridEdgeAt,
  keyEnds: keyEnds,
  nodeAt: nodeAt
};

if (typeof module !== 'undefined' && module.exports) module.exports = FF;
})(typeof window !== 'undefined' ? window : globalThis);
