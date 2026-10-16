/* FieldFlow · symbols — 人教版教科书风格的电路符号
 *
 * 所有符号在局部坐标系里绘制:边从 (-20,0) 到 (+20,0),+x = 边方向 a→b。
 * render 层对 <g> 施加 rotate(angle);符号内的文字(A/V、+)单独反向旋转保持正立。
 * 动态部件用 data-hook 标记,render 拿引用做原位更新:
 *   lever  开关杠杆 · glow 灯泡光晕 · wiper 滑动变阻器滑片 · reading 表内读数 */
(function (global) {
'use strict';

var FF = global.FF || (global.FF = {});
var T = FF.T;
var NS = 'http://www.w3.org/2000/svg';
var HALF = FF.GRID / 2;   /* 20:局部坐标半径 */

function el(name, attrs, parent) { return FF.svgEl(name, attrs, parent); }
function line(g, x1, y1, x2, y2, cls) { return el('line', { x1: x1, y1: y1, x2: x2, y2: y2, 'class': cls || '' }, g); }
function dot(g, cx, cy, r) { return el('circle', { cx: cx, cy: cy, r: r, 'class': 'junction-dot' }, g); }

/* 文字保持正立:抵消外层旋转 */
function text(g, x, y, str, size, angle, attrs) {
  var t = el('text', Object.assign({
    x: x, y: y, 'font-size': size,
    'text-anchor': 'middle',
    transform: 'rotate(' + (-angle) + ' ' + x + ' ' + y + ')'
  }, attrs || {}), g);
  t.textContent = str;
  return t;
}

function stubs(g) {
  line(g, -HALF, 0, -14, 0);
  line(g, 14, 0, HALF, 0);
}

/* ---- 各元件符号(angle 为边方向角,度) ---- */

var BUILDERS = {};

BUILDERS[T.WIRE] = function (g, angle, props) {
  line(g, -HALF, 0, HALF, 0, 'wire-line');
};

/* 干电池:长线 = 正极(在 b 端,局部 +x),短粗线 = 负极 */
BUILDERS[T.BATTERY] = function (g, angle, props) {
  line(g, -HALF, 0, -4, 0);
  line(g, 4, 0, HALF, 0);
  line(g, 4, -8, 4, 8);                      /* 长细线:正极 */
  line(g, -4, -4.5, -4, 4.5, 'thick');       /* 短粗线:负极 */
  text(g, 11.5, -6.5, '+', 10, angle);
};

/* 开关:两个接线柱点 + 杠杆(开:上翘;合:水平)。lever 由 render 动态更新 */
BUILDERS[T.SWITCH] = function (g, angle, props) {
  line(g, -HALF, 0, -7, 0);
  line(g, 7, 0, HALF, 0);
  dot(g, -7, 0, 1.8);
  dot(g, 7, 0, 1.8);
  var lever = line(g, -7, 0, 5.4, -8.5);
  lever.setAttribute('data-hook', 'lever');
};

/* 定值电阻:空矩形(IEC / 人教版) */
BUILDERS[T.RESISTOR] = function (g, angle, props) {
  stubs(g);
  el('rect', { x: -11, y: -6.5, width: 22, height: 13, 'class': 'fill-paper' }, g);
};

/* 小灯泡:圆圈内打叉 + 双层伪 HDR 光晕(泛光/白热核),亮度连续受控 */
BUILDERS[T.LAMP] = function (g, angle, props) {
  var glow = el('g', { opacity: 0 }, g);
  glow.setAttribute('data-hook', 'glow');
  el('circle', { cx: 0, cy: 0, r: 10.5, fill: '#ffca66', filter: 'url(#lamp-bloom)', 'data-part': 'bloom' }, glow);
  el('circle', { cx: 0, cy: 0, r: 4, fill: 'url(#lamp-core)', 'data-part': 'core' }, glow);
  line(g, -HALF, 0, -8.5, 0);
  line(g, 8.5, 0, HALF, 0);
  el('circle', { cx: 0, cy: 0, r: 8.5, 'class': 'fill-paper' }, g);
  line(g, -6, -6, 6, 6, 'thin');
  line(g, -6, 6, 6, -6, 'thin');
};

/* 滑动变阻器:矩形 + 上方箭头线 + 滑片竖线(位置随 wiper) */
BUILDERS[T.RHEOSTAT] = function (g, angle, props) {
  line(g, -HALF, 0, -13, 0);
  line(g, 13, 0, HALF, 0);
  el('rect', { x: -13, y: -5.5, width: 26, height: 11, 'class': 'fill-paper' }, g);
  line(g, -13, -11, 10, -11, 'thin');         /* 箭杆 */
  el('polygon', { points: '10,-13.5 15,-11 10,-8.5', 'class': '' }, g); /* 箭头 */
  var wiper = line(g, 0, -11.5, 0, -5.5);
  wiper.setAttribute('data-hook', 'wiper');
  wiper.setAttribute('stroke-width', '2.5');
  var knob = el('circle', { cx: 0, cy: -11.5, r: 3.2, 'class': 'fill-paper' }, g);
  knob.setAttribute('data-hook', 'wiper-knob');
};

/* 电流表 / 电压表:圆圈 + 字母;读数文字由 render 层放到符号下方 */
function meter(g, angle, letter) {
  line(g, -HALF, 0, -9.5, 0);
  line(g, 9.5, 0, HALF, 0);
  el('circle', { cx: 0, cy: 0, r: 9.5, 'class': 'fill-paper' }, g);
  text(g, 0, 4, letter, 11, angle);
}
BUILDERS[T.AMMETER] = function (g, angle) { meter(g, angle, 'A'); };
BUILDERS[T.VOLTMETER] = function (g, angle) { meter(g, angle, 'V'); };

/* 橡皮(仅元件栏图标,画布上不出现) */
BUILDERS.eraser = function (g) {
  var r = FF.svgEl('g', { transform: 'rotate(-18)' }, g);
  FF.svgEl('rect', { x: -8, y: -6, width: 16, height: 11, rx: 1.5, 'class': 'fill-paper' }, r);
  line(r, -8, -0.5, 8, -0.5, 'thin');
};

/* ---- 构建一个元件的符号组(不含导线),返回 <g class="sym"> ---- */
FF.symbols = {
  build: function (type, angle, props) {
    var g = FF.svgEl('g', { 'class': 'sym' });
    (BUILDERS[type] || BUILDERS[T.WIRE])(g, angle || 0, props || {});
    return g;
  },

  /* 边方向角(dx,dy → 度) */
  angleOf: function (a, b) {
    return Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
  },

  /* ---- 动态部件原位更新 ---- */

  /* 开关杠杆:130ms 缓动补间 */
  setLever: function (hookEl, closed) {
    if (!hookEl) return;
    var to = closed ? { x: 7, y: 0 } : { x: 5.4, y: -8.5 };
    var from = {
      x: parseFloat(hookEl.getAttribute('x2')),
      y: parseFloat(hookEl.getAttribute('y2'))
    };
    if (!isFinite(from.x)) from = { x: 5.4, y: -8.5 };
    if (hookEl.__raf) cancelAnimationFrame(hookEl.__raf);
    var t0 = (typeof performance !== 'undefined') ? performance.now() : 0;
    function frame(now) {
      var t = Math.min(1, ((now || t0 + 130) - t0) / 130);
      var e = 1 - Math.pow(1 - t, 3);
      hookEl.setAttribute('x2', from.x + (to.x - from.x) * e);
      hookEl.setAttribute('y2', from.y + (to.y - from.y) * e);
      if (t < 1) hookEl.__raf = requestAnimationFrame(frame);
    }
    hookEl.__raf = requestAnimationFrame(frame);
  },

  /* 滑片位置(0..1):滑线与把手同步(hooks 为 {wiper, wiper-knob}) */
  setWiper: function (hooks, wiper) {
    var bar = hooks.wiper || hooks;
    if (!bar) return;
    var x = FF.lerp(-13, 13, FF.clamp(wiper == null ? 1 : wiper, 0, 1));
    bar.setAttribute('x1', x);
    bar.setAttribute('x2', x);
    if (hooks['wiper-knob']) hooks['wiper-knob'].setAttribute('cx', x);
  },

  /* 灯泡光晕强度(0..1.2,可过曝):泛光 + 白热核联动,亮度连续 */
  setGlow: function (hookEl, k) {
    if (!hookEl) return;
    k = FF.clamp(k, 0, 1.2);
    hookEl.setAttribute('opacity', Math.min(1, k * 1.05).toFixed(3));
    var bloom = hookEl.querySelector('[data-part="bloom"]');
    var core = hookEl.querySelector('[data-part="core"]');
    if (bloom) {
      bloom.setAttribute('r', (8.5 + 3.5 * k).toFixed(1));
      bloom.setAttribute('opacity', (k * 0.62).toFixed(3));
    }
    if (core) {
      core.setAttribute('r', (3 + 3.4 * k).toFixed(1));
      core.setAttribute('opacity', Math.min(1, k * 1.35).toFixed(3));
    }
  },

  /* ---- 元件栏图标(56×36,静态示意) ---- */
  paletteIcon: function (type, props) {
    var svg = FF.svgEl('svg', {
      width: 56, height: 36, viewBox: '-28 -18 56 36',
      'aria-hidden': 'true'
    });
    var g = FF.svgEl('g', {}, svg);
    g.setAttribute('class', 'sym');
    (BUILDERS[type] || BUILDERS[T.WIRE])(g, 0, props || {});
    /* 元件栏里导线没有意义长度,画短些 */
    return svg;
  },

  /* 元件栏定义(顺序即展示顺序) */
  PALETTE: [
    { type: T.WIRE,      name: '导线' },
    { type: T.BATTERY,   name: '电池', props: { V: 3 } },
    { type: T.SWITCH,    name: '开关', props: { closed: false } },
    { type: T.RESISTOR,  name: '电阻', props: { R: 10 } },
    { type: T.LAMP,      name: '灯泡', props: { R: 10 } },
    { type: T.RHEOSTAT,  name: '滑变', props: { Rmax: 50, wiper: 0.5 } },
    { type: T.AMMETER,   name: '电流表' },
    { type: T.VOLTMETER, name: '电压表' },
    { type: 'eraser',    name: '橡皮' }
  ]
};

if (typeof module !== 'undefined' && module.exports) module.exports = FF;
})(typeof window !== 'undefined' ? window : globalThis);
