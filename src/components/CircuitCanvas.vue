<script setup>
/* CircuitCanvas — SVG 画布 + 指针/键盘/触摸交互(Vue 3 封装)
 *
 * 渲染与命中全部委托给 core/render.js;本组件只负责:
 *   - 创建/销毁渲染器,把 model / solution / opts 的变化同步进场景
 *   - 工具状态机(与旧 interact.js 逐条对齐):
 *       导线 = 磁吸起点 + 跟随光标逐格铺线,松手一次 undo;
 *       放置 = 空边/导线边直接放,元件边拒绝;触摸延迟到抬手;
 *       开关 = 任意工具下点符号中部开合;滑变 = 抓滑片拖阻值;
 *       双指 = 平移 + 捏合缩放,第二指落下时回滚未完成的单指手势。
 *   - 长按(触摸 450ms)/ 右键 / 选择工具点击 → 通知父层打开浮动检查器
 *
 * 事件:edge-click(key) · select(key|null) · changed() · probe(key|null) · viewport(view)
 */
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { T, GRID, clamp, edgeKey, fmt, bus } from '../core/util.js'
import { symbols } from '../core/symbols.js'
import { solver } from '../core/solver.js'
import { createRenderer } from '../core/render.js'

const props = defineProps({
  model: { type: Object, required: true },
  solution: { type: Object, default: null },
  opts: { type: Object, default: () => ({}) },
  tool: { type: String, default: 'select' },
  armed: { type: Object, default: null }
})

const emit = defineEmits(['edge-click', 'wiper-open', 'select', 'changed', 'probe', 'viewport'])

const G = GRID
const svgEl = ref(null)

let R = null
let lastSol = null
let fitted = false
let fittedNonEmpty = false

/* ---------- 内部交互状态 ---------- */
const I = {
  drag: null,
  pinch: null,
  pointers: new Map(),
  spaceDown: false,
  hoverKey: null,
  ghost: null,
  lp: null,           /* 长按计时器 */
  suppressUp: false,  /* 长按已消费本次手势,抬手不再放置/切换 */
  recentPlaces: []
}

const hintText = ref('点击元件选中 · 点开关中部切换开合 · 拖滑变滑片调阻值 · 双击导线开截面探针')
const empty = ref(true)

function hint(msg) { hintText.value = msg }

const HINTS = {
  select: '点击元件选中 · 点开关中部切换开合 · 拖滑变滑片调阻值 · 双击导线开截面探针',
  wire: '单击空边放一段 · 按住拖动,导线逐格跟随光标铺过去',
  eraser: '点击或拖过要删除的边',
  battery: '点击网格边放置电池(R 翻转正负极,Esc 结束)',
  switch: '点击网格边放置开关,再点符号中部切换开合',
  resistor: '点击网格边放置定值电阻',
  lamp: '点击网格边放置小灯泡',
  rheostat: '点击网格边放置滑动变阻器,拖符号上的滑片调阻值',
  ammeter: '点击网格边放置电流表(串联进电路)',
  voltmeter: '点击网格边放置电压表(并联在被测元件两端)',
  motor: '点击网格边放置电动机(通电后转子旋转)',
  bell: '点击网格边放置电铃(通电后铃体摇动)'
}

/* ---------- 渲染同步 ---------- */

function syncStructure() {
  if (!R) return
  R.setModel(props.model)
  R.syncStructure()
  empty.value = props.model.edges.size === 0
}

function syncSolution() {
  if (!R) return
  R.setModel(props.model)
  R.setSolution(props.solution)
  if (props.solution) {
    R.syncSolution()
    lastSol = props.solution
  }
  /* 读数写在 symbol-text 层的原节点上;检查中的克隆不会自动跟着变,
     解刷新后重克隆一次,让 overlay 里的读数也是新的 */
  if (I.inspectKey) setInspected(I.inspectKey)
}

function emitViewport() {
  if (!R) return
  emit('viewport', { ...R.view() })
  /* 检查器开着时视野被拖动/缩放,面板要跟着元件重新择边 */
  bus.emit('viewport')
}

function onModelChanged() {
  syncStructure()
  /* 结构层重建会换掉新的符号组;检查中要重新克隆,否则 overlay 里是旧元件 */
  if (I.inspectKey) setInspected(I.inspectKey)
  /* 首次拿到非空电路(父层 mounted 里载入预置)时补一次适配视图 */
  if (!fittedNonEmpty && !I.touched && props.model.edges.size) {
    fittedNonEmpty = true
    /* 等一帧:题目浮层和画布在同一轮里出现,此刻量不到它的高度 */
    requestAnimationFrame(() => {
      if (R) { R.fitView({ topInset: topInset() }); emitViewport() }
    })
  }
  /* 父层在同一轮事件里会重算 solution;等它落到 prop 上再画解层。
     若父层没有重算(同引用),这里补一次,避免读数停在旧值。 */
  Promise.resolve().then(() => {
    if (props.solution !== lastSol) syncSolution()
  })
}

/* ---------- 选中 ---------- */

function selectKey(key, { silent = false } = {}) {
  if (!R) return
  R.select(key)
  if (!silent) emit('select', key)
}

function currentSelected() { return R ? R.selectedKey() : null }

/* ---------- 放置预览 ---------- */

function clearGhost() {
  if (I.ghost) { I.ghost.remove(); I.ghost = null }
  I.hoverKey = null
}

function showGhost(key) {
  clearGhost()
  if (!props.armed || !key || !R) return
  const occ = props.model.edges.get(key)
  if (occ && occ.type !== T.WIRE) return
  if (occ && props.armed.type === T.WIRE) return
  const ends = R.keyEnds(key)
  const pa = ends[0], pb = ends[1]
  const angle = symbols.angleOf(pa, pb)
  I.ghost = symbols.build(props.armed.type, angle, props.armed.props, { text: false })
  I.ghost.setAttribute('class', 'sym ghost-sym' + (props.armed.type === T.WIRE ? ' dashed' : ''))
  I.ghost.setAttribute('transform',
    'translate(' + (pa[0] + pb[0]) / 2 * G + ',' + (pa[1] + pb[1]) / 2 * G + ') rotate(' + angle + ')')
  R.overlay().appendChild(I.ghost)
}

/* ---------- 磁吸与几何 ---------- */

function snapPoint(world) {
  const deg = props.model.nodeDegrees()
  const gx = Math.round(world.x / G), gy = Math.round(world.y / G)
  const cx = Math.floor(world.x / G), cy = Math.floor(world.y / G)
  const cand = [[gx, gy], [cx, cy], [cx + 1, cy], [cx, cy + 1], [cx + 1, cy + 1]]
  let best = null, bestD = G * 0.4
  cand.forEach((p) => {
    if (!deg.has(p[0] + ',' + p[1])) return
    const d = Math.hypot(world.x - p[0] * G, world.y - p[1] * G)
    if (d < bestD) { bestD = d; best = p }
  })
  return best || [gx, gy]
}

function distToSeg(pt, a, b) {
  const ax = a[0] * G, ay = a[1] * G, bx = b[0] * G, by = b[1] * G
  const vx = bx - ax, vy = by - ay
  const t = clamp(((pt.x - ax) * vx + (pt.y - ay) * vy) / (vx * vx + vy * vy), 0, 1)
  return Math.hypot(pt.x - (ax + vx * t), pt.y - (ay + vy * t))
}

function clickPlaceSegment(world) {
  const N = snapPoint(world)
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]]
  let best = null, bestD = G * 0.6
  dirs.forEach((d) => {
    const a = N, b = [N[0] + d[0], N[1] + d[1]]
    if (props.model.edges.has(edgeKey(a, b))) return
    const dd = distToSeg(world, a, b)
    if (dd < bestD) { bestD = dd; best = [a, b] }
  })
  if (best) {
    props.model.placeWire(best[0], best[1])
    I.recentPlaces.push(performance.now())
  } else {
    hint('该节点四周都已被占用')
  }
}

function rheostatLocal(e, world) {
  const ax = e.a[0] * G, ay = e.a[1] * G, bx = e.b[0] * G, by = e.b[1] * G
  const len = Math.hypot(bx - ax, by - ay)
  const ux = (bx - ax) / len, uy = (by - ay) / len
  const mx = (ax + bx) / 2, my = (ay + by) / 2
  const dx = world.x - mx, dy = world.y - my
  return { lx: dx * ux + dy * uy, ly: -dx * uy + dy * ux }
}

/* 滑片可抓取区:长方形上边以上、顶部绕行线以下,横向覆盖滑片可达范围 */
function wiperGrab(e, world) {
  const loc = rheostatLocal(e, world)
  return loc.ly <= -4 && loc.ly >= -16 && loc.lx >= -12 && loc.lx <= 8
}

function placeAtEdge(world) {
  const gkey = R.gridEdgeAt(world)
  if (!gkey) return
  const occ = props.model.edges.get(gkey)
  if (occ && occ.type !== T.WIRE) {
    hint('该边已有元件 — 先删除,或换个位置')
    return
  }
  /* 端点排序只按字典序,不保留拖拽方向:竖放元件因此总是朝同一侧,
     和预置里声明的方向可能正好相反,看起来就是"放反了"。
     统一成视觉约定:横放从左到右,竖放从下到上,符号永远朝正方向;
     要反接按 R 翻转。 */
  const ends = R.keyEnds(gkey)
  let [a, b] = ends
  if (a[1] === b[1]) { if (a[0] > b[0]) [a, b] = [b, a] }        /* 横:左→右 */
  else { if (a[1] < b[1]) [a, b] = [b, a] }                       /* 竖:下→上 */
  const res = props.model.place(props.tool, a, b, props.armed ? props.armed.props : {})
  if (res) {
    /* 放置只选中,不自动打开检查器:检查器由用户主动选中(单击)才出现 */
    selectKey(null)
    emit('placed', gkey)
  }
}

/* ---------- 长按(触摸 450ms)---------- */

function clearLongPress() {
  if (I.lp && I.lp.timer) clearTimeout(I.lp.timer)
  I.lp = null
}

function startLongPress(ev, key) {
  clearLongPress()
  if (!key) return
  const x0 = ev.clientX, y0 = ev.clientY
  const timer = setTimeout(() => {
    I.lp = null
    /* 手指基本没动才算长按:打开检查器,并吞掉本次抬手。
       不按 pointerId 判断:CDP/部分浏览器把 touch 转成 pointer 时
       会换 id,导致长按永远不触发。只看还有没有活动指针。 */
    if (I.pointers.size === 0) return
    if (I.drag) {
      if (I.drag.snap) { props.model.restore(JSON.parse(I.drag.snap)); bus.emit('changed') }
      I.drag = null
    }
    clearGhost()
    const sel2 = window.getSelection && window.getSelection()
    if (sel2 && sel2.removeAllRanges) sel2.removeAllRanges()
    selectKey(key)
    emit('edge-click', key)
    hint('长按打开元件检查器')
    I.suppressUp = true
  }, 450)
  I.lp = { timer, x0, y0, id: ev.pointerId }
}

/* ---------- 指针 ---------- */

function pinchDist() {
  const pts = Array.from(I.pointers.values())
  if (pts.length < 2) return 0
  return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
}

function pinchCenter() {
  const pts = Array.from(I.pointers.values())
  if (!pts.length) return { x: 0, y: 0 }
  let cx = 0, cy = 0
  pts.forEach((p) => { cx += p.x; cy += p.y })
  return { x: cx / pts.length, y: cy / pts.length }
}

function cancelDrag() {
  if (I.drag && I.drag.snap) {
    props.model.restore(JSON.parse(I.drag.snap))
    bus.emit('changed')
  }
  I.drag = null
  clearLongPress()
  clearGhost()
}

function blockGesture(ev) {
  ev.preventDefault()
}

function onTouchStart(ev) {
  /* 只拦选择,不拦多指:双指缩放走 pointer 流程 */
  if (ev.touches && ev.touches.length > 1) return
  ev.preventDefault()
  const sel = window.getSelection && window.getSelection()
  if (sel && sel.removeAllRanges) sel.removeAllRanges()
}

function onDown(ev) {
  if (!R) return
  /* 用户碰过画布后,后续电路变化不再自动适配视图:
     空画布上放下第一个元件时的 fitView 会把视野猛地拉近,
     触屏上像"突然放大"。外部载入(题库/分享链接/预置)不经过
     指针,自动适配照常。 */
  I.touched = true
  I.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY })

  /* 双指:进入捏合/平移,回滚未完成的单指手势(拖画/拖擦/滑片) */
  if (I.pointers.size === 2) {
    cancelDrag()
    I.pinch = { d0: pinchDist(), c0: pinchCenter(), view0: { ...R.view() } }
    return
  }

  if (ev.button === 1 || I.spaceDown) {
    I.drag = { mode: 'pan', sx: ev.clientX, sy: ev.clientY }
    svgEl.value.classList.add('panning')
    ev.preventDefault()
    return
  }

  const world = R.screenToWorld(ev.clientX, ev.clientY)
  const hitKey = R.hitEdge(world)
  const hit = hitKey ? props.model.edges.get(hitKey) : null
  const touch = ev.pointerType === 'touch' || ev.pointerType === 'pen'
  if (touch) {
    /* 长按会触发 iOS 的文字选择/呼出菜单;按住期间清掉并拦下 */
    ev.preventDefault()
    const sel = window.getSelection && window.getSelection()
    if (sel && sel.removeAllRanges) sel.removeAllRanges()
  }

  /* 右键:命中元件 → 打开检查器;空白处 → 平移 */
  if (ev.button === 2) {
    ev.preventDefault()
    if (hitKey) {
      selectKey(hit && hit.type === T.WIRE ? '__wires__' : hitKey)
      emit('edge-click', hitKey)
    } else {
      I.drag = { mode: 'pan', sx: ev.clientX, sy: ev.clientY }
      svgEl.value.classList.add('panning')
    }
    return
  }
  if (ev.button !== 0) return
  /* 长按 = 打开检查器:鼠标与触摸统一,仅在选择工具下生效,
     放置/橡皮/导线工具里长按不应弹面板。导线也长按(检查器里有
     全局导线电阻)。开关的触摸开合走 tap-switch 抬手,长按会吞掉它。 */
  if (hitKey && props.tool === 'select') {
    /* 导线也支持长按:检查器里是全局导线设置,但视觉抬起的是这根导线 */
    startLongPress(ev, hitKey)
  }

  /* 点开关符号中部 = 开合,与当前工具无关(橡皮除外) */
  if (hit && hit.type === T.SWITCH && props.tool !== 'eraser') {
    const smx = (hit.a[0] + hit.b[0]) / 2 * G, smy = (hit.a[1] + hit.b[1]) / 2 * G
    if (Math.hypot(world.x - smx, world.y - smy) < 16) {
      if (touch) {
        I.drag = { mode: 'tap-switch', key: hitKey, x0: ev.clientX, y0: ev.clientY }
        capture(ev)
        return
      }
      props.model.toggleSwitch(hitKey)
      hint(hit.props.closed ? '开关闭合 — 电路接通' : '开关断开 — 电路断开')
      return
    }
  }

  /* 滑变:点符号 = 选中并弹出滑条;拖滑轨 = 直接调阻值;滚轮 = 微调。
     橡皮除外,否则点滑变中心永远删不掉它。 */
  if (hit && hit.type === T.RHEOSTAT && props.tool !== 'eraser') {
    selectKey(hitKey)
    if (wiperGrab(hit, world)) {
      I.drag = { mode: 'wiper', edge: hit, key: hitKey, snap: props.model.serializeStr(), moved: false }
      hint('拖动滑片调阻值')
      capture(ev)
      return
    }
    /* 点符号本体(非滑轨):抬手时开浮出滑条。
       走 tap-rheo 而不是立刻派发,长按才能优先开完整检查器。 */
    I.drag = { mode: 'tap-rheo', key: hitKey, x0: ev.clientX, y0: ev.clientY }
    capture(ev)
    return
  }

  switch (props.tool) {
    case 'select': {
      /* 鼠标单击已经在上面的指针按下里同步完成,这里不重复派发
         edge-click —— 否则父层可能在同一事件里把检查器开两遍。 */
      if (hitKey) {
        selectKey(hitKey)
      } else {
        selectKey(null)
      }
      break
    }

    case 'wire': {
      const N = snapPoint(world)
      I.drag = { mode: 'wire', last: N, everMoved: false, snap: props.model.serializeStr() }
      break
    }

    case 'eraser': {
      if (hitKey) {
        I.drag = {
          mode: 'erase', firstKey: hitKey, snap: props.model.serializeStr(),
          changed: false, moved: false, x0: ev.clientX, y0: ev.clientY
        }
      }
      break
    }

    default: {
      /* 元件放置:触摸延迟到抬手;鼠标按下即放 */
      if (touch) {
        I.drag = { mode: 'tap-place', world0: world, x0: ev.clientX, y0: ev.clientY }
        break
      }
      placeAtEdge(world)
      break
    }
  }
  if (I.drag) capture(ev)
}

function capture(ev) {
  try { svgEl.value.setPointerCapture(ev.pointerId) } catch (e) { /* 合成事件兜底 */ }
}

function onMove(ev) {
  if (!R) return
  if (I.pointers.has(ev.pointerId)) {
    I.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY })
  }

  /* 长按候选:手指挪动超阈值就取消 */
  if (I.lp && Math.hypot(ev.clientX - I.lp.x0, ev.clientY - I.lp.y0) > 10) clearLongPress()

  /* 双指:捏合缩放 + 中点平移(锚定手势起始视图) */
  if (I.pinch && I.pointers.size >= 2) {
    const d = pinchDist(), c = pinchCenter()
    const v0 = I.pinch.view0
    const r = svgEl.value.getBoundingClientRect()
    const scale = clamp(I.pinch.d0 / Math.max(d, 10), 0.2, 5)
    const nw = clamp(v0.w * scale, 200, 4000)
    const nh = nw * (r.height / r.width || 0.65)
    R.setView(
      v0.x + v0.w / 2 - (c.x - I.pinch.c0.x) * nw / r.width - nw / 2,
      v0.y + v0.h / 2 - (c.y - I.pinch.c0.y) * nh / r.height - nh / 2,
      nw
    )
    emitViewport()
    return
  }

  const world = R.screenToWorld(ev.clientX, ev.clientY)

  if (I.drag && I.drag.mode === 'pan') {
    const r2 = svgEl.value.getBoundingClientRect()
    R.panBy((ev.clientX - I.drag.sx) * R.view().w / r2.width,
            (ev.clientY - I.drag.sy) * R.view().h / r2.height)
    I.drag.sx = ev.clientX; I.drag.sy = ev.clientY
    emitViewport()
    return
  }

  /* 触摸点击类:挪动超阈值 = 滑动,取消 */
  if (I.drag && (I.drag.mode === 'tap-place' || I.drag.mode === 'tap-switch' || I.drag.mode === 'tap-rheo')) {
    if (Math.hypot(ev.clientX - I.drag.x0, ev.clientY - I.drag.y0) > 12) {
      I.drag = null
      clearLongPress()
    }
    return
  }

  /* 拖擦:确认移动后才开始(避免点击抖动误删) */
  if (I.drag && I.drag.mode === 'erase' && !I.drag.moved) {
    if (Math.hypot(ev.clientX - (I.drag.x0 || ev.clientX), ev.clientY - (I.drag.y0 || ev.clientY)) > 8) {
      I.drag.moved = true
    } else return
  }

  /* 滑变滑片:投影到 [0,1] */
  if (I.drag && I.drag.mode === 'wiper') {
    if (!props.model.edges.get(I.drag.key)) { I.drag = null; return }
    const loc = rheostatLocal(I.drag.edge, world)
    I.drag.moved = true
    I.drag.edge.props.wiper = clamp((loc.lx + 10) / 16, 0, 1)
    bus.emit('changed')
    return
  }

  /* 跟随式布线:朝光标逐格推进(主轴优先) */
  if (I.drag && I.drag.mode === 'wire') {
    const target = snapPoint(world)
    let guard = 0
    while (guard++ < 64) {
      const dx = target[0] - I.drag.last[0], dy = target[1] - I.drag.last[1]
      if (Math.abs(dx) + Math.abs(dy) === 0) break
      let next
      if (Math.abs(dx) >= Math.abs(dy)) next = [I.drag.last[0] + Math.sign(dx), I.drag.last[1]]
      else next = [I.drag.last[0], I.drag.last[1] + Math.sign(dy)]
      if (props.model.rawPlaceWire(I.drag.last, next)) bus.emit('changed')
      I.drag.everMoved = true
      I.drag.last = next
    }
    return
  }

  if (I.drag && I.drag.mode === 'erase') {
    const dkey = R.hitEdge(world)
    if (dkey && props.model.rawRemove(dkey)) {
      I.drag.changed = true
      bus.emit('changed')
    }
    return
  }

  /* 悬停预览(放置工具) */
  if (props.armed) {
    const hk = R.gridEdgeAt(world)
    if (hk !== I.hoverKey) showGhost(hk)
  }
}

function onUp(ev) {
  if (!R) return
  I.pointers.delete(ev.pointerId)
  if (I.pinch && I.pointers.size < 2) I.pinch = null

  const suppress = I.suppressUp
  I.suppressUp = false
  clearLongPress()

  if (!I.drag) { if (suppress) hint(HINTS[props.tool] || ''); return }
  const d = I.drag
  I.drag = null

  if (d.mode === 'pan') {
    svgEl.value.classList.remove('panning')
    return
  }

  if (suppress) return

  if (d.mode === 'tap-place') {
    placeAtEdge(d.world0)
    return
  }

  if (d.mode === 'tap-rheo') {
    emit('wiper-open', { key: d.key, x: ev.clientX, y: ev.clientY })
    return
  }

  if (d.mode === 'tap-switch') {
    const sw = props.model.edges.get(d.key)
    if (sw && sw.type === T.SWITCH) {
      selectKey(d.key)
      props.model.toggleSwitch(d.key)
      hint(sw.props.closed ? '开关闭合 — 电路接通' : '开关断开 — 电路断开')
    }
    return
  }

  if (d.mode === 'wiper') {
    if (!d.moved) emit('edge-click', d.key)
    props.model.commit(d.snap)
    hint('滑片位置: ' + fmt(solver.rOf(d.edge, props.model.wireR), 'Ω'))
    return
  }

  if (d.mode === 'wire') {
    if (!d.everMoved) {
      const world = R.screenToWorld(ev.clientX, ev.clientY)
      clickPlaceSegment(world)
      return
    }
    props.model.commit(d.snap)
    return
  }

  if (d.mode === 'erase') {
    if (!d.changed && !d.moved && props.model.rawRemove(d.firstKey)) d.changed = true
    if (d.changed) props.model.commit(d.snap)
  }
}

function onCancel(ev) {
  I.pointers.delete(ev.pointerId)
  if (I.pinch && I.pointers.size < 2) I.pinch = null
  if (I.drag) cancelDrag()
  svgEl.value && svgEl.value.classList.remove('panning')
}

/* ---------- 双击:导线截面探针 ---------- */

function onDblClick(ev) {
  if (!R) return
  const world = R.screenToWorld(ev.clientX, ev.clientY)
  const key = R.hitEdge(world)
  if (!key) return
  const e = props.model.edges.get(key)
  if (!e || e.type !== T.WIRE) return

  /* 导线工具下,双击前的单击可能误放了支线段 —— 收回(最新 500ms 内的放置) */
  if (props.tool === 'wire' && I.recentPlaces.length) {
    const now = performance.now()
    let n = 0
    I.recentPlaces = I.recentPlaces.filter((t) => {
      if (now - t < 500) { n++; return false }
      return true
    })
    while (n-- > 0) props.model.undo()
  }
  const next = R.probe() === key ? null : key
  R.probe(next)
  emit('probe', next)
  hint(next ? '截面探针已放置' : '探针已移除')
}

/* ---------- 滚轮 / 缩放 ---------- */

function onWheel(ev) {
  if (!R) return
  ev.preventDefault()

  /* 悬停在滑动变阻器上:滚轮调滑片(上滚增大,下滚减小)。
     这是"符合直觉的交互方式"之一 —— 和缩放不冲突,因为焦点明确。 */
  const world = R.screenToWorld(ev.clientX, ev.clientY)
  const hitKey = R.hitEdge(world)
  const hit = hitKey ? props.model.edges.get(hitKey) : null
  if (hit && hit.type === T.RHEOSTAT) {
    const step = ev.deltaY < 0 ? 0.04 : -0.04
    const next = clamp((hit.props.wiper == null ? 1 : hit.props.wiper) + step, 0, 1)
    if (next !== hit.props.wiper) {
      hit.props.wiper = next
      bus.emit('changed')
      hint('滑片 ' + Math.round(next * 100) + '%  ·  ' + fmt(solver.rOf(hit, props.model.wireR), 'Ω'))
    }
    return
  }

  R.zoomAt(ev.clientX, ev.clientY, ev.deltaY < 0 ? 1.15 : 1 / 1.15)
  emitViewport()
}

function onContextMenu(ev) { ev.preventDefault() }

/* ---------- 键盘 ---------- */

function isTyping(ev) {
  const t = ev.target
  /* 只排除真正的文本输入;按钮获得焦点时 R/Delete/F 仍应生效 */
  return t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)
}

function onKeyDown(ev) {
  if (!R || isTyping(ev)) return
  if (ev.code === 'Space') {
    I.spaceDown = true
    svgEl.value.classList.add('panning')
    ev.preventDefault()
    return
  }
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') {
    ev.preventDefault()
    /* Shift+Z 是重做;先判 shift,否则永远落进撤销分支 */
    if (ev.shiftKey) props.model.redo()
    else props.model.undo()
    return
  }
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'y') {
    ev.preventDefault()
    props.model.redo()
    return
  }
  switch (ev.key) {
    case 'Escape':
      cancelDrag()
      selectKey(null)
      emit('escape')
      break
    case 'r': case 'R': {
      const sk = currentSelected()
      if (sk && sk !== '__wires__') {
        props.model.flip(sk)
        hint('已翻转极性(交换两端)')
      }
      break
    }
    case 'Delete': case 'Backspace': {
      const sk2 = currentSelected()
      if (sk2 && sk2 !== '__wires__') props.model.remove(sk2)
      ev.preventDefault()
      break
    }
    case 'f': case 'F':
      R.fitView()
      emitViewport()
      break
  }
}

function onKeyUp(ev) {
  if (ev.code === 'Space') {
    I.spaceDown = false
    if (svgEl.value) svgEl.value.classList.remove('panning')
  }
}

/* ---------- 检查器联动 ----------
   打开检查器时:画布其余层模糊压暗作背景,被检元件整组克隆到
   overlay 层(不模糊)并抬起。原件留在原层一起虚化,不做特殊处理。 */

function setInspected(key) {
  if (!svgEl.value) return
  I.inspectKey = key || null
  const active = !!I.inspectKey
  /* CSS 的作用域是 .ff-canvas(不是包住 svg 的 .ff-scene-wrap),
     同时给 svg 留一份,e2e/调试仍能直接查 svg.ff-stage.inspecting。 */
  const host = svgEl.value.closest('.ff-canvas')
  if (host) host.classList.toggle('inspecting', active)
  svgEl.value.classList.toggle('inspecting', active)
  /* overlay 现在挂在独立的 svg.ff-overlay-stage 里(不参与模糊) */
  const ov = R ? R.overlay() : svgEl.value.querySelector('[data-layer="overlay"]')
  if (ov) ov.innerHTML = ''
  if (!active) return
  const edge = props.model.edges.get(key)
  if (!edge) return
  /* 符号组 + 该元件的所有文字(字母/标注/读数)一起克隆 */
  const parts = svgEl.value.querySelectorAll('[data-edge-id="' + edge.id + '"]')
  parts.forEach((el) => {
    const c = el.cloneNode(true)
    c.classList.add('overlay-clone')
    if (ov) ov.appendChild(c)
  })
}

/* 顶部被浮层遮住的高度:题目面板是 absolute 覆盖在画布上的,
   适配视图时要把它扣掉,否则电路会被顶到面板底下。 */
function topInset() {
  const el = svgEl.value
  if (!el) return 0
  const host = el.closest('.body')
  const strip = host && host.querySelector('.problem-strip')
  if (!strip) return 0
  const a = strip.getBoundingClientRect()
  const b = el.getBoundingClientRect()
  return Math.max(0, a.bottom - b.top + 8)
}

/* ---------- 生命周期 ---------- */

onMounted(async () => {
  await nextTick()
  R = createRenderer(svgEl.value)
  R.setModel(props.model)
  R.setSolution(props.solution)
  R.syncStructure()
  R.syncSolution()
  lastSol = props.solution
  empty.value = props.model.edges.size === 0

  if (!fitted) {
    fitted = true
    R.fitView({ topInset: topInset() })
    emitViewport()
  }

  /* iOS 的文字选择/呼出菜单由 touchstart 触发,pointerdown 拦不住 */
  svgEl.value.addEventListener('touchstart', onTouchStart, { passive: false })
  /* Safari 的双指缩放走 gesture* 事件而非 pointer events,
     touch-action 拦不住,必须显式 preventDefault 才不触发页面缩放 */
  svgEl.value.addEventListener('gesturestart', blockGesture, { passive: false })
  svgEl.value.addEventListener('gesturechange', blockGesture, { passive: false })
  svgEl.value.addEventListener('gestureend', blockGesture, { passive: false })
  svgEl.value.addEventListener('pointerdown', onDown)
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onCancel)
  svgEl.value.addEventListener('dblclick', onDblClick)
  svgEl.value.addEventListener('wheel', onWheel, { passive: false })
  svgEl.value.addEventListener('contextmenu', onContextMenu)
  svgEl.value.addEventListener('pointerleave', clearGhost)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)

  bus.on('changed', onModelChanged)
  bus.on('inspect', setInspected)

  hint(HINTS[props.tool] || '')
})

onBeforeUnmount(() => {
  if (svgEl.value) {
    svgEl.value.removeEventListener('touchstart', onTouchStart)
    svgEl.value.removeEventListener('gesturestart', blockGesture)
    svgEl.value.removeEventListener('gesturechange', blockGesture)
    svgEl.value.removeEventListener('gestureend', blockGesture)
    svgEl.value.removeEventListener('pointerdown', onDown)
    svgEl.value.removeEventListener('dblclick', onDblClick)
    svgEl.value.removeEventListener('wheel', onWheel)
    svgEl.value.removeEventListener('contextmenu', onContextMenu)
    svgEl.value.removeEventListener('pointerleave', clearGhost)
  }
  window.removeEventListener('pointermove', onMove)
  window.removeEventListener('pointerup', onUp)
  window.removeEventListener('pointercancel', onCancel)
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  bus.off('changed', onModelChanged)
  bus.off('inspect', setInspected)
  clearLongPress()
  if (R) { R.destroy(); R = null }
})

watch(() => props.solution, (sol) => {
  if (!R) return
  R.setSolution(sol)
  if (sol) { R.syncSolution(); lastSol = sol }
})

watch(() => props.opts, (o) => {
  if (R && o) R.setOpts({ ...o })
}, { deep: true })

watch(() => props.tool, (t) => {
  clearGhost()
  hint(HINTS[t] || '')
  if (svgEl.value) {
    svgEl.value.classList.toggle('tool-select', t === 'select')
    svgEl.value.classList.toggle('tool-eraser', t === 'eraser')
  }
})

watch(() => props.armed, () => clearGhost())

defineExpose({
  fitView() { if (R) { R.fitView(); emitViewport() } },
  zoomAt(x, y, f) { if (R) { R.zoomAt(x, y, f); emitViewport() } },
  panBy(dx, dy) { if (R) { R.panBy(dx, dy); emitViewport() } },
  view() { return R ? { ...R.view() } : null },
  select: selectKey,
  probe(key) { if (R) { const v = R.probe(key); emit('probe', v) } },
  renderer: () => R
})
</script>

<template>
  <div class="ff-canvas">
    <svg ref="svgEl" class="ff-stage" :class="tool === 'select' ? 'tool-select' : (tool === 'eraser' ? 'tool-eraser' : '')"></svg>

    <div v-if="empty" class="ff-empty-hint">
      <div class="hint-title">空白的方格纸</div>
      <div>从左侧选电池,点击网格边放下,再用导线连成回路</div>
      <div class="hint-keys">空格拖拽平移 · 滚轮缩放 · F 适配视图</div>
    </div>

    <div class="ff-statusbar">
      <span class="ff-hint">{{ hintText }}</span>
      <span v-if="solution && solution.status === 'short'" class="ff-badge short">短路</span>
      <span v-else-if="solution && solution.status === 'open'" class="ff-badge open">断路</span>
    </div>
  </div>
</template>

<style scoped>
.ff-hint {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ff-badge {
  flex: none;
  padding: 1px 10px;
  border: 1px solid var(--ink-faint);
  border-radius: var(--radius);
  background: var(--paper);
  letter-spacing: 1px;
}
.ff-badge.open { border-color: var(--amber); color: var(--amber); }
.ff-badge.short { border-color: var(--vermilion); background: var(--vermilion); color: var(--paper); }
</style>
