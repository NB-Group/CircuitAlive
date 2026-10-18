#!/usr/bin/env node
/* FieldFlow · 布局 + 求解器验证 CLI
 *
 * 用法:node tools/layout-cli.mjs spec.json [--emit]
 *
 * spec.json:
 *   { "components": [{"id":"bat","type":"battery","props":{"V":6}}, ...],
 *     "connections": [{"from":"bat","to":"sw"}, ...] }
 *
 * 输出网格边元组;加 --emit 时额外输出一行可直接粘进题库的 JSON。
 * 布局失败或被短接时以非零码退出 —— 绝不产出坏电路。
 */
import { readFileSync } from 'node:fs'
import { layoutCircuit } from './circuit-layout.mjs'
import { solver } from '../src/core/solver.js'

const spec = JSON.parse(readFileSync(process.argv[2], 'utf8'))

/* 求解器会把超范围参数静默钳位(36 V 电池被当 24 V 算),布局和
   状态检查都发现不了。在入口就拦下:题面参数超出物理量程,这条题
   没法如实呈现,宁可失败也不要一份读数全错的电路。 */
const LIMITS = { R: [0.1, 9999], Rmax: [1, 999], V: [0.1, 24] }
for (const c of spec.components || []) {
  const p = c.props || {}
  const checks = [
    ['V', LIMITS.V], ['R', LIMITS.R], ['Rmax', LIMITS.Rmax], ['r', [0.01, 50]]
  ]
  for (const [k, [lo, hi]] of checks) {
    if (p[k] != null && (p[k] < lo || p[k] > hi)) {
      console.error(`参数超范围: ${c.id}.${k}=${p[k]}(允许 ${lo}~${hi})`)
      console.error('题面数值超出工具量程,无法如实呈现;如需收录请在题解中说明。')
      process.exit(1)
    }
  }
}

const edges = await layoutCircuit(spec)
if (!edges) {
  console.error('布局失败')
  process.exit(1)
}

const es = edges.map(([t, x1, y1, x2, y2, p], i) => ({
  id: i + 1, a: [x1, y1], b: [x2, y2], type: t, props: p || {}
}))

/* 悬空端点:度为 1 的节点意味着某条支路没接上 */
const deg = new Map()
for (const e of es) for (const n of [e.a, e.b]) {
  const k = n.join(','); deg.set(k, (deg.get(k) || 0) + 1)
}
const dangling = [...deg].filter(([, d]) => d === 1)
if (dangling.length) {
  console.error('悬空端点:', dangling.map(([k]) => k).join(' '))
  process.exit(1)
}

/* 纯导线短路:元件两端若只靠导线就连通,该元件被旁路 */
const wAdj = new Map()
const push = (m, a, b) => { if (!m.has(a)) m.set(a, []); m.get(a).push(b) }
for (const e of es) {
  if (e.type !== 'wire') continue
  const a = e.a.join(','), b = e.b.join(',')
  push(wAdj, a, b); push(wAdj, b, a)
}
const reach = (s, t) => {
  const seen = new Set([s]); const st = [s]
  while (st.length) {
    const c = st.pop()
    if (c === t) return true
    for (const n of wAdj.get(c) || []) if (!seen.has(n)) { seen.add(n); st.push(n) }
  }
  return false
}
const shorted = es.filter(e => e.type !== 'wire' && reach(e.a.join(','), e.b.join(',')))
if (shorted.length) {
  console.error('被导线短接:', shorted.map(e => e.type).join(' '))
  process.exit(1)
}

const s = solver.solve(es, { wireR: 0 })
console.log(`边数 ${es.length} · 状态 ${s.status} · Imax ${s.Imax?.toFixed(4)}`)
for (const e of es) {
  if (e.type === 'wire') continue
  const I = s.edgeI.get(e.id)
  console.log(`  ${e.type.padEnd(10)} I=${typeof I === 'number' ? I.toFixed(4) : I}`)
}

if (process.argv.includes('--emit')) {
  const rows = es.map(e => {
    const props = Object.keys(e.props).length ? ', ' + JSON.stringify(e.props) : ''
    return `[T.${e.type.toUpperCase()}, ${e.a[0]}, ${e.a[1]}, ${e.b[0]}, ${e.b[1]}${props}]`
  })
  console.log('\n--- 粘贴用 ---')
  console.log(rows.join(',\n'))
}
