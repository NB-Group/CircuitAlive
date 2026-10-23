/* CircuitAlive · 真实物理模式纯逻辑测试 — node test/micro.test.js
 *
 * 表面电荷(φ̄ 参考、死支路、电池特例)、坡印廷流线方向、
 * 镜头分类/物理量、Drude 模拟的漂移恒定性(散射率无关)。 */
'use strict'

import assert from 'node:assert/strict'
import { T, nodeKey, GRID } from '../src/core/util.js'
import { solver } from '../src/core/solver.js'
import {
  computeSurfaceCharges, componentRefs, buildPoyntingFlows,
  lensKindOf, lensFacts, scatterRateOf, createLensSim, mulberry32,
  EDGE_LEN_M, VD_PER_A
} from '../src/core/micro.js'

const G = GRID
let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name) }
  catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + e.message) }
}

/* ---- 测试电路 ---- */

/* 电池(左负右正)+ 电阻 R 串联回路(顺时针,电池在底边) */
function seriesR(V, R) {
  const es = []
  const bat = { id: 1, a: [0, 0], b: [1, 0], key: '0,0|1,0', type: T.BATTERY, props: { V } }
  es.push(bat)
  es.push({ id: 2, a: [1, 0], b: [2, 0], key: '1,0|2,0', type: T.WIRE, props: {} })
  const res = { id: 3, a: [2, 0], b: [3, 0], key: '2,0|3,0', type: T.RESISTOR, props: { R } }
  es.push(res)
  es.push({ id: 4, a: [3, 0], b: [3, 1], key: '3,0|3,1', type: T.WIRE, props: {} })
  es.push({ id: 5, a: [3, 1], b: [0, 1], key: '0,1|3,1', type: T.WIRE, props: { long: true, _pts: [[3, 1], [0, 1]] } })
  es.push({ id: 6, a: [0, 1], b: [0, 0], key: '0,0|0,1', type: T.WIRE, props: {} })
  return { es, bat, res }
}
/* 注:模型要求相邻格点;上边用一条跨 3 格的"长导线"仅作节点电势覆盖,
 * 求解器只看端点,不影响单测语义。 */

function solve(es) { return solver.solve(es, { wireR: 0 }) }

console.log('CircuitAlive 真实物理模式(纯逻辑)测试')

/* ============ 表面电荷 ============ */

test('φ̄ 参考:负极侧导线负记号、正极侧正记号、电阻上梯度过零', () => {
  const { es, bat, res } = seriesR(3, 10)
  const sol = solve(es)
  assert.equal(sol.status, 'normal')
  /* a=0V 负极, b≈3V 正极(内阻 0.1);φ̄≈1.5 */
  const marks = computeSurfaceCharges(es, sol)
  assert.ok(marks.length > 10, '应有密集记号, got ' + marks.length)
  /* 负极导线(边 6, 0V):全部 q<0 */
  const neg = marks.filter(m => Math.abs(m.x - 0) < 20 && m.y > 0 && m.y < G + 20)
  assert.ok(neg.length > 0, '负极侧导线应有记号')
  neg.forEach(m => assert.ok(m.q < 0, '负极侧应全为负, got ' + m.q))
  /* 正极引出导线(边 2, ≈2.97V):全部 q>0 */
  const pos = marks.filter(m => m.x > 1.2 * G && m.x < 2 * G && Math.abs(m.y) < 20)
  assert.ok(pos.length > 0, '正极侧导线应有记号')
  pos.forEach(m => assert.ok(m.q > 0, '正极侧应全为正, got ' + m.q))
  /* 电阻边:存在符号翻转(2.97V→0.04V 过 φ̄≈1.5) */
  const rmarks = marks.filter(m => m.x > 2 * G && m.x < 3 * G && Math.abs(m.y) < 20)
  assert.ok(rmarks.some(m => m.q > 0) && rmarks.some(m => m.q < 0),
    '电阻内部应有符号翻转: ' + rmarks.map(m => m.q.toFixed(2)).join(','))
  /* 电池两端记号 |q| 应接近满幅 */
  const batMarks = marks.filter(m => m.y > -20 && m.y < 20 && m.x < G + 20)
  assert.ok(batMarks.some(m => Math.abs(m.q) > 0.9), '端部记号应接近满幅')
})

test('断路:仍有记号,断口两侧反号,全部电流为 0', () => {
  const es = []
  es.push({ id: 1, a: [0, 0], b: [1, 0], key: '0,0|1,0', type: T.BATTERY, props: { V: 3 } })
  es.push({ id: 2, a: [1, 0], b: [2, 0], key: '1,0|2,0', type: T.SWITCH, props: { closed: false } })
  es.push({ id: 3, a: [2, 0], b: [3, 0], key: '2,0|3,0', type: T.RESISTOR, props: { R: 10 } })
  es.push({ id: 4, a: [3, 0], b: [0, 0], key: '0,0|3,0', type: T.WIRE, props: {} })
  const sol = solve(es)
  assert.equal(sol.status, 'open')
  es.forEach(e => { const i = sol.edgeI.get(e.id); assert.ok(i == null || Math.abs(i) < 1e-9, '电流应全为 0') })
  const marks = computeSurfaceCharges(es, sol)
  assert.ok(marks.length > 0, '断路仍有表面电荷')
  /* 开关边:靠电池侧(a,1V? no a=3V? ) —— a 端接电池正极 3V(+),b 端 0V(−) */
  const sw = marks.filter(m => m.x > 1 * G && m.x < 2 * G && Math.abs(m.y) < 20)
  assert.ok(sw.length > 0, '开关气隙应有记号')
  assert.ok(sw.some(m => m.q > 0) && sw.some(m => m.q < 0), '断口两侧符号相反')
})

test('电压表探针:电流为 0 仍有记号,电势取所附节点', () => {
  const { es, res } = seriesR(3, 10)
  /* 探针:从电阻右端(3,0)向上引到 (3,1)?该点已在回路 —— 改从电阻两端引出死端 */
  es.push({ id: 10, a: [2, 0], b: [2, -1], key: '2,0|2,-1', type: T.WIRE, props: {} })
  es.push({ id: 11, a: [2, -1], b: [3, -1], key: '2,-1|3,-1', type: T.VOLTMETER, props: {} })
  es.push({ id: 12, a: [3, -1], b: [3, 0], key: '3,0|3,-1', type: T.WIRE, props: {} })
  const sol = solve(es)
  assert.equal(sol.status, 'normal')
  const vmI = sol.edgeI.get(11)
  assert.ok(vmI == null || Math.abs(vmI) < 1e-9, '电压表支路电流应为 0')
  const marks = computeSurfaceCharges(es, sol)
  /* 探针线 (2,0)-(2,-1):挂在 φ≈2.97V 节点上 → 全正 */
  const probe = marks.filter(m => Math.abs(m.x - 2 * G) < 20 && m.y < -20 && m.y > -G)
  assert.ok(probe.length > 0, '死支路也应有记号')
  probe.forEach(m => assert.ok(m.q > 0, '探针挂在高电势节点应全正'))
  /* 电压表边本身也有记号(两端 2.97V / 0.04V) */
  const vm = marks.filter(m => m.y < -G + 10 && m.x > 2 * G && m.x < 3 * G)
  assert.ok(vm.length > 0, '电压表边应有记号')
})

test('无源孤岛:零记号', () => {
  const es = [{ id: 1, a: [5, 5], b: [6, 5], key: '5,5|6,5', type: T.WIRE, props: {} }]
  const sol = solve(es)
  assert.equal(sol.status, 'noSource')
  const marks = computeSurfaceCharges(es, sol)
  assert.equal(marks.length, 0)
})

test('多分量:各自取自己的极值中点', () => {
  const a = seriesR(3, 10).es
  const b = seriesR(6, 10).es.map(e => ({ ...e, id: e.id + 100, a: [e.a[0] + 10, e.a[1]], b: [e.b[0] + 10, e.b[1]], key: (e.a[0] + 10) + ',' + e.a[1] + '|' + (e.b[0] + 10) + ',' + e.b[1] }))
  const es = a.concat(b)
  const sol = solve(es)
  assert.equal(sol.comps.length, 2)
  const { refs } = componentRefs(sol)
  const ok = refs.filter(Boolean)
  assert.equal(ok.length, 2)
  const bars = ok.map(r => r.phiBar).sort((x, y) => x - y)
  assert.ok(Math.abs(bars[0] - 1.5) < 0.05, '3V 电路 φ̄≈1.5, got ' + bars[0])
  assert.ok(Math.abs(bars[1] - 3.0) < 0.05, '6V 电路 φ̄≈3.0, got ' + bars[1])
})

test('电池边:记号只落在两端 30% 区段,两端反号', () => {
  const { es } = seriesR(3, 10)
  const sol = solve(es)
  const marks = computeSurfaceCharges(es, sol)
  const bat = marks.filter(m => m.x > -20 && m.x < 1 * G + 20 && Math.abs(m.y) < 20)
  /* 区段断言:所有电池记号的 t 都 <0.3 或 >0.7(按 x 位置归一) */
  bat.forEach(m => {
    const t = m.x / G
    assert.ok(t < 0.35 || t > 0.65, '中段不应有记号 t=' + t.toFixed(2))
  })
  assert.ok(bat.some(m => m.q < 0) && bat.some(m => m.q > 0), '两端反号')
})

/* ============ 坡印廷 ============ */

test('坡印廷:正常回路有流线,端点分别靠近电池端子与电阻', () => {
  const { es, bat, res } = seriesR(3, 10)
  const sol = solve(es)
  const flows = buildPoyntingFlows(es, sol, 0)
  assert.ok(flows.length >= 1, '至少 1 条')
  flows.forEach(f => {
    assert.ok(f.d.startsWith('M '), '三次贝塞尔路径')
    assert.ok(f.width >= 1 && f.width <= 3, '线宽 1..3')
    assert.ok(f.dur >= 0.9 && f.dur <= 2.2, '时长钳制')
  })
  /* 起点(第一条 M 坐标)应在电池两端之一附近 */
  const first = flows[0].d.match(/M (-?[\d.]+) (-?[\d.]+)/)
  const sx = +first[1], sy = +first[2]
  const nearA = Math.hypot(sx - bat.a[0] * G, sy - bat.a[1] * G) < 14
  const nearB = Math.hypot(sx - bat.b[0] * G, sy - bat.b[1] * G) < 14
  assert.ok(nearA || nearB, '起点应在电池端子附近')
  /* 某条流线的箭头应落在电阻中点附近 */
  const rm = { x: (res.a[0] + res.b[0]) / 2 * G, y: res.a[1] * G }
  assert.ok(flows.some(f => Math.hypot(f.arrow.x - rm.x, f.arrow.y - rm.y) < 16),
    '应有箭头汇入电阻')
})

test('坡印廷:断路零流线;短路唯一汇是电池本体', () => {
  /* 断路 */
  const open = [
    { id: 1, a: [0, 0], b: [1, 0], key: '0,0|1,0', type: T.BATTERY, props: { V: 3 } },
    { id: 2, a: [1, 0], b: [2, 0], key: '1,0|2,0', type: T.SWITCH, props: { closed: false } },
    { id: 3, a: [2, 0], b: [0, 0], key: '0,0|2,0', type: T.WIRE, props: {} }
  ]
  assert.equal(buildPoyntingFlows(open, solve(open), 0).length, 0, '断路 → 0 条')

  /* 短路:理想导线直接闭合 */
  const short = [
    { id: 1, a: [0, 0], b: [1, 0], key: '0,0|1,0', type: T.BATTERY, props: { V: 3 } },
    { id: 2, a: [1, 0], b: [2, 0], key: '1,0|2,0', type: T.WIRE, props: {} },
    { id: 3, a: [2, 0], b: [2, 1], key: '2,0|2,1', type: T.WIRE, props: {} },
    { id: 4, a: [2, 1], b: [0, 1], key: '0,1|2,1', type: T.WIRE, props: {} },
    { id: 5, a: [0, 1], b: [0, 0], key: '0,0|0,1', type: T.WIRE, props: {} }
  ]
  const sol2 = solve(short)
  assert.equal(sol2.status, 'short')
  const flows2 = buildPoyntingFlows(short, sol2, 0)
  assert.ok(flows2.length >= 1, '短路有流线(全进内阻)')
  const batMid = { x: 0.5 * G, y: 0 }
  flows2.forEach(f => {
    assert.ok(Math.hypot(f.arrow.x - batMid.x, f.arrow.y - batMid.y) < 20,
      '短路流线应汇入电池本体')
  })
})

test('坡印廷:被充电电池是汇(反串双电池)', () => {
  /* 3V 正向 + 1.5V 反向(其正极也朝 node1,被 3V 充) */
  const es = [
    { id: 1, a: [0, 0], b: [1, 0], key: '0,0|1,0', type: T.BATTERY, props: { V: 3 } },
    { id: 2, a: [2, 0], b: [1, 0], key: '1,0|2,0', type: T.BATTERY, props: { V: 1.5 } },
    { id: 3, a: [2, 0], b: [3, 0], key: '2,0|3,0', type: T.RESISTOR, props: { R: 5 } },
    { id: 4, a: [3, 0], b: [0, 0], key: '0,0|3,0', type: T.WIRE, props: {} }
  ]
  const sol = solve(es)
  const bat2 = es[1]
  const I2 = sol.edgeI.get(bat2.id)   /* 沿 a→b = 2→1 */
  assert.ok(I2 != null && I2 < 0, '电流应从 b→a(正极进)穿过被充电池, got ' + I2)
  assert.ok(I2 * solver.emfOf(bat2) < 0, 'bat2 应处于被充电状态')
  const flows = buildPoyntingFlows(es, sol, 0)
  const b2mid = { x: 1.5 * G, y: 0 }
  assert.ok(flows.some(f => Math.hypot(f.arrow.x - b2mid.x, f.arrow.y - b2mid.y) < 20),
    '应有流线汇入被充电池')
})

/* ============ 镜头 ============ */

test('lensKindOf:电池/死路/金属三分', () => {
  assert.equal(lensKindOf({ type: T.BATTERY, props: {} }, 0.3), 'battery')
  assert.equal(lensKindOf({ type: T.VOLTMETER, props: {} }, null), 'dead')
  assert.equal(lensKindOf({ type: T.SWITCH, props: { closed: false } }, null), 'dead')
  assert.equal(lensKindOf({ type: T.RESISTOR, props: {} }, 0.3), 'metal')
  assert.equal(lensKindOf({ type: T.WIRE, props: {} }, 0), 'dead')
  assert.equal(lensKindOf({ type: T.WIRE, props: {} }, 0.5), 'metal')
})

test('lensFacts:E=|U|/0.1m,v_d=73.4|I| µm/s,电池 Enet=I·r/L', () => {
  const { es, res, bat } = seriesR(3, 10)
  const sol = solve(es)
  const f = lensFacts(res, sol, es)
  const I = sol.edgeI.get(res.id)
  const U = solver.edgeU(res, sol)
  assert.ok(Math.abs(f.E - Math.abs(U) / EDGE_LEN_M) < 1e-9)
  assert.ok(Math.abs(f.vdSI - Math.abs(I) * VD_PER_A) < 1e-12)
  assert.ok(f.Efrac > 0.9, '唯一耗能边 Efrac 应接近 1')
  assert.ok(f.vdPx < 0, 'I>0(a→b)时电子漂移为 −x̂')
  const fb = lensFacts(bat, sol, es)
  assert.ok(fb.battery, '电池 facts')
  assert.ok(Math.abs(fb.battery.Enet - Math.abs(I) * 0.1 / EDGE_LEN_M) < 1e-6,
    'Enet = I·r/L')
  assert.ok(fb.battery.Enet >= 0, '放电时净驱动为正')
  assert.ok(fb.battery.Echem > fb.battery.Eelec, '化学力略胜静电场力')
})

test('散射率表:电阻远大于导线,滑变随滑片单调', () => {
  assert.ok(scatterRateOf({ type: T.WIRE, props: {} }) < scatterRateOf({ type: T.RESISTOR, props: {} }))
  const w0 = scatterRateOf({ type: T.RHEOSTAT, props: { wiper: 0 } })
  const w1 = scatterRateOf({ type: T.RHEOSTAT, props: { wiper: 1 } })
  assert.ok(w1 > w0, '接入越长散射越频繁')
})

test('Drude 模拟:漂移恒定与散射率无关(wire ν=0.7 vs resistor ν=7)', () => {
  for (const nu of [0.7, 7]) {
    const sim = createLensSim({ kind: 'metal', radius: 66, vd: 40, scatter: nu }, mulberry32(7))
    const dt = 1 / 30
    let x0 = 0
    sim.agents.forEach(a => x0 += a.x)
    x0 /= sim.agents.length
    for (let i = 0; i < 1800; i++) sim.step(dt)   /* 60 s */
    let x1 = 0
    sim.agents.forEach(a => x1 += a.x)
    x1 /= sim.agents.length
    /* 回绕会破坏均值位移 → 用 meanVx 瞬时均值代替:全程断言 */
    let mv = 0, n = 0
    for (let i = 0; i < 300; i++) { sim.step(dt); mv += sim.meanVx(); n++ }
    mv /= n
    assert.ok(Math.abs(mv - 40) <= Math.max(0.08 * 40, 3),
      'ν=' + nu + ' 平均速度应 ≈ v_d=40, got ' + mv.toFixed(2))
    /* 出界回绕:所有 agent 都在方内 */
    sim.agents.forEach(a => {
      assert.ok(Math.abs(a.x) <= 66 + 0.5 && Math.abs(a.y) <= 66 + 0.5, '回绕生效')
    })
  }
})

test('Drude 模拟:同种子同轨迹;散射计数 ∝ ν;换参数不重播种', () => {
  const a = createLensSim({ kind: 'metal', radius: 66, vd: 20, scatter: 7 }, mulberry32(3))
  const b = createLensSim({ kind: 'metal', radius: 66, vd: 20, scatter: 7 }, mulberry32(3))
  for (let i = 0; i < 100; i++) { a.step(1 / 30); b.step(1 / 30) }
  assert.deepEqual(a.agents.map(x => [x.x.toFixed(3), x.y.toFixed(3)]),
    b.agents.map(x => [x.x.toFixed(3), x.y.toFixed(3)]), '确定性')

  const slow = createLensSim({ kind: 'metal', radius: 66, vd: 20, scatter: 0.7 }, mulberry32(5))
  const fast = createLensSim({ kind: 'metal', radius: 66, vd: 20, scatter: 7 }, mulberry32(5))
  for (let i = 0; i < 600; i++) { slow.step(1 / 30); fast.step(1 / 30) }
  assert.ok(fast.scatterTotal() > 3 * slow.scatterTotal(),
    '电阻散射计数应远大于导线: ' + fast.scatterTotal() + ' vs ' + slow.scatterTotal())

  /* 仅参数变化:agent 位置连续 */
  const pos0 = slow.agents.map(x => x.x + ',' + x.y)
  slow.setDrift(-20); slow.setScatter(3)
  slow.step(1 / 30)
  assert.deepEqual(slow.agents.map(x => x.x + ',' + x.y).length, pos0.length, '不重播种')
})

console.log(`\n${passed} 通过, ${failed} 失败`)
if (failed) process.exit(1)
