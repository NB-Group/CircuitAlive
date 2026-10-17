#!/usr/bin/env node
/* FieldFlow · 电路自动布局(elkjs)
 *
 * 输入:逻辑连接图(模型从试卷读出)
 * 输出:FieldFlow 网格边元组,可直接喂给求解器
 *
 * 布局用 Eclipse Layout Kernel 的分层算法(与 netlistsvg 同源):
 *   - 电源在左,电流流向决定层序
 *   - 并联支路自动并排到同一列的不同行
 *   - 正交路由
 * 然后吸附到整数网格。
 *
 * 用法:
 *   node tools/circuit-layout.mjs <input.json> [--out out.json]
 *   import { layoutCircuit } from './circuit-layout.mjs'
 */
import ELK from 'elkjs/lib/elk.bundled.js'
import { readFileSync, writeFileSync } from 'node:fs'

const GRID = 40            /* 网格步长(与前端 util.js 一致) */
/* elk 节点间距 40 + 节点宽 40 = 相邻节点中心距至少 80。
   要让元件之间留出导线空间,一个元件至少占 3 格:
   元件本体 1 格 + 两侧走线各 1 格。 */
const CELLS_PER_ELK_UNIT = 1 / 40 * 3

const ALIASES = {
  '电源': 'battery', '电池': 'battery', 'battery': 'battery',
  '开关': 'switch', '电键': 'switch', 'switch': 'switch',
  '电阻': 'resistor', '定值电阻': 'resistor', 'resistor': 'resistor',
  '灯泡': 'lamp', '小灯泡': 'lamp', 'lamp': 'lamp',
  '滑动变阻器': 'rheostat', '变阻器': 'rheostat', 'rheostat': 'rheostat',
  '电流表': 'ammeter', 'ammeter': 'ammeter',
  '电压表': 'voltmeter', 'voltmeter': 'voltmeter',
  '导线': 'wire', 'wire': 'wire'
}

const DEFAULT_PROPS = {
  battery: { V: 3 },
  switch: { closed: false },
  resistor: { R: 10 },
  lamp: { R: 10 },
  rheostat: { Rmax: 50, wiper: 0.5 },
  ammeter: {},
  voltmeter: {},
  wire: {}
}

function normType(raw) {
  const s = String(raw || '').trim()
  return ALIASES[s] || ALIASES[s.toLowerCase()] || 'wire'
}

/* 浮点坐标 → 网格整数坐标 */
function snap(v) {
  /* elk 坐标 → 网格整数坐标:每 40px 映射到 3 格,保证元件不挤在一起 */
  return Math.round(v * CELLS_PER_ELK_UNIT)
}

/* 两点之间的逐格正交路径。
   先走"距离更长"的方向,能让并联支路沿列对齐、少绕路。 */
function walk(a, b) {
  const pts = [a]
  let [x, y] = a
  const dx = Math.abs(b[0] - x), dy = Math.abs(b[1] - y)
  const horizontalFirst = dx >= dy
  if (horizontalFirst) {
    while (x !== b[0]) { x += b[0] > x ? 1 : -1; pts.push([x, y]) }
    while (y !== b[1]) { y += b[1] > y ? 1 : -1; pts.push([x, y]) }
  } else {
    while (y !== b[1]) { y += b[1] > y ? 1 : -1; pts.push([x, y]) }
    while (x !== b[0]) { x += b[0] > x ? 1 : -1; pts.push([x, y]) }
  }
  return pts
}

export async function layoutCircuit(circuit, opts = {}) {
  const comps = circuit.components || []
  const conns = circuit.connections || []
  if (!comps.length || !conns.length) return null

  const byId = new Map(comps.map(c => [c.id, c]))
  const type = new Map(comps.map(c => [c.id, normType(c.type)]))
  const bat = comps.find(c => type.get(c.id) === 'battery')
  if (!bat) return null

  /* elk 图:元件是节点,连接是边 */
  const graph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.spacing.nodeNode': '40',
      'elk.layered.spacing.nodeNodeBetweenLayers': '60',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX'
    },
    children: comps.map(c => ({
      id: c.id,
      width: 40,
      height: 40
    })),
    edges: conns
      .filter(k => byId.has(k.from) && byId.has(k.to) && k.from !== k.to)
      .map((k, i) => ({ id: 'e' + i, sources: [k.from], targets: [k.to] }))
  }

  const elk = new ELK()
  const out = await elk.layout(graph)

  /* 元件中心 → 网格坐标(翻转 y,让电流从上往下更像电路图) */
  const pos = new Map()
  let minX = Infinity, minY = Infinity
  for (const c of out.children) {
    const cx = snap(c.x + c.width / 2)
    const cy = snap(c.y + c.height / 2)
    pos.set(c.id, [cx, cy])
    minX = Math.min(minX, cx)
    minY = Math.min(minY, cy)
  }
  /* 平移到原点附近 */
  for (const [id, [x, y]] of pos) pos.set(id, [x - minX, y - minY])

  /* 生成边:元件本体占一段,连接走导线 */
  const edges = []
  const used = new Set()
  function add(t, a, b) {
    if (!a || !b) return
    if (a[0] === b[0] && a[1] === b[1]) return
    const key = [Math.min(a[0], b[0]), Math.min(a[1], b[1]),
                 Math.max(a[0], b[0]), Math.max(a[1], b[1])].join(',')
    /* 元件本体不去重(它占的格必须存在);导线才去重。
       否则导线经过元件所在格时会被误判为重复而丢失。 */
    if (t === 'wire') {
      if (used.has(key)) return
      used.add(key)
    } else {
      used.add(key)
    }
    edges.push([t, a[0], a[1], b[0], b[1], { ...(DEFAULT_PROPS[t] || {}) }])
  }

  /* 每个元件:从它的网格点向右延伸一格作为本体。
     记录两个端点,后续连接必须接到端点而不是中心。 */
  const terminals = new Map()   /* cid -> {in: [x,y], out: [x,y]} */
  for (const c of comps) {
    const p = pos.get(c.id)
    if (!p) continue
    const t = type.get(c.id)
    if (t === 'wire') {
      terminals.set(c.id, { in: p, out: p })
      continue
    }
    /* 元件本体统一朝右:p 是入端,p+1 是出端 */
    const q = [p[0] + 1, p[1]]
    add(t, p, q)
    terminals.set(c.id, { in: p, out: q })
  }

  /* 连接:在已铺网格上做 A*,优先复用已有导线,避免冗余绕线 */
  const wireSet = new Set()      /* 已铺的网格边(端点对) */
  function keyOf(a, b) {
    return [Math.min(a[0], b[0]), Math.min(a[1], b[1]),
            Math.max(a[0], b[0]), Math.max(a[1], b[1])].join(',')
  }
  edges.forEach(e => {
    if (e[0] === 'wire') wireSet.add(keyOf([e[1], e[2]], [e[3], e[4]]))
  })

  /* 元件本体占用的边:走线不能穿过它们(否则电流会被元件"短路"或走错路) */
  const bodySet = new Set()
  edges.forEach(e => {
    if (e[0] !== 'wire') bodySet.add(keyOf([e[1], e[2]], [e[3], e[4]]))
  })

  function routeOnGrid(a, b, bounds) {
    /* 在 [0..maxX] x [0..maxY] 的格点图上做 BFS:
       已有导线 = 0,新格 = 1,元件本体 = 不可通行 */
    const [x0, y0, x1, y1] = bounds
    const key = (x, y) => x + ',' + y
    const start = key(a[0], a[1])
    const goal = key(b[0], b[1])
    if (start === goal) return []
    const prev = new Map([[start, null]])
    const dist = new Map([[start, 0]])
    const q = [[0, a[0], a[1]]]
    while (q.length) {
      q.sort((p, r) => p[0] - r[0])
      const [d, x, y] = q.shift()
      if (x === b[0] && y === b[1]) {
        const path = []
        let cur = key(x, y)
        while (cur) {
          const [cx, cy] = cur.split(',').map(Number)
          path.push([cx, cy])
          cur = prev.get(cur)
        }
        return path.reverse()
      }
      if (d > dist.get(key(x, y))) continue
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < x0 || nx > x1 || ny < y0 || ny > y1) continue
        const ek = keyOf([x, y], [nx, ny])
        /* 元件本体不可穿越 */
        if (bodySet.has(ek)) continue
        const nk = key(nx, ny)
        /* 复用已有导线代价略低(仍>0),避免两条连接完全重叠造成短路 */
        const cost = d + (wireSet.has(ek) ? 1 : 2)
        if (!dist.has(nk) || cost < dist.get(nk)) {
          dist.set(nk, cost)
          prev.set(nk, key(x, y))
          q.push([cost, nx, ny])
        }
      }
    }
    return null
  }

  let maxX = 0, maxY = 0
  terminals.forEach(({ in: a, out: b }) => {
    maxX = Math.max(maxX, a[0], b[0]); maxY = Math.max(maxY, a[1], b[1])
  })
  /* 边界放宽:元件端点可能在边缘,走线需要绕行空间 */
  const bounds = [-4, -4, maxX + 6, maxY + 6]

  for (const e of out.edges || []) {
    const src = e.sources[0]
    const tgt = e.targets[0]
    const ta = terminals.get(src)
    const tb = terminals.get(tgt)
    if (!ta || !tb) {
      if (process.env.FF_LAYOUT_DEBUG) console.error('missing terminal:', src, tgt, !!ta, !!tb)
      continue
    }
    const a = ta.out
    const b = tb.in
    let path = routeOnGrid(a, b, bounds)
    if (process.env.FF_LAYOUT_DEBUG) {
      console.error('conn', src, '->', tgt, 'a=', a, 'b=', b, 'pathLen=', path ? path.length : 'null')
    }
    /* A* 失败或为空时回退到直线路径:宁可绕一点,也不能断路 */
    if (!path || path.length < 2) path = walk(a, b)
    let added = 0
    for (let i = 0; i < path.length - 1; i++) {
      const before = edges.length
      add('wire', path[i], path[i + 1])
      if (edges.length > before) { added++; wireSet.add(keyOf(path[i], path[i + 1])) }
    }
    if (process.env.FF_LAYOUT_DEBUG) console.error('  added', added, 'of', path.length - 1)
  }

  return edges.length ? edges : null
}

/* ---- CLI ---- */
if (import.meta.url === `file://${process.argv[1]}`) {
  const input = process.argv[2]
  let data
  if (!input || input === '-') {
    /* 从 stdin 读(供 ingest_exam.py 调用) */
    const chunks = []
    for await (const chunk of process.stdin) chunks.push(chunk)
    data = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } else {
    data = JSON.parse(readFileSync(input, 'utf8'))
  }
  const circuits = Array.isArray(data) ? data : [data]
  const results = []
  for (const c of circuits) {
    const edges = await layoutCircuit(c)
    results.push({ input: c, edges })
  }
  const outIdx = process.argv.indexOf('--out')
  const text = JSON.stringify(results, null, 2)
  if (outIdx > 0) writeFileSync(process.argv[outIdx + 1], text)
  else console.log(text)
}
