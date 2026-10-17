<script setup>
/* CircuitThumbnail — 用编辑器同一套渲染器画出电路缩略图
 *
 * 做法:
 *   1. 用 Model.restore 还原存储的电路数据;
 *   2. createRenderer(svg) 建立与画布相同的图层结构,只做 syncStructure,
 *      不传 solution,所以没有粒子/转子/灯泡动画,缩略图是静止的;
 *   3. 渲染器内部的 defs id 是固定的(lamp-core、ff-grid…),一页上多张
 *      缩略图会互相撞 id。这里给每个实例的 defs 加后缀并同步改写 url(#…);
 *   4. 网格自己重画(按 40 单位的格距),保证元件落在格线上;
 *   5. 按模型包围盒直接算 viewBox,把整张电路装进 16:10 的框。
 *
 * 闭着的开关在静态结构里仍是断开的杠杆,这里直接把杠杆摆到闭合位置。
 */
import { ref, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { Model } from '../core/model.js'
import { createRenderer } from '../core/render.js'
import { T, GRID, svgEl } from '../core/util.js'

const props = defineProps({
  data: { type: Object, required: true }
})

const svgRef = ref(null)

let R = null
let uidSeq = 0

/* 给 defs 里的 id 加上实例后缀,并改写本 svg 内所有 url(#…) 引用 */
function isolateDefs(svg, uid) {
  const map = new Map()
  svg.querySelectorAll('[id]').forEach((el) => {
    const old = el.getAttribute('id')
    if (!old) return
    const next = old + '-' + uid
    map.set(old, next)
    el.setAttribute('id', next)
  })
  if (!map.size) return

  svg.querySelectorAll('*').forEach((el) => {
    const attrs = el.attributes
    for (let i = 0; i < attrs.length; i++) {
      const a = attrs[i]
      if (!a || a.value.indexOf('url(#') < 0) continue
      let v = a.value
      map.forEach((to, from) => {
        v = v.split('url(#' + from + ')').join('url(#' + to + ')')
      })
      if (v !== a.value) el.setAttribute(a.name, v)
    }
  })
}

/* 重画网格:渲染器初始化时 pattern 会被第二次 buildDefs 清掉,
 * 而且格距必须和世界坐标一致,元件才会落在格线上。 */
function drawGrid(svg, uid) {
  const layer = svg.querySelector('[data-layer="grid"]')
  const defs = svg.querySelector('defs.ff-defs')
  if (!layer || !defs) return
  layer.innerHTML = ''

  const size = GRID
  const major = size * 5
  const id = 'ff-thumb-grid-' + uid
  const pat = svgEl('pattern', {
    id, width: major, height: major, patternUnits: 'userSpaceOnUse'
  }, defs)

  let d = ''
  for (let i = 0; i < 5; i++) {
    d += 'M' + (i * size) + ' 0V' + major + 'M0 ' + (i * size) + 'H' + major
  }
  svgEl('path', { d, fill: 'none', class: 'ff-grid-minor', 'stroke-width': 1 }, pat)
  svgEl('path', {
    d: 'M0 0V' + major + 'M0 0H' + major,
    fill: 'none', class: 'ff-grid-major', 'stroke-width': 1.2
  }, pat)

  svgEl('rect', {
    x: -8000, y: -8000, width: 16000, height: 16000,
    fill: 'url(#' + id + ')', 'pointer-events': 'none'
  }, layer)
}

/* 按模型包围盒直接算 viewBox。不依赖 getBoundingClientRect:
 * 挂载瞬间元素往往还没布局,fitView 会退回默认视图,卡片里就只剩
 * 角落里一小块电路。缩略图框固定 16:10,这里用同一比例算,
 * 之后 ResizeObserver 触发的 applyView 只会按同样的比例重算高度。 */
const THUMB_ASPECT = 16 / 10

function fitToModel(model) {
  if (!R) return
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  model.edges.forEach((e) => {
    x0 = Math.min(x0, e.a[0], e.b[0]); x1 = Math.max(x1, e.a[0], e.b[0])
    y0 = Math.min(y0, e.a[1], e.b[1]); y1 = Math.max(y1, e.a[1], e.b[1])
  })
  if (!isFinite(x0)) return

  const pad = 1.3
  const wWorld = (x1 - x0 + pad * 2) * GRID
  const hWorld = (y1 - y0 + pad * 2) * GRID
  const viewW = Math.max(200, wWorld, hWorld * THUMB_ASPECT)
  const viewH = viewW / THUMB_ASPECT
  const cx = ((x0 + x1) / 2) * GRID
  const cy = ((y0 + y1) / 2) * GRID

  R.setView(cx - viewW / 2, cy - viewH / 2, viewW)
  /* setView 只写宽度;高度按 16:10 直接落到属性上,布局未完成也正确 */
  svgRef.value.setAttribute('viewBox',
    (cx - viewW / 2) + ' ' + (cy - viewH / 2) + ' ' + viewW + ' ' + viewH)
}

/* 静态结构不经过 syncSolution,闭合的开关要手动摆到闭合位置;
 * 仪表读数占位「—」在缩略图里没有意义,直接去掉。 */
function settle(model, svg) {
  model.edges.forEach((e) => {
    if (e.type !== T.SWITCH || !(e.props && e.props.closed)) return
    const g = svg.querySelector('.edge-group[data-edge-id="' + e.id + '"]')
    const lever = g && g.querySelector('[data-hook="lever"]')
    if (!lever) return
    lever.setAttribute('x2', 7)
    lever.setAttribute('y2', 0)
  })
  svg.querySelectorAll('.reading-text').forEach((n) => n.remove())
}

function teardown() {
  if (R) { R.destroy(); R = null }
}

function build() {
  const svg = svgRef.value
  if (!svg) return
  teardown()
  svg.innerHTML = ''

  const model = new Model()
  try {
    model.restore(props.data)
  } catch (err) {
    return
  }
  if (!model.edges.size) return

  const uid = 't' + (++uidSeq)

  /* 一条边构建失败(例如某个符号构建器抛错)不该让整张缩略图空掉:
   * 逐条加入模型再同步,失败的那条剔除,其余照画。 */
  try {
    R = createRenderer(svg)
    R.setOpts({ particles: false, electrons: false, potential: false, phiLabels: false, efield: false })
  } catch (err) {
    return
  }
  const partial = new Model()
  R.setModel(partial)
  model.list().forEach((e) => {
    partial.edges.set(e.key, e)
    try {
      R.syncStructure()
    } catch (err) {
      partial.edges.delete(e.key)
    }
  })
  if (!partial.edges.size) return

  isolateDefs(svg, uid)
  drawGrid(svg, uid)
  settle(model, svg)

  fitToModel(model)
  svg.dataset.fit = svg.getAttribute('viewBox')
}

onMounted(() => {
  nextTick(build)
})

onBeforeUnmount(teardown)

watch(() => props.data, () => {
  nextTick(build)
})
</script>

<template>
  <svg ref="svgRef" class="ff-thumb-svg" aria-hidden="true" focusable="false"></svg>
</template>
