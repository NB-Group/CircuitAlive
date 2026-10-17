<script setup>
/* EditorView — 电路绘制与查看的主界面
 *
 * 职责:持有 Model 与求解结果,把画布、元件栏、检查器、分析面板组装起来。
 * 具体渲染/交互逻辑在 CircuitCanvas 与 InspectorPopover 中。 */
import { ref, shallowRef, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Model } from '../core/model.js'
import { solver } from '../core/solver.js'
import { T, bus } from '../core/util.js'
import { decodeCircuit } from '../core/share.js'
import CircuitCanvas from '../components/CircuitCanvas.vue'
import InspectorPopover from '../components/InspectorPopover.vue'
import { presets } from '../data/presets.js'

const props = defineProps({ theme: String, id: String })
const emit = defineEmits(['toggle-theme'])
const route = useRoute()
const router = useRouter()

const model = shallowRef(new Model())
const solution = shallowRef(null)
const selectedKey = ref(null)
const tool = ref('select')
const armed = ref(null)
const opts = ref({
  particles: true,
  electrons: false,
  potential: false,
  phiLabels: false,
  efield: false
})

/* 当前检查的元件:长按/右键/选中后浮出检查器 */
const inspectedKey = computed(() => selectedKey.value)

function resolve() {
  const sol = solver.solve(model.value.list(), { wireR: model.value.wireR })
  solution.value = sol
}

function onChanged() { resolve() }

onMounted(() => {
  /* 分享链接优先,其次预置,最后空白 */
  const s = route.query.s
  if (s) {
    try {
      const data = decodeCircuit(s)
      model.value.restore({ v: 1, wireR: data.wireR, edges: data.edges })
    } catch (e) {
      console.warn('分享链接解析失败', e)
    }
  } else if (route.query.preset) {
    const p = presets.find(x => x.id === route.query.preset)
    if (p) model.value.loadPreset(p.tuples)
  } else if (!model.value.edges.size) {
    model.value.loadPreset(presets[0].tuples)
  }
  resolve()
  bus.on('changed', onChanged)
})

onBeforeUnmount(() => {
  bus.off('changed', onChanged)
})

function setTool(t, p) {
  tool.value = t
  armed.value = p ? { type: t, props: p } : null
}

function onSelect(key) { selectedKey.value = key }

function toggle(layer) {
  opts.value = { ...opts.value, [layer]: !opts.value[layer] }
}

const stateText = computed(() => {
  const s = solution.value
  if (!s) return ''
  return { normal: '正常', open: '断路', short: '短路', noSource: '无电源', empty: '空' }[s.status] || ''
})
</script>

<template>
  <div class="editor">
    <header class="topbar">
      <button class="ff-btn ghost" @click="router.push('/')">← 主页</button>
      <h1 class="title">FieldFlow</h1>
      <nav class="layers">
        <button class="ff-btn ghost" :class="{ on: opts.particles && !opts.electrons }" @click="toggle('particles')">电流</button>
        <button class="ff-btn ghost" :class="{ on: opts.electrons }" @click="toggle('electrons')">电子流向</button>
        <button class="ff-btn ghost" :class="{ on: opts.potential }" @click="toggle('potential')">电势</button>
        <button class="ff-btn ghost" :class="{ on: opts.phiLabels }" @click="toggle('phiLabels')">电势数值</button>
        <button class="ff-btn ghost" :class="{ on: opts.efield }" @click="toggle('efield')">电场</button>
      </nav>
      <span class="state" :class="solution?.status">{{ stateText }}</span>
      <button class="ff-btn ghost" @click="emit('toggle-theme')">{{ theme === 'dark' ? '浅色' : '深色' }}</button>
    </header>

    <main class="body">
      <aside class="palette">
        <!-- 元件栏由 CircuitCanvas 暴露的 symbols 驱动;此处占位,由子组件填充 -->
        <slot name="palette" />
      </aside>

      <CircuitCanvas
        :model="model"
        :solution="solution"
        :opts="opts"
        :tool="tool"
        :armed="armed"
        @select="onSelect"
        @changed="resolve"
      />

      <InspectorPopover
        v-if="inspectedKey"
        :model="model"
        :solution="solution"
        :edge-key="inspectedKey"
        @close="selectedKey = null"
        @changed="resolve"
      />
    </main>
  </div>
</template>

<style scoped>
.editor { display: flex; flex-direction: column; height: 100%; background: var(--paper); }

.topbar {
  display: flex; align-items: center; gap: 14px;
  height: 54px; padding: 0 14px; flex: none;
  background: var(--paper-panel);
  border-bottom: 1px solid var(--hairline);
}
.title { font-family: var(--serif); font-size: 18px; font-weight: 900; }
.layers { display: flex; gap: 2px; }
.layers .on { color: var(--vermilion); background: var(--vermilion-soft); }
.state {
  margin-left: auto; font-family: var(--mono); font-size: 12px;
  padding: 2px 10px; border: 1px solid var(--hairline); border-radius: 10px;
}
.state.short { border-color: var(--vermilion); color: var(--vermilion); }
.state.open { border-color: var(--amber); color: var(--amber); }

.body { flex: 1; display: flex; min-height: 0; position: relative; }
.palette { width: 96px; flex: none; background: var(--paper-panel); border-right: 1px solid var(--hairline); }
</style>
