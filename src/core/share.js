/* FieldFlow · share · 电路的编码、分享链接与文件读写(纯 ESM,Node 可测)
 *
 * 编码格式(v1)
 *   文本:  "FF" + base64url(二进制体)
 *   二进制体:
 *     byte     版本号(1)
 *     varint   全局导线电阻,单位 mΩ
 *     varint   边数
 *     每条边:
 *       byte     类型码(w 导线, b 电池, s 开关, r 电阻, l 灯泡,
 *                        h 滑变, a 电流表, v 电压表, m 电动机, n 电铃)
 *       varint   端点坐标 x1 y1 x2 y2(zigzag 有符号)
 *       byte     属性位掩码
 *       按掩码顺序排列的数值: V(mV) r(mΩ) R(mΩ) Rmax(mΩ) wiper(‰) 标签长度 + UTF-8
 *
 * 坐标与网格规则一致:一条边只能连接水平或竖直相邻的两个格点。
 * 解码后按数组顺序重新编号 id,顺序不变,元件标号(R₁、A₁…)因此保持稳定。
 *
 * 数值精度:V 存到 mV,r、R、Rmax 存到 mΩ,wiper 存到千分之一。
 * 编码前按这一精度取整,界面上的参数步进本来就不小于它。
 */

import { T } from './util.js';
import { copy } from '../data/copy.js';

export const SCHEMA_VERSION = 1;

const PREFIX = 'FF';
const MAX_CODE_LEN = 100000;
const MAX_EDGES = 2000;
const MAX_COORD = 4096;
const MAX_LABEL = 200;

const TYPE_TO_CODE = {
  [T.WIRE]: 'w',
  [T.BATTERY]: 'b',
  [T.SWITCH]: 's',
  [T.RESISTOR]: 'r',
  [T.LAMP]: 'l',
  [T.RHEOSTAT]: 'h',
  [T.AMMETER]: 'a',
  [T.VOLTMETER]: 'v',
  [T.MOTOR]: 'm',
  [T.BELL]: 'n'
};

const CODE_TO_TYPE = {};
Object.keys(TYPE_TO_CODE).forEach((type) => {
  CODE_TO_TYPE[TYPE_TO_CODE[type]] = type;
});

/* 每种元件允许出现的属性键。label 是可选的自定义名称,所有元件通用。 */
const PROP_KEYS = {
  [T.WIRE]: ['r', 'label'],
  [T.BATTERY]: ['V', 'r', 'label'],
  [T.SWITCH]: ['closed', 'label'],
  [T.RESISTOR]: ['R', 'label'],
  [T.LAMP]: ['R', 'label'],
  [T.RHEOSTAT]: ['Rmax', 'wiper', 'label'],
  [T.AMMETER]: ['label'],
  [T.VOLTMETER]: ['label'],
  [T.MOTOR]: ['label'],
  [T.BELL]: ['label']
};

/* 掩码位 */
const BIT_V = 0x01;
const BIT_R = 0x02;
const BIT_RES = 0x04;
const BIT_RMAX = 0x08;
const BIT_WIPER = 0x10;
const BIT_CLOSED = 0x20;
const BIT_LABEL = 0x40;

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64_INV = {};
for (let i = 0; i < B64.length; i++) B64_INV[B64[i]] = i;

const utf8 = new TextEncoder();
const utf8Fatal = new TextDecoder('utf-8', { fatal: true });

class ShareError extends Error {
  constructor(code, params) {
    const entry = copy.errors.share[code];
    const text = typeof entry === 'function' ? entry.apply(null, params || []) : entry;
    super(text || code);
    this.name = 'ShareError';
    this.code = code;
  }
}

function fail(code) {
  throw new ShareError(code, Array.prototype.slice.call(arguments, 1));
}

/* ---------- base64url ---------- */

function toBase64Url(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | (b1 >> 4)];
    if (i + 1 < bytes.length) out += B64[((b1 & 15) << 2) | (b2 >> 6)];
    if (i + 2 < bytes.length) out += B64[b2 & 63];
  }
  return out;
}

function fromBase64Url(text) {
  if (text.length % 4 === 1) fail('badBody');
  const out = new Uint8Array(Math.floor((text.length * 3) / 4));
  let buf = 0;
  let bits = 0;
  let o = 0;
  for (let i = 0; i < text.length; i++) {
    const v = B64_INV[text[i]];
    if (v === undefined) fail('badChars');
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buf >> bits) & 0xff;
      buf &= (1 << bits) - 1;
    }
  }
  if (bits > 0 && buf !== 0) fail('badBody');
  return out.subarray(0, o);
}

/* ---------- 变长整数 ---------- */

function writeVarint(out, value) {
  let n = value;
  if (!Number.isInteger(n) || n < 0) fail('badBody');
  while (n >= 0x80) {
    out.push((n & 0x7f) | 0x80);
    n = Math.floor(n / 128);
  }
  out.push(n);
}

const zigzag = (n) => (n >= 0 ? n * 2 : -n * 2 - 1);
const unzigzag = (n) => (n % 2 === 0 ? n / 2 : -(n + 1) / 2);

function Reader(bytes) {
  this.bytes = bytes;
  this.i = 0;
}

Reader.prototype.byte = function () {
  if (this.i >= this.bytes.length) fail('badBody');
  return this.bytes[this.i++];
};

Reader.prototype.varint = function () {
  let n = 0;
  let mul = 1;
  for (;;) {
    const b = this.byte();
    n += (b & 0x7f) * mul;
    if (!(b & 0x80)) return n;
    mul *= 128;
    if (mul > Number.MAX_SAFE_INTEGER / 128) fail('badBody');
  }
};

/* ---------- 数据规范化与校验 ---------- */

function toData(modelOrData) {
  if (modelOrData && typeof modelOrData.serialize === 'function') {
    return modelOrData.serialize();
  }
  return modelOrData;
}

function readRawEdge(raw, i) {
  let type;
  let a;
  let b;
  let props;
  if (Array.isArray(raw)) {
    type = raw[0];
    a = [raw[1], raw[2]];
    b = [raw[3], raw[4]];
    props = raw[5] || {};
  } else if (raw && typeof raw === 'object') {
    type = raw.t || raw.type;
    a = raw.a;
    b = raw.b;
    props = raw.p || raw.props || {};
  } else {
    fail('badEdge', i);
  }

  if (!TYPE_TO_CODE[type]) fail('unknownType', i, String(type));
  if (!Array.isArray(a) || !Array.isArray(b) || a.length < 2 || b.length < 2) {
    fail('badEdge', i);
  }

  const x1 = a[0];
  const y1 = a[1];
  const x2 = b[0];
  const y2 = b[1];
  const coords = [x1, y1, x2, y2];
  for (let k = 0; k < 4; k++) {
    const v = coords[k];
    if (!Number.isInteger(v)) fail('badCoord', i);
    if (v < -MAX_COORD || v > MAX_COORD) fail('coordRange', i);
  }
  if (Math.abs(x1 - x2) + Math.abs(y1 - y2) !== 1) {
    fail('diagonal', i, x1, y1, x2, y2);
  }
  if (!props || typeof props !== 'object' || Array.isArray(props)) {
    fail('badProps', i);
  }

  return { id: raw && raw.id, t: type, a: [x1, y1], b: [x2, y2], p: props };
}

function pickNum(props, key, def, lo, hi, i) {
  let v = props[key];
  if (v === undefined) {
    if (def === undefined) fail('badPropValue', i, key);
    v = def;
  }
  if (typeof v !== 'number' || !isFinite(v) || v < lo || v > hi) {
    fail('badPropValue', i, key);
  }
  return v;
}

/* 主参数(V、R、Rmax)必须写全,缺了就报错,免得默认值悄悄换掉电路含义。
 * 内阻 r 和滑片位置 wiper 有求解器认可的默认值,可以省略。 */
function canonicalProps(type, props, i) {
  const allowed = PROP_KEYS[type];
  const keys = Object.keys(props);
  for (let k = 0; k < keys.length; k++) {
    if (allowed.indexOf(keys[k]) < 0) fail('badPropKey', i, keys[k]);
  }

  let out;
  switch (type) {
    case T.BATTERY:
      out = {
        V: pickNum(props, 'V', undefined, 0.1, 24, i),
        r: pickNum(props, 'r', 0.1, 0.01, 50, i)
      };
      break;
    case T.SWITCH:
      if (props.closed !== undefined && typeof props.closed !== 'boolean') {
        fail('badPropValue', i, 'closed');
      }
      out = { closed: !!props.closed };
      break;
    case T.RESISTOR:
    case T.LAMP:
      out = { R: pickNum(props, 'R', undefined, 0.1, 9999, i) };
      break;
    case T.RHEOSTAT:
      out = {
        Rmax: pickNum(props, 'Rmax', undefined, 1, 999, i),
        wiper: pickNum(props, 'wiper', 1, 0, 1, i)
      };
      break;
    default:
      out = {};
  }

  if (props.label !== undefined) {
    if (typeof props.label !== 'string' || props.label.length === 0 || props.label.length > MAX_LABEL) {
      fail('badPropValue', i, 'label');
    }
    out.label = props.label;
  }
  return out;
}

function canonicalizeCircuit(data, kind) {
  const shapeCode = kind === 'file' ? 'fileShape' : 'badData';
  const edgesCode = kind === 'file' ? 'fileEdges' : 'badData';

  if (!data || typeof data !== 'object' || Array.isArray(data)) fail(shapeCode);
  if (!Array.isArray(data.edges)) fail(edgesCode);

  let wireR = data.wireR == null ? 0 : data.wireR;
  if (typeof wireR !== 'number' || !isFinite(wireR) || wireR < 0 || wireR > 50) {
    fail('badWireR');
  }

  const seen = new Set();
  const edges = [];

  for (let i = 0; i < data.edges.length; i++) {
    if (i >= MAX_EDGES) fail('badEdgeCount');
    const raw = readRawEdge(data.edges[i], i);

    /* 旧数据迁移:单根导线的 r 折算成全局导线电阻 */
    if (raw.t === T.WIRE && raw.p.r > 0 && wireR === 0) wireR = raw.p.r;

    const p = canonicalProps(raw.t, raw.p, i);
    const [x1, y1] = raw.a;
    const [x2, y2] = raw.b;
    const key = x1 < x2 || (x1 === x2 && y1 < y2)
      ? x1 + ',' + y1 + '|' + x2 + ',' + y2
      : x2 + ',' + y2 + '|' + x1 + ',' + y1;
    if (seen.has(key)) fail('duplicate', i);
    seen.add(key);

    const id = Number.isInteger(raw.id) && raw.id > 0 ? raw.id : i + 1;
    edges.push({ id, t: raw.t, a: [x1, y1], b: [x2, y2], p });
  }

  return { wireR, edges };
}

/* ---------- 编码 ---------- */

export function encodeCircuit(modelOrData) {
  const data = canonicalizeCircuit(toData(modelOrData), 'share');
  const out = [SCHEMA_VERSION];

  writeVarint(out, Math.round(data.wireR * 1000));
  writeVarint(out, data.edges.length);

  for (let i = 0; i < data.edges.length; i++) {
    const e = data.edges[i];
    const code = TYPE_TO_CODE[e.t];
    out.push(code.charCodeAt(0));

    writeVarint(out, zigzag(e.a[0]));
    writeVarint(out, zigzag(e.a[1]));
    writeVarint(out, zigzag(e.b[0]));
    writeVarint(out, zigzag(e.b[1]));

    let mask = 0;
    if (e.t === T.BATTERY) {
      mask |= BIT_V;
      if (e.p.r !== 0.1) mask |= BIT_R;
    } else if (e.t === T.RESISTOR || e.t === T.LAMP) {
      mask |= BIT_RES;
    } else if (e.t === T.RHEOSTAT) {
      mask |= BIT_RMAX;
      if (e.p.wiper !== 1) mask |= BIT_WIPER;
    } else if (e.t === T.SWITCH) {
      if (e.p.closed) mask |= BIT_CLOSED;
    }
    if (e.p.label) mask |= BIT_LABEL;
    out.push(mask);

    if (e.t === T.BATTERY) {
      writeVarint(out, Math.round(e.p.V * 1000));
      if (mask & BIT_R) writeVarint(out, Math.round(e.p.r * 1000));
    } else if (e.t === T.RESISTOR || e.t === T.LAMP) {
      writeVarint(out, Math.round(e.p.R * 1000));
    } else if (e.t === T.RHEOSTAT) {
      writeVarint(out, Math.round(e.p.Rmax * 1000));
      if (mask & BIT_WIPER) writeVarint(out, Math.round(e.p.wiper * 1000));
    }

    if (mask & BIT_LABEL) {
      const bytes = utf8.encode(e.p.label);
      writeVarint(out, bytes.length);
      for (let k = 0; k < bytes.length; k++) out.push(bytes[k]);
    }
  }

  return PREFIX + toBase64Url(out);
}

/* ---------- 解码 ---------- */

function readLabel(reader, i) {
  const len = reader.varint();
  if (len > MAX_LABEL * 4) fail('badLabel', i);
  if (reader.i + len > reader.bytes.length) fail('badBody');
  const slice = reader.bytes.subarray(reader.i, reader.i + len);
  reader.i += len;
  try {
    return utf8Fatal.decode(slice);
  } catch (err) {
    fail('badLabel', i);
  }
}

export function decodeCircuit(text) {
  if (typeof text !== 'string') fail('notString');
  const str = text.trim();
  if (!str) fail('empty');
  if (str.length > MAX_CODE_LEN) fail('tooLong');
  if (str.slice(0, PREFIX.length) !== PREFIX) fail('badPrefix');

  const body = str.slice(PREFIX.length);
  if (!body) fail('badBody');
  for (let i = 0; i < body.length; i++) {
    if (B64_INV[body[i]] === undefined) fail('badChars');
  }

  const bytes = fromBase64Url(body);
  const reader = new Reader(bytes);

  const version = reader.byte();
  if (version !== SCHEMA_VERSION) fail('badVersion', version, SCHEMA_VERSION);

  const wireR = reader.varint() / 1000;
  if (!(wireR >= 0 && wireR <= 50)) fail('badWireR');

  const count = reader.varint();
  if (count > MAX_EDGES) fail('badEdgeCount');

  const rawEdges = [];
  for (let i = 0; i < count; i++) {
    const code = String.fromCharCode(reader.byte());
    const type = CODE_TO_TYPE[code];
    if (!type) fail('unknownType', i, code);

    const x1 = unzigzag(reader.varint());
    const y1 = unzigzag(reader.varint());
    const x2 = unzigzag(reader.varint());
    const y2 = unzigzag(reader.varint());

    const mask = reader.byte();
    const props = {};

    if (type === T.BATTERY) {
      if (!(mask & BIT_V)) fail('badProps', i);
      if (mask & ~(BIT_V | BIT_R | BIT_LABEL)) fail('badProps', i);
      props.V = reader.varint() / 1000;
      if (mask & BIT_R) props.r = reader.varint() / 1000;
    } else if (type === T.RESISTOR || type === T.LAMP) {
      if (!(mask & BIT_RES)) fail('badProps', i);
      if (mask & ~(BIT_RES | BIT_LABEL)) fail('badProps', i);
      props.R = reader.varint() / 1000;
    } else if (type === T.RHEOSTAT) {
      if (!(mask & BIT_RMAX)) fail('badProps', i);
      if (mask & ~(BIT_RMAX | BIT_WIPER | BIT_LABEL)) fail('badProps', i);
      props.Rmax = reader.varint() / 1000;
      if (mask & BIT_WIPER) props.wiper = reader.varint() / 1000;
    } else if (type === T.SWITCH) {
      if (mask & ~(BIT_CLOSED | BIT_LABEL)) fail('badProps', i);
      props.closed = !!(mask & BIT_CLOSED);
    } else {
      if (mask & ~BIT_LABEL) fail('badProps', i);
    }

    if (mask & BIT_LABEL) props.label = readLabel(reader, i);

    rawEdges.push({ t: type, a: [x1, y1], b: [x2, y2], p: props });
  }

  if (reader.i !== bytes.length) fail('badBody');

  const data = canonicalizeCircuit({ wireR, edges: rawEdges }, 'share');
  return { wireR: data.wireR, edges: data.edges };
}

/* ---------- 分享链接 ---------- */

export function buildShareUrl(code, base) {
  let root = base;
  if (!root) {
    if (typeof location === 'undefined') fail('noBase');
    /* file:// 页面的 origin 是字符串 "null",此时只用路径 */
    const origin = location.origin && location.origin !== 'null' ? location.origin : '';
    root = origin + location.pathname;
  }
  while (root.length > 1 && root[root.length - 1] === '#') root = root.slice(0, -1);
  return root + '#/edit?s=' + code;
}

/* ---------- 文件 ---------- */

function fileSafeName(name) {
  let base = typeof name === 'string' && name.trim() ? name.trim() : 'circuit';
  base = base.replace(/[\\/:*?"<>|\x00-\x1f]/g, '-');
  if (!/\.ff\.json$/i.test(base)) {
    base = base.replace(/\.json$/i, '') + '.ff.json';
  }
  return base;
}

export function serializeCircuit(modelOrData) {
  const data = canonicalizeCircuit(toData(modelOrData), 'share');
  return {
    schema: 'fieldflow/circuit',
    v: SCHEMA_VERSION,
    wireR: data.wireR,
    edges: data.edges.map((e) => ({ id: e.id, t: e.t, a: e.a, b: e.b, p: e.p }))
  };
}

export function downloadCircuit(modelOrData, filename) {
  if (typeof document === 'undefined' || typeof URL === 'undefined') {
    throw new ShareError('noDom');
  }
  const data = serializeCircuit(modelOrData);
  const text = JSON.stringify(data, null, 2);
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const name = fileSafeName(filename);
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  return name;
}

export function readCircuitFile(file) {
  return Promise.resolve().then(function () {
    if (!file) fail('fileMissing');
    let textPromise;
    if (typeof file.text === 'function') {
      textPromise = file.text();
    } else if (typeof FileReader !== 'undefined') {
      textPromise = new Promise(function (resolve, reject) {
        const reader = new FileReader();
        reader.onload = function () { resolve(String(reader.result || '')); };
        reader.onerror = function () { reject(new Error('read failed')); };
        reader.readAsText(file);
      });
    } else {
      fail('fileUnreadable');
    }
    return Promise.resolve(textPromise).catch(function () { fail('fileUnreadable'); });
  }).then(function (text) {
    let json;
    try {
      json = JSON.parse(text);
    } catch (err) {
      fail('fileJson');
    }
    if (!json || typeof json !== 'object' || Array.isArray(json)) fail('fileShape');
    if (json.schema !== undefined && json.schema !== 'fieldflow/circuit') fail('fileShape');
    const version = json.v !== undefined ? json.v : json.version;
    if (version === undefined) fail('fileShape');
    if (version !== SCHEMA_VERSION) fail('fileVersion', version, SCHEMA_VERSION);

    const data = canonicalizeCircuit(json, 'file');
    return { v: SCHEMA_VERSION, wireR: data.wireR, edges: data.edges };
  });
}

export { ShareError };
