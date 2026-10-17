<script setup>
import { ref, onMounted, watch } from 'vue'

/* 隐私模式/沙箱 iframe 里 localStorage 可能直接抛异常,不能让它拖垮整个应用 */
function safeGet(key, fallback) {
  try { return localStorage.getItem(key) || fallback } catch (e) { return fallback }
}
function safeSet(key, value) {
  try { localStorage.setItem(key, value) } catch (e) { /* 静默:只是不记住偏好 */ }
}

const theme = ref(safeGet('ff-theme', 'light'))

function apply(t) {
  document.documentElement.setAttribute('data-theme', t)
  safeSet('ff-theme', t)
}

onMounted(() => apply(theme.value))
watch(theme, apply)

function toggleTheme() {
  theme.value = theme.value === 'light' ? 'dark' : 'light'
}

/* 供子视图使用 */
defineExpose({ theme, toggleTheme })
</script>

<template>
  <router-view v-slot="{ Component }">
    <transition name="page" mode="out-in">
      <component :is="Component" :theme="theme" @toggle-theme="toggleTheme" />
    </transition>
  </router-view>
</template>
