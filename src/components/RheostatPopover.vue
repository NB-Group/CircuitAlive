<script setup>
/* RheostatPopover — 滑动变阻器的单击滑条
 *
 * 单击滑变符号弹出(长按仍是完整检查器)。目的是调节时能直接看到
 * 电路状态变化:滑条旁边实时显示接入阻值、支路电流和两端电压。
 * 拖动走 undo 快照,松手提交一次,不污染撤销栈。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { bus, fmt } from '../core/util.js'

const props = defineProps({
  model: { type: Object, required: true },
  solution: { type: Object, default: null },
  edgeKey: { type: String, required: true },
  anchor: { type: Object, default: () => ({ x: 0, y: 0 }) }
})
const emit = defineEmits(['close'])

const rootEl = ref(null)
const pos = ref({ left: 0, top: 0 })
let snap = null

/* model 用普通 Map(shallowRef 包着),Vue 追踪不到内部变更。
   滑条位置自己拿一个 ref,由 bus 的 changed 事件(含撤销)同步;
   拖动时先改本地值再写模型,读数不会跳回上一帧。 */
const wiper = ref(1)
const rmax = ref(0)
/* undo/restore 会重建边对象,computed 得跟着 bus 重查,否则拖条
   还写在一个已经不在图里的旧对象上。 */
const tick = ref(0)
const edge = computed(() => {
  void tick.value
  return props.model.edges.get(props.edgeKey) || null
})

function syncFromModel() {
  const e = props.model.edges.get(props.edgeKey)
  if (!e) return false
  wiper.value = e.props.wiper == null ? 1 : e.props.wiper
  rmax.value = Number(e.props.Rmax) || 0
  return true
}

const rNow = computed(() => Math.max(0.01, wiper.value * rmax.value))

const current = computed(() => {
  const s = props.solution
  if (!s || !edge.value) return null
  const I = s.edgeI.get(edge.value.id)
  return I == null ? null : Math.abs(I)
})

const voltage = computed(() => {
  const s = props.solution
  if (!s || !edge.value) return null
  const a = s.nodePhi.get(edge.value.a.join(','))
  const b = s.nodePhi.get(edge.value.b.join(','))
  if (a == null || b == null) return null
  return Math.abs(b - a)
})

function label() {
  return (edge.value && edge.value.props.label) || '滑动变阻器'
}

function place() {
  const el = rootEl.value
  if (!el) return
  const w = el.offsetWidth || 260
  const h = el.offsetHeight || 150
  const pad = 10
  let left = props.anchor.x + 14
  let top = props.anchor.y - h / 2
  if (left + w > window.innerWidth - pad) left = props.anchor.x - w - 14
  left = Math.max(pad, Math.min(left, window.innerWidth - w - pad))
  top = Math.max(pad, Math.min(top, window.innerHeight - h - pad))
  pos.value = { left, top }
}

function onDown() {
  snap = props.model.serializeStr()
}

function onInput(ev) {
  if (!edge.value) return
  /* 键盘方向键改滑条时没有 pointerdown,补一份快照 */
  if (!snap) snap = props.model.serializeStr()
  const w = parseFloat(ev.target.value)
  wiper.value = w
  props.model.rawSetProps(props.edgeKey, { wiper: w })
}

function onCommit() {
  if (snap) {
    props.model.commit(snap)
    snap = null
  }
}

function toMax() {
  snap = props.model.serializeStr()
  props.model.rawSetProps(props.edgeKey, { wiper: 1 })
  props.model.commit(snap)
  snap = null
}
function toMin() {
  snap = props.model.serializeStr()
  props.model.rawSetProps(props.edgeKey, { wiper: 0 })
  props.model.commit(snap)
  snap = null
}

function onKey(ev) {
  if (ev.key === 'Escape') { ev.stopPropagation(); emit('close') }
}
function onDownOutside(ev) {
  if (rootEl.value && !rootEl.value.contains(ev.target)) emit('close')
}

let offBus = null
onMounted(() => {
  syncFromModel()
  place()
  window.addEventListener('keydown', onKey, true)
  window.addEventListener('pointerdown', onDownOutside, true)
  offBus = bus.on('changed', () => {
    tick.value++
    /* 撤销/删除把滑变拿掉了,弹窗没有对象可调 */
    if (!props.model.edges.has(props.edgeKey)) { emit('close'); return }
    syncFromModel()
  })
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey, true)
  window.removeEventListener('pointerdown', onDownOutside, true)
  if (offBus) bus.off('changed', offBus)
})
</script>

<template>
  <Teleport to="body">
    <div ref="rootEl" class="ff-rheo" :style="{ left: pos.left + 'px', top: pos.top + 'px' }" role="dialog" :aria-label="label() + ' 滑片'">
      <div class="ff-rheo-head">
        <span class="ff-rheo-title">{{ label() }}</span>
        <button class="ff-rheo-close" type="button" aria-label="关闭" @click="emit('close')">×</button>
      </div>

      <div class="ff-rheo-value ff-num">{{ fmt(rNow, 'Ω') }}</div>

      <input
        class="ff-rheo-range"
        type="range" min="0" max="1" step="0.01" :value="wiper"
        aria-label="滑片位置"
        @pointerdown="onDown"
        @input="onInput"
        @change="onCommit"
      />

      <div class="ff-rheo-reads ff-num">
        <span>I {{ current == null ? '—' : fmt(current, 'A') }}</span>
        <span>U {{ voltage == null ? '—' : fmt(voltage, 'V') }}</span>
      </div>

      <div class="ff-rheo-actions">
        <button type="button" class="ff-btn ghost" @click="toMin">调到最小</button>
        <button type="button" class="ff-btn ghost" @click="toMax">调到最大</button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ff-rheo {
  position: fixed;
  z-index: 60;
  width: 236px;
  padding: 10px 12px 9px;
  background: var(--paper-panel);
  border: 1px solid var(--hairline);
  border-radius: 3px;
  box-shadow: 0 8px 24px rgba(44, 40, 34, 0.16);
  animation: ff-rheo-in 160ms var(--ease-out);
}
@keyframes ff-rheo-in {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: none; }
}
.ff-rheo-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.ff-rheo-title { font-family: var(--serif); font-size: 13px; font-weight: 700; color: var(--ink); }
.ff-rheo-close {
  margin-left: auto; border: none; background: transparent; cursor: pointer;
  color: var(--ink-faint); font-size: 16px; line-height: 1; padding: 0 2px;
}
.ff-rheo-close:hover { color: var(--ink); }
.ff-rheo-value {
  font-size: 20px; color: var(--vermilion); letter-spacing: 0.5px; margin: 2px 0 6px;
}
.ff-rheo-range { width: 100%; accent-color: var(--vermilion); }
.ff-rheo-reads {
  display: flex; gap: 14px; margin-top: 6px;
  font-size: 11px; color: var(--ink-soft);
}
.ff-rheo-actions { display: flex; gap: 6px; margin-top: 8px; }
.ff-rheo-actions .ff-btn { flex: 1; padding: 3px 6px; font-size: 11px; }
</style>
