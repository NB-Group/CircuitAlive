<script setup>
/* EditorView — 电路绘制与查看的主界面
 *
 * 职责:持有 Model 与求解结果,把画布、元件栏、检查器、分析面板组装起来。
 * 具体渲染/交互逻辑在 CircuitCanvas 与 InspectorPopover 中。 */
import { ref, shallowRef, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Model } from '../core/model.js'
import { solver } from '../core/solver.js'
import { T, bus } from '../core/util.js'
import { bellSoundOn, setBellSound } from '../core/bell-toggle.js'
import { PALETTE, symbols } from '../core/symbols.js'
import { decodeCircuit } from '../core/share.js'
import CircuitCanvas from '../components/CircuitCanvas.vue'
import InspectorPopover from '../components/InspectorPopover.vue'
import SaveDialog from '../components/SaveDialog.vue'
import { useLibrary } from '../composables/useLibrary.js'
import { presets } from '../data/presets.js'
import { getProblem } from '../data/problems.js'
import MathText from '../components/MathText.vue'
import MeterDial from '../components/MeterDial.vue'
import RheostatPopover from '../components/RheostatPopover.vue'
import TutorialOverlay from '../components/TutorialOverlay.vue'
import { useOnboarding } from '../composables/useOnboarding.js'

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
/* 电铃声音开关(状态读写都在 bell-toggle 里,localStorage 持久化) */
const bellOn = ref(bellSoundOn())

/* 选中与检查分离:单击只高亮(虚框),长按/右键才浮出检查器。
   检查器打开时由 InspectorPopover 发 bus 'inspect' 给画布,
   画布给元件加 .inspected(抬起+阴影),背景由 scrim 模糊压暗。 */
const inspectedKey = ref(null)

function onEdgeClick(key) { inspectedKey.value = key }

/* 滑变单击弹窗:与完整检查器分开,调节时不被背景模糊挡住 */
const rheoPop = ref(null)
const rheoAnchor = ref({ x: 0, y: 0 })
function onWiperOpen(p) {
  inspectedKey.value = null
  rheoAnchor.value = { x: p.x, y: p.y }
  rheoPop.value = p
}
function closeInspector() { inspectedKey.value = null; selectedKey.value = null }

/* ---------- 新手教程 ----------
   第一次进编辑器自动播放;顶栏「教程」按钮可以随时重看。 */
const tour = useOnboarding()
const tourOpen = ref(false)
const tourSteps = [
  {
    target: '.palette',
    title: '先挑一个元件',
    text: '左边是元件栏:电池、开关、电阻、灯泡、滑变、电表……<br>选一个,再点画布上的一条格边,它就放上去了。'
  },
  {
    target: ['.ff-scene-wrap'],
    title: '电路画在方格纸上',
    text: '元件吸附在网格线上,共点即相连。<br>空格拖拽平移、滚轮缩放,按 F 一键适配视图。'
  },
  {
    target: ['.layers .ff-btn:nth-child(1)', '.layers', '.topbar'],
    title: '看电流怎么流',
    text: '「电流」显示正电荷的流动方向,「电子流向」反向。<br>粒子速度跟电流大小走:电流越大,跑得越快。'
  },
  {
    target: ['.layers .ff-btn:nth-child(3)', '.layers', '.topbar'],
    title: '看电势怎么降',
    text: '「电势」用颜色标出每个点的电势高低,「电势数值」直接写出 φ。<br>导线是等势体,所以整段同色 —— 这正是 U=0 的意思。'
  },
  {
    target: ['.edge-group[data-edge-key="4,0|5,0"]', '.edge-group', '.ff-scene-wrap'],
    title: '长按元件打开检查器',
    text: '单击只是选中;<b>长按</b>任意元件(或导线)会把它抬起、<br>其余画面虚化,旁边浮出检查器:参数、U、I、R、P 和定义式都在里面。'
  },
  {
    target: ['.edge-group[data-edge-key="4,3|5,3"]', '.pal-btn[title="滑变"]', '.palette'],
    title: '滑变单击就能调',
    text: '滑动变阻器还有单独的轻点弹条:直接拖滑片,<br>旁边实时显示接入阻值和支路电流,能看到整个电路跟着变。'
  },
  {
    target: ['.prob-head', '.body', '.topbar'],
    title: '题目页还能对答案',
    text: '从题库打开的电路会带上原题和来源。<br>点「查看解析」展开答案,读完再自己动手调参数验证。'
  },
  {
    target: '.topbar .save-btn',
    title: '存进作品库',
    text: '「保存」把电路存进本机作品库,随时可以回来继续改。<br>也可以从作品库分享链接给别人。'
  }
]
function startTour() {
  tourOpen.value = true
}
function endTour() {
  tourOpen.value = false
  tour.markSeen()
}
const problem = ref(null)
const showAnswer = ref(false)
/* 题目的图分两类:
     kind: 'circuit' — 电路图,画布上可交互,多于一张时给切换条
     kind: 'dial'    — 表盘图,只在题目条里静态渲染
   老数据没有 figures 字段,按单张 circuit 退化。 */
const activeFigure = ref(0)
const problemFigures = computed(() => {
  const p = problem.value
  if (!p) return []
  if (Array.isArray(p.figures) && p.figures.length) {
    return p.figures.map((f) => ({ kind: f.kind || 'circuit', ...f }))
  }
  if (Array.isArray(p.circuits) && p.circuits.length) {
    return p.circuits.map((c) => ({ kind: 'circuit', ...c }))
  }
  if (Array.isArray(p.circuit) && p.circuit.length) {
    return [{ kind: 'circuit', label: '', grid: p.circuit }]
  }
  return []
})
const circuitFigures = computed(() => problemFigures.value.filter((f) => f.kind !== 'dial'))
const dialFigures = computed(() => problemFigures.value.filter((f) => f.kind === 'dial'))

function loadFigure(i) {
  const figs = circuitFigures.value
  if (!figs.length) return
  const k = Math.max(0, Math.min(figs.length - 1, i))
  activeFigure.value = k
  model.value.loadPreset(figs[k].grid)
  resolve()
}

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

function onChanged() {
  resolve()
  canUndo.value = model.value.canUndo()
  canRedo.value = model.value.canRedo()
}

/* 撤销/重做:键盘 Ctrl+Z / Ctrl+Shift+Z 在画布里处理;
   这两个按钮给触屏用(手机上没有键盘) */
const canUndo = ref(false)
const canRedo = ref(false)
function doUndo() {
  if (model.value.undo()) showTip('已撤销')
}
function doRedo() {
  if (model.value.redo()) showTip('已重做')
}

onMounted(() => {
  /* 上次关过铃音的话,这里同步一次;bell-audio 默认开,不压就是响 */
  if (!bellSoundOn()) setBellSound(false)

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
    loadProblem(props.id)
  } else if (!loadedFromLib && route.query.preset) {
    const p = presets.find(x => x.id === route.query.preset)
    if (p) model.value.loadPreset(p.tuples)
  }
  /* 无任何参数 = 空白画布,不再默认载入串联预置 */
  resolve()
  /* 载入题目/预置本身不进 undo 栈,按钮初始应为禁用 */
  canUndo.value = model.value.canUndo()
  canRedo.value = model.value.canRedo()
  bus.on('changed', onChanged)

  /* 第一次进编辑器:等布局稳定后再起教程 */
  if (!tour.seen()) {
    setTimeout(() => { if (!tour.seen()) startTour() }, 700)
  }
})

/* 题库题目:载入题干与第一张电路图。
   必须单独成函数并 watch 路由 id —— 只写在 onMounted 里的话,
   从题目 A 点到题目 B 时组件复用,内容不会更新。 */
/* 换题/换图时把上一张图浮着的检查器和滑条收掉:
   否则它们会挡住新图的指针事件,而且指向的边已经不存在。 */
function resetOverlays() {
  inspectedKey.value = null
  rheoPop.value = null
}

function loadProblem(id) {
  const prob = getProblem(id)
  if (!prob) return
  resetOverlays()
  problem.value = prob
  showAnswer.value = false
  const figs = Array.isArray(prob.figures) && prob.figures.length
    ? prob.figures.filter((f) => (f.kind || 'circuit') !== 'dial')
    : (Array.isArray(prob.circuits) && prob.circuits.length
      ? prob.circuits
      : [{ label: '', grid: prob.circuit }])
  activeFigure.value = 0
  model.value.loadPreset(figs[0] && figs[0].grid ? figs[0].grid : [])
  resolve()
}

watch(() => props.id, (id) => {
  resetOverlays()
  if (id) loadProblem(id)
  else { problem.value = null }
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

/* 电流 / 电子流向是一个三态开关:关闭 · 电流 · 电子流向。
   两个按钮各自独立翻转时,particles 管开关、electrons 管方向,
   点电子流向会把电流一起点亮,再点电流又把电子流向关掉,
   状态组合出四种而用户只想要三种。这里统一成一个状态量。 */
function setFlow(mode) {
  const cur = !opts.value.particles ? 'off' : (opts.value.electrons ? 'electron' : 'current')
  const next = cur === mode ? 'off' : mode
  opts.value = {
    ...opts.value,
    particles: next !== 'off',
    electrons: next === 'electron'
  }
}

function toggleBell() {
  bellOn.value = !bellOn.value
  setBellSound(bellOn.value)
}

const stateText = computed(() => {
  const s = solution.value
  if (!s) return ''
  return { normal: '正常', open: '断路', short: '短路', noSource: '无电源', empty: '空' }[s.status] || ''
})
</script>

<template>
  <div class="editor" :class="{ 'is-inspecting': !!inspectedKey }">
    <header class="topbar">
      <button class="ff-btn ghost" @click="router.push('/')">← 主页</button>
      <h1 class="title">CircuitAlive</h1>
      <nav class="layers">
        <button class="ff-btn ghost" :class="{ on: opts.particles && !opts.electrons }" :aria-pressed="opts.particles && !opts.electrons" @click="setFlow('current')">电流</button>
        <button class="ff-btn ghost" :class="{ on: opts.electrons }" :aria-pressed="opts.electrons" @click="setFlow('electron')">电子流向</button>
        <button class="ff-btn ghost" :class="{ on: opts.potential }" @click="toggle('potential')">电势</button>
        <button class="ff-btn ghost" :class="{ on: opts.phiLabels }" @click="toggle('phiLabels')">电势数值</button>
        <button class="ff-btn ghost" :class="{ on: opts.efield }" @click="toggle('efield')">电场</button>
        <button class="ff-btn ghost" :class="{ on: bellOn }" @click="toggleBell" title="电铃声音">铃音</button>
      </nav>
      <span class="state" :class="solution?.status">{{ stateText }}</span>
      <button class="ff-btn ghost" :disabled="!canUndo" :title="'撤销 (Ctrl+Z)'" :aria-label="'撤销'" @click="doUndo">撤销</button>
      <button class="ff-btn ghost" :disabled="!canRedo" :title="'重做 (Ctrl+Shift+Z)'" :aria-label="'重做'" @click="doRedo">重做</button>
      <router-link to="/library" class="ff-btn ghost">作品库</router-link>
      <button class="ff-btn ghost" @click="startTour" title="新手教程">教程</button>
      <button class="ff-btn save-btn" @click="openSave">保存</button>
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
        <div v-if="circuitFigures.length > 1" class="fig-tabs" role="group" aria-label="电路图切换">
          <span class="fig-tabs-label">电路图</span>
          <button
            v-for="(f, i) in circuitFigures"
            :key="i"
            type="button"
            class="fig-tab"
            :class="{ on: activeFigure === i }"
            :aria-pressed="activeFigure === i"
            @click="loadFigure(i)"
          >{{ f.label || ('图 ' + (i + 1)) }}</button>
        </div>
        <div v-if="dialFigures.length" class="fig-dials">
          <MeterDial
            v-for="(f, i) in dialFigures"
            :key="'d' + i"
            :meter="f.meter"
            :range="f.range"
            :value="f.value"
            :label="f.label"
          />
        </div>
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
        @edge-click="onEdgeClick"
        @wiper-open="onWiperOpen"
        @placed="onPlaced"
        @changed="resolve"
        @escape="setTool('select')"
      />

      <RheostatPopover
        :model="model"
        :solution="solution"
        :edge-key="rheoPop ? rheoPop.key : ''"
        :anchor="rheoAnchor"
        @close="rheoPop = null"
      />

      <InspectorPopover
        :model="model"
        :solution="solution"
        :edge-key="inspectedKey || null"
        @close="closeInspector"
        @changed="resolve"
      />
    </main>

    <TutorialOverlay v-if="tourOpen" :steps="tourSteps" @done="endTour" />

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
  padding: 2px 10px; border: 1px solid var(--hairline); border-radius: var(--radius);
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
  cursor: pointer; border-radius: 0 var(--radius) var(--radius) 0; color: var(--ink);
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
.fig-tabs { display: flex; align-items: center; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
.fig-tabs-label { font-size: 11px; color: var(--ink-faint); letter-spacing: 2px; font-family: var(--serif); }
.fig-tab {
  padding: 3px 10px; border: 1px solid var(--hairline); border-radius: var(--radius);
  background: transparent; color: var(--ink-soft); cursor: pointer;
  font-family: var(--mono); font-size: 11px;
  transition: border-color var(--dur-fast) ease, color var(--dur-fast) ease, background-color var(--dur-fast) ease;
}
.fig-tab:hover { border-color: var(--ink-faint); color: var(--ink); }
.fig-tab.on { border-color: var(--vermilion); color: var(--vermilion); background: rgba(200, 69, 31, 0.06); }
.fig-dials { display: flex; gap: 18px; margin-top: 10px; flex-wrap: wrap; }
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

/* ---- 窄屏(手机) ---------------------------------------------------
   桌面版顶栏是一整行;390px 宽放不下时会把整页撑到 519px,
   移动浏览器因此放大布局视口,检查器按 innerWidth 钳位就会跑出屏幕。
   这里让顶栏换行、图层条自己横向滚动,并压缩元件栏,页面不再横向溢出。 */
@media (max-width: 720px) {
  .topbar {
    flex-wrap: wrap; height: auto; min-height: 50px;
    padding: 5px 8px; gap: 6px;
  }
  .title { font-size: 15px; }
  .topbar .ff-btn { padding: 3px 7px; font-size: 11px; }
  .layers {
    order: 10; width: 100%; gap: 2px;
    overflow-x: auto; overflow-y: hidden;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }
  .layers::-webkit-scrollbar { display: none; }
  .layers .ff-btn { flex: none; }
  .state { margin-left: 0; font-size: 11px; padding: 1px 8px; }

  .palette { width: 64px; }
  .pal-title { letter-spacing: 2px; }
  .pal-btn { width: calc(100% - 8px); margin: 1px 4px; padding: 5px 0; }
  .pal-name { font-size: 10px; }

  .problem-strip {
    left: 72px; right: 8px; top: 8px;
    padding: 8px 10px; max-height: 34vh;
  }
  .prob-head { flex-wrap: wrap; gap: 4px 8px; }
  .prob-title { font-size: 13px; }
  .prob-head .ff-btn { margin-left: auto; }
  .prob-text { font-size: 12.5px; line-height: 1.8; }
  .va-guide { font-size: 12px; }
}

/* 只模糊画布。题目条和元件栏保持清晰 —— 它们是阅读/操作区,
   糊掉反而让人分不清"到底哪里是背景"。 */

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

/* 图层开关是"电路活了"的核心,任何宽度都不藏:
   顶栏放不下时由 <=720px 的换行规则接管 */

</style>
