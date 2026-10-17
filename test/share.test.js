/* FieldFlow · share 单元测试 · Node 直接运行:node test/share.test.js
 * 无框架、无依赖,只用 node:assert。 */
'use strict';

import assert from 'node:assert/strict';
import {
  SCHEMA_VERSION,
  encodeCircuit,
  decodeCircuit,
  buildShareUrl,
  serializeCircuit,
  downloadCircuit,
  readCircuitFile,
  ShareError
} from '../src/core/share.js';
import { T } from '../src/core/util.js';
import { Model } from '../src/core/model.js';

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ✓ ' + name);
  } catch (err) {
    failed++;
    failures.push({ name, err });
    console.log('  ✗ ' + name + '\n      ' + (err && err.message));
  }
}

function testAsync(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log('  ✓ ' + name); })
    .catch((err) => { failed++; failures.push({ name, err }); console.log('  ✗ ' + name + '\n      ' + (err && err.message)); });
}

function throwsShare(fn, code, label) {
  let caught = null;
  try { fn(); } catch (err) { caught = err; }
  assert.ok(caught, (label || '') + ' 应当抛错');
  assert.equal(caught.name, 'ShareError', (label || '') + ' 应抛 ShareError,实际 ' + caught.name + ': ' + caught.message);
  if (code) assert.equal(caught.code, code, (label || '') + ' 错误码应为 ' + code + ',实际 ' + caught.code);
  assert.ok(caught.message && caught.message.length > 0, '错误信息不能为空');
}

/* ---------- 数据助手 ---------- */

/* 40 条边的矩形回路:电池 + 若干元件 + 导线 */
function rectCircuit() {
  const edges = [];
  const W = 10;
  const H = 10;
  edges.push({ t: T.BATTERY, a: [0, 0], b: [1, 0], p: { V: 3, r: 0.1 } });
  for (let x = 1; x < W; x++) {
    edges.push({ t: T.WIRE, a: [x, 0], b: [x + 1, 0], p: {} });
  }
  for (let y = 0; y < H; y++) {
    edges.push({ t: T.WIRE, a: [W, y], b: [W, y + 1], p: {} });
  }
  for (let x = W; x > 0; x--) {
    edges.push({ t: T.WIRE, a: [x, H], b: [x - 1, H], p: {} });
  }
  for (let y = H; y > 0; y--) {
    edges.push({ t: T.WIRE, a: [0, y], b: [0, y - 1], p: {} });
  }
  return { wireR: 0, edges };
}

function mixedCircuit() {
  return {
    wireR: 0.02,
    edges: [
      { t: T.BATTERY, a: [0, 0], b: [1, 0], p: { V: 4.5, r: 0.2 } },
      { t: T.WIRE, a: [1, 0], b: [2, 0], p: {} },
      { t: T.SWITCH, a: [2, 0], b: [3, 0], p: { closed: true } },
      { t: T.RESISTOR, a: [3, 0], b: [4, 0], p: { R: 10 } },
      { t: T.LAMP, a: [4, 0], b: [5, 0], p: { R: 20 } },
      { t: T.RHEOSTAT, a: [5, 0], b: [6, 0], p: { Rmax: 50, wiper: 0.35 } },
      { t: T.AMMETER, a: [6, 0], b: [7, 0], p: {} },
      { t: T.WIRE, a: [7, 0], b: [7, 1], p: {} },
      { t: T.VOLTMETER, a: [6, 1], b: [7, 1], p: {} },
      { t: T.WIRE, a: [6, 1], b: [6, 0], p: {} },
      { t: T.MOTOR, a: [0, 1], b: [1, 1], p: {} },
      { t: T.BELL, a: [1, 1], b: [2, 1], p: {} }
    ]
  };
}

/* ---------- 往返 ---------- */

console.log('FieldFlow share 测试');

test('SCHEMA_VERSION 为 1', () => {
  assert.equal(SCHEMA_VERSION, 1);
});

test('空电路往返:wireR 与边数都保持', () => {
  const code = encodeCircuit({ wireR: 0, edges: [] });
  assert.ok(code.startsWith('FF'), '分享码以 FF 开头');
  const back = decodeCircuit(code);
  assert.equal(back.wireR, 0);
  assert.equal(back.edges.length, 0);
});

test('往返:全部元件类型与参数逐项相等', () => {
  const src = mixedCircuit();
  const back = decodeCircuit(encodeCircuit(src));
  assert.equal(back.wireR, src.wireR);
  assert.equal(back.edges.length, src.edges.length);
  src.edges.forEach((e, i) => {
    const r = back.edges[i];
    assert.equal(r.t, e.t, '第 ' + i + ' 条边类型');
    assert.deepEqual(r.a, e.a, '第 ' + i + ' 条边起点');
    assert.deepEqual(r.b, e.b, '第 ' + i + ' 条边终点');
    assert.deepEqual(r.p, e.p, '第 ' + i + ' 条边参数');
  });
});

test('往返:id 按顺序重排,元件标号顺序不变', () => {
  const src = mixedCircuit();
  const back = decodeCircuit(encodeCircuit(src));
  back.edges.forEach((e, i) => assert.equal(e.id, i + 1, 'id 应为序号 ' + (i + 1)));
});

test('往返:坐标可以为负,也可以离原点很远', () => {
  const src = {
    wireR: 0,
    edges: [
      { t: T.WIRE, a: [-300, -200], b: [-300, -199], p: {} },
      { t: T.BATTERY, a: [900, 400], b: [901, 400], p: { V: 1.5, r: 0.1 } }
    ]
  };
  const back = decodeCircuit(encodeCircuit(src));
  assert.deepEqual(back.edges[0].a, [-300, -200]);
  assert.deepEqual(back.edges[0].b, [-300, -199]);
  assert.deepEqual(back.edges[1].a, [900, 400]);
});

test('往返:导线电阻保留三位小数', () => {
  const back = decodeCircuit(encodeCircuit({ wireR: 1.234, edges: [] }));
  assert.equal(back.wireR, 1.234);
});

test('往返:开关的两种状态', () => {
  const src = {
    wireR: 0,
    edges: [
      { t: T.SWITCH, a: [0, 0], b: [1, 0], p: { closed: false } },
      { t: T.SWITCH, a: [2, 0], b: [3, 0], p: { closed: true } }
    ]
  };
  const back = decodeCircuit(encodeCircuit(src));
  assert.equal(back.edges[0].p.closed, false);
  assert.equal(back.edges[1].p.closed, true);
});

test('往返:接受元组形式的边与 model.serialize() 形式', () => {
  const tuples = [
    [T.BATTERY, 0, 0, 1, 0, { V: 3 }],
    [T.WIRE, 1, 0, 1, 1, {}],
    [T.RESISTOR, 1, 1, 0, 1, { R: 15 }],
    [T.WIRE, 0, 1, 0, 0, {}]
  ];
  const back = decodeCircuit(encodeCircuit({ wireR: 0, edges: tuples }));
  assert.equal(back.edges.length, 4);
  assert.equal(back.edges[2].t, T.RESISTOR);
  assert.equal(back.edges[2].p.R, 15);

  const modelLike = {
    serialize: () => ({
      v: 1,
      wireR: 0,
      edges: [{ id: 7, t: T.WIRE, a: [0, 0], b: [1, 0], p: {} }]
    })
  };
  const back2 = decodeCircuit(encodeCircuit(modelLike));
  assert.equal(back2.edges.length, 1);
  assert.equal(back2.edges[0].t, T.WIRE);
});

test('往返:电池省略内阻时按默认 0.1 Ω 处理', () => {
  const back = decodeCircuit(encodeCircuit({
    wireR: 0,
    edges: [{ t: T.BATTERY, a: [0, 0], b: [1, 0], p: { V: 3 } }]
  }));
  assert.equal(back.edges[0].p.r, 0.1);
});

test('往返:旧数据里单根导线的 r 折算成全局 wireR', () => {
  const back = decodeCircuit(encodeCircuit({
    wireR: 0,
    edges: [{ t: T.WIRE, a: [0, 0], b: [1, 0], p: { r: 0.5 } }]
  }));
  assert.equal(back.wireR, 0.5);
});

/* ---------- 中文属性 ---------- */

test('中文标签:往返后逐字相同', () => {
  const src = {
    wireR: 0,
    edges: [
      { t: T.BATTERY, a: [0, 0], b: [1, 0], p: { V: 3, r: 0.1, label: '干电池①' } },
      { t: T.RESISTOR, a: [1, 0], b: [2, 0], p: { R: 10, label: '定值电阻 10 Ω' } },
      { t: T.LAMP, a: [2, 0], b: [3, 0], p: { R: 20, label: '小灯泡（额定 2.5 V）' } },
      { t: T.MOTOR, a: [3, 0], b: [4, 0], p: { label: '电动机 A' } }
    ]
  };
  const back = decodeCircuit(encodeCircuit(src));
  assert.equal(back.edges[0].p.label, '干电池①');
  assert.equal(back.edges[1].p.label, '定值电阻 10 Ω');
  assert.equal(back.edges[2].p.label, '小灯泡（额定 2.5 V）');
  assert.equal(back.edges[3].p.label, '电动机 A');
});

test('中文标签:编码结果只含 URL 安全字符', () => {
  const code = encodeCircuit({
    wireR: 0,
    edges: [{ t: T.RESISTOR, a: [0, 0], b: [1, 0], p: { R: 10, label: '滑动变阻器与电阻箱' } }]
  });
  assert.match(code, /^FF[A-Za-z0-9_-]+$/, '分享码只允许 base64url 字符');
});

/* ---------- 链接长度 ---------- */

test('40 条边的回路:分享码长度小于 2000', () => {
  const src = rectCircuit();
  assert.equal(src.edges.length, 40, '测试电路应为 40 条边');
  const code = encodeCircuit(src);
  const url = buildShareUrl(code, 'https://example.test/fieldflow/');
  assert.ok(code.length < 500, '40 条边的分享码应很短,实际 ' + code.length);
  assert.ok(url.length < 2000, '完整链接应小于 2000 字符,实际 ' + url.length);
});

test('40 条边且带中文标签:链接长度仍小于 2000', () => {
  const src = rectCircuit();
  const labelAt = [3, 7, 11];
  const names = ['第一个定值电阻', '第二个定值电阻', '第三个定值电阻'];
  labelAt.forEach((idx, k) => {
    src.edges[idx] = { ...src.edges[idx], t: T.RESISTOR, p: { R: 10 * (k + 1), label: names[k] } };
  });
  const url = buildShareUrl(encodeCircuit(src), 'https://example.test/');
  assert.ok(url.length < 2000, '完整链接应小于 2000 字符,实际 ' + url.length);
  const back = decodeCircuit(encodeCircuit(src));
  assert.equal(back.edges[11].p.label, '第三个定值电阻');
});

/* ---------- 链接构造 ---------- */

test('buildShareUrl:使用给定的 base', () => {
  assert.equal(
    buildShareUrl('FFabc', 'https://example.test/app/'),
    'https://example.test/app/#/edit?s=FFabc'
  );
});

test('buildShareUrl:base 末尾带 # 时不重复', () => {
  assert.equal(
    buildShareUrl('FFabc', 'https://example.test/app/#'),
    'https://example.test/app/#/edit?s=FFabc'
  );
});

test('buildShareUrl:没有 base 且没有 location 时报错', () => {
  throwsShare(() => buildShareUrl('FFabc'), 'noBase');
});

test('buildShareUrl:读取 location 的 origin 与 pathname', () => {
  const prev = globalThis.location;
  globalThis.location = { origin: 'https://example.test', pathname: '/ff/index.html' };
  try {
    assert.equal(
      buildShareUrl('FFxyz'),
      'https://example.test/ff/index.html#/edit?s=FFxyz'
    );
  } finally {
    if (prev === undefined) delete globalThis.location;
    else globalThis.location = prev;
  }
});

/* ---------- 拒绝坏输入 ---------- */

test('拒绝:非字符串、空串、缺前缀', () => {
  throwsShare(() => decodeCircuit(null), 'notString');
  throwsShare(() => decodeCircuit(123), 'notString');
  throwsShare(() => decodeCircuit(''), 'empty');
  throwsShare(() => decodeCircuit('   '), 'empty');
  throwsShare(() => decodeCircuit('ZZabcd'), 'badPrefix');
  throwsShare(() => decodeCircuit('FF'), 'badBody');
});

test('拒绝:非法字符', () => {
  throwsShare(() => decodeCircuit('FFabc$def'), 'badChars');
  throwsShare(() => decodeCircuit('FFabc def'), 'badChars');
  throwsShare(() => decodeCircuit('FFab='), 'badChars');
});

test('拒绝:截断的分享码', () => {
  const code = encodeCircuit(mixedCircuit());
  for (let cut = 3; cut < code.length - 1; cut += 7) {
    throwsShare(() => decodeCircuit(code.slice(0, cut)), null, '截断到 ' + cut + ' 字符');
  }
});

test('拒绝:尾部多余字节', () => {
  const code = encodeCircuit({ wireR: 0, edges: [] });
  throwsShare(() => decodeCircuit(code + 'AA'), 'badBody');
});

test('拒绝:版本号不认识', () => {
  /* FF + base64url([2]) = FFAg */
  throwsShare(() => decodeCircuit('FFAg'), 'badVersion');
});

test('拒绝:对角线边', () => {
  throwsShare(() => encodeCircuit({
    wireR: 0,
    edges: [{ t: T.WIRE, a: [0, 0], b: [1, 1], p: {} }]
  }), 'diagonal');
});

test('拒绝:跨两格或原地不动的边', () => {
  throwsShare(() => encodeCircuit({
    wireR: 0,
    edges: [{ t: T.WIRE, a: [0, 0], b: [2, 0], p: {} }]
  }), 'diagonal');
  throwsShare(() => encodeCircuit({
    wireR: 0,
    edges: [{ t: T.WIRE, a: [3, 3], b: [3, 3], p: {} }]
  }), 'diagonal');
});

test('拒绝:解码出的对角线边(手工构造字节)', () => {
  /* v1, wireR=0, 1 条边, w, (0,0)->(1,1), mask=0 */
  const bytes = [1, 0, 1, 'w'.charCodeAt(0), 0, 0, 2, 2, 0];
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  const code = 'FF' + Buffer.from(bin, 'binary').toString('base64url');
  throwsShare(() => decodeCircuit(code), 'diagonal');
});

test('拒绝:坐标不是整数或超出范围', () => {
  throwsShare(() => encodeCircuit({
    wireR: 0,
    edges: [{ t: T.WIRE, a: [0.5, 0], b: [1.5, 0], p: {} }]
  }), 'badCoord');
  throwsShare(() => encodeCircuit({
    wireR: 0,
    edges: [{ t: T.WIRE, a: [0, 0], b: [1, 0], p: {} }].map((e) => ({ ...e, a: [99999, 0], b: [99998, 0] }))
  }), 'coordRange');
});

test('拒绝:未知元件类型', () => {
  throwsShare(() => encodeCircuit({
    wireR: 0,
    edges: [{ t: 'capacitor', a: [0, 0], b: [1, 0], p: {} }]
  }), 'unknownType');
});

test('拒绝:未知参数键', () => {
  throwsShare(() => encodeCircuit({
    wireR: 0,
    edges: [{ t: T.RESISTOR, a: [0, 0], b: [1, 0], p: { R: 10, color: 'red' } }]
  }), 'badPropKey');
});

test('拒绝:参数缺失、类型错误或越界', () => {
  throwsShare(() => encodeCircuit({
    wireR: 0,
    edges: [{ t: T.RESISTOR, a: [0, 0], b: [1, 0], p: {} }]
  }), 'badPropValue');
  throwsShare(() => encodeCircuit({
    wireR: 0,
    edges: [{ t: T.RESISTOR, a: [0, 0], b: [1, 0], p: { R: '10' } }]
  }), 'badPropValue');
  throwsShare(() => encodeCircuit({
    wireR: 0,
    edges: [{ t: T.RESISTOR, a: [0, 0], b: [1, 0], p: { R: -1 } }]
  }), 'badPropValue');
  throwsShare(() => encodeCircuit({
    wireR: 0,
    edges: [{ t: T.BATTERY, a: [0, 0], b: [1, 0], p: { V: 100 } }]
  }), 'badPropValue');
  throwsShare(() => encodeCircuit({
    wireR: 0,
    edges: [{ t: T.RHEOSTAT, a: [0, 0], b: [1, 0], p: { Rmax: 50, wiper: 2 } }]
  }), 'badPropValue');
  throwsShare(() => encodeCircuit({
    wireR: 0,
    edges: [{ t: T.SWITCH, a: [0, 0], b: [1, 0], p: { closed: 'yes' } }]
  }), 'badPropValue');
});

test('拒绝:重复的边(同一对端点)', () => {
  throwsShare(() => encodeCircuit({
    wireR: 0,
    edges: [
      { t: T.WIRE, a: [0, 0], b: [1, 0], p: {} },
      { t: T.WIRE, a: [1, 0], b: [0, 0], p: {} }
    ]
  }), 'duplicate');
});

test('拒绝:导线电阻越界或非数字', () => {
  throwsShare(() => encodeCircuit({ wireR: -1, edges: [] }), 'badWireR');
  throwsShare(() => encodeCircuit({ wireR: 100, edges: [] }), 'badWireR');
  throwsShare(() => encodeCircuit({ wireR: 'x', edges: [] }), 'badWireR');
});

test('拒绝:边数超上限', () => {
  const edges = [];
  for (let i = 0; i < 2001; i++) edges.push({ t: T.WIRE, a: [i, 0], b: [i + 1, 0], p: {} });
  throwsShare(() => encodeCircuit({ wireR: 0, edges }), 'badEdgeCount');
});

test('拒绝:数据整体不是对象', () => {
  throwsShare(() => encodeCircuit(null), 'badData');
  throwsShare(() => encodeCircuit({ edges: 'nope' }), 'badData');
});

test('往返:直接接受 Model 实例', () => {
  const model = new Model();
  model.loadPreset([
    [T.BATTERY, 0, 0, 1, 0, { V: 3 }],
    [T.WIRE, 1, 0, 1, 1, {}],
    [T.RESISTOR, 1, 1, 0, 1, { R: 10 }],
    [T.WIRE, 0, 1, 0, 0, {}]
  ]);
  const back = decodeCircuit(encodeCircuit(model));
  assert.equal(back.edges.length, 4);
  assert.equal(back.edges[2].t, T.RESISTOR);
  assert.equal(back.edges[2].p.R, 10);
});

test('往返:解码结果能直接喂给 Model.restore', () => {
  const src = mixedCircuit();
  const data = decodeCircuit(encodeCircuit(src));
  const model = new Model();
  model.restore({ v: 1, wireR: data.wireR, edges: data.edges });
  assert.equal(model.list().length, src.edges.length);
  assert.equal(model.wireR, src.wireR);
});

/* ---------- 文件格式 ---------- */

test('serializeCircuit:带 schema 与版本号,参数规范化', () => {
  const data = serializeCircuit(mixedCircuit());
  assert.equal(data.schema, 'fieldflow/circuit');
  assert.equal(data.v, 1);
  assert.equal(data.edges.length, 12);
  assert.equal(data.edges[0].p.r, 0.2);
  assert.equal(data.edges[6].p.closed, undefined);
});

await testAsync('readCircuitFile:读取导出的 JSON', async () => {
  const src = mixedCircuit();
  const text = JSON.stringify(serializeCircuit(src), null, 2);
  const back = await readCircuitFile({ text: () => Promise.resolve(text) });
  assert.equal(back.v, 1);
  assert.equal(back.wireR, src.wireR);
  assert.equal(back.edges.length, src.edges.length);
  assert.equal(back.edges[5].p.wiper, 0.35);
});

await testAsync('readCircuitFile:拒绝坏 JSON 与错误版本', async () => {
  await assert.rejects(
    () => readCircuitFile({ text: () => Promise.resolve('{oops') }),
    (err) => err instanceof ShareError && err.code === 'fileJson'
  );
  await assert.rejects(
    () => readCircuitFile({ text: () => Promise.resolve(JSON.stringify({ schema: 'fieldflow/circuit', v: 99, edges: [] })) }),
    (err) => err instanceof ShareError && err.code === 'fileVersion'
  );
  await assert.rejects(
    () => readCircuitFile({ text: () => Promise.resolve(JSON.stringify({ schema: 'fieldflow/circuit', v: 1 })) }),
    (err) => err instanceof ShareError && err.code === 'fileEdges'
  );
});

await testAsync('readCircuitFile:没有文件时报错', async () => {
  await assert.rejects(
    () => readCircuitFile(null),
    (err) => err instanceof ShareError && err.code === 'fileMissing'
  );
});

test('downloadCircuit:Node 里没有 DOM 时报错', () => {
  throwsShare(() => downloadCircuit(mixedCircuit(), 'x'), 'noDom');
});

console.log('\n' + passed + ' 通过, ' + failed + ' 失败');
if (failed) {
  failures.forEach((f) => console.log('  ' + f.name + ': ' + (f.err && f.err.stack)));
  process.exit(1);
}
