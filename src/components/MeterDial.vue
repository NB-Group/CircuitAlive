<script setup>
/* MeterDial — 题面里的电表表盘
 *
 * 有些题不给具体读数,而是给一张表盘图(「电流表示数如图 10(b) 所示」)。
 * 这里按初中实验室表盘画:弧形刻度、主刻度带数字、指针指向读数。
 * 纯静态示意,不参与求解;读数由题目数据给出。
 *
 * 双量程表盘(如电流表 0.6 A / 3 A)按主量程画一圈,再在内圈
 * 标出另一量程的数字;初中教材就是这种双排刻度。
 */
import { computed } from 'vue'

const props = defineProps({
  meter: { type: String, default: 'A' },
  range: { type: Number, default: 0.6 },
  value: { type: Number, default: 0 },
  label: { type: String, default: '' }
})

const W = 260, H = 168
const CX = 130, CY = 150, R = 112
const A0 = -62, A1 = 62

function pt(deg, r) {
  const t = (deg * Math.PI) / 180
  return [CX + r * Math.sin(t), CY - r * Math.cos(t)]
}

const arc = computed(() => {
  const [x0, y0] = pt(A0, R)
  const [x1, y1] = pt(A1, R)
  return `M ${x0} ${y0} A ${R} ${R} 0 0 1 ${x1} ${y1}`
})

/* 初中实验室表盘的刻度和量程是配套的:
     电流表 0~0.6 A 标 0/0.2/0.4/0.6,0~3 A 标 0/1/2/3;
     电压表 0~3 V 同样标 0/1/2/3,0~15 V 标 0/5/10/15。
   大格之间再分 10 小格。所以主刻度步长按量程查表,不写死。 */
const majorStep = computed(() => {
  const r = props.range
  const table = [[0.6, 0.2], [3, 1], [6, 2], [15, 5], [20, 5], [50, 10], [100, 25]]
  const hit = table.find(([rr]) => Math.abs(r - rr) < 1e-6)
  if (hit) return hit[1]
  /* 未知量程:取能让主刻度落在 3~6 个之间的整步长 */
  const raw = r / 4
  const pow = Math.pow(10, Math.floor(Math.log10(raw)))
  return [1, 2, 2.5, 5, 10].map((m) => m * pow).find((c) => r / c <= 6) || r
})
const majorCount = computed(() => Math.max(1, Math.round(props.range / majorStep.value)))

const ticks = computed(() => {
  const out = []
  const n = majorCount.value
  const minors = 10
  for (let i = 0; i <= n; i++) {
    const f = i / n
    const deg = A0 + (A1 - A0) * f
    const [x0, y0] = pt(deg, R - 2)
    const [x1, y1] = pt(deg, R - 13)
    const [lx, ly] = pt(deg, R - 26)
    out.push({ x0, y0, x1, y1, lx, ly, text: fmtTick(props.range * f), major: true })
    if (i < n) {
      for (let k = 1; k < minors; k++) {
        const dd = A0 + (A1 - A0) * (f + (k / minors) / n)
        const [a0x, a0y] = pt(dd, R - 2)
        const [a1x, a1y] = pt(dd, R - 8)
        out.push({ x0: a0x, y0: a0y, x1: a1x, y1: a1y, major: false })
      }
    }
  }
  return out
})

function fmtTick(v) {
  if (Math.abs(v) < 1e-9) return '0'
  if (Math.abs(v - Math.round(v)) < 1e-9) return String(Math.round(v))
  return String(+v.toFixed(2))
}

/* 指针:0 对应 A0,满量程对应 A1 */
const needleDeg = computed(() => {
  const span = props.range || 1
  const f = Math.max(0, Math.min(1, props.value / span))
  return A0 + (A1 - A0) * f
})

const needle = computed(() => {
  /* 尖端画到刻度内侧,尾部越过圆心一小段,像真表盘 */
  const [x, y] = pt(needleDeg.value, R - 20)
  const [tx, ty] = pt(needleDeg.value, -14)
  return { x, y, tx, ty }
})
</script>

<template>
  <figure class="meter-dial">
    <svg :viewBox="`0 0 ${W} ${H}`" role="img" :aria-label="`${meter} 表盘,读数 ${value}`">
      <path class="dial-arc" :d="arc" />
      <g class="dial-ticks">
        <line
          v-for="(t, i) in ticks"
          :key="i"
          :x1="t.x0" :y1="t.y0" :x2="t.x1" :y2="t.y1"
          :class="t.major ? 'tick major' : 'tick'"
        />
      </g>
      <g class="dial-nums">
        <text
          v-for="(t, i) in ticks.filter(x => x.major)"
          :key="'n' + i"
          :x="t.lx" :y="t.ly"
          text-anchor="middle" dominant-baseline="central"
        >{{ t.text }}</text>
      </g>
      <g class="dial-needle">
        <line :x1="needle.tx" :y1="needle.ty" :x2="needle.x" :y2="needle.y" />
        <circle :cx="CX" :cy="CY" r="4" />
      </g>
      <text class="dial-unit" :x="CX" :y="CY - 34" text-anchor="middle">{{ meter }}</text>
    </svg>
    <figcaption v-if="label">{{ label }}</figcaption>
  </figure>
</template>

<style scoped>
.meter-dial { margin: 0; display: flex; flex-direction: column; align-items: center; gap: 3px; }
.meter-dial svg { width: 200px; height: 129px; display: block; }
.dial-arc { fill: none; stroke: var(--ink); stroke-width: 1.7; }
.dial-ticks .tick { stroke: var(--ink); stroke-width: 0.75; opacity: 0.72; }
.dial-ticks .tick.major { stroke-width: 1.25; opacity: 1; }
.dial-nums text { fill: var(--ink); font-family: var(--mono); font-size: 9.5px; }
.dial-needle line { stroke: var(--vermilion); stroke-width: 1.7; stroke-linecap: round; }
.dial-needle circle { fill: var(--vermilion); }
.dial-unit { fill: var(--ink); font-family: var(--serif); font-size: 13px; font-weight: 700; }
figcaption { font-family: var(--serif); font-size: 11px; color: var(--ink-faint); letter-spacing: 0.5px; }
</style>
