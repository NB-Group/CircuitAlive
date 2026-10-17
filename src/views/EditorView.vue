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
import SaveDialog from '../components/SaveDialog.vue'
import { useLibrary } from '../composables/useLibrary.js'
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

/* ---------- 作品库 ---------- */
const lib = useLibrary()
const libItemId = ref(null)      /* 当前电路在作品库里的 id;null = 还没保存过 */
const showSave = ref(false)
const saveError = ref('')
const saveTip = ref('')
let saveTipTimer = 0

const libItem = computed(() => (libItemId.value ? lib.get(libItemId.value) : null))
const currentName = computed(() => (libItem.value ? libItem.value.name : ''))

function openSave() {
  if (!lib.isAvailable()) {
    showTip('当前浏览器不允许本地存储,无法保存。')
    return
  }
  if (!model.value.edges.size) {
    showTip('画布是空的,先放几个元件再保存。')
    return
  }
  saveError.value = ''
  showSave.value = true
}

function closeSave() {
  showSave.value = false
  saveError.value = ''
}

function doSave(name) {
  const data = model.value.serialize()
  const res = libItemId.value
    ? lib.update(libItemId.value, { name, data })
    : lib.save({ name, data })
  if (!res.ok) {
    saveError.value = res.message
    return
  }
  libItemId.value = res.item.id
  closeSave()
  showTip('已保存到作品库。')
}

function doSaveAsNew(name) {
  const res = lib.save({ name, data: model.value.serialize() })
  if (!res.ok) {
    saveError.value = res.message
    return
  }
  libItemId.value = res.item.id
  closeSave()
  showTip('已另存为新电路。')
}

function showTip(text) {
  saveTip.value = text
  if (saveTipTimer) clearTimeout(saveTipTimer)
  saveTipTimer = setTimeout(() => { saveTip.value = '' }, 2400)
}

function resolve() {
  const sol = solver.solve(model.value.list(), { wireR: model.value.wireR })
  solution.value = sol
}

function onChanged() { resolve() }

onMounted(() => {
  /* 作品库条目优先,其次分享链接,其次预置,最后空白 */
  const libId = route.query.lib
  let loadedFromLib = false
  if (libId) {
    const item = lib.get(String(libId))
    if (item) {
      libItemId.value = item.id
      try {
        model.value.restore(item.data)
        loadedFromLib = true
      } catch (e) {
        console.warn('作品库电路载入失败', e)
      }
    }
  }

  const s = route.query.s
  if (s) {
    try {
      const data = decodeCircuit(s)
      model.value.restore({ v: 1, wireR: data.wireR, edges: data.edges })
      libItemId.value = null
    } catch (e) {
      console.warn('分享链接解析失败', e)
    }
  } else if (!loadedFromLib && props.id) {
    /* 题库题目:载入题干电路 */
    const prob = getProblem(props.id)
    if (prob) {
      problem.value = prob
      model.value.loadPreset(prob.circuit)
    }
  } else if (!loadedFromLib && route.query.preset) {
    const p = presets.find(x => x.id === route.query.preset)
    if (p) model.value.loadPreset(p.tuples)
  }
  /* 无任何参数 = 空白画布,不再默认载入串联预置 */
  resolve()
  bus.on('changed', onChanged)
})

onBeforeUnmount(() => {
  bus.off('changed', onChanged)
  if (saveTipTimer) clearTimeout(saveTipTimer)
})

/* 元件栏图标:把 symbols 的 SVG 转成 HTML 字符串 */
const SELECT_ICON = '<svg width="56" height="36" viewBox="-30 -22 60 44" aria-hidden="true">' +
  '<path d="M -3 -10 L 9 2 L 2.5 3.2 L 6.5 11 L 3.4 12.4 L -0.6 4.6 L -5.6 9.6 Z" ' +
  'fill="currentColor" opacity="0.85" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/></svg>'

const palette = [{ type: 'select', name: '选择', icon: SELECT_ICON }].concat(PALETTE.map(it => ({
  ...it,
  icon: (() => {
    if (it.type === 'select') return SELECT_ICON
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

/* 只有显式选中才打开检查器;放置元件不打开 */
function onSelect(key) { selectedKey.value = key }
function onPlaced() { selectedKey.value = null }

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
      <router-link to="/library" class="ff-btn ghost">作品库</router-link>
      <button class="ff-btn" @click="openSave">保存</button>
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
          <span class="prob-src">{{ problem.source }}<template v-if="problem.number"> · 第 {{ problem.number }} 题</template></span>
          <button class="ff-btn ghost" @click="showAnswer = !showAnswer">{{ showAnswer ? '收起解析' : '查看解析' }}</button>
        </div>
        <MathText class="prob-text" :text="problem.statement" />
        <div v-if="problem.type === '伏安法'" class="va-guide">
          <div class="va-title">伏安法测电阻 · 实验要点</div>
          <MathText text="用电压表测出电阻两端的电压 $U$,用电流表测出通过它的电流 $I$,由 $R = \\frac{U}{I}$ 求出阻值。" />
          <ul class="va-list">
            <li>电流表<b>串联</b>接入,电压表<b>并联</b>在被测电阻两端。</li>
            <li>滑动变阻器串联在电路中,用来改变待测电阻两端的电压,多次测量取平均。</li>
            <li>连接电路时开关断开,滑动变阻器调到最大阻值。</li>
            <li>电压表与电流表都有内阻,读数会有系统误差;初中阶段按理想表处理。</li>
          </ul>
        </div>
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
        @placed="onPlaced"
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

    <SaveDialog
      v-if="showSave"
      :initial-name="currentName"
      :has-item="!!libItem"
      :error="saveError"
      @close="closeSave"
      @save="doSave"
      @save-as-new="doSaveAsNew"
    />

    <transition name="ff-editor-tip">
      <div v-if="saveTip" class="editor-tip" role="status">{{ saveTip }}</div>
    </transition>
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
.prob-src { font-size: 11px; color: var(--ink-faint); font-family: var(--mono); }
.prob-text { font-size: 13px; line-height: 1.9; }
.va-guide {
  margin-top: 10px; padding: 8px 12px;
  background: var(--paper-inset); border-left: 2px solid var(--vermilion);
  font-size: 12.5px; line-height: 1.9; color: var(--ink-soft);
}
.va-title { font-family: var(--serif); font-weight: 700; color: var(--ink); margin-bottom: 4px; }
.va-list { margin: 4px 0 0 18px; }
.va-list li { margin: 2px 0; }
.prob-answer { margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--hairline); font-size: 13px; line-height: 1.9; }

/* 保存/提示浮条:与作品库的 toast 同款,固定在画布下方 */
.editor-tip {
  position: fixed; left: 50%; bottom: 30px; z-index: 80;
  transform: translateX(-50%);
  padding: 7px 16px;
  border: 1px solid var(--hairline); border-radius: 999px;
  background: var(--paper-panel); box-shadow: var(--shadow-float);
  color: var(--ink); font-size: 12.5px; pointer-events: none;
}
.ff-editor-tip-enter-active { transition: opacity var(--dur-mid) var(--ease-out), transform var(--dur-mid) var(--ease-spring); }
.ff-editor-tip-leave-active { transition: opacity var(--dur-fast) ease, transform var(--dur-fast) ease; }
.ff-editor-tip-enter-from, .ff-editor-tip-leave-to { opacity: 0; transform: translateX(-50%) translateY(8px); }

@media (max-width: 900px) {
  .layers { display: none; }
}
</style>
