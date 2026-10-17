<script setup>
/* ShareDialog — 分享一张电路
 *
 * 链接里编码的是整个电路(encodeCircuit),不依赖服务器;同时提供
 * .ff.json 下载。复制按钮走 navigator.clipboard,失败时退回
 * 选中输入框内容,提示用户手动复制。
 *
 * Esc / 点遮罩 / 关闭按钮都能关;打开时焦点落在链接输入框。
 */
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { encodeCircuit, buildShareUrl, downloadCircuit } from '../core/share.js'
import { copy as strings } from '../data/copy.js'

const props = defineProps({
  item: { type: Object, required: true }
})

const emit = defineEmits(['close'])

const linkEl = ref(null)
const copied = ref(false)
const copyError = ref('')
const downloaded = ref(false)

const code = computed(() => {
  try {
    return encodeCircuit(props.item.data)
  } catch (err) {
    return ''
  }
})

const url = computed(() => {
  if (!code.value) return ''
  try {
    return buildShareUrl(code.value)
  } catch (err) {
    return ''
  }
})

const long = computed(() => url.value.length > 1800)

let timer = 0

function close() {
  emit('close')
}

async function copyLink() {
  const text = url.value
  if (!text) return
  copyError.value = ''
  let ok = false
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text)
      ok = true
    }
  } catch (err) {
    ok = false
  }
  if (!ok) {
    /* 退回手动选中:让用户按 Ctrl+C */
    try {
      if (linkEl.value) {
        linkEl.value.focus()
        linkEl.value.select()
        ok = document.execCommand && document.execCommand('copy')
      }
    } catch (err) {
      ok = false
    }
  }
  if (ok) {
    copied.value = true
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { copied.value = false }, 1800)
  } else {
    copyError.value = strings.share.copyFailed
    if (linkEl.value) { linkEl.value.focus(); linkEl.value.select() }
  }
}

function download() {
  try {
    downloadCircuit(props.item.data, props.item.name)
    downloaded.value = true
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { downloaded.value = false }, 1800)
  } catch (err) {
    copyError.value = strings.errors.share.noDom
  }
}

function onKey(ev) {
  if (ev.key === 'Escape') {
    ev.stopPropagation()
    close()
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKey)
  nextTick(() => {
    if (linkEl.value) linkEl.value.focus()
  })
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  if (timer) clearTimeout(timer)
})
</script>

<template>
  <div class="ff-dialog-layer" @keydown.esc="close">
    <div class="ff-dialog-scrim" @click="close"></div>

    <div class="ff-dialog ff-share-dialog" role="dialog" aria-modal="true" aria-labelledby="ff-share-title">
      <header class="ff-dialog-head">
        <span class="ff-dialog-kicker">分享</span>
        <h2 id="ff-share-title" class="ff-dialog-title">{{ item.name }}</h2>
        <button type="button" class="ff-dialog-close" aria-label="关闭" @click="close">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>

      <div class="ff-dialog-body">
        <label class="ff-field-label" for="ff-share-link">分享链接</label>
        <div class="ff-share-row">
          <input
            id="ff-share-link"
            ref="linkEl"
            class="ff-input ff-share-input ff-num"
            type="text"
            :value="url"
            readonly
            spellcheck="false"
            @focus="$event.target.select()"
          />
          <button
            type="button"
            class="ff-btn primary ff-share-copy"
            :class="{ done: copied }"
            :disabled="!url"
            @click="copyLink"
          >
            <span class="ff-share-copy-label">{{ copied ? '已复制' : strings.share.copy }}</span>
          </button>
        </div>

        <p v-if="copyError" class="ff-share-error" role="alert">{{ copyError }}</p>
        <p v-else-if="long" class="ff-share-warn">{{ strings.share.longWarning }}</p>

        <div class="ff-share-alt">
          <button type="button" class="ff-btn" @click="download">
            {{ downloaded ? '已开始下载' : strings.share.download }}
          </button>
          <span class="ff-share-alt-note">离线保存,之后可以在作品库里导入。</span>
        </div>

        <div class="ff-share-note">
          <svg class="ff-share-note-icon" viewBox="0 0 24 24" aria-hidden="true">
            <rect x="3.5" y="5.5" width="17" height="13" rx="1.5" />
            <path d="M7 9.5h6M7 13h10M7 16.5h4" />
          </svg>
          <p>
            链接里带着整张电路,不是一张截图。对方打开后能继续编辑、改参数、看读数,
            不需要联网读取任何服务器数据。
          </p>
        </div>
      </div>

      <footer class="ff-dialog-foot">
        <button type="button" class="ff-btn" @click="close">关闭</button>
      </footer>
    </div>
  </div>
</template>
