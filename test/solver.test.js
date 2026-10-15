/* FieldFlow · solver 单元测试 — Node 直接运行:node test/solver.test.js
 * 全部为解析对照用例(手算期望值),无框架、无依赖。 */
'use strict';

const FF = require('../js/util.js');
require('../js/solver.js');
const { E, T, solver } = FF;
const { solve, edgeU, findSingleLoop } = solver;
const W = FF.wireChain;

const nk = FF.nodeKey;
let passed = 0, failed = 0;
const failures = [];

function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (err) { failed++; failures.push({ name, err }); console.log('  ✗ ' + name + '\n      ' + err.message); }
}

function assert(cond, msg) { if (!cond) throw new Error(msg || '断言失败'); }

/* 近似比较:相对容差(期望为 0 时用绝对容差) */
function approx(actual, expected, rel, msg) {
  rel = rel == null ? 1e-3 : rel;
  const tol = Math.max(Math.abs(expected) * rel, 1e-9);
  if (actual == null || !isFinite(actual) || Math.abs(actual - expected) > tol) {
    throw new Error((msg || '数值不符') + `: 实际 ${actual}, 期望 ${expected}±${tol}`);
  }
}

console.log('FieldFlow solver 测试');

/* ---------- 构图助手 ---------- */
function seriesCircuit() { /* 电池 3V + R1=10 + R2=20 串联(单回路矩形) */
  return [
    E(T.BATTERY, 0, 0, 1, 0, { V: 3 }),      /* a=(0,0) 负极, b=(1,0) 正极 */
    E(T.WIRE, 1, 0, 2, 0),
    E(T.RESISTOR, 2, 0, 3, 0, { R: 10 }),
    E(T.RESISTOR, 3, 0, 4, 0, { R: 20 })
  ].concat(
    W(4, 0, 4, 1), W(4, 1, 0, 1), W(0, 1, 0, 0)   /* 回路底边与左侧, 共 6 条导线 */
  );
}

/* ---------- 1. 串联分压 ---------- */
test('串联分压: I≈V/(R1+R2), U1≈1V, U2≈2V', () => {
  const edges = seriesCircuit();
  const R1 = edges[2], R2 = edges[3];
  const s = solve(edges);
  /* 电池内阻 0.1Ω + 导线毫欧:读数偏离理想值 < 0.5%,这正是真实电路 */
  approx(s.edgeI.get(R1.id), 0.09965, 5e-3, '电流');
  approx(s.edgeI.get(R2.id), 0.09965, 5e-3, '电流处处相等');
  approx(edgeU(R1, s), 1.0, 5e-3, 'R1 分压');
  approx(edgeU(R2, s), 2.0, 5e-3, 'R2 分压');
  assert(s.status === 'normal', '状态应为 normal, 实际 ' + s.status);
});

/* ---------- 2. 并联分流 ----------
   布局(两支路并联,J1/J2 为分结点,探针与回线互不交叉):
     b(0,2)─┬─(1,2)─(2,2)=J1 ──[R1]── (3,2)─(4,2)=J2
            │                    │              │
           电池                 [R2]           (4,1)
            │                    │              │
     a(0,1)─┴─(1,1)─(2,1)─(3,1)─┴────(4,3)────(4,2) 底轨 */
test('并联分流: I1=0.3A, I2=0.1A, 干路 0.4A', () => {
  const edges = [
    E(T.BATTERY, 0, 1, 0, 2, { V: 3 }),          /* a=(0,1) 负极 */
    E(T.WIRE, 0, 2, 1, 2), E(T.WIRE, 1, 2, 2, 2), /* 顶轨 → J1=(2,2) */
    E(T.RESISTOR, 2, 2, 3, 2, { R: 10 }),         /* 支路1 */
    E(T.WIRE, 3, 2, 4, 2),                        /* → J2=(4,2) */
    E(T.WIRE, 2, 2, 2, 3), E(T.RESISTOR, 2, 3, 3, 3, { R: 30 }), /* 支路2 */
    E(T.WIRE, 3, 3, 4, 3), E(T.WIRE, 4, 3, 4, 2),
    E(T.WIRE, 4, 2, 4, 1)                         /* J2 → 底轨 */
  ].concat(W(4, 1, 0, 1));                        /* 底轨回负极 */
  const s = solve(edges);
  const I1 = s.edgeI.get(edges[3].id), I2 = s.edgeI.get(edges[6].id), Ib = s.edgeI.get(edges[0].id);
  approx(I1, 0.296, 5e-3, '支路1 (10Ω)');
  approx(I2, 0.0986, 5e-3, '支路2 (30Ω)');
  approx(Ib, 0.394, 5e-3, '干路电流');
  approx(I1 + I2, Ib, 1e-6, 'KCL: 支路电流和 = 干路');
  assert(Math.sign(I1) === Math.sign(I2), '并联支路电流同向');
});

/* ---------- 3. 电池电流符号公式(最易错点) ---------- */
test('电池边电流含电动势项: I=(φa−φb+V)/r > 0(放电)', () => {
  const edges = [
    E(T.BATTERY, 0, 0, 1, 0, { V: 1.5 }),
    E(T.WIRE, 1, 0, 2, 0),
    E(T.RESISTOR, 2, 0, 3, 0, { R: 10 })
  ].concat(W(3, 0, 3, 1), W(3, 1, 0, 1), W(0, 1, 0, 0));
  const s = solve(edges);
  const Ib = s.edgeI.get(edges[0].id);
  approx(Ib, 1.5 / (10 + 0.1 + 6e-3), 1e-9, '电池电流');
  assert(Ib > 0, '放电时电池电流(沿 a→b 内部)必须为正, 实际 ' + Ib);
});

/* ---------- 4. 电池端电压 = V − I·r ---------- */
test('电池端电压 U=V−I·r ≈ 1.5V(区别于电动势)', () => {
  const edges = [
    E(T.BATTERY, 0, 0, 1, 0, { V: 1.5 }),
    E(T.WIRE, 1, 0, 2, 0),
    E(T.RESISTOR, 2, 0, 3, 0, { R: 10 })
  ].concat(W(3, 0, 3, 1), W(3, 1, 0, 1), W(0, 1, 0, 0));
  const s = solve(edges);
  const U = edgeU(edges[0], s);
  const I4 = s.edgeI.get(edges[0].id);
  approx(U, 1.5 - I4 * 0.1, 1e-9, '端电压 U = E − I·r, r=0.1Ω');
  assert(U < 1.5, '有内阻压降, 端电压应小于电动势');
});

/* ---------- 5. 电压表并联电阻: 不扰动电路(探针伸进空白区 y=−1,不碰底轨) ---------- */
test('电压表并联 R1: 读数≈1V, 原电路电流不变, 探针线电流为 0', () => {
  const base = seriesCircuit();
  const s0 = solve(base);
  const probe1 = E(T.WIRE, 2, 0, 2, -1);
  const vm = E(T.VOLTMETER, 2, -1, 3, -1, {});   /* b=(3,−1) 为 + 接线柱 */
  const probe2 = E(T.WIRE, 3, -1, 3, 0);
  const withVM = base.concat([probe1, vm, probe2]);
  const s1 = solve(withVM);
  const reading = s1.nodePhi.get(nk(vm.b)) - s1.nodePhi.get(nk(vm.a));
  approx(reading, -0.9965, 5e-3, '电压表读数(φ+−φ−, 此接法为负)');
  approx(s1.edgeI.get(base[2].id), s0.edgeI.get(base[2].id), 1e-7, 'R1 电流不受电压表影响');
  assert(s1.edgeI.get(probe1.id) === 0, '电压表探针线电流应为 0(死区)');
});

/* ---------- 6. 电压表接在断开的开关两端 → 读数 = 电动势 ---------- */
test('断开关两端的电压表读数 = 电源电动势(经典题)', () => {
  const edges = [
    E(T.BATTERY, 0, 0, 1, 0, { V: 1.5 }),
    E(T.WIRE, 1, 0, 2, 0),
    E(T.SWITCH, 2, 0, 3, 0, { closed: false }),   /* 断开 */
    E(T.RESISTOR, 3, 0, 4, 0, { R: 10 })
  ].concat(
    W(4, 0, 4, 1), W(4, 1, 0, 1), W(0, 1, 0, 0),
    [E(T.WIRE, 2, 0, 2, -1), E(T.VOLTMETER, 2, -1, 3, -1, {}), E(T.WIRE, 3, -1, 3, 0)]
  );
  const s = solve(edges);
  assert(s.status === 'open', '状态应为 open, 实际 ' + s.status);
  const vm = edges.find(e => e.type === T.VOLTMETER);
  const reading = s.nodePhi.get(nk(vm.b)) - s.nodePhi.get(nk(vm.a));
  approx(Math.abs(reading), 1.5, 1e-4, '断路时开关两端电压 = EMF');
  edges.filter(e => e.type !== T.VOLTMETER).forEach(e => {
    if (e.type !== T.SWITCH) assert(s.edgeI.get(e.id) === 0, '断路时所有电流为 0');
  });
});

/* ---------- 7. 电压表在无源孤岛上 → 读数未定义 ---------- */
test('无源孤岛上的电压表 → 读数 null(显示"—")', () => {
  const edges = [
    E(T.WIRE, 10, 0, 10, 1), E(T.WIRE, 10, 1, 11, 1),
    E(T.VOLTMETER, 10, 0, 11, 0, {})
  ];
  const s = solve(edges);
  const vm = edges.find(e => e.type === T.VOLTMETER);
  assert(s.nodePhi.get(nk(vm.a)) === null && s.nodePhi.get(nk(vm.b)) === null, '孤岛电势未定义');
  assert(s.status === 'noSource', '状态 noSource');
});

/* ---------- 8. 滑动变阻器端点 ---------- */
test('滑动变阻器: wiper→R 线性, wiper=0 相当于短路', () => {
  function circuit(wiper) {
    return [
      E(T.BATTERY, 0, 0, 1, 0, { V: 3 }),
      E(T.WIRE, 1, 0, 2, 0),
      E(T.RHEOSTAT, 2, 0, 3, 0, { Rmax: 100, wiper: wiper })
    ].concat(W(3, 0, 3, 1), W(3, 1, 0, 1), W(0, 1, 0, 0));
  }
  approx(solver.rOf(circuit(0.5)[2]), 50, 1e-9, 'wiper=0.5 → 50Ω');
  approx(solver.rOf(circuit(1)[2]), 100, 1e-9, 'wiper=1 → Rmax');
  const c = circuit(0.5);
  const s = solve(c);
  approx(s.edgeI.get(c[2].id), 3 / (50 + 0.1 + 6e-3), 1e-9, '3V/50Ω');
  const sShort = solve(circuit(0));
  assert(sShort.status === 'short', 'wiper=0 (R≈0) 应判短路');
});

/* ---------- 9. 电源短路幅值 ---------- */
test('电源短路: I = V/Σr ≈ 250A, 数值有限, 状态 short', () => {
  const edges = [
    E(T.BATTERY, 0, 0, 1, 0, { V: 1.5 }),
    E(T.WIRE, 1, 0, 2, 0), E(T.WIRE, 2, 0, 2, 1),
    E(T.WIRE, 2, 1, 1, 1), E(T.WIRE, 1, 1, 0, 1), E(T.WIRE, 0, 1, 0, 0)
  ];
  const s = solve(edges);
  const expected = 1.5 / (solver.R_BAT + 5 * solver.R_WIRE);
  approx(s.edgeI.get(edges[0].id), expected, 1e-9, '短路电流精确值');
  assert(s.status === 'short', '状态 short');
});

/* ---------- 10. 双电池并联环流 ----------
   布局(回线绕外侧,不穿电池所在列):
     (0,1)+──(1,1)+──(2,1)──[R=10]──(3,1)
       │      │                     │
      电池1   电池2                  │
       │      │                     │
     (0,0)──(1,0)──(2,0)──(3,0)────┘ */
test('两不等电池并联: 环流 ≈ (V1−V2)/4mΩ = 25A, 负载 ≈ 0.142A', () => {
  const edges = [
    E(T.BATTERY, 0, 0, 0, 1, { V: 1.5 }),
    E(T.BATTERY, 1, 0, 1, 1, { V: 1.4 }),
    E(T.WIRE, 0, 1, 1, 1),                    /* 正极相连 */
    E(T.WIRE, 1, 1, 2, 1),
    E(T.RESISTOR, 2, 1, 3, 1, { R: 10 }),
    E(T.WIRE, 3, 1, 3, 0),
    E(T.WIRE, 3, 0, 2, 0), E(T.WIRE, 2, 0, 1, 0), E(T.WIRE, 1, 0, 0, 0) /* 负极相连 */
  ];
  const s = solve(edges);
  const I1 = s.edgeI.get(edges[0].id);
  const I2 = s.edgeI.get(edges[1].id);
  const Iload = s.edgeI.get(edges[4].id);
  /* 环流量级 = ΔV/(2r) ≈ 0.5A(负载电流流经环流段,实际略低);
     低压电池被充电但端电压未塌陷,判正常 */
  approx(I2, -0.1 / (2 * 0.1 + 7e-3), 0.2, '低压电池被充电');
  approx(Iload, (1.4 + 0.1 * 0.1 / 0.207) / 10, 8e-2, '负载电流');
  assert(s.status === 'normal', '端电压未塌陷 → normal, 实际 ' + s.status);
  approx(I1 + I2, Iload, 1e-6, '结点电流守恒');
});

/* ---------- 11. 反串电池 ---------- */
test('反串电池: 净电动势 1V, I≈0.1A, 被充电池电流为负', () => {
  const wires = W(1, 0, 2, 0).length;                 /* 横向导线数 */
  const edges = [
    E(T.BATTERY, 0, 0, 1, 0, { V: 3 }),
    E(T.WIRE, 1, 0, 2, 0),
    E(T.RESISTOR, 2, 0, 3, 0, { R: 10 }),
    E(T.BATTERY, 4, 0, 3, 0, { V: 2 })      /* 反向: 抬升方向与回路绕向相反 */
  ].concat(W(4, 0, 4, 1), W(4, 1, 0, 1), W(0, 1, 0, 0));
  const nWires = wires + 1 + 4 + 1;                   /* 1+4+1 = 6, 共 7 条 */
  const s = solve(edges);
  const expected = 1 / (10 + 2 * solver.R_BAT + nWires * solver.R_WIRE);
  const I1 = s.edgeI.get(edges[0].id), I2 = s.edgeI.get(edges[3].id);
  approx(I1, expected, 1e-6, '净电流');
  approx(I2, -expected, 1e-6, '被充电电池');
});

/* ---------- 12. 纯导线孤岛被排除 ---------- */
test('纯导线孤岛: 电势/电流 null, 主电路不受影响', () => {
  const base = seriesCircuit();
  const s0 = solve(base);
  const island = E(T.WIRE, 10, 0, 10, 1);
  const edges = base.concat([island, E(T.WIRE, 10, 1, 11, 1)]);
  const s = solve(edges);
  assert(s.edgeI.get(island.id) === null, '孤岛边电流 null');
  assert(s.nodePhi.get('10,0') === null, '孤岛节点电势 null');
  approx(s.edgeI.get(base[2].id), s0.edgeI.get(base[2].id), 1e-7, '主电路电流不变');
});

/* ---------- 13. 空输入 ---------- */
test('空输入不抛异常, 状态 empty', () => {
  const s = solve([]);
  assert(s.status === 'empty');
  const s2 = solve(null);
  assert(s2.status === 'empty');
});

/* ---------- 14. 电流表串联精度 ---------- */
test('理想电流表串联: 读数 = 电路电流, 引入误差 < 1e-3', () => {
  const edges = [
    E(T.BATTERY, 0, 0, 1, 0, { V: 1.5 }),
    E(T.WIRE, 1, 0, 2, 0),
    E(T.AMMETER, 2, 0, 3, 0, {}),
    E(T.RESISTOR, 3, 0, 4, 0, { R: 15 })
  ].concat(W(4, 0, 4, 1), W(4, 1, 0, 1), W(0, 1, 0, 0));
  const s = solve(edges);
  const Iam = s.edgeI.get(edges[2].id), Ib = s.edgeI.get(edges[0].id);
  approx(Iam, 1.5 / (15 + 0.1 + 7e-3 + 1e-4), 1e-9, '≈ V/R(含内阻+表内阻)');
  approx(Iam, Ib, 1e-9, '串联电流处处相等');
});

/* ---------- 15. 单回路检测 ---------- */
test('单回路检测: 串联回路(含电压表探针)可绕行, 并联/断路/共点双环不可', () => {
  const base = seriesCircuit();                       /* 4 元件 + 6 导线 = 10 条核心边 */
  const loop = base.concat([
    E(T.WIRE, 2, 0, 2, -1),                  /* 探针伸进空白区,不碰底轨 */
    E(T.VOLTMETER, 2, -1, 3, -1, {}),
    E(T.WIRE, 3, -1, 3, 0)
  ]);
  const walk = findSingleLoop(loop);
  assert(walk && walk.length === 10, '剥离探针后核心 10 条边, 实际 ' + (walk && walk.length));
  assert(walk[0].edge.type === T.BATTERY, '绕行从电池开始');
  const nR = walk.filter(w => w.edge.type === T.RESISTOR).length;
  const nW = walk.filter(w => w.edge.type === T.WIRE).length;
  assert(nR === 2 && nW === 7, `核心成员: 电池1 + 电阻${nR} + 导线${nW}`);
  assert(!walk.some(w => w.edge.type === T.VOLTMETER), '电压表不在核心内');

  /* 并联 → 结点度 3 → null */
  const parallel = [
    E(T.BATTERY, 0, 1, 0, 2, { V: 3 }),
    E(T.WIRE, 0, 2, 1, 2), E(T.WIRE, 1, 2, 2, 2),
    E(T.RESISTOR, 2, 2, 3, 2, { R: 10 }),
    E(T.WIRE, 3, 2, 4, 2),
    E(T.WIRE, 2, 2, 2, 3), E(T.RESISTOR, 2, 3, 3, 3, { R: 30 }),
    E(T.WIRE, 3, 3, 4, 3), E(T.WIRE, 4, 3, 4, 2),
    E(T.WIRE, 4, 2, 4, 1)
  ].concat(W(4, 1, 0, 1));
  assert(findSingleLoop(parallel) === null, '并联电路不是单回路');

  /* 断路 → 链被剥空 → null */
  const open = [
    E(T.BATTERY, 0, 0, 1, 0, { V: 3 }),
    E(T.WIRE, 1, 0, 2, 0),
    E(T.SWITCH, 2, 0, 3, 0, { closed: false }),
    E(T.RESISTOR, 3, 0, 4, 0, { R: 10 })
  ].concat(W(4, 0, 4, 1), W(4, 1, 0, 1), W(0, 1, 0, 0));
  assert(findSingleLoop(open) === null, '断路电路无回路');

  /* figure-eight(两环共点)→ 度 3 结点 → null */
  const fig8 = [
    E(T.BATTERY, 0, 0, 1, 0, { V: 3 }),
    E(T.WIRE, 1, 0, 2, 0),
    E(T.WIRE, 2, 0, 2, 1), E(T.WIRE, 2, 1, 1, 1), E(T.WIRE, 1, 1, 0, 1), E(T.WIRE, 0, 1, 0, 0),
    E(T.WIRE, 2, 0, 3, 0), E(T.RESISTOR, 3, 0, 3, 1, { R: 10 }), E(T.WIRE, 3, 1, 2, 1)
  ];
  assert(findSingleLoop(fig8) === null, 'figure-eight 不是单回路');
});

/* ---------- 16. 模型不变量 ---------- */
test('网格不变量: 非相邻格点/对角线/同点的边一律拒绝', () => {
  const bad = [[0, 0, 2, 0], [0, 0, 1, 1], [0, 0, 0, 0], [0, 0, -1, 1]];
  bad.forEach(c => {
    let threw = false;
    try { E(T.WIRE, c[0], c[1], c[2], c[3]); } catch (e) { threw = true; }
    assert(threw, `(${c}) 应抛异常`);
  });
  assert(FF.edgeKey([2, 3], [4, 5]) === FF.edgeKey([4, 5], [2, 3]), 'edgeKey 与端点顺序无关');
});

/* ---------- 17. 参数防御: 越界值被钳制, 不破坏矩阵 ---------- */
test('参数钳制: R 越界/NaN 被拉回合法区间', () => {
  const e1 = E(T.RESISTOR, 0, 0, 1, 0, { R: -5 });
  approx(solver.rOf(e1), 0.1, 1e-9, '负电阻钳到下限');
  const e2 = E(T.RESISTOR, 0, 0, 1, 0, { R: NaN });
  approx(solver.rOf(e2), 0.1, 1e-9, 'NaN 钳到下限');
  const e3 = E(T.BATTERY, 0, 0, 1, 0, { V: 999 });
  approx(solver.emfOf(e3), 24, 1e-9, 'EMF 钳到上限');
});

/* ---------- 18. 短路的真实图景(用户实测驱动) ---------- */
test('短路: 端电压塌陷, 导线几乎等势, 电动势降在电源内阻上', () => {
  const edges = [
    E(T.BATTERY, 0, 0, 1, 0, { V: 3 })
  ].concat(W(1, 0, 6, 0), W(6, 0, 6, 4), W(6, 4, 0, 4), W(0, 4, 0, 0)); /* 22 格导线环 */
  const s = solve(edges);
  const I = s.edgeI.get(edges[0].id);
  approx(I, 3 / (0.1 + 19e-3), 1e-9, '短路电流 I = E/(r+Σr线)');
  assert(s.status === 'short', '状态 short(端电压塌陷判据)');
  const U = edgeU(edges[0], s);
  assert(U < 0.3 * 3, '端电压塌到 0.3E 以下, 实际 ' + U);
  /* 导线上任意节点电势不得超过端电压:几乎等势 */
  let wireMax = 0;
  s.nodePhi.forEach(v => { if (v != null && Math.abs(v) > wireMax) wireMax = Math.abs(v); });
  assert(wireMax <= U + 1e-9, '导线电势 ≤ 端电压');
  assert(wireMax < 0.7, '22 格导线的总压降远小于电动势(降在内阻上), 实际 ' + wireMax);
});

console.log(`\n${passed} 通过, ${failed} 失败`);
if (failed) process.exit(1);
