<script setup>
import { ref, onMounted, watch } from 'vue'

const theme = ref(localStorage.getItem('ff-theme') || 'light')

function apply(t) {
  document.documentElement.setAttribute('data-theme', t)
  localStorage.setItem('ff-theme', t)
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
