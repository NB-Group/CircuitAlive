/* CircuitAlive · util — 共享常量与纯工具(ESM,浏览器 / Node 双端可用) */

/* ---- 元件类型 ---- */
export const T = {
  WIRE: 'wire',
  BATTERY: 'battery',
  SWITCH: 'switch',
  RESISTOR: 'resistor',
  LAMP: 'lamp',
  RHEOSTAT: 'rheostat',
  AMMETER: 'ammeter',
  VOLTMETER: 'voltmeter',
  MOTOR: 'motor',
  BELL: 'bell'
};

export const TYPE_NAME = {
  wire: '导线', battery: '电池', switch: '开关', resistor: '定值电阻',
  lamp: '小灯泡', rheostat: '滑动变阻器', ammeter: '电流表', voltmeter: '电压表',
  motor: '电动机', bell: '电铃'
};

export const GRID = 40;

/* 参数合法范围(负电阻会破坏求解矩阵的正定性,必须在入口拦截) */
export const LIMITS = { R: [0.1, 9999], Rmax: [1, 999], V: [0.1, 24] };

/* ---- id 发号(单调递增,反序列化后对齐) ---- */
let _seq = 1;
export const nextId = () => _seq++;
export const setSeq = (s) => { if (s >= _seq) _seq = s + 1; };

/* ---- 节点 / 边键 ---- */
export const nodeKey = (p) => p[0] + ',' + p[1];

export const edgeKey = (a, b) => {
  const ka = a[0] + ',' + a[1], kb = b[0] + ',' + b[1];
  return ka < kb ? ka + '|' + kb : kb + '|' + ka;
};

/* 构造一条边。网格模型的核心不变量:两端必须是相邻格点。 */
export const E = (type, x1, y1, x2, y2, props) => {
  const dx = Math.abs(x1 - x2), dy = Math.abs(y1 - y2);
  if (dx + dy !== 1) {
    throw new Error('边必须连接相邻格点: (' + x1 + ',' + y1 + ')-(' + x2 + ',' + y2 + ')');
  }
  return {
    id: nextId(),
    a: [x1, y1],
    b: [x2, y2],
    key: edgeKey([x1, y1], [x2, y2]),
    type,
    props: props || {}
  };
};

/* 生成 (x1,y1)→(x2,y2) 的正交折线导线链(先横后竖,逐格一条边) */
export const wireChain = (x1, y1, x2, y2) => {
  const out = [];
  let x = x1, y = y1;
  while (x !== x2) { const nx = x + (x2 > x ? 1 : -1); out.push(E(T.WIRE, x, y, nx, y)); x = nx; }
  while (y !== y2) { const ny = y + (y2 > y ? 1 : -1); out.push(E(T.WIRE, x, y, x, ny)); y = ny; }
  return out;
};

export const clamp = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));
export const lerp = (a, b, t) => a + (b - a) * t;

/* ---- 数字格式化:3 位有效数字 + SI 前缀 + 单位 ---- */
const PREFIX = [[1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ']];

const trimZeros = (s) => (s.indexOf('.') < 0 ? s : s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, ''));

export const fmt = (x, unit, digits) => {
  unit = unit || '';
  digits = (digits == null ? 3 : digits);
  if (x == null || !isFinite(x)) return '—';
  const ax = Math.abs(x);
  if (ax < 1e-9) return '0' + (unit ? ' ' + unit : '');
  for (let i = 0; i < PREFIX.length; i++) {
    const s = PREFIX[i][0];
    let p = PREFIX[i][1];
    if (ax >= s) {
      let v = x / s, str;
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
class Bus {
  constructor() { this.h = {}; }
  on(ev, fn) { (this.h[ev] = this.h[ev] || []).push(fn); return fn; }
  off(ev, fn) {
    const a = this.h[ev];
    if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }
  }
  emit(ev, arg) {
    const a = this.h[ev];
    if (a) for (let i = 0; i < a.length; i++) a[i](arg);
  }
}
export const bus = new Bus();

/* ---- SVG 元素辅助(仅浏览器代码调用) ---- */
const NS = 'http://www.w3.org/2000/svg';
export const svgEl = (name, attrs, parent) => {
  const el = document.createElementNS(NS, name);
  if (attrs) {
    for (const k in attrs) {
      if (attrs[k] != null) el.setAttribute(k, attrs[k]);
    }
  }
  if (parent) parent.appendChild(el);
  return el;
};
