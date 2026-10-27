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

/* ---- 电势发散色阶(OKLab:群青 ← 纸色 → 朱红,锚定 φ=0 对称) ----
 * 无状态版本,render(带缓存)与 3D 地形共用同一编码。 */
export const PHI_NULL_COLOR = '#b4a996';

function hexToRgb(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
function s2l(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function l2s(c) { return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055); }

function rgbToOklab(rgb) {
  const r = s2l(rgb[0]), g = s2l(rgb[1]), b = s2l(rgb[2]);
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
  return [
    0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
  ];
}

function oklabToHex(lab) {
  const l_ = lab[0] + 0.3963377774 * lab[1] + 0.2158037573 * lab[2];
  const m_ = lab[0] - 0.1055613458 * lab[1] - 0.0638541728 * lab[2];
  const s_ = lab[0] - 0.0894841775 * lab[1] - 1.2914855480 * lab[2];
  const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const b = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
  function ch(c) { c = Math.round(l2s(Math.min(1, Math.max(0, c)))); const h = c.toString(16); return h.length < 2 ? '0' + h : h; }
  return '#' + ch(r) + ch(g) + ch(b);
}

const PHI_PAPER = '#f7f2e5', PHI_VERMILION = '#c8451f', PHI_INDIGO = '#2f62a8';
const PHI_LAB_PAPER = rgbToOklab(hexToRgb(PHI_PAPER));
const PHI_LAB_HI = rgbToOklab(hexToRgb(PHI_VERMILION));
const PHI_LAB_LO = rgbToOklab(hexToRgb(PHI_INDIGO));
const phiColorCache = new Map();

export function phiColorAt(phi, phiScale) {
  if (phi == null) return PHI_NULL_COLOR;
  const t = clamp(phi / Math.max(0.05, phiScale), -1, 1);
  const key = Math.round(t * 128);
  const c = phiColorCache.get(key);
  if (c) return c;
  const lab = t >= 0 ? PHI_LAB_HI : PHI_LAB_LO, a = Math.abs(t);
  const out = oklabToHex([
    PHI_LAB_PAPER[0] + (lab[0] - PHI_LAB_PAPER[0]) * a,
    PHI_LAB_PAPER[1] + (lab[1] - PHI_LAB_PAPER[1]) * a,
    PHI_LAB_PAPER[2] + (lab[2] - PHI_LAB_PAPER[2]) * a
  ]);
  phiColorCache.set(key, out);
  return out;
}
export function phiColorHexToRgb(hex) { return hexToRgb(hex); }

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
