/* CircuitAlive · 电势地形纯逻辑测试 — node test/terrain.test.js */
'use strict'

import assert from 'node:assert/strict'
import { T } from '../src/core/util.js'
import { solver } from '../src/core/solver.js'
import { buildTerrain, heightScale, ballDirFor, RIBBON_W } from '../src/core/terrain.js'

let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name) }
  catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + e.message) }
}

/* 电池(左负右正)+ 电阻串联回路 */
function seriesR(V, R) {
  const es = [
    { id: 1, a: [0, 0], b: [1, 0], key: '0,0|1,0', type: T.BATTERY, props: { V } },
    { id: 2, a: [1, 0], b: [2, 0], key: '1,0|2,0', type: T.WIRE, props: {} },
    { id: 3, a: [2, 0], b: [3, 0], key: '2,0|3,0', type: T.RESISTOR, props: { R } },
    { id: 4, a: [3, 0], b: [3, 1], key: '3,0|3,1', type: T.WIRE, props: {} },
    { id: 5, a: [3, 1], b: [0, 1], key: '0,1|3,1', type: T.WIRE, props: {} },
    { id: 6, a: [0, 1], b: [0, 0], key: '0,0|0,1', type: T.WIRE, props: {} }
  ]
  return { model: { list: () => es, edges: new Map(es.map(e => [e.key, e])) }, es }
}

console.log('CircuitAlive 电势地形(纯逻辑)测试')

test('平地/斜坡/电梯三分:导线平、电阻坡、电池陡', () => {
  const { model } = seriesR(3, 10)
  const sol = solver.solve(model.list(), { wireR: 0 })
  const t = buildTerrain(model, sol)
  assert.equal(t.ribbons.length, 6)
  const byType = {}
  t.ribbons.forEach(r => { byType[r.type] = r })
  /* 导线两端同 φ(理想导线超节点)→ flat,rows 高度全部相等 */
  const wire = byType[T.WIRE]
  assert.equal(wire.kind, 'flat')
  const phis = wire.rows.map(r => r.phi)
  assert.ok(phis.every(p => Math.abs(p - phis[0]) < 1e-9), '平地')
  /* 电阻 2.97V → 0.03V → slope,首尾 φ 之差 ≈ 端电压 */
  const res = byType[T.RESISTOR]
  assert.equal(res.kind, 'slope')
  assert.ok(Math.abs((res.rows[0].phi - res.rows[res.rows.length - 1].phi) -
    (sol.nodePhi.get('2,0') - sol.nodePhi.get('3,0'))) < 1e-9)
  /* 电池 kind=battery,首行=φa、末行=φb */
  const bat = byType[T.BATTERY]
  assert.equal(bat.kind, 'battery')
  assert.equal(bat.rows[0].phi, sol.nodePhi.get('0,0'))
  assert.equal(bat.rows[bat.rows.length - 1].phi, sol.nodePhi.get('1,0'))
  /* meta */
  assert.ok(t.meta.hScale > 0)
  assert.ok(Math.abs(t.meta.phiMin) < 1e-9 && Math.abs(t.meta.phiMax - 3) < 0.05)
})

test('球:速度 ∝ |I|/Imax,方向为电子方向(−sign(I))', () => {
  const { model } = seriesR(3, 10)
  const sol = solver.solve(model.list(), { wireR: 0 })
  const t = buildTerrain(model, sol)
  assert.equal(t.balls.length, 6, '每条通电边一组球')
  const bat = t.balls.find(b => b.key === '0,0|1,0')
  const I = sol.edgeI.get(1)
  assert.equal(bat.dir, -Math.sign(I), '存的方向是电子方向')
  assert.ok(bat.speed >= 2.5 && bat.speed <= 12, '速度在示意区间')
  /* ballDirFor:电流视角取反,电子视角保持 */
  assert.equal(ballDirFor(bat.dir, false), Math.sign(I))
  assert.equal(ballDirFor(bat.dir, true), -Math.sign(I))
})

test('断路:无球,死支路仍是地形(有坡无流)', () => {
  const es = [
    { id: 1, a: [0, 0], b: [1, 0], key: '0,0|1,0', type: T.BATTERY, props: { V: 3 } },
    { id: 2, a: [1, 0], b: [2, 0], key: '1,0|2,0', type: T.SWITCH, props: { closed: false } },
    { id: 3, a: [2, 0], b: [3, 0], key: '2,0|3,0', type: T.RESISTOR, props: { R: 10 } },
    { id: 4, a: [3, 0], b: [0, 0], key: '0,0|3,0', type: T.WIRE, props: {} }
  ]
  const model = { list: () => es, edges: new Map(es.map(e => [e.key, e])) }
  const sol = solver.solve(es, { wireR: 0 })
  const t = buildTerrain(model, sol)
  assert.equal(t.balls.length, 0, '断路没有球')
  const sw = t.ribbons.find(r => r.type === T.SWITCH)
  assert.equal(sw.kind, 'slope', '断开的开关气隙是一条坡(3V→0V)')
})

test('电压表探针:平地、无球', () => {
  const { model, es } = seriesR(3, 10)
  es.push({ id: 10, a: [2, 0], b: [2, -1], key: '2,0|2,-1', type: T.WIRE, props: {} })
  es.push({ id: 11, a: [2, -1], b: [3, -1], key: '2,-1|3,-1', type: T.VOLTMETER, props: {} })
  es.push({ id: 12, a: [3, -1], b: [3, 0], key: '3,0|3,-1', type: T.WIRE, props: {} })
  const sol = solver.solve(model.list(), { wireR: 0 })
  const t = buildTerrain(model, sol)
  const probe = t.ribbons.find(r => r.key === '2,0|2,-1')
  assert.equal(probe.kind, 'flat', '探针线等势 → 平地')
  const vm = t.ribbons.find(r => r.type === T.VOLTMETER)
  assert.equal(vm.kind, 'slope', '电压表两端有电势差 → 有坡')
  assert.ok(!t.balls.some(b => b.key === vm.key), '电压表上没有球')
})

test('无源孤岛:不进地形', () => {
  const es = [
    { id: 1, a: [5, 5], b: [6, 5], key: '5,5|6,5', type: T.WIRE, props: {} }
  ]
  const model = { list: () => es, edges: new Map() }
  const sol = solver.solve(es, { wireR: 0 })
  const t = buildTerrain(model, sol)
  assert.equal(t.ribbons.length, 0)
  assert.equal(t.caps.length, 0)
})

test('高度换算:跨度大则压缩,跨度小则放大,有上下限', () => {
  assert.equal(heightScale(0, 0), 0, '零跨度')
  assert.ok(heightScale(0, 3) > 0)
  assert.equal(heightScale(0, 100), 3, '大跨度钳到下限(平缓)')
  assert.ok(heightScale(0, 0.1) <= 26, '小跨度不超上限')
})

test('路面宽度与行数:不变量', () => {
  const { model } = seriesR(3, 10)
  const sol = solver.solve(model.list(), { wireR: 0 })
  const t = buildTerrain(model, sol)
  t.ribbons.forEach(r => {
    assert.equal(r.rows.length, 6, 'SEGS+1 行')
    assert.equal(r.w, RIBBON_W)
  })
  assert.ok(t.caps.length >= 6, '结点盖板')
  assert.ok(t.labels.length === t.caps.length, 'φ 标注与盖板同点')
})

console.log(`\n${passed} 通过, ${failed} 失败`)
if (failed) process.exit(1)
