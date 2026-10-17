<script setup>
/* SaveDialog — 编辑器里的保存面板
 *
 * 首次保存 = 新建条目;打开自作品库的电路 = 覆盖该条目;
 * 「另存为新电路」总是新建一条。
 *
 * 事件:close · save(name) · save-as-new(name)
 */
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { copy as strings } from '../data/copy.js'

const props = defineProps({
  initialName: { type: String, default: '' },
  hasItem: { type: Boolean, default: false },
  error: { type: String, default: '' }
})

const emit = defineEmits(['close', 'save', 'save-as-new'])

const name = ref(props.initialName)
const inputEl = ref(null)

const trimmed = computed(() => name.value.trim())
const canSave = computed(() => trimmed.value.length > 0)

function submit() {
  if (!canSave.value) return
  emit('save', trimmed.value)
}

function saveAsNew() {
  if (!canSave.value) return
  emit('save-as-new', trimmed.value)
}

function onKey(ev) {
  if (ev.key === 'Escape') {
    ev.stopPropagation()
    emit('close')
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKey)
  nextTick(() => {
    if (inputEl.value) {
      inputEl.value.focus()
      inputEl.value.select()
    }
  })
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div class="ff-dialog-layer">
    <div class="ff-dialog-scrim" @click="emit('close')"></div>

    <div class="ff-dialog ff-save-dialog" role="dialog" aria-modal="true" aria-labelledby="ff-save-title">
      <header class="ff-dialog-head">
        <span class="ff-dialog-kicker">作品库</span>
        <h2 id="ff-save-title" class="ff-dialog-title">{{ strings.library.saveTitle }}</h2>
        <button type="button" class="ff-dialog-close" aria-label="关闭" @click="emit('close')">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>

      <div class="ff-dialog-body">
        <label class="ff-field-label" for="ff-save-name">{{ strings.library.nameLabel }}</label>
        <input
          id="ff-save-name"
          ref="inputEl"
          v-model="name"
          class="ff-input"
          type="text"
          maxlength="60"
          :placeholder="strings.library.namePlaceholder"
          autocomplete="off"
          @keydown.enter.prevent="submit"
        />

        <p v-if="error" class="ff-dialog-error" role="alert">{{ error }}</p>
        <p class="ff-save-hint">
          {{ hasItem ? '保存会覆盖作品库里的这一条。' : '保存后可以在作品库中找到这张电路。' }}
        </p>
      </div>

      <footer class="ff-dialog-foot spread">
        <button v-if="hasItem" type="button" class="ff-btn" :disabled="!canSave" @click="saveAsNew">
          另存为新电路
        </button>
        <span v-else></span>
        <div class="ff-dialog-foot-right">
          <button type="button" class="ff-btn ghost" @click="emit('close')">{{ strings.library.cancel }}</button>
          <button type="button" class="ff-btn primary" :disabled="!canSave" @click="submit">
            {{ strings.library.save }}
          </button>
        </div>
      </footer>
    </div>
  </div>
</template>
