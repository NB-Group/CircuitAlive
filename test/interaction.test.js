/* CircuitAlive · 交互与模型回归测试 — node test/interaction.test.js
 *
 * 画布手势依赖 DOM,这里用最小假 DOM 桩验证与框架无关的部分:
 * 吸附/跟随布线算法、模型放置语义、开关开合、滑片拖拽、触摸手势判定。
 * 纯逻辑,无浏览器依赖。 */
'use strict'

import assert from 'node:assert/strict'
import * as U from '../src/core/util.js'
import { Model } from '../src/core/model.js'
import { solver } from '../src/core/solver.js'
import { presets } from '../src/data/presets.js'

const { T, edgeKey, nodeKey } = U
const GRID = U.GRID

let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name) }
  catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + e.message) }
}

/* ---- 与 CircuitCanvas 一致的跟随式布线:主轴优先,逐格推进 ---- */
function followPath(start, target) {
  const segs = []
  let cur = [...start]
  let guard = 0
  while (guard++ < 64) {
    const dx = target[0] - cur[0], dy = target[1] - cur[1]
    if (Math.abs(dx) + Math.abs(dy) === 0) break
    const next = Math.abs(dx) >= Math.abs(dy)
      ? [cur[0] + Math.sign(dx), cur[1]]
      : [cur[0], cur[1] + Math.sign(dy)]
    segs.push([cur, next])
    cur = next
  }
  return segs
}

/* ---- 磁吸:0.4 格内优先吸已有节点 ---- */
function snapPoint(world, model) {
  const deg = model.nodeDegrees()
  const gx = Math.round(world.x / GRID), gy = Math.round(world.y / GRID)
  const cx = Math.floor(world.x / GRID), cy = Math.floor(world.y / GRID)
  const cand = [[gx, gy], [cx, cy], [cx + 1, cy], [cx, cy + 1], [cx + 1, cy + 1]]
  let best = null, bestD = GRID * 0.4
  for (const p of cand) {
    if (!deg.has(p[0] + ',' + p[1])) continue
    const d = Math.hypot(world.x - p[0] * GRID, world.y - p[1] * GRID)
    if (d < bestD) { bestD = d; best = p }
  }
  return best || [gx, gy]
}

console.log('CircuitAlive 交互回归测试')

test('跟随式布线:斜向拖动生成逐格直角路径', () => {
  const segs = followPath([8, 5], [11, 7])
  const keys = segs.map(s => edgeKey(s[0], s[1]))
  for (const k of [[8, 5, 9, 5], [9, 5, 10, 5], [10, 5, 10, 6], [10, 6, 11, 6], [11, 6, 11, 7]]) {
    assert.ok(keys.includes(edgeKey([k[0], k[1]], [k[2], k[3]])), '缺少段 ' + k)
  }
  assert.equal(segs.length, 5)
})

test('磁吸:靠近已有节点时吸过去,否则取最近格点', () => {
  const m = new Model()
  m.placeWire([0, 0], [1, 0])
  const near = snapPoint({ x: 1 * GRID + 8, y: 0 + 6 }, m)
  assert.deepEqual(near, [1, 0], '应吸附到已有节点 (1,0)')
  const far = snapPoint({ x: 5 * GRID + 9, y: 3 * GRID + 2 }, m)
  assert.deepEqual(far, [5, 3], '远离节点时取最近格点')
})

test('放置语义:导线可被元件替换,元件不可被覆盖', () => {
  const m = new Model()
  m.placeWire([0, 0], [1, 0])
  assert.ok(m.place(T.BATTERY, [0, 0], [1, 0], { V: 3 }), '导线边应允许放元件')
  assert.equal(m.place(T.LAMP, [0, 0], [1, 0], { R: 10 }), false, '元件边应拒绝覆盖')
})

test('props 隔离:同类元件不共享参数对象', () => {
  const m = new Model()
  const p = { V: 3 }
  m.place(T.BATTERY, [0, 0], [1, 0], p)
  m.place(T.BATTERY, [1, 0], [2, 0], p)
  const bats = m.list().filter(e => e.type === T.BATTERY)
  bats[0].props.V = 12
  assert.equal(bats[1].props.V, 3, '改一个电池不应影响另一个')
  assert.equal(p.V, 3, '外部对象不应被污染')
})

test('开关开合:闭合后电路从断路变正常', () => {
  const m = new Model()
  m.loadPreset(presets[0].tuples)
  const before = solver.solve(m.list(), { wireR: m.wireR })
  assert.equal(before.status, 'open', '预置开关默认断开')
  const sw = m.list().find(e => e.type === T.SWITCH)
  m.toggleSwitch(sw.key)
  const after = solver.solve(m.list(), { wireR: m.wireR })
  assert.equal(after.status, 'normal', '闭合后应正常导通')
})

test('滑片拖拽:wiper 连续改变阻值', () => {
  const m = new Model()
  m.loadPreset(presets[3].tuples)
  const r = m.list().find(e => e.type === T.RHEOSTAT)
  const r0 = solver.rOf(r, m.wireR)
  r.props.wiper = 0.25
  const r1 = solver.rOf(r, m.wireR)
  assert.ok(r1 < r0, '滑片减小应降低阻值')
  r.props.wiper = 1
  assert.ok(Math.abs(solver.rOf(r, m.wireR) - r.props.Rmax) < 1e-9, 'wiper=1 时为 Rmax')
})

test('撤销:一次手势一个快照,可回滚', () => {
  const m = new Model()
  const snap = m.serializeStr()
  m.rawPlaceWire([0, 0], [1, 0])
  m.rawPlaceWire([1, 0], [2, 0])
  assert.equal(m.edges.size, 2)
  m.commit(snap)
  m.undo()
  assert.equal(m.edges.size, 0, '撤销后回到手势前')
})

test('电动机/电铃:有限电阻,不被误判为开路或短路', () => {
  const mk = (type) => {
    const m = new Model()
    m.place(T.BATTERY, [0, 0], [1, 0], { V: 3 })
    m.place(type, [1, 0], [2, 0], {})
    m.placeWire([2, 0], [2, 1])
    m.placeWire([2, 1], [1, 1])
    m.placeWire([1, 1], [0, 1])
    m.placeWire([0, 1], [0, 0])
    return solver.solve(m.list(), { wireR: 0 })
  }
  for (const type of [T.MOTOR, T.BELL]) {
    const s = mk(type)
    assert.equal(s.status, 'normal', type + ' 应为正常回路')
    assert.ok(s.Imax > 0.1 && s.Imax < 2, type + ' 电流应在合理范围')
  }
})

test('电压表读数符号:φ(+接线柱) − φ(−接线柱)', () => {
  const m = new Model()
  m.place(T.BATTERY, [0, 0], [1, 0], { V: 3 })
  m.place(T.RESISTOR, [1, 0], [2, 0], { R: 10 })
  m.placeWire([2, 0], [2, 1])
  m.placeWire([2, 1], [1, 1])
  m.placeWire([1, 1], [0, 1])
  m.placeWire([0, 1], [0, 0])
  m.placeWire([1, 0], [1, -1])
  m.place(T.VOLTMETER, [1, -1], [2, -1], {})
  m.placeWire([2, -1], [2, 0])
  const s = solver.solve(m.list(), { wireR: 0 })
  const vm = m.list().find(e => e.type === T.VOLTMETER)
  const reading = s.nodePhi.get(nodeKey(vm.b)) - s.nodePhi.get(nodeKey(vm.a))
  assert.ok(reading < 0, '此接法下 + 接线柱在低电势侧,读数为负')
  assert.ok(Math.abs(Math.abs(reading) - 3 * 10 / 10.1) < 1e-6, '读数绝对值应等于 R 两端电压')
})

console.log(`\n${passed} 通过, ${failed} 失败`)
if (failed) process.exit(1)
