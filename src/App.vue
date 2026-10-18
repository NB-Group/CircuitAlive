<script setup>
import { ref, onMounted, onErrorCaptured, watch } from 'vue'

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

/* 视图渲染出错时不要把整页留白:给出可读的提示,同时把错误打进控制台。
   之前的整页转场(mode="out-in")遇到异常会卡在淡出态,看起来就是
   "点了没反应、字也没了"。 */
const crash = ref('')
onErrorCaptured((err) => {
  console.error(err)
  crash.value = (err && err.message) ? err.message : String(err)
  return false
})
</script>

<template>
  <!-- 不做整页转场:mode="out-in" 会先让旧页面淡出,如果新页面
       (例如作品库缩略图很多)装配稍慢,用户会看到一段空白,以为点了没反应。 -->
  <div v-if="crash" class="ff-crash" role="alert">
    <h2>页面出了点问题</h2>
    <p>{{ crash }}</p>
    <button class="ff-btn primary" @click="() => { crash = ''; location.reload() }">重新加载</button>
  </div>
  <router-view v-else v-slot="{ Component }">
    <component :is="Component" :theme="theme" @toggle-theme="toggleTheme" />
  </router-view>
</template>
