<script setup>
/* InspectorPopover — 浮动元件检查器
 *
 * 打开时机由父层决定(长按 / 右键 / 选择工具点击);本组件负责:
 *   - 页面其余部分压暗 + 模糊(scrim,backdrop-filter: blur(6px))
 *   - 面板浮在元件旁边(左右自动择边,纵向钳制在视口内)
 *   - 元件定义式(DEFS)、可编辑参数、实时 U/I/R/P
 *   - Esc / 点 scrim / 滚动 关闭;--ease-spring 入场
 *
 * 事件:close · changed(参数已改,父层应重算 solution)
 */
import { computed, onMounted, onBeforeUnmount, ref, watch, nextTick } from 'vue'
import { T, TYPE_NAME, LIMITS, GRID, clamp, fmt, nodeKey, bus } from '../core/util.js'
import { solver } from '../core/solver.js'
import { render } from '../core/render.js'

const props = defineProps({
  model: { type: Object, required: true },
  solution: { type: Object, default: null },
  edgeKey: { type: String, default: null }
})

const emit = defineEmits(['close', 'changed'])

const G = GRID
const rootEl = ref(null)
const pos = ref({ left: 0, top: 0, origin: '50% 50%' })

/* ---------- 严格定义式(自 js/panel.js 移植,补电动机 / 电铃) ---------- */
const DEFS = {
  [T.BATTERY]: '<b>电动势 E</b>:电源内非静电力把单位正电荷从负极移到正极所做的功(单位 V)。闭合电路欧姆定律 <b>U = E − I·r</b>:内阻 r 默认 0.1 Ω(真实干电池量级,可在下方修改)。短路时电流只受 r 限制,电动势几乎全降在电源内部,端电压≈0、导线几乎等势。',
  [T.WIRE]: '所有导线<b>统一为一根理想导线(等势体)</b>:U = 0,内部 E = 0,整段合并为同一节点。要演示真实导线的压降,在下方统一调电阻;若只想要某一段有电阻,那应该用<b>电阻元件</b>表达。',
  [T.RESISTOR]: '电阻定义式 <b>R = U/I</b>:这个比值由导体本身(材料、长度、横截面积)决定 —— U/I 只是<b>量度</b>它,不是电压"产生"了电阻。',
  [T.LAMP]: '灯泡亮度由<b>实际功率 P = U·I</b> 决定,不是由电流或电压单独决定。',
  [T.RHEOSTAT]: '靠改变接入电路的电阻丝<b>长度</b>来改变电阻:接入越长,R 越大(与横截面积、材料共同决定 R)。',
  [T.AMMETER]: '电流定义 <b>I = q/t</b>:单位时间内通过导体横截面的<b>电荷量</b>。电流表内阻≈0,必须<b>串联</b>在被测电路中,相当于一段导线。',
  [T.VOLTMETER]: '电压即<b>电势差 U = φ₊ − φ₋</b>。电压表内阻≈∞,<b>并联</b>不改变电路;读数就是两接线柱的电势之差。',
  [T.SWITCH]: '闭合 = 电阻 0(通路);断开 = 电阻 ∞(断路,该支路电流为 0,但两端可以有电压)。',
  [T.MOTOR]: '电动机把<b>电能</b>转化为机械能:通电线圈在磁场中受力转动。转速随端电压升高而增大,电流反向则转向相反。',
  [T.BELL]: '电铃靠<b>电磁铁</b>断续吸放衔铁,使铃锤反复敲击铃碗发声。通以交流或断续电流才会持续发声。'
}

const STATE_SHORT = { normal: '正常', open: '断路', short: '短路', noSource: '无电源', empty: '空' }

/* ---------- 元件 / 编号 ---------- */
const SUB = '₀₁₂₃₄₅₆₇₈₉'
function sub(n) {
  if (n <= 0) return ''
  let s = ''
  while (n > 0) { s = SUB[n % 10] + s; n = Math.floor(n / 10) }
  return s || '₁'
}

const labels = computed(() => {
  const counters = {}, map = new Map()
  props.model.list().slice().sort((a, b) => a.id - b.id).forEach((e) => {
    const base = {
      battery: 'E', resistor: 'R', lamp: 'L', rheostat: 'R′',
      switch: 'S', ammeter: 'A', voltmeter: 'V', motor: 'M', bell: 'B'
    }[e.type]
    if (!base) return
    counters[e.type] = (counters[e.type] || 0) + 1
    map.set(e.id, base + sub(counters[e.type]))
  })
  return map
})

const isWires = computed(() => props.edgeKey === '__wires__')

const edge = computed(() => {
  void props.model.version   /* 依赖模型版本:撤销/删除/改参数后重算 */
  if (!props.edgeKey || isWires.value) return null
  return props.model.edges.get(props.edgeKey) || null
})

const title = computed(() => {
  if (isWires.value) return '导线(全部统一)'
  const e = edge.value
  if (!e) return ''
  return TYPE_NAME[e.type] + (labels.value.get(e.id) ? ' ' + labels.value.get(e.id) : '')
})

const defText = computed(() => {
  if (isWires.value) return DEFS[T.WIRE]
  const e = edge.value
  return e ? (DEFS[e.type] || '') : ''
})

/* ---------- 计算值 ---------- */
const sol = computed(() => props.solution)

const I = computed(() => {
  const e = edge.value
  if (!e || !sol.value) return null
  const v = sol.value.edgeI.get(e.id)
  return v == null ? null : v
})

const U = computed(() => {
  const e = edge.value
  if (!e || !sol.value) return null
  /* 电压表:读数定义为 φ(+接线柱) − φ(−接线柱),b 端为 + 接线柱。
     其余元件沿用 solver.edgeU(φa − φb,沿 a→b 的压降)。 */
  if (e.type === T.VOLTMETER) {
    const pa = sol.value.nodePhi.get(nodeKey(e.a))
    const pb = sol.value.nodePhi.get(nodeKey(e.b))
    return (pa == null || pb == null) ? null : pb - pa
  }
  return solver.edgeU(e, sol.value)
})

const R = computed(() => {
  const e = edge.value
  if (!e) return null
  /* 依赖 solution:模型属性是原地修改的普通对象,不读一次 prop
     这个 computed 不会在参数变更后重新求值 */
  void props.solution
  if (e.type === T.AMMETER) return solver.R_AM
  const r = solver.rOf(e, props.model.wireR)
  return isFinite(r) ? r : null
})

const P = computed(() => {
  if (I.value == null || U.value == null) return null
  return Math.abs(U.value * I.value)
})

const wireStats = computed(() => {
  let count = 0, maxU = 0
  props.model.edges.forEach((e) => {
    if (e.type !== T.WIRE) return
    count++
    if (sol.value) {
      const u = solver.edgeU(e, sol.value)
      if (u != null && Math.abs(u) > maxU) maxU = Math.abs(u)
    }
  })
  return { count, maxU }
})

/* ---------- 参数编辑 ---------- */

function setProp(patch) {
  if (!edge.value) return
  props.model.setProps(props.edgeKey, patch)
  emit('changed')
}

function numInput(label, unit, value, min, max, step, apply, read) {
  return { label, unit, value, min, max, step, apply, read }
}

const params = computed(() => {
  const e = edge.value
  if (!e) return []
  const P0 = e.props || {}
  const out = []
  if (e.type === T.BATTERY) {
    out.push(numInput('电动势 E', 'V', P0.V || 3, 0.1, 24, 0.1, (v) => {
      setProp({ V: clamp(v || 1.5, LIMITS.V[0], LIMITS.V[1]) })
    }, () => (edge.value.props.V || 3)))
    out.push(numInput('内阻 r', 'Ω', P0.r == null ? 0.1 : P0.r, 0.01, 50, 0.01, (v) => {
      setProp({ r: clamp(v || 0.1, 0.01, 50) })
    }, () => (edge.value.props.r == null ? 0.1 : edge.value.props.r)))
  }
  if (e.type === T.RESISTOR || e.type === T.LAMP) {
    out.push(numInput('电阻 R', 'Ω', P0.R || 10, 0.1, 9999, 0.5, (v) => {
      setProp({ R: clamp(v || 10, LIMITS.R[0], LIMITS.R[1]) })
    }, () => (edge.value.props.R || 10)))
  }
  if (e.type === T.RHEOSTAT) {
    out.push(numInput('最大阻值', 'Ω', P0.Rmax || 50, 1, 999, 1, (v) => {
      setProp({ Rmax: clamp(v || 50, LIMITS.Rmax[0], LIMITS.Rmax[1]) })
    }, () => (edge.value.props.Rmax || 50)))
  }
  return out
})

function onNumChange(p, ev) {
  p.apply(parseFloat(ev.target.value))
  /* 钳制后的值回写到输入框 */
  ev.target.value = p.read()
}

/* 滑片:拖动实时变阻,整个手势一次 undo */
let sliderSnap = null
const wiperValue = computed(() => {
  void props.solution
  const e = edge.value
  return e ? (e.props.wiper == null ? 1 : e.props.wiper) : 0
})
const wiperR = computed(() => {
  void props.solution
  const e = edge.value
  return e ? solver.rOf(e, props.model.wireR) : 0
})
function onWiperDown() {
  sliderSnap = props.model.serializeStr()
}
function onWiperInput(ev) {
  if (!edge.value) return
  edge.value.props.wiper = clamp(parseFloat(ev.target.value), 0, 1)
  bus.emit('changed')
  emit('changed')
}
function onWiperCommit() {
  if (sliderSnap) {
    props.model.commit(sliderSnap)
    sliderSnap = null
  }
}

function onWireR(ev) {
  const v = parseFloat(ev.target.value)
  props.model.setWireR(isFinite(v) ? v : 0)
  emit('changed')
}

function toggleSwitch() {
  if (!edge.value) return
  props.model.toggleSwitch(props.edgeKey)
  emit('changed')
}

function flip() {
  if (!edge.value) return
  props.model.flip(props.edgeKey)
  emit('changed')
}

function remove() {
  if (!edge.value) return
  props.model.remove(props.edgeKey)
  emit('changed')
  emit('close')
}

/* ---------- 定位 ---------- */
function place() {
  const el = rootEl.value
  if (!el) return
  const W = el.offsetWidth || 340
  const H = el.offsetHeight || 360
  const vw = window.innerWidth, vh = window.innerHeight
  const gap = 18

  let ax = vw / 2, ay = vh / 2
  const e = edge.value
  const inst = render.current
  if (e && inst) {
    const svg = document.querySelector('.ff-canvas svg.ff-stage')
    if (svg) {
      const r = svg.getBoundingClientRect()
      const view = inst.view()
      const wx = (e.a[0] + e.b[0]) / 2 * G
      const wy = (e.a[1] + e.b[1]) / 2 * G
      ax = r.left + (wx - view.x) / view.w * r.width
      ay = r.top + (wy - view.y) / view.h * r.height
    }
  }

  /* 右侧放不下就放左侧;两侧都挤时贴边 */
  let left = ax + gap
  let originX = '0%'
  if (left + W > vw - 12) {
    left = ax - gap - W
    originX = '100%'
  }
  left = clamp(left, 12, Math.max(12, vw - W - 12))

  let top = ay - H / 2
  top = clamp(top, 12, Math.max(12, vh - H - 12))

  pos.value = { left, top, origin: originX + ' 50%' }
}

/* ---------- 关闭 ---------- */

function close() { emit('close') }

function onKey(ev) {
  if (ev.key === 'Escape') {
    ev.stopPropagation()
    close()
  }
}

function onWheelAny(ev) {
  /* 面板自身滚动不关闭 */
  if (rootEl.value && ev.target instanceof Node && rootEl.value.contains(ev.target)) return
  close()
}
function onScrollAny(ev) {
  if (rootEl.value && ev.target instanceof Node && rootEl.value.contains(ev.target)) return
  close()
}

/* ---------- 生命周期 ---------- */

onMounted(async () => {
  await nextTick()
  place()
  bus.emit('inspect', props.edgeKey)
  window.addEventListener('keydown', onKey, true)
  window.addEventListener('wheel', onWheelAny, { passive: true })
  window.addEventListener('scroll', onScrollAny, true)
  window.addEventListener('resize', place)
})

onBeforeUnmount(() => {
  bus.emit('inspect', null)
  window.removeEventListener('keydown', onKey, true)
  window.removeEventListener('wheel', onWheelAny)
  window.removeEventListener('scroll', onScrollAny, true)
  window.removeEventListener('resize', place)
})

watch(() => props.edgeKey, async () => {
  await nextTick()
  place()
  bus.emit('inspect', props.edgeKey)
})

watch(() => props.solution, async () => {
  await nextTick()
  place()
})
</script>

<template>
  <Teleport to="body">
    <div class="ff-insp-scrim" @pointerdown.self="close" @click.self="close"></div>
    <aside
      ref="rootEl"
      class="ff-inspector"
      role="dialog"
      aria-modal="true"
      :aria-label="title || '元件检查器'"
      :style="{ left: pos.left + 'px', top: pos.top + 'px', '--insp-origin': pos.origin }"
      @pointerdown.stop
      @wheel.stop
    >
      <div class="ff-insp-kicker">元件检查器</div>

      <div class="ff-insp-name">{{ title }}</div>

      <div v-if="defText" class="ff-insp-def" v-html="defText"></div>

      <!-- 导线:全局统一 -->
      <template v-if="isWires">
        <div class="ff-insp-row">
          <label>电阻 r (0=理想)</label>
          <input
            type="number" :value="model.wireR" min="0" max="50" step="0.001"
            @change="onWireR"
          />
          <span class="ff-insp-unit">Ω</span>
        </div>
        <div class="ff-insp-vals">
          <div class="kv"><span>段数</span><b>{{ wireStats.count }}</b></div>
          <div class="kv"><span>每段 r</span><b>{{ model.wireR === 0 ? '理想' : fmt(model.wireR, 'Ω') }}</b></div>
          <div class="kv"><span>最大单段压降</span><b>{{ wireStats.count ? fmt(wireStats.maxU, 'V') : '—' }}</b></div>
          <div class="kv"><span>状态</span><b>{{ model.wireR === 0 ? '等势体' : '电阻性' }}</b></div>
        </div>
      </template>

      <template v-else-if="edge">
        <!-- 数值参数 -->
        <div v-for="p in params" :key="p.label" class="ff-insp-row">
          <label>{{ p.label }}</label>
          <input
            type="number" :value="p.value" :min="p.min" :max="p.max" :step="p.step"
            @change="onNumChange(p, $event)"
          />
          <span class="ff-insp-unit">{{ p.unit }}</span>
        </div>

        <!-- 滑变:滑片 -->
        <div v-if="edge.type === T.RHEOSTAT" class="ff-insp-row">
          <label>滑片位置</label>
          <input
            type="range" min="0" max="1" step="0.01" :value="wiperValue"
            @pointerdown="onWiperDown"
            @input="onWiperInput"
            @change="onWiperCommit"
          />
          <span class="ff-insp-unit">{{ fmt(wiperR, 'Ω') }}</span>
        </div>

        <!-- 开关 -->
        <div v-if="edge.type === T.SWITCH" class="ff-insp-row">
          <label>状态</label>
          <button class="ff-btn" type="button" @click="toggleSwitch">
            {{ edge.props.closed ? '断开开关' : '闭合开关' }}
          </button>
          <span class="ff-insp-unit">{{ edge.props.closed ? '闭合' : '断开' }}</span>
        </div>

        <!-- 计算值 -->
        <div class="ff-insp-vals">
          <template v-if="edge.type === T.BATTERY">
            <div class="kv"><span>端电压 U</span><b>{{ U == null ? '—' : fmt(U, 'V') }}</b></div>
            <div class="kv"><span>电动势 E</span><b>{{ fmt(solver.emfOf(edge), 'V') }}</b></div>
            <div class="kv"><span>内阻 r</span><b>{{ fmt(solver.rOf(edge, model.wireR), 'Ω') }}</b></div>
            <div class="kv"><span>电流 I</span><b>{{ I == null ? '—' : fmt(I, 'A') }}</b></div>
            <div class="kv"><span>输出功率</span><b>{{ P == null ? '—' : fmt(P, 'W') }}</b></div>
          </template>

          <template v-else-if="edge.type === T.VOLTMETER">
            <div class="kv"><span>φ(+接线柱)</span><b>{{ sol ? fmt(sol.nodePhi.get(nodeKey(edge.b)), 'V') : '—' }}</b></div>
            <div class="kv"><span>φ(−接线柱)</span><b>{{ sol ? fmt(sol.nodePhi.get(nodeKey(edge.a)), 'V') : '—' }}</b></div>
            <div class="kv"><span>读数 U</span><b>{{ U == null ? '—' : fmt(U, 'V') }}</b></div>
          </template>

          <template v-else-if="edge.type === T.AMMETER">
            <div class="kv"><span>电流 I</span><b>{{ I == null ? '—' : fmt(I, 'A') }}</b></div>
            <div class="kv"><span>内阻</span><b>{{ fmt(solver.R_AM, 'Ω') }}</b></div>
          </template>

          <template v-else-if="edge.type === T.SWITCH">
            <div class="kv"><span>电流 I</span><b>{{ I == null ? '—' : fmt(I || 0, 'A') }}</b></div>
            <div class="kv"><span>两端 U</span><b>{{ U == null ? '—' : fmt(U, 'V') }}</b></div>
          </template>

          <template v-else-if="edge.type === T.MOTOR || edge.type === T.BELL">
            <div class="kv"><span>电压 U</span><b>{{ U == null ? '—' : fmt(U, 'V') }}</b></div>
            <div class="kv"><span>电流 I</span><b>{{ I == null ? '—' : fmt(I, 'A') }}</b></div>
            <div class="kv"><span>功率 P</span><b>{{ P == null ? '—' : fmt(P, 'W') }}</b></div>
          </template>

          <template v-else>
            <div class="kv"><span>电压 U</span><b>{{ U == null ? '—' : fmt(U, 'V') }}</b></div>
            <div class="kv"><span>电流 I</span><b>{{ I == null ? '—' : fmt(I, 'A') }}</b></div>
            <div class="kv"><span>电阻 R</span><b>{{ R == null ? '—' : fmt(R, 'Ω') }}</b></div>
            <div class="kv"><span>功率 P</span><b>{{ P == null ? '—' : fmt(P, 'W') }}</b></div>
          </template>
        </div>

        <div v-if="sol" class="ff-insp-state">
          电路:{{ STATE_SHORT[sol.status] || '—' }}
        </div>

        <div class="ff-insp-actions">
          <button type="button" @click="flip">翻转两端 (R)</button>
          <button type="button" class="danger" @click="remove">删除 (Del)</button>
        </div>
      </template>

      <div v-else class="ff-insp-empty">元件已不存在</div>
    </aside>
  </Teleport>
</template>

<style scoped>
.ff-insp-state {
  margin-top: 8px;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--ink-faint);
}

.ff-insp-empty {
  font-size: 12px;
  color: var(--ink-faint);
  padding: 4px 0;
}
</style>
