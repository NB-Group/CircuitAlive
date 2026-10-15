/* FieldFlow · util — 共享常量与纯工具(浏览器 / Node 双端可用,加载时不碰 DOM) */
(function (global) {
'use strict';

var FF = global.FF || (global.FF = {});

/* ---- 元件类型 ---- */
var T = {
  WIRE: 'wire',
  BATTERY: 'battery',
  SWITCH: 'switch',
  RESISTOR: 'resistor',
  LAMP: 'lamp',
  RHEOSTAT: 'rheostat',
  AMMETER: 'ammeter',
  VOLTMETER: 'voltmeter'
};
FF.T = T;

/* 元件中文名(面板/检查器用) */
FF.TYPE_NAME = {
  wire: '导线', battery: '电池', switch: '开关', resistor: '定值电阻',
  lamp: '小灯泡', rheostat: '滑动变阻器', ammeter: '电流表', voltmeter: '电压表'
};

FF.GRID = 40; /* 格距(世界单位) */

/* 参数合法范围(负电阻会破坏求解矩阵的正定性,必须在入口拦截) */
FF.LIMITS = { R: [0.1, 9999], Rmax: [1, 999], V: [0.1, 24] };

/* ---- id 发号(单调递增,反序列化后对齐) ---- */
var _seq = 1;
FF.nextId = function () { return _seq++; };
FF.setSeq = function (s) { if (s >= _seq) _seq = s + 1; };

/* ---- 节点 / 边键 ---- */
FF.nodeKey = function (p) { return p[0] + ',' + p[1]; };

/* 规范化边键:端点按字典序排列,保证 a-b 与 b-a 得到同一个键 */
FF.edgeKey = function (a, b) {
  var ka = a[0] + ',' + a[1], kb = b[0] + ',' + b[1];
  return ka < kb ? ka + '|' + kb : kb + '|' + ka;
};

/* 构造一条边。网格模型的核心不变量:两端必须是相邻格点。
   自环与重边因此不可能,这也是整套模型稳健的根源。 */
FF.E = function (type, x1, y1, x2, y2, props) {
  var dx = Math.abs(x1 - x2), dy = Math.abs(y1 - y2);
  if (dx + dy !== 1) {
    throw new Error('边必须连接相邻格点: (' + x1 + ',' + y1 + ')-(' + x2 + ',' + y2 + ')');
  }
  return {
    id: FF.nextId(),
    a: [x1, y1],
    b: [x2, y2],
    key: FF.edgeKey([x1, y1], [x2, y2]),
    type: type,
    props: props || {}
  };
};

/* 生成 (x1,y1)→(x2,y2) 的正交折线导线链(先横后竖,逐格一条边) */
FF.wireChain = function (x1, y1, x2, y2) {
  var out = [], x = x1, y = y1;
  while (x !== x2) { var nx = x + (x2 > x ? 1 : -1); out.push(FF.E(FF.T.WIRE, x, y, nx, y)); x = nx; }
  while (y !== y2) { var ny = y + (y2 > y ? 1 : -1); out.push(FF.E(FF.T.WIRE, x, y, x, ny)); y = ny; }
  return out;
};

FF.clamp = function (v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); };
FF.lerp = function (a, b, t) { return a + (b - a) * t; };

/* ---- 数字格式化:3 位有效数字 + SI 前缀 + 单位 ---- */
var PREFIX = [[1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ']];

function trimZeros(s) {
  return s.indexOf('.') < 0 ? s : s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

FF.fmt = function (x, unit, digits) {
  unit = unit || '';
  digits = (digits == null ? 3 : digits);
  if (x == null || !isFinite(x)) return '—';
  var ax = Math.abs(x);
  if (ax < 1e-9) return '0' + (unit ? ' ' + unit : '');
  for (var i = 0; i < PREFIX.length; i++) {
    var s = PREFIX[i][0], p = PREFIX[i][1];
    if (ax >= s) {
      var v = x / s, str;
      if (Math.abs(v) >= 999.95 && i > 0) { v = x / PREFIX[i - 1][0]; p = PREFIX[i - 1][1]; }
      if (v >= 100) str = v.toFixed(Math.max(0, digits - 3));
      else if (v >= 10) str = v.toFixed(Math.max(0, digits - 2));
      else str = v.toFixed(Math.max(0, digits - 1));
      return trimZeros(str) + p + (unit ? ' ' + unit : '');
    }
  }
  return x.toExponential(2) + (unit ? ' ' + unit : '');
};

/* ---- 微型事件总线 ---- */
function Bus() { this.h = {}; }
Bus.prototype.on = function (ev, fn) { (this.h[ev] = this.h[ev] || []).push(fn); return fn; };
Bus.prototype.off = function (ev, fn) {
  var a = this.h[ev];
  if (a) { var i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }
};
Bus.prototype.emit = function (ev, arg) {
  var a = this.h[ev];
  if (a) for (var i = 0; i < a.length; i++) a[i](arg);
};
FF.bus = new Bus();

/* ---- SVG 元素辅助(仅浏览器代码调用) ---- */
FF.svgEl = function (name, attrs, parent) {
  var el = document.createElementNS('http://www.w3.org/2000/svg', name);
  if (attrs) {
    for (var k in attrs) {
      if (attrs[k] != null) el.setAttribute(k, attrs[k]);
    }
  }
  if (parent) parent.appendChild(el);
  return el;
};

if (typeof module !== 'undefined' && module.exports) module.exports = FF;
})(typeof window !== 'undefined' ? window : globalThis);
