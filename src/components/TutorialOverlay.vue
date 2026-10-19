<script setup>
/* TutorialOverlay — 新手教程(聚光灯式引导)
 *
 * 每一步给一个 CSS 选择器,组件取它的 getBoundingClientRect,
 * 用超大 box-shadow 的镂空块把目标从暗背景里挖出来。
 *
 * 覆盖层 pointer-events:none —— 教程期间用户可以真的点按被高亮的东西。
 * 需要"做一步再继续"的步骤写 waitFor,组件轮询到目标出现就自动前进。
 *
 * 目标还可能是"工具栏第 N 个按钮"这种没有稳定类名的地方,
 * 用 target 数组依次尝试。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch, nextTick } from 'vue'

const props = defineProps({
  steps: { type: Array, required: true }
})
const emit = defineEmits(['done'])

const idx = ref(0)
const rect = ref(null)
const cardEl = ref(null)
const cardPos = ref({ left: 0, top: 0 })
const ready = ref(false)

const step = computed(() => props.steps[idx.value] || null)
const isLast = computed(() => idx.value >= props.steps.length - 1)

let poll = 0
let raf = 0

function pickTarget(s) {
  const list = Array.isArray(s.target) ? s.target : [s.target]
  for (const sel of list) {
    if (!sel) continue
    const el = document.querySelector(sel)
    if (el) {
      const r = el.getBoundingClientRect()
      if (r.width > 1 || r.height > 1) return el
    }
  }
  return null
}

function measure() {
  const s = step.value
  if (!s) return
  const el = pickTarget(s)
  if (!el) { rect.value = null; return }
  const r = el.getBoundingClientRect()
  const pad = s.pad == null ? 6 : s.pad
  rect.value = {
    left: r.left - pad,
    top: r.top - pad,
    width: r.width + pad * 2,
    height: r.height + pad * 2
  }
  ready.value = true
  positionCard()
}

function positionCard() {
  const r = rect.value
  const cw = cardEl.value ? cardEl.value.offsetWidth : 330
  const ch = cardEl.value ? cardEl.value.offsetHeight : 190
  const gap = 14
  const vw = window.innerWidth, vh = window.innerHeight
  const clampX = (x) => Math.max(12, Math.min(x, vw - cw - 12))

  if (!r) {
    cardPos.value = { left: Math.max(12, (vw - cw) / 2), top: Math.max(12, vh / 2 - ch / 2) }
    return
  }

  const cx = r.left + r.width / 2
  /* 依次尝试:下方、上方、右侧、左侧。第一个能完整放进视口的就赢。
     目标是整列/整行(元件栏、顶栏)时,下方和上方永远放不下,
     会自然落到右/左侧,不会再被挤到屏幕外。 */
  const cands = [
    { left: clampX(cx - cw / 2), top: r.top + r.height + gap },
    { left: clampX(cx - cw / 2), top: r.top - gap - ch },
    { left: r.left + r.width + gap, top: r.top + r.height / 2 - ch / 2 },
    { left: r.left - gap - cw, top: r.top + r.height / 2 - ch / 2 }
  ]
  const fits = (c) => c.left >= 8 && c.left + cw <= vw - 8 && c.top >= 8 && c.top + ch <= vh - 8
  let pick = cands.find(fits)
  if (!pick) {
    /* 都放不下:取"溢出最少"的那个,再硬夹进视口 */
    const overflow = (c) =>
      Math.max(0, 8 - c.top) + Math.max(0, c.top + ch - (vh - 8)) +
      Math.max(0, 8 - c.left) + Math.max(0, c.left + cw - (vw - 8))
    pick = cands.slice().sort((a, b) => overflow(a) - overflow(b))[0]
  }
  cardPos.value = {
    left: clampX(pick.left),
    top: Math.max(8, Math.min(pick.top, vh - ch - 8))
  }
}

function startPoll() {
  stopPoll()
  const s = step.value
  if (!s || !s.waitFor) return
  poll = window.setInterval(() => {
    if (document.querySelector(s.waitFor)) {
      stopPoll()
      next()
    }
  }, 180)
}
function stopPoll() {
  if (poll) { clearInterval(poll); poll = 0 }
}

function next() {
  if (isLast.value) { finish(); return }
  idx.value++
}

function back() {
  if (idx.value > 0) idx.value--
}

function finish() {
  stopPoll()
  emit('done')
}

function onResize() {
  if (raf) return
  raf = requestAnimationFrame(() => { raf = 0; measure() })
}

watch(idx, async () => {
  ready.value = false
  await nextTick()
  measure()
  settleFrames(14)
  startPoll()
})

/* 目标可能晚一拍才渲染(题目页刚载入、面板刚出现),多校正几帧 */
function settleFrames(n) {
  if (n <= 0) return
  requestAnimationFrame(() => { measure(); settleFrames(n - 1) })
}

onMounted(() => {
  measure()
  settleFrames(14)
  startPoll()
  window.addEventListener('resize', onResize)
  window.addEventListener('scroll', onResize, true)
})

onBeforeUnmount(() => {
  stopPoll()
  if (raf) cancelAnimationFrame(raf)
  window.removeEventListener('resize', onResize)
  window.removeEventListener('scroll', onResize, true)
})
</script>

<template>
  <Teleport to="body">
    <div class="ff-tour" role="dialog" aria-modal="false" :aria-label="step ? step.title : '新手教程'">
      <div
        v-if="rect"
        class="ff-tour-hole"
        :style="{
          left: rect.left + 'px',
          top: rect.top + 'px',
          width: rect.width + 'px',
          height: rect.height + 'px'
        }"
      ></div>
      <div v-else class="ff-tour-veil"></div>

      <div
        v-if="step"
        ref="cardEl"
        class="ff-tour-card"
        :style="{ left: cardPos.left + 'px', top: cardPos.top + 'px', opacity: ready ? 1 : 0 }"
      >
        <div class="ff-tour-kicker">新手教程 · {{ idx + 1 }} / {{ steps.length }}</div>
        <h3 class="ff-tour-title">{{ step.title }}</h3>
        <p class="ff-tour-text" v-html="step.text"></p>
        <p v-if="step.waitFor" class="ff-tour-wait">试试点一下高亮的地方,会自动进入下一步</p>
        <div class="ff-tour-actions">
          <button type="button" class="ff-tour-skip" @click="finish">跳过教程</button>
          <div class="ff-tour-nav">
            <button v-if="idx > 0" type="button" class="ff-btn ghost" @click="back">上一步</button>
            <button type="button" class="ff-btn primary" @click="next">
              {{ isLast ? '开始使用' : '下一步' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ff-tour {
  position: fixed;
  inset: 0;
  z-index: 90;
  pointer-events: none;   /* 引导期间目标仍可点按 */
}
.ff-tour-hole {
  position: absolute;
  border-radius: var(--radius);
  box-shadow:
    0 0 0 2px var(--vermilion),
    0 0 0 9999px rgba(28, 25, 20, 0.55);
  transition: left 220ms var(--ease-out), top 220ms var(--ease-out),
              width 220ms var(--ease-out), height 220ms var(--ease-out);
}
.ff-tour-veil {
  position: absolute;
  inset: 0;
  background: rgba(28, 25, 20, 0.55);
}
.ff-tour-card {
  position: absolute;
  width: min(340px, calc(100vw - 24px));
  padding: 14px 16px 12px;
  background: var(--paper-panel);
  border: 1px solid var(--hairline);
  border-radius: var(--radius);
  box-shadow: var(--shadow-float);
  color: var(--ink);
  pointer-events: auto;
  transition: opacity 160ms ease, left 220ms var(--ease-out), top 220ms var(--ease-out);
}
.ff-tour-kicker {
  font-family: var(--mono);
  font-size: 10.5px;
  letter-spacing: 1.5px;
  color: var(--ink-faint);
  margin-bottom: 4px;
}
.ff-tour-title {
  font-family: var(--serif);
  font-size: 16px;
  font-weight: 700;
  margin-bottom: 6px;
}
.ff-tour-text {
  font-size: 13px;
  line-height: 1.85;
  color: var(--ink-soft);
}
.ff-tour-wait {
  margin-top: 6px;
  font-size: 11.5px;
  color: var(--vermilion);
}
.ff-tour-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 12px;
}
.ff-tour-nav { display: flex; gap: 6px; }
.ff-tour-skip {
  border: none;
  background: transparent;
  color: var(--ink-faint);
  font-size: 12px;
  cursor: pointer;
  padding: 4px 2px;
}
.ff-tour-skip:hover { color: var(--ink); }
</style>
