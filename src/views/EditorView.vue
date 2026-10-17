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
import { PALETTE, symbols } from '../core/symbols.js'
import { decodeCircuit } from '../core/share.js'
import CircuitCanvas from '../components/CircuitCanvas.vue'
import InspectorPopover from '../components/InspectorPopover.vue'
import { presets } from '../data/presets.js'
import { getProblem } from '../data/problems.js'
import MathText from '../components/MathText.vue'

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
const problem = ref(null)
const showAnswer = ref(false)

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
  } else if (props.id) {
    /* 题库题目:载入题干电路 */
    const prob = getProblem(props.id)
    if (prob) {
      problem.value = prob
      model.value.loadPreset(prob.circuit)
    }
  } else if (route.query.preset) {
    const p = presets.find(x => x.id === route.query.preset)
    if (p) model.value.loadPreset(p.tuples)
  }
  /* 无任何参数 = 空白画布,不再默认载入串联预置 */
  resolve()
  bus.on('changed', onChanged)
})

onBeforeUnmount(() => {
  bus.off('changed', onChanged)
})

/* 元件栏图标:把 symbols 的 SVG 转成 HTML 字符串 */
const palette = [{ type: 'select', name: '选择', icon: '' }].concat(PALETTE.map(it => ({
  ...it,
  icon: (() => {
    if (it.type === 'select') return '<svg width="56" height="36" viewBox="-30 -22 60 44"><path d="M -4 -9 L 8 3 L 1 4 L 5 11 L 2 12 L -2 5 L -7 10 Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>'
    const svg = symbols.paletteIcon(it.type, it.props)
    return svg.outerHTML
  })()
})))

function pick(item) {
  if (item.type === 'select') { setTool('select'); return }
  if (item.type === 'eraser') { setTool('eraser'); return }
  setTool(item.type, item.type === 'switch' ? { closed: false } : JSON.parse(JSON.stringify(item.props || {})))
}

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
        <div class="pal-title">元件</div>
        <button
          v-for="item in palette"
          :key="item.type"
          class="pal-btn"
          :class="{ active: tool === item.type || (tool === 'wire' && item.type === 'wire') }"
          :title="item.name"
          @click="pick(item)"
        >
          <span class="pal-icon" v-html="item.icon"></span>
          <span class="pal-name">{{ item.name }}</span>
        </button>
      </aside>

      <aside v-if="problem" class="problem-strip">
        <div class="prob-head">
          <span class="ff-h">题目</span>
          <span class="prob-title">{{ problem.title }}</span>
          <button class="ff-btn ghost" @click="showAnswer = !showAnswer">{{ showAnswer ? '收起解析' : '查看解析' }}</button>
        </div>
        <MathText class="prob-text" :text="problem.statement" />
        <div v-if="showAnswer" class="prob-answer">
          <MathText :text="problem.answer" />
          <MathText :text="problem.solution" />
        </div>
      </aside>

      <CircuitCanvas
        :model="model"
        :solution="solution"
        :opts="opts"
        :tool="tool"
        :armed="armed"
        @select="onSelect"
        @changed="resolve"
        @escape="setTool('select')"
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
.palette { width: 96px; flex: none; background: var(--paper-panel); border-right: 1px solid var(--hairline); overflow-y: auto; padding: 8px 0; }
.pal-title { font-family: var(--serif); font-size: 11px; letter-spacing: 4px; color: var(--ink-faint); text-align: center; padding: 2px 0 6px; }
.pal-btn {
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  width: calc(100% - 16px); margin: 1px 8px; padding: 6px 2px 7px;
  border: none; border-left: 2px solid transparent; background: transparent;
  cursor: pointer; border-radius: 0 2px 2px 0; color: var(--ink);
  transition: background-color var(--dur-fast) ease, border-color var(--dur-fast) ease;
}
.pal-btn:hover { background: rgba(44, 40, 34, 0.05); }
.pal-btn.active { border-left-color: var(--vermilion); background: var(--vermilion-soft); }
.pal-icon { display: block; width: 56px; height: 36px; }
.pal-icon :deep(svg) { display: block; width: 100%; height: 100%; }
.pal-name { font-size: 11px; color: var(--ink-soft); }
.pal-btn.active .pal-name { color: var(--ink); }

.problem-strip {
  position: absolute; left: 108px; right: 12px; top: 10px; z-index: 5;
  padding: 10px 14px; background: var(--paper-panel);
  border: 1px solid var(--hairline); border-radius: var(--radius);
  box-shadow: var(--shadow-soft); max-height: 38vh; overflow-y: auto;
}
.prob-head { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
.prob-title { font-family: var(--serif); font-weight: 700; font-size: 14px; }
.prob-head .ff-btn { margin-left: auto; }
.prob-text { font-size: 13px; line-height: 1.9; }
.prob-answer { margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--hairline); font-size: 13px; line-height: 1.9; }
</style>
