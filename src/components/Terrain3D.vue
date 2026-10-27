<script setup>
/* Terrain3D — 电势地形 3D 附加预览
 *
 * 高度 = 当前载流子的电势能:
 *   电流视角 高=φ(红球=等效正电荷,顺坡下滚)
 *   电子视角 高=−φ(地形翻转,蓝球同样下坡)
 * 两种视角里电池永远是爬升(化学力电梯)、电阻永远是下坡,
 * 导线 = 等势平地。俯视 X/Y 就是电路网格。
 *
 * 懒加载:本组件经 defineAsyncComponent 按需引入,three.js 不进主包。
 * 自制轨道控制(拖转/滚轮/双指/双击复位),不依赖 examples 模块。
 */
import { onMounted, onBeforeUnmount, ref, watch, computed } from 'vue'
import * as THREE from 'three'
import { buildTerrain, ballDirFor } from '../core/terrain.js'
import { phiColorAt, fmt, GRID } from '../core/util.js'

const props = defineProps({
  model: { type: Object, required: true },
  solution: { type: Object, default: null },
  opts: { type: Object, required: true }
})
const emit = defineEmits(['close'])

const rootEl = ref(null)
const empty = ref(false)

const electronView = computed(() => !!(props.opts && props.opts.electrons))
const heightLabel = computed(() => electronView.value ? '−φ(电子势能坡)' : 'φ(电流视角)')

/* ---------- 颜色(CSS 变量,组件按需挂载,读一次) ---------- */
function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}
const C = {}

/* ---------- three 资源 ---------- */
let renderer = null, scene = null, camera = null
let terrainGroup = null, ballsGroup = null, labelGroup = null, axisGroup = null
let gridHelper = null
let raf = 0, lastT = 0, destroyed = false
let ro = null

let T = null                        /* buildTerrain 结果 + metaScale */
let flip = 1, flipTarget = 1        /* 高度符号,向 target 缓动 */
const flipables = []                /* { geo, base: Float32Array(phi), y: 位置数组引用 } */
const ballState = []                /* { mesh, rows, t, speed, dirBase } */
const batteryArrows = []            /* { grp, rows } */
let ballSphere = null, ballMats = null
let buildDisposables = []           /* 每次重建的短命资源;卸载时连同长命资源一起 dispose */

function track(d) { buildDisposables.push(d); return d }

/* ---------- 轨道相机 ---------- */
const orbit = { az: -0.72, pol: 0.98, dist: 420, tx: 0, tz: 0, min: 140, max: 1400 }
const AZ0 = -0.72, POL0 = 0.98

function applyCamera() {
  const sp = Math.sin(orbit.pol), cp = Math.cos(orbit.pol)
  camera.position.set(
    orbit.tx + orbit.dist * sp * Math.sin(orbit.az),
    orbit.dist * cp,
    orbit.tz + orbit.dist * sp * Math.cos(orbit.az)
  )
  camera.lookAt(orbit.tx, 0, orbit.tz)
}

function fitCamera() {
  if (!T || !T.caps.length) { orbit.dist = 420; orbit.tx = 0; orbit.tz = 0; applyCamera(); return }
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
  T.caps.forEach((c) => {
    x0 = Math.min(x0, c.x); x1 = Math.max(x1, c.x)
    z0 = Math.min(z0, c.y); z1 = Math.max(z1, c.y)
  })
  orbit.tx = (x0 + x1) / 2
  orbit.tz = (z0 + z1) / 2
  orbit.dist = Math.min(orbit.max, Math.max(orbit.min, Math.max(x1 - x0, z1 - z0) * 2.0 + 120))
  applyCamera()
}

/* ---------- 文字精灵 ---------- */
function makeTextSprite(text, color) {
  const pad = 10, fontPx = 42
  const cv = document.createElement('canvas')
  let g = cv.getContext('2d')
  g.font = '600 ' + fontPx + 'px ui-monospace, "SF Mono", monospace'
  cv.width = Math.ceil(g.measureText(text).width) + pad * 2
  cv.height = fontPx + pad * 2
  g = cv.getContext('2d')
  g.font = '600 ' + fontPx + 'px ui-monospace, "SF Mono", monospace'
  g.textBaseline = 'middle'
  g.strokeStyle = C.paper
  g.lineWidth = 7
  g.strokeText(text, pad, cv.height / 2)
  g.fillStyle = color
  g.fillText(text, pad, cv.height / 2)
  const tex = track(new THREE.CanvasTexture(cv))
  tex.colorSpace = THREE.SRGBColorSpace
  const mat = track(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }))
  const sp = new THREE.Sprite(mat)
  const k = 0.13
  sp.scale.set(cv.width * k, cv.height * k, 1)
  sp.renderOrder = 20
  return sp
}

/* ---------- 路面几何 ---------- */

/* 带顶点色的 ribbon:返回 { geo, base } */
function makeRibbon(r) {
  const n = r.rows.length
  const pos = new Float32Array(n * 2 * 3)
  const col = new Float32Array(n * 2 * 3)
  const base = new Float32Array(n * 2)
  const c = new THREE.Color()
  for (let i = 0; i < n; i++) {
    const row = r.rows[i]
    const prev = r.rows[Math.max(0, i - 1)]
    const dx = row.x - prev.x, dy = row.y - prev.y
    const L = Math.hypot(dx, dy) || 1
    const nx = -dy / L * r.w, ny = dx / L * r.w
    c.set(phiColorAt(row.phi, T.metaScale))
    for (let s = 0; s < 2; s++) {
      const k = (i * 2 + s) * 3
      pos[k] = row.x + (s === 0 ? nx : -nx)
      pos[k + 1] = 0
      pos[k + 2] = row.y + (s === 0 ? ny : -ny)
      base[i * 2 + s] = row.phi
      col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b
    }
  }
  const idx = []
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
  }
  const geo = track(new THREE.BufferGeometry())
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  return { geo, base, pos }
}

/* 纸风线框:两条纵边 + 每行横线(不用 wireframe:true,避免三角斜线) */
function makeRibbonWire(r, rb) {
  const n = r.rows.length
  const pts = []
  const idxSeq = []
  for (let i = 0; i < n; i++) {
    const a = i * 2, b = i * 2 + 1
    idxSeq.push(a, b)
    if (i < n - 1) idxSeq.push(a, a + 2, b, b + 2)
  }
  idxSeq.forEach((vi) => {
    pts.push(rb.pos[vi * 3], rb.pos[vi * 3 + 1], rb.pos[vi * 3 + 2])
  })
  const base = new Float32Array(idxSeq.length)
  for (let k = 0; k < idxSeq.length; k++) {
    base[k] = r.rows[Math.floor(idxSeq[k] / 2)].phi
  }
  const geo = track(new THREE.BufferGeometry())
  const arr = new Float32Array(pts)
  geo.setAttribute('position', new THREE.BufferAttribute(arr, 3))
  return { geo, base, pos: arr }
}

/* 结点盖板(菱形,顶点色) */
function makeCap(cap, size) {
  const pos = new Float32Array(4 * 3)
  const col = new Float32Array(4 * 3)
  const c = new THREE.Color()
  c.set(phiColorAt(cap.phi, T.metaScale))
  const pts = [[cap.x + size, cap.y], [cap.x, cap.y + size], [cap.x - size, cap.y], [cap.x, cap.y - size]]
  for (let i = 0; i < 4; i++) {
    pos[i * 3] = pts[i][0]
    pos[i * 3 + 1] = 0
    pos[i * 3 + 2] = pts[i][1]
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b
  }
  const geo = track(new THREE.BufferGeometry())
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
  geo.setIndex([0, 1, 2, 0, 2, 3])
  geo.computeVertexNormals()
  return { geo, base: new Float32Array([cap.phi, cap.phi, cap.phi, cap.phi]), pos }
}

/* 电池电梯箭头:低端 → 高端(当前翻转坐标系),随 flip 更新 */
function makeBatteryArrow(r) {
  const grp = new THREE.Group()
  const shaftGeo = track(new THREE.CylinderGeometry(0.9, 0.9, 1, 8))
  shaftGeo.translate(0, 0.5, 0)
  const headGeo = track(new THREE.ConeGeometry(2.4, 6, 10))
  headGeo.translate(0, 3, 0)
  const mat = track(new THREE.MeshLambertMaterial({ color: new THREE.Color(C.vermilion) }))
  const shaft = new THREE.Mesh(shaftGeo, mat)
  const head = new THREE.Mesh(headGeo, mat)
  grp.add(shaft, head)
  grp.userData.rows = r.rows
  terrainGroup.add(grp)
  batteryArrows.push(grp)
}

function updateBatteryArrows() {
  batteryArrows.forEach((grp) => {
    const rows = grp.userData.rows
    const a = rows[0], b = rows[rows.length - 1]
    const h = T.hScale * flip
    const p0 = new THREE.Vector3(a.x, a.phi * h, a.y)
    const p1 = new THREE.Vector3(b.x, b.phi * h, b.y)
    const dir = p1.clone().sub(p0)
    const len = dir.length()
    if (len < 4) { grp.visible = false; return }
    grp.visible = true
    dir.normalize()
    grp.position.copy(p0.clone().add(dir.clone().multiplyScalar(len * 0.14)).add(new THREE.Vector3(0, 4, 0)))
    grp.scale.set(1, len * 0.55, 1)
    grp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)
  })
}

/* ---------- 重建 ---------- */

function clearBuild() {
  flipables.length = 0
  batteryArrows.length = 0
  ballState.length = 0
  for (const g of [terrainGroup, ballsGroup, labelGroup, axisGroup]) {
    if (g) g.clear()
  }
  buildDisposables.forEach((d) => { if (d && d.dispose) d.dispose() })
  buildDisposables = []
}

function rebuild() {
  if (destroyed || !scene) return
  clearBuild()
  T = buildTerrain(props.model, props.solution)
  if (!T.ribbons.length) { empty.value = true; return }
  empty.value = false
  T.metaScale = Math.max(Math.abs(T.meta.phiMax), Math.abs(T.meta.phiMin), 0.05)
  T.hScale = T.meta.hScale

  const matTerrain = track(new THREE.MeshLambertMaterial({ vertexColors: true }))
  const matWire = track(new THREE.LineBasicMaterial({
    color: new THREE.Color(C.ink), transparent: true, opacity: 0.38
  }))

  T.ribbons.forEach((r) => {
    const rb = makeRibbon(r)
    const wr = makeRibbonWire(r, rb)
    flipables.push({ geo: rb.geo, base: rb.base, pos: rb.pos })
    flipables.push({ geo: wr.geo, base: wr.base, pos: wr.pos })
    terrainGroup.add(new THREE.Mesh(rb.geo, matTerrain))
    terrainGroup.add(new THREE.LineSegments(wr.geo, matWire))
    if (r.kind === 'battery') makeBatteryArrow(r)
  })

  T.caps.forEach((cap) => {
    const cp = makeCap(cap, 9.9)
    flipables.push({ geo: cp.geo, base: cp.base, pos: cp.pos })
    terrainGroup.add(new THREE.Mesh(cp.geo, matTerrain))
  })

  /* 电池标签 */
  T.ribbons.filter(r => r.kind === 'battery').forEach((r) => {
    const mid = r.rows[Math.floor(r.rows.length / 2)]
    const sp = makeTextSprite('化学力 · 电梯', C.vermilion)
    sp.userData.follow = { x: mid.x, z: mid.y, phi: mid.phi }
    labelGroup.add(sp)
  })
  /* φ 数值标注(跟随「电势数值」开关) */
  if (props.opts && props.opts.phiLabels) {
    T.labels.forEach((l) => {
      const sp = makeTextSprite(fmt(l.phi, 'V', 2), C.inkSoft)
      sp.userData.follow = { x: l.x, z: l.y, phi: l.phi, isLabel: true }
      labelGroup.add(sp)
    })
  }

  /* 载流子球(几何与材质跨重建复用,卸载时手动 dispose) */
  if (!ballSphere) {
    ballSphere = new THREE.SphereGeometry(2.3, 12, 10)
    ballMats = {
      current: new THREE.MeshLambertMaterial({ color: new THREE.Color(C.vermilion) }),
      electron: new THREE.MeshLambertMaterial({ color: new THREE.Color(C.indigo) })
    }
  }
  const ribbonByKey = new Map(T.ribbons.map(r => [r.key, r]))
  T.balls.forEach((b) => {
    const r = ribbonByKey.get(b.key)
    if (!r) return
    for (let i = 0; i < b.count; i++) {
      const mesh = new THREE.Mesh(ballSphere, ballMats.current)
      ballsGroup.add(mesh)
      ballState.push({
        mesh, rows: r.rows,
        t: (i + ((r.id * 0.618) % 1 + 0.99 * i / b.count) % 1) % 1,
        speed: b.speed, dirBase: b.dir
      })
    }
  })

  /* φ 轴指示:包围盒角落一根竖线 + 顶端量程 */
  let x0 = Infinity, z1 = -Infinity
  T.caps.forEach((c) => { x0 = Math.min(x0, c.x); z1 = Math.max(z1, c.y) })
  const axH = T.hScale * Math.max(Math.abs(T.meta.phiMax), Math.abs(T.meta.phiMin))
  const axGeo = track(new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, axH, 0)
  ]))
  const axMat = track(new THREE.LineBasicMaterial({ color: new THREE.Color(C.inkFaint) }))
  const axLine = new THREE.Line(axGeo, axMat)
  axLine.position.set(x0 - 46, 0, z1 + 24)
  axisGroup.add(axLine)
  flipables.push({ geo: axGeo, base: new Float32Array([0, Math.max(Math.abs(T.meta.phiMax), Math.abs(T.meta.phiMin))]), pos: axGeo.attributes.position.array, scalar: true })
  const top = makeTextSprite('φ ' + fmt(Math.max(Math.abs(T.meta.phiMax), Math.abs(T.meta.phiMin)), 'V', 2), C.inkFaint)
  top.position.set(x0 - 46, axH + 6, z1 + 24)
  top.userData.followAxisPhi = Math.max(Math.abs(T.meta.phiMax), Math.abs(T.meta.phiMin))
  axisGroup.add(top)
  const zero = makeTextSprite('0 V', C.inkFaint)
  zero.position.set(x0 - 46, 5, z1 + 24)
  axisGroup.add(zero)

  applyFlip()
  updateBatteryArrows()
  fitCamera()
}

/* ---------- 高度翻转 ---------- */
function applyFlip() {
  if (!T) return
  const h = T.hScale * flip
  flipables.forEach((f) => {
    for (let i = 0; i < f.base.length; i++) {
      f.pos[i * 3 + 1] = f.base[i] * h
    }
    f.geo.attributes.position.needsUpdate = true
    if (!f.scalar) f.geo.computeVertexNormals()
  })
  updateLabels()
}

function updateLabels() {
  if (!T) return
  const h = T.hScale * flip
  labelGroup.children.forEach((sp) => {
    const f = sp.userData.follow
    if (f) sp.position.set(f.x, f.phi * h + (f.isLabel ? 5 : 9), f.z)
  })
  axisGroup.children.forEach((ch) => {
    if (ch.userData.followAxisPhi != null) {
      ch.position.y = Math.abs(T.hScale * flip * ch.userData.followAxisPhi) + 6
    }
  })
}

/* ---------- 球步进 ---------- */
function rowAt(rows, t) {
  const n = rows.length - 1
  const x = t * n
  const i = Math.min(n - 1, Math.floor(x))
  const f = x - i
  const a = rows[i], b = rows[i + 1]
  return {
    x: a.x + (b.x - a.x) * f,
    y: a.y + (b.y - a.y) * f,
    phi: a.phi + (b.phi - a.phi) * f
  }
}

function stepBalls(dt) {
  if (!T || !ballState.length) return
  const h = T.hScale * flip
  const mat = electronView.value ? ballMats.electron : ballMats.current
  ballState.forEach((b) => {
    const d = ballDirFor(b.dirBase, electronView.value)
    b.t += b.speed * dt / GRID * d
    if (b.t >= 1) b.t -= 1
    else if (b.t < 0) b.t += 1
    const p = rowAt(b.rows, b.t)
    b.mesh.position.set(p.x, p.phi * h + 2.6, p.y)
    if (b.mesh.material !== mat) b.mesh.material = mat
  })
}

/* ---------- 主循环 ---------- */
function tick(now) {
  if (destroyed) return
  const dt = Math.min(0.05, (now - lastT) / 1000 || 0.016)
  lastT = now
  if (Math.abs(flip - flipTarget) > 1e-3) {
    flip += (flipTarget - flip) * Math.min(1, dt * 6)
    applyFlip()
    updateBatteryArrows()
  }
  stepBalls(dt)
  renderer.render(scene, camera)
  raf = requestAnimationFrame(tick)
}

/* ---------- 轨道交互 ---------- */
const ptrs = new Map()
let pinchD0 = 0, pinchDist0 = 0

function onCanvasDown(ev) {
  ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY })
  if (ptrs.size === 2) {
    const [a, b] = Array.from(ptrs.values())
    pinchD0 = Math.hypot(a.x - b.x, a.y - b.y)
    pinchDist0 = orbit.dist
  }
  try { ev.currentTarget.setPointerCapture(ev.pointerId) } catch (err) { /* 已释放 */ }
}
function onCanvasMove(ev) {
  const p = ptrs.get(ev.pointerId)
  if (!p) return
  const dx = ev.clientX - p.x, dy = ev.clientY - p.y
  p.x = ev.clientX; p.y = ev.clientY
  if (ptrs.size === 1) {
    orbit.az -= dx * 0.008
    orbit.pol = Math.min(1.45, Math.max(0.22, orbit.pol - dy * 0.006))
    applyCamera()
  } else if (ptrs.size === 2 && pinchD0 > 0) {
    const [a, b] = Array.from(ptrs.values())
    const d = Math.hypot(a.x - b.x, a.y - b.y)
    orbit.dist = Math.min(orbit.max, Math.max(orbit.min, pinchDist0 * pinchD0 / Math.max(20, d)))
    applyCamera()
  }
}
function onCanvasUp(ev) {
  ptrs.delete(ev.pointerId)
  if (ptrs.size < 2) pinchD0 = 0
}
function onWheel(ev) {
  ev.preventDefault()
  orbit.dist = Math.min(orbit.max, Math.max(orbit.min, orbit.dist * (1 + Math.sign(ev.deltaY) * 0.12)))
  applyCamera()
}
function onDblClick() {
  orbit.az = AZ0; orbit.pol = POL0
  fitCamera()
}

/* ---------- 生命周期 ---------- */

onMounted(() => {
  C.paper = cssVar('--paper', '#f7f2e5')
  C.ink = cssVar('--ink', '#2c2822')
  C.inkSoft = cssVar('--ink-soft', '#6f6557')
  C.inkFaint = cssVar('--ink-faint', '#a89d8c')
  C.vermilion = cssVar('--vermilion', '#c8451f')
  C.indigo = cssVar('--indigo', '#2f62a8')
  C.hairline = cssVar('--hairline', '#d9cfb6')
  C.gridMinor = cssVar('--grid-minor', '#dfe7ec')

  const el = rootEl.value
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true })
  } catch (err) {
    empty.value = true
    return
  }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
  renderer.setClearColor(new THREE.Color(C.paper))
  renderer.domElement.className = 'ff-3d-cv'
  el.appendChild(renderer.domElement)
  renderer.domElement.addEventListener('pointerdown', onCanvasDown)
  renderer.domElement.addEventListener('pointermove', onCanvasMove)
  renderer.domElement.addEventListener('pointerup', onCanvasUp)
  renderer.domElement.addEventListener('pointercancel', onCanvasUp)
  renderer.domElement.addEventListener('wheel', onWheel, { passive: false })
  renderer.domElement.addEventListener('dblclick', onDblClick)

  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(32, 1, 1, 6000)
  const hemi = new THREE.HemisphereLight(0xffffff, new THREE.Color(C.paper).multiplyScalar(0.7), 1.05)
  const dir = new THREE.DirectionalLight(0xffffff, 0.55)
  dir.position.set(120, 300, 160)
  scene.add(hemi, dir)

  gridHelper = new THREE.GridHelper(2400, 60, new THREE.Color(C.hairline), new THREE.Color(C.gridMinor))
  gridHelper.material.transparent = true
  gridHelper.material.opacity = 0.45
  gridHelper.position.y = -0.5
  scene.add(gridHelper)

  terrainGroup = new THREE.Group()
  ballsGroup = new THREE.Group()
  labelGroup = new THREE.Group()
  axisGroup = new THREE.Group()
  scene.add(terrainGroup, ballsGroup, labelGroup, axisGroup)

  const resize = () => {
    const w = el.clientWidth || 300, h = el.clientHeight || 200
    renderer.setSize(w, h)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  ro = new ResizeObserver(resize)
  ro.observe(el)
  resize()

  rebuild()
  lastT = performance.now()
  raf = requestAnimationFrame(tick)
})

onBeforeUnmount(() => {
  destroyed = true
  if (raf) cancelAnimationFrame(raf)
  if (ro) ro.disconnect()
  clearBuild()
  if (ballSphere) { ballSphere.dispose(); ballSphere = null; ballMats = null }
  if (gridHelper) {
    gridHelper.geometry.dispose()
    gridHelper.material.dispose()
    gridHelper = null
  }
  if (renderer) {
    const cv = renderer.domElement
    cv.removeEventListener('pointerdown', onCanvasDown)
    cv.removeEventListener('pointermove', onCanvasMove)
    cv.removeEventListener('pointerup', onCanvasUp)
    cv.removeEventListener('pointercancel', onCanvasUp)
    cv.removeEventListener('wheel', onWheel)
    cv.removeEventListener('dblclick', onDblClick)
    renderer.dispose()
    if (cv.parentElement) cv.remove()
    renderer = null
  }
})

/* 解变了 → 整体重建(短命资源在 clearBuild 里 dispose,不泄漏) */
watch(() => props.solution, () => rebuild())
/* 电子/电流切换 → 地形翻转 + 球变色变向(方向在 stepBalls 里逐帧取) */
watch(electronView, (v) => { flipTarget = v ? -1 : 1 })
/* φ 标注开关 → 重建标签 */
watch(() => !!(props.opts && props.opts.phiLabels), () => rebuild())
</script>

<template>
  <div ref="rootEl" class="ff-3d" role="img" aria-label="电势地形 3D 预览">
    <div v-if="empty" class="ff-3d-empty">画一个含电池的电路,再回来<br>就能看到电势地形了</div>
    <div class="ff-3d-chip">
      <div class="ff-3d-title">电势地形 · 附加预览 <button type="button" class="ff-3d-x" aria-label="关闭 3D" @click="emit('close')">×</button></div>
      <div class="ff-3d-line">高度 = {{ heightLabel }}</div>
      <div class="ff-3d-line">{{ electronView ? '蓝球 = 电子,顺坡下滚' : '红球 = 电流(等效正电荷),顺坡下滚' }} · 球速为示意</div>
      <div class="ff-3d-line dim">导线 = 等势平地 · 电阻 = 斜坡 · 电池 = 化学力电梯(红箭头)</div>
      <div class="ff-3d-line dim">拖动旋转 · 滚轮/双指缩放 · 双击复位</div>
    </div>
  </div>
</template>

<style scoped>
.ff-3d {
  position: absolute;
  inset: 0;
  z-index: 7;
  background: var(--paper);
}
.ff-3d-cv { display: block; width: 100%; height: 100%; touch-action: none; }
.ff-3d-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  font-family: var(--serif);
  font-size: 15px;
  line-height: 2;
  color: var(--ink-soft);
  pointer-events: none;
}
.ff-3d-chip {
  position: absolute;
  top: 10px;
  left: 10px;
  max-width: min(330px, calc(100% - 24px));
  padding: 8px 11px 7px;
  background: var(--paper-panel);
  border: 1px solid var(--hairline);
  border-radius: var(--radius);
  box-shadow: 0 2px 10px rgba(44, 40, 34, 0.15);
  font-size: 11px;
  line-height: 1.65;
  color: var(--ink-soft);
  pointer-events: none;
}
.ff-3d-title {
  font-family: var(--serif);
  font-size: 12.5px;
  font-weight: 700;
  color: var(--ink);
  margin-bottom: 3px;
}
.ff-3d-line { display: block; }
.ff-3d-line.dim { color: var(--ink-faint); }
.ff-3d-x {
  pointer-events: auto;
  float: right;
  border: none;
  background: transparent;
  color: var(--ink-faint);
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
  padding: 0 3px;
}
.ff-3d-x:hover { color: var(--ink); }
@media (max-width: 700px) {
  .ff-3d-chip { font-size: 10px; padding: 6px 9px; }
}
</style>
