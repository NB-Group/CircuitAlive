<script setup>
/* HomeView — 首页:品牌介绍、题库浏览、预置电路入口
 *
 * 视觉基调:方格纸 + 衬线标题 + 细线分隔 + 朱红点缀。
 * 动画全部走 tokens.css 的 ff-fade-up;卡片错峰靠 --i 自定义属性。
 * 主题由 App.vue 注入(prop theme / emit toggle-theme),本视图不自己存状态。 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { allProblems as problems, problemTypes } from '../data/problems.js'
import MathText from '../components/MathText.vue'
import { Model } from '../core/model.js'
import { solver } from '../core/solver.js'
import { createRenderer } from '../core/render.js'
import { presets } from '../data/presets.js'
import { bus } from '../core/util.js'

const props = defineProps({
  theme: { type: String, default: 'light' }
})
const emit = defineEmits(['toggle-theme'])
const router = useRouter()

/* ---------- 题库筛选 ---------- */
const filters = ['全部', ...problemTypes]
const active = ref('全部')

const countOf = (t) =>
  t === '全部' ? problems.length : problems.filter((p) => p.type === t).length

const filtered = computed(() =>
  active.value === '全部' ? problems : problems.filter((p) => p.type === active.value)
)

function setFilter(t) { active.value = t }

const DIFF_NAME = { 1: '基础', 2: '中等', 3: '提高' }
const diffLabel = (d) => DIFF_NAME[d] || ''

/* ---------- 首页演示:真实引擎 ---------- */
const heroStage = ref(null)
let heroRenderer = null
let heroModel = null
let heroRaf = 0

function mountHero() {
  const host = heroStage.value
  if (!host) return
  host.classList.add('ff-canvas')
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', '100%')
  svg.setAttribute('height', '100%')
  svg.setAttribute('viewBox', '0 0 380 250')
  svg.setAttribute('aria-label', '串联电路演示:电流粒子沿导线运动')
  /* renderer 产出的描边全靠 canvas.css 里的 .ff-canvas 作用域变量;
     不加这个类,SVG 画出来是一条线都没有的空框。 */
  svg.classList.add('ff-stage')
  host.appendChild(svg)

  heroModel = new Model()
  heroModel.loadPreset(presets[0].tuples)   /* 串联:电池 + 开关 + 两灯 */
  /* 演示用:开关闭合、去掉灯泡的暗态 */
  const sw = heroModel.list().find(e => e.type === 'switch')
  if (sw) sw.props.closed = true

  heroRenderer = createRenderer(svg)
  heroRenderer.setModel(heroModel)
  heroRenderer.setOpts({ particles: true, electrons: false, potential: false, phiLabels: false, efield: false })
  solveHero()
  /* 等布局完成再适配视图:appendChild 之后立刻读 getBoundingClientRect 会得到 0 */
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (heroRenderer) heroRenderer.fitView()
    })
  })
  bus.on('changed', solveHero)
}

function solveHero() {
  if (!heroRenderer || !heroModel) return
  const sol = solver.solve(heroModel.list(), { wireR: heroModel.wireR })
  heroRenderer.setSolution(sol)
  heroRenderer.syncStructure()
  heroRenderer.syncSolution()
}

onMounted(() => {
  mountHero()
})

onBeforeUnmount(() => {
  bus.off('changed', solveHero)
  if (heroRenderer && heroRenderer.destroy) heroRenderer.destroy()
  heroRenderer = null
})

/* ---------- 滚动到题目库 ---------- */
const libraryEl = ref(null)
function scrollToProblems() {
  const el = libraryEl.value
  if (el) el.scrollIntoView({ block: 'start' })
}

/* ---------- 预置电路 ---------- */
const presetCards = [
  {
    id: 'series',
    name: '串联电路',
    desc: '电源、开关与两只灯泡首尾相接,电流处处相等。',
    note: 'SERIES'
  },
  {
    id: 'parallel',
    name: '并联电路',
    desc: '两条支路并排,各自独立,干路电流等于支路电流之和。',
    note: 'PARALLEL'
  },
  {
    id: 'vam',
    name: '伏安法测电阻',
    desc: '电流表串联、电压表并联,滑动变阻器改变测量条件。',
    note: 'V–A METHOD'
  }
]
</script>

<template>
  <div class="home ff-paper-grid">
    <!-- ---------- 顶栏 ---------- -->
    <header class="nav">
      <div class="wrap nav-inner">
        <router-link to="/" class="brand" aria-label="CircuitAlive 首页">
          <span class="brand-mark" aria-hidden="true">F</span>
          <span class="brand-word">CircuitAlive</span>
        </router-link>

        <div class="nav-right">
          <span class="nav-note">电学实验台</span>
          <router-link to="/library" class="ff-btn ghost library-link">作品库</router-link>
          <button
            type="button"
            class="ff-btn ghost theme-btn"
            :aria-label="theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'"
            @click="emit('toggle-theme')"
          >
            <svg v-if="theme === 'dark'" class="theme-icon" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="4.2" />
              <path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4L17 7M7 17l-1.6 1.6" />
            </svg>
            <svg v-else class="theme-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20.4 14.6A8.6 8.6 0 0 1 9.4 3.6a8.6 8.6 0 1 0 11 11Z" />
            </svg>
            <span>{{ theme === 'dark' ? '浅色' : '深色' }}</span>
          </button>
        </div>
      </div>
    </header>

    <main class="wrap">
      <!-- ---------- Hero ---------- -->
      <section class="hero">
        <div class="hero-copy">
          <p class="eyebrow rise" style="--i: 0">
            <span class="eyebrow-rule" aria-hidden="true"></span>初中电学 · 可视化练习
          </p>

          <h1 class="hero-title rise" style="--i: 1">
            <span class="latin">CircuitAlive</span>
            <span class="cn">电路,活了</span>
          </h1>

          <p class="lede rise" style="--i: 2">
            Make your circuit alive — 画一条导线,看电流真的流起来,电压真的落下来。
          </p>

          <div class="hero-actions rise" style="--i: 3">
            <button type="button" class="ff-btn primary" @click="router.push('/library')">
              开始画图<span class="btn-arrow" aria-hidden="true">→</span>
            </button>
            <button type="button" class="ff-btn" @click="scrollToProblems">浏览题目</button>
          </div>

          <ul class="hero-meta rise" style="--i: 4">
            <li><span class="num">{{ problems.length }}</span> 道原创模拟题</li>
            <li><span class="num">{{ problemTypes.length }}</span> 类题型</li>
            <li>实时求解</li>
          </ul>
        </div>

        <div class="stage-wrap rise" style="--i: 2">
          <figure class="stage">
            <figcaption class="stage-head">
              <span class="live"><span class="live-dot" aria-hidden="true"></span>演示回路</span>
              <span class="stage-read">I = 0.30 A</span>
            </figcaption>

            <!-- 真实引擎渲染的演示回路:与编辑器同一套求解器/符号/粒子 -->
            <div ref="heroStage" class="circuit-art hero-engine"></div>

            <div class="stage-foot">
              <span>6 V</span>
              <span class="sep" aria-hidden="true"></span>
              <span>R = 20 Ω</span>
              <span class="sep" aria-hidden="true"></span>
              <span>开关闭合</span>
            </div>
          </figure>
          <p class="stage-cap">图 1 · 串联回路中的电流粒子</p>
        </div>
      </section>

      <!-- ---------- 题目库 ---------- -->
      <section id="problems" ref="libraryEl" class="library">
        <div class="section-head">
          <div class="section-title">
            <h2>题目库</h2>
            <span class="count ff-num">{{ filtered.length }} / {{ problems.length }}</span>
          </div>

          <div class="chips" role="group" aria-label="按题型筛选">
            <button
              v-for="t in filters"
              :key="t"
              type="button"
              class="chip"
              :class="{ on: active === t }"
              :aria-pressed="active === t"
              @click="setFilter(t)"
            >
              {{ t }}<span class="chip-n ff-num">{{ countOf(t) }}</span>
            </button>
          </div>
        </div>

        <div :key="active" class="grid">
          <router-link
            v-for="(p, i) in filtered"
            :key="p.id"
            :to="'/problem/' + p.id"
            class="card"
            :style="{ '--i': i }"
          >
            <div class="card-top">
              <span class="card-type">{{ p.type }}</span>
              <span class="card-year ff-num">{{ p.source }}<template v-if="p.number"> · 第 {{ p.number }} 题</template></span>
            </div>

            <h3 class="card-title">{{ p.title }}</h3>

            <p class="card-statement"><MathText :text="p.statement" /></p>

            <div class="card-foot">
              <div class="tags">
                <span v-for="t in p.tags.slice(0, 2)" :key="t" class="tag">{{ t }}</span>
              </div>
              <span class="diff" :aria-label="'难度:' + diffLabel(p.difficulty)">
                <span
                  v-for="n in 3"
                  :key="n"
                  class="dot"
                  :class="{ on: n <= p.difficulty }"
                  aria-hidden="true"
                ></span>
              </span>
            </div>
          </router-link>
        </div>

        <p v-if="!filtered.length" class="empty">这一类暂时没有题目。</p>
      </section>

      <!-- ---------- 从这里开始 ---------- -->
      <section class="start">
        <div class="section-head plain">
          <div class="section-title">
            <h2>从这里开始</h2>
            <span class="count">三个预置电路</span>
          </div>
        </div>

        <div class="presets">
          <router-link
            v-for="(p, i) in presetCards"
            :key="p.id"
            :to="{ path: '/edit', query: { preset: p.id } }"
            class="preset"
            :style="{ '--i': i }"
          >
            <div class="glyph">
              <svg viewBox="0 0 200 110" aria-hidden="true">
                <!-- 串联 -->
                <g v-if="p.id === 'series'">
                  <path class="g-wire" d="M30 30 H170 V80 H30 Z" />
                  <line class="g-wire" x1="30" y1="30" x2="30" y2="48" />
                  <line class="g-wire" x1="30" y1="56" x2="30" y2="80" />
                  <line class="g-sym" x1="23" y1="48" x2="37" y2="48" />
                  <line class="g-sym" x1="26" y1="56" x2="34" y2="56" />
                  <circle class="g-body" cx="75" cy="30" r="7" />
                  <line class="g-sym thin" x1="70" y1="25" x2="80" y2="35" />
                  <line class="g-sym thin" x1="70" y1="35" x2="80" y2="25" />
                  <circle class="g-body" cx="125" cy="30" r="7" />
                  <line class="g-sym thin" x1="120" y1="25" x2="130" y2="35" />
                  <line class="g-sym thin" x1="120" y1="35" x2="130" y2="25" />
                  <circle class="g-contact" cx="92" cy="80" r="2" />
                  <circle class="g-contact" cx="108" cy="80" r="2" />
                  <line class="g-sym" x1="92" y1="80" x2="107" y2="75" />
                </g>

                <!-- 并联 -->
                <g v-else-if="p.id === 'parallel'">
                  <path class="g-wire" d="M30 30 H170 V80 H30 V64 M30 46 V30" />
                  <line class="g-sym" x1="23" y1="46" x2="37" y2="46" />
                  <line class="g-sym" x1="26" y1="54" x2="34" y2="54" />
                  <path class="g-wire" d="M90 30 V80 M140 30 V80" />
                  <circle class="g-body" cx="90" cy="55" r="7" />
                  <line class="g-sym thin" x1="85" y1="50" x2="95" y2="60" />
                  <line class="g-sym thin" x1="85" y1="60" x2="95" y2="50" />
                  <circle class="g-body" cx="140" cy="55" r="7" />
                  <line class="g-sym thin" x1="135" y1="50" x2="145" y2="60" />
                  <line class="g-sym thin" x1="135" y1="60" x2="145" y2="50" />
                </g>

                <!-- 伏安法 -->
                <g v-else>
                  <path class="g-wire" d="M30 30 H170 V80 H30 V64 M30 46 V30" />
                  <line class="g-sym" x1="23" y1="46" x2="37" y2="46" />
                  <line class="g-sym" x1="26" y1="54" x2="34" y2="54" />
                  <circle class="g-body" cx="68" cy="30" r="8" />
                  <text class="g-text" x="68" y="33.5">A</text>
                  <rect class="g-body" x="112" y="24" width="30" height="12" />
                  <path class="g-wire" d="M112 30 V58 H142 V30" />
                  <circle class="g-body" cx="127" cy="58" r="8" />
                  <text class="g-text" x="127" y="61.5">V</text>
                </g>
              </svg>
            </div>

            <div class="preset-body">
              <div class="preset-head">
                <h3>{{ p.name }}</h3>
                <span class="preset-note ff-num">{{ p.note }}</span>
              </div>
              <p>{{ p.desc }}</p>
              <span class="open">打开<span class="btn-arrow" aria-hidden="true">→</span></span>
            </div>
          </router-link>
        </div>
      </section>
    </main>

    <!-- ---------- 页脚 ---------- -->
    <footer class="foot">
      <div class="wrap foot-inner">
        <p class="foot-note">
          本项目为独立开发的学习工具,题目为原创模拟题,不来自任何真实试卷。
        </p>
        <p class="foot-mark"><span class="brand-word">CircuitAlive</span><span class="foot-year ff-num">2026</span></p>
      </div>
    </footer>
  </div>
</template>

<style scoped>
/* ================= 页面骨架 ================= */
.home {
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  position: relative;
}

.wrap {
  width: 100%;
  max-width: 1120px;
  margin: 0 auto;
  padding: 0 clamp(20px, 5vw, 56px);
}

.rise {
  animation: ff-fade-up var(--dur-slow) var(--ease-out) backwards;
  animation-delay: calc(var(--i, 0) * 70ms);
}

/* ================= 顶栏 ================= */
.nav {
  position: sticky;
  top: 0;
  z-index: 20;
  background: var(--paper);
  border-bottom: 1px solid var(--hairline);
}

.nav-inner {
  height: 58px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
  color: var(--ink);
}

.brand-mark {
  width: 23px;
  height: 23px;
  display: grid;
  place-items: center;
  border: 1px solid var(--vermilion);
  border-radius: 2px;
  color: var(--vermilion);
  font-family: var(--serif);
  font-size: 13px;
  font-weight: 900;
  line-height: 1;
}

.brand-word {
  font-family: var(--serif);
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.nav-right {
  display: flex;
  align-items: center;
  gap: 14px;
}

.nav-note {
  font-size: 12px;
  letter-spacing: 0.14em;
  color: var(--ink-faint);
}

.theme-btn {
  gap: 6px;
  font-size: 12.5px;
  padding: 5px 10px;
}

.library-link {
  font-size: 12.5px;
  padding: 5px 10px;
}

.theme-icon {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
}

/* ================= Hero ================= */
.hero {
  display: grid;
  grid-template-columns: minmax(0, 1.04fr) minmax(0, 0.96fr);
  align-items: center;
  gap: clamp(32px, 5vw, 72px);
  padding: clamp(44px, 7.5vh, 88px) 0 clamp(48px, 8vh, 92px);
}

.eyebrow {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  letter-spacing: 0.16em;
  color: var(--ink-soft);
}

.eyebrow-rule {
  width: 26px;
  height: 1px;
  background: var(--vermilion);
}

.hero-title {
  margin-top: 18px;
  font-family: var(--serif);
  font-weight: 900;
  line-height: 1.06;
  letter-spacing: 0.01em;
}

.hero-title .latin {
  display: block;
  font-size: clamp(30px, 3.6vw, 44px);
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--ink-soft);
}

.hero-title .cn {
  display: block;
  margin-top: 4px;
  font-size: clamp(40px, 5.6vw, 66px);
  color: var(--ink);
}

.lede {
  margin-top: 22px;
  max-width: 30em;
  font-size: 15.5px;
  line-height: 1.95;
  color: var(--ink-soft);
}

.hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 30px;
}

.hero-actions .ff-btn {
  padding: 10px 20px;
  font-size: 14px;
}

.btn-arrow {
  display: inline-block;
  margin-left: 7px;
  transition: transform var(--dur-mid) var(--ease-out);
}

.ff-btn:hover .btn-arrow,
.preset:hover .btn-arrow {
  transform: translateX(3px);
}

.hero-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0;
  margin-top: 34px;
  list-style: none;
  font-size: 12px;
  color: var(--ink-faint);
}

.hero-meta li {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 0 16px;
  border-left: 1px solid var(--hairline);
}

.hero-meta li:first-child {
  padding-left: 0;
  border-left: 0;
}

.hero-meta .num {
  font-family: var(--mono);
  font-size: 15px;
  color: var(--vermilion);
}

/* ---------- 演示电路 ---------- */
.stage-wrap {
  position: relative;
  isolation: isolate;
}

.stage-wrap::after {
  content: '';
  position: absolute;
  inset: 14px -12px -12px 14px;
  z-index: -1;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-lg);
}

.stage {
  position: relative;
  background: var(--paper-panel);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-soft);
  overflow: hidden;
}

.stage-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-bottom: 1px solid var(--hairline);
  font-family: var(--mono);
  font-size: 10.5px;
  letter-spacing: 0.08em;
  color: var(--ink-faint);
}

.live {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}

.live-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--vermilion);
  animation: ff-glow-pulse 2.6s ease-in-out infinite;
}

.stage-read {
  color: var(--ink-soft);
}

.circuit-art {
  display: block;
  width: 100%;
  height: auto;
  padding: 6px 10px 0;
}

/* 真实引擎渲染的演示区:固定高度,内部 SVG 铺满 */
.hero-engine {
  height: 250px;
  padding: 0;
  background: transparent;
}
.hero-engine > svg { display: block; width: 100%; height: 100%; }

.stage-foot {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 6px 16px 14px;
  font-family: var(--mono);
  font-size: 10.5px;
  color: var(--ink-faint);
}

.stage-foot .sep {
  width: 1px;
  height: 9px;
  background: var(--hairline);
}

.stage-cap {
  margin-top: 12px;
  font-family: var(--serif);
  font-size: 11.5px;
  letter-spacing: 0.06em;
  color: var(--ink-faint);
  text-align: right;
}

/* SVG 描边全部走 CSS 变量,深色模式自动跟随 */
.wire {
  fill: none;
  stroke: var(--ink-soft);
  stroke-width: 1.6;
  stroke-linecap: round;
}

.sym {
  fill: none;
  stroke: var(--ink);
  stroke-width: 1.7;
  stroke-linecap: round;
}

.sym.heavy { stroke-width: 2.6; }
.sym.thin { stroke-width: 1.3; }
.sym.lever { stroke-width: 2.2; }

.contact {
  fill: var(--ink-soft);
}

.body {
  fill: var(--paper-panel);
  stroke: var(--ink);
  stroke-width: 1.7;
}

.lamp-halo {
  fill: var(--vermilion);
  opacity: 0.16;
  filter: blur(7px);
  animation: ff-glow-pulse 3.4s ease-in-out infinite;
}

.plus {
  fill: var(--ink-faint);
  font-family: var(--sans);
  font-size: 11px;
}

.note {
  fill: var(--ink-faint);
  font-family: var(--serif);
  font-size: 11px;
  text-anchor: middle;
}

.spark {
  fill: var(--vermilion);
  filter: drop-shadow(0 0 3px var(--vermilion));
  animation: ff-spark 7s linear infinite;
}

/* 矩形回路 (46,62)→(334,62)→(334,196)→(46,196),周长 844;
   关键帧百分比按各段长度分配,保证全程匀速。 */
@keyframes ff-spark {
  0% { transform: translate(46px, 62px); }
  34.12% { transform: translate(334px, 62px); }
  50% { transform: translate(334px, 196px); }
  84.12% { transform: translate(46px, 196px); }
  100% { transform: translate(46px, 62px); }
}

/* ================= 小节标题 ================= */
.section-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 18px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--hairline);
}

.section-title {
  display: flex;
  align-items: baseline;
  gap: 14px;
}

.section-title h2 {
  font-family: var(--serif);
  font-size: 26px;
  font-weight: 700;
  letter-spacing: 0.06em;
}

.count {
  font-size: 11.5px;
  letter-spacing: 0.08em;
  color: var(--ink-faint);
}

/* ================= 筛选 ================= */
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.chip {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  padding: 5px 11px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius);
  background: transparent;
  color: var(--ink-soft);
  font-size: 12.5px;
  cursor: pointer;
  transition: color var(--dur-fast) ease, border-color var(--dur-fast) ease,
              background-color var(--dur-fast) ease;
}

.chip:hover {
  border-color: var(--ink-faint);
  color: var(--ink);
}

.chip.on {
  border-color: var(--vermilion);
  background: var(--vermilion-soft);
  color: var(--vermilion);
}

.chip-n {
  font-size: 10.5px;
  opacity: 0.7;
}

/* ================= 题目卡片 ================= */
.library {
  padding-top: clamp(40px, 6vh, 64px);
  scroll-margin-top: 74px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(272px, 1fr));
  gap: 18px;
  padding-top: 26px;
}

.card {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 208px;
  padding: 20px 20px 15px;
  border: 1px solid var(--hairline);
  border-radius: var(--radius);
  background: var(--paper-panel);
  color: var(--ink);
  text-decoration: none;
  transition: transform var(--dur-mid) var(--ease-out),
              border-color var(--dur-mid) ease,
              box-shadow var(--dur-mid) ease,
              background-color var(--dur-mid) ease;
  animation: ff-fade-up var(--dur-slow) var(--ease-out) backwards;
  animation-delay: calc(var(--i, 0) * 45ms + 60ms);
}

/* 顶部朱红细线,悬停时从左展开 */
.card::before {
  content: '';
  position: absolute;
  top: -1px;
  left: 19px;
  right: 19px;
  height: 2px;
  background: var(--vermilion);
  transform: scaleX(0);
  transform-origin: left;
  transition: transform var(--dur-mid) var(--ease-out);
}

.card:hover {
  transform: translateY(-3px);
  border-color: var(--ink-faint);
  background: var(--paper-raised);
  box-shadow: var(--shadow-soft);
}

.card:hover::before {
  transform: scaleX(1);
}

.card-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}

.card-type {
  font-size: 11px;
  letter-spacing: 0.2em;
  color: var(--vermilion);
}

.card-source {
  font-size: 10.5px;
  color: var(--ink-faint);
}

.card-title {
  margin-top: 10px;
  font-family: var(--serif);
  font-size: 17.5px;
  font-weight: 700;
  line-height: 1.5;
  letter-spacing: 0.01em;
}

.card-statement {
  margin-top: 8px;
  font-size: 12.5px;
  line-height: 1.8;
  color: var(--ink-soft);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: auto;
  padding-top: 14px;
}

.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  min-width: 0;
}

.tag {
  padding: 2px 7px;
  border-radius: 2px;
  background: var(--paper-inset);
  color: var(--ink-faint);
  font-size: 10.5px;
  white-space: nowrap;
}

.diff {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: none;
}

.dot {
  width: 5px;
  height: 5px;
  border: 1px solid var(--hairline);
  border-radius: 50%;
}

.dot.on {
  border-color: var(--vermilion);
  background: var(--vermilion);
}

.empty {
  padding: 40px 0;
  text-align: center;
  color: var(--ink-faint);
  font-size: 13px;
}

/* ================= 预置电路 ================= */
.start {
  padding: clamp(44px, 7vh, 76px) 0 clamp(24px, 4vh, 44px);
}

.section-head.plain {
  border-bottom: 1px solid var(--hairline);
}

.presets {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px;
  padding-top: 26px;
}

.preset {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--hairline);
  border-radius: var(--radius);
  background: var(--paper-panel);
  color: var(--ink);
  text-decoration: none;
  overflow: hidden;
  transition: transform var(--dur-mid) var(--ease-out),
              border-color var(--dur-mid) ease,
              box-shadow var(--dur-mid) ease;
  animation: ff-fade-up var(--dur-slow) var(--ease-out) backwards;
  animation-delay: calc(var(--i, 0) * 70ms + 60ms);
}

.preset:hover {
  transform: translateY(-3px);
  border-color: var(--ink-faint);
  box-shadow: var(--shadow-soft);
}

.glyph {
  height: 128px;
  display: grid;
  place-items: center;
  border-bottom: 1px solid var(--hairline);
  background-color: var(--paper-inset);
  background-image:
    linear-gradient(var(--grid-minor) 1px, transparent 1px),
    linear-gradient(90deg, var(--grid-minor) 1px, transparent 1px);
  background-size: 20px 20px;
}

.glyph svg {
  width: 178px;
  height: auto;
  display: block;
}

.g-wire {
  fill: none;
  stroke: var(--ink-soft);
  stroke-width: 1.4;
  stroke-linecap: round;
}

.g-sym {
  fill: none;
  stroke: var(--ink);
  stroke-width: 1.5;
  stroke-linecap: round;
}

.g-sym.thin { stroke-width: 1.1; }

.g-body {
  fill: var(--paper-inset);
  stroke: var(--ink);
  stroke-width: 1.5;
}

.g-contact { fill: var(--ink-soft); }

.g-text {
  fill: var(--ink-soft);
  font-family: var(--sans);
  font-size: 7.5px;
  text-anchor: middle;
}

.preset-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px 18px 18px;
}

.preset-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}

.preset-head h3 {
  font-family: var(--serif);
  font-size: 16.5px;
  font-weight: 700;
}

.preset-note {
  font-size: 9px;
  letter-spacing: 0.12em;
  color: var(--ink-faint);
}

.preset-body p {
  font-size: 12px;
  line-height: 1.75;
  color: var(--ink-soft);
}

.open {
  margin-top: 2px;
  font-size: 12px;
  color: var(--vermilion);
}

/* ================= 页脚 ================= */
.foot {
  margin-top: clamp(40px, 6vh, 72px);
  border-top: 1px solid var(--hairline);
}

.foot-inner {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  padding-top: 22px;
  padding-bottom: 34px;
}

.foot-note {
  font-size: 11.5px;
  line-height: 1.8;
  color: var(--ink-faint);
}

.foot-mark {
  display: flex;
  align-items: baseline;
  gap: 12px;
}

.foot-mark .brand-word {
  font-size: 12.5px;
  color: var(--ink-faint);
}

.foot-year {
  font-size: 10.5px;
  color: var(--ink-faint);
}

/* ================= 响应式 ================= */
@media (max-width: 900px) {
  .hero {
    grid-template-columns: minmax(0, 1fr);
    gap: 40px;
    padding-top: 36px;
  }

  .stage-wrap {
    max-width: 520px;
  }

  .stage-wrap::after {
    inset: 10px -6px -8px 10px;
  }

  .presets {
    grid-template-columns: minmax(0, 1fr);
  }

  .glyph {
    height: 112px;
  }
}

@media (max-width: 560px) {
  .nav-note {
    display: none;
  }

  .hero-meta li {
    padding: 0 10px;
  }

  .section-head {
    align-items: flex-start;
  }

  .grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .card {
    min-height: 0;
  }
}
</style>
