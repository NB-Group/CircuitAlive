<script setup>
/* MathText — 把字符串里的 $...$(行内)与 $$...$$(独立行)交给 KaTeX 渲染。
 * throwOnError:false:数据里写坏的公式显示为红色原文,不会让整个视图崩掉。 */
import { computed } from 'vue'
import katex from 'katex'
import 'katex/dist/katex.min.css'

const props = defineProps({
  text: { type: String, default: '' }
})

const parts = computed(() => {
  const src = props.text || ''
  const out = []
  const re = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g
  let last = 0
  let m
  while ((m = re.exec(src)) !== null) {
    if (m.index > last) out.push({ kind: 'text', value: src.slice(last, m.index) })
    const display = m[1] != null
    const tex = (display ? m[1] : m[2]).trim()
    out.push({
      kind: 'math',
      display,
      html: katex.renderToString(tex, {
        throwOnError: false,
        displayMode: display,
        strict: false,
        output: 'html'
      })
    })
    last = re.lastIndex
  }
  if (last < src.length) out.push({ kind: 'text', value: src.slice(last) })
  return out
})
</script>

<template>
  <span class="math-text">
    <template v-for="(p, i) in parts" :key="i">
      <span v-if="p.kind === 'text'">{{ p.value }}</span>
      <span v-else-if="p.display" class="math-display" v-html="p.html"></span>
      <span v-else class="math-inline" v-html="p.html"></span>
    </template>
  </span>
</template>

<style scoped>
.math-text {
  white-space: inherit;
}

.math-inline {
  display: inline;
  white-space: nowrap;
}

/* 独立公式:保留 KaTeX 自带的 .katex-display 块级排版,只收紧上下留白 */
.math-display {
  display: block;
  margin: 10px 0;
  overflow-x: auto;
  overflow-y: hidden;
}

.math-display :deep(.katex-display) {
  margin: 0;
}

.math-text :deep(.katex) {
  font-size: 1.02em;
}

.math-text :deep(.katex .mord),
.math-text :deep(.katex .mbin),
.math-text :deep(.katex .mrel) {
  color: inherit;
}
</style>
