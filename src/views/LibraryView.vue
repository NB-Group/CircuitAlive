<script setup>
/* LibraryView — 作品库
 *
 * 数据全部来自 useLibrary()(localStorage)。收藏、查看记录、来源这些
 * 附加信息放在 useLibraryMeta() 的独立键里,不动 useLibrary 的存储结构。
 *
 * 四个筛选:
 *   全部      = 所有保存的电路
 *   最近查看  = 有查看记录的(按查看时间倒序)
 *   由您创建  = 从编辑器保存的(排除导入的 .ff.json)
 *   收藏夹    = 星标过的
 */
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useLibrary } from '../composables/useLibrary.js'
import { useLibraryMeta } from '../composables/useLibraryMeta.js'
import { relativeTime } from '../composables/formatTime.js'
import { readCircuitFile } from '../core/share.js'
import { copy as strings } from '../data/copy.js'
import CircuitCard from '../components/CircuitCard.vue'
import ShareDialog from '../components/ShareDialog.vue'

const props = defineProps({
  theme: { type: String, default: 'light' }
})
const emit = defineEmits(['toggle-theme'])
const router = useRouter()

const lib = useLibrary()
const meta = useLibraryMeta()

/* ---------- 筛选 / 排序 / 视图 ---------- */

const FILTERS = [
  { id: 'all', label: '全部' },
  { id: 'recent', label: '最近查看' },
  { id: 'created', label: '由您创建' },
  { id: 'favorites', label: '收藏夹' }
]

const filter = ref('all')
const sort = ref('updated')
const view = ref('grid')

const SORTS = [
  { id: 'updated', label: '最近修改' },
  { id: 'created', label: '创建时间' },
  { id: 'name', label: '名称' }
]

const items = computed(() => lib.items.value || [])

const counts = computed(() => {
  const list = items.value
  return {
    all: list.length,
    recent: list.filter((x) => meta.viewedAt(x.id) > 0).length,
    created: list.filter((x) => meta.originOf(x.id) === 'created').length,
    favorites: list.filter((x) => meta.isFavorite(x.id)).length
  }
})

function baseFiltered() {
  const list = items.value
  switch (filter.value) {
    case 'recent':
      return list.filter((x) => meta.viewedAt(x.id) > 0)
    case 'created':
      return list.filter((x) => meta.originOf(x.id) === 'created')
    case 'favorites':
      return list.filter((x) => meta.isFavorite(x.id))
    default:
      return list.slice()
  }
}

const filtered = computed(() => {
  const list = baseFiltered()
  const s = sort.value
  if (filter.value === 'recent' && s === 'updated') {
    return list.slice().sort((a, b) => meta.viewedAt(b.id) - meta.viewedAt(a.id))
  }
  if (s === 'created') {
    return list.slice().sort((a, b) => b.createdAt - a.createdAt)
  }
  if (s === 'name') {
    return list.slice().sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
  }
  return list.slice().sort((a, b) => b.updatedAt - a.updatedAt)
})

/* 空状态按筛选给不同的话术 */
const emptyText = computed(() => {
  switch (filter.value) {
    case 'recent':
      return { title: '还没有查看记录', text: '打开一张电路之后,它会出现在这里。' }
    case 'created':
      return { title: '还没有自己画的电路', text: '从空白画布开始,搭一张属于自己的电路。' }
    case 'favorites':
      return { title: '收藏夹是空的', text: '点卡片右上角的星标,把常用的电路收进来。' }
    default:
      return { title: '还没有保存的电路', text: strings.library.empty }
  }
})

const storageOk = ref(true)

/* ---------- 打开 / 收藏 ---------- */

function openItem(item) {
  meta.markViewed(item.id, Date.now())
  router.push('/edit?lib=' + encodeURIComponent(item.id))
}

function toggleFavorite(item) {
  const on = meta.toggleFavorite(item.id)
  toast(on ? '已加入收藏夹' : '已取消收藏')
}

/* ---------- 分享 ---------- */

const shareItem = ref(null)
function openShare(item) { shareItem.value = item }
function closeShare() { shareItem.value = null }

/* ---------- 重命名 ---------- */

const renaming = ref(null)
const renameName = ref('')
const renameError = ref('')

function startRename(item) {
  renaming.value = item
  renameName.value = item.name
  renameError.value = ''
}

function confirmRename() {
  if (!renaming.value) return
  const res = lib.rename(renaming.value.id, renameName.value)
  if (!res.ok) {
    renameError.value = res.message
    return
  }
  renaming.value = null
  toast(strings.library.renamed)
}

/* ---------- 删除 ---------- */

const deleting = ref(null)

function startDelete(item) { deleting.value = item }

function confirmDelete() {
  if (!deleting.value) return
  const res = lib.remove(deleting.value.id)
  if (!res.ok) {
    toast(res.message)
    deleting.value = null
    return
  }
  meta.forget(deleting.value.id)
  deleting.value = null
  toast(strings.library.deleted)
}

/* ---------- 导入 ---------- */

const fileEl = ref(null)
const importing = ref(false)
const importError = ref('')

function pickFile() {
  importError.value = ''
  if (fileEl.value) fileEl.value.click()
}

function baseName(filename) {
  return String(filename || '导入的电路')
    .replace(/\.ff\.json$/i, '')
    .replace(/\.json$/i, '')
    .trim() || '导入的电路'
}

async function onFile(ev) {
  const file = ev.target.files && ev.target.files[0]
  ev.target.value = ''
  if (!file) return
  importing.value = true
  importError.value = ''
  try {
    const data = await readCircuitFile(file)
    const res = lib.save({ name: baseName(file.name), data })
    if (!res.ok) {
      importError.value = res.message
      return
    }
    meta.markOrigin(res.item.id, 'imported')
    filter.value = 'all'
    toast(strings.share.imported)
  } catch (err) {
    importError.value = err && err.message ? err.message : strings.errors.share.fileShape
  } finally {
    importing.value = false
  }
}

/* ---------- 轻提示 ---------- */

const tip = ref('')
let tipTimer = 0

function toast(text) {
  if (!text) return
  tip.value = text
  if (tipTimer) clearTimeout(tipTimer)
  tipTimer = setTimeout(() => { tip.value = '' }, 2200)
}

onBeforeUnmount(() => {
  if (tipTimer) clearTimeout(tipTimer)
})

/* ---------- 键盘 ---------- */

function onKey(ev) {
  if (ev.key !== 'Escape') return
  if (shareItem.value) { shareItem.value = null; return }
  if (renaming.value) { renaming.value = null; return }
  if (deleting.value) { deleting.value = null; return }
}

onMounted(() => {
  storageOk.value = lib.isAvailable()
  window.addEventListener('keydown', onKey)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
})

/* 任何一次写入失败(配额/不可用)都在页面顶部说清楚 */
watch(() => lib.items.value, () => {
  if (!lib.isAvailable()) storageOk.value = false
}, { deep: true })

const lastSavedLabel = computed(() => {
  const list = items.value
  if (!list.length) return ''
  const latest = list.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a))
  return relativeTime(latest.updatedAt) + '更新'
})
</script>

<template>
  <div class="ff-lib-page ff-paper-grid">
    <header class="ff-lib-nav">
      <div class="ff-lib-wrap ff-lib-nav-inner">
        <router-link to="/" class="ff-lib-brand" aria-label="FieldFlow 首页">
          <span class="brand-mark" aria-hidden="true">F</span>
          <span class="brand-word">FieldFlow</span>
        </router-link>

        <div class="ff-lib-nav-right">
          <router-link to="/" class="ff-btn ghost">主页</router-link>
          <button
            type="button"
            class="ff-btn ghost ff-lib-theme"
            :aria-label="theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'"
            @click="emit('toggle-theme')"
          >
            {{ theme === 'dark' ? '浅色' : '深色' }}
          </button>
        </div>
      </div>
    </header>

    <main class="ff-lib-wrap ff-lib-main">
      <section class="ff-lib-head">
        <div class="ff-lib-title-row">
          <div>
            <p class="ff-lib-eyebrow">
              <span class="eyebrow-rule" aria-hidden="true"></span>作品库
            </p>
            <h1 class="ff-lib-title">我的电路</h1>
            <p class="ff-lib-sub">
              电路存在这台浏览器的本地存储里。
              <span v-if="lastSavedLabel" class="ff-num">{{ lastSavedLabel }}</span>
            </p>
          </div>

          <div class="ff-lib-head-actions">
            <button type="button" class="ff-btn" :disabled="importing" @click="pickFile">
              {{ importing ? '导入中…' : strings.share.import }}
            </button>
            <button type="button" class="ff-btn primary" @click="router.push('/edit')">
              新建电路<span class="btn-arrow" aria-hidden="true">→</span>
            </button>
          </div>
        </div>

        <input
          ref="fileEl"
          class="ff-lib-file"
          type="file"
          accept=".json,.ff.json,application/json"
          @change="onFile"
        />

        <p v-if="!storageOk" class="ff-lib-alert" role="alert">
          {{ strings.library.unavailable }}
        </p>
        <p v-if="importError" class="ff-lib-alert error" role="alert">
          导入失败:{{ importError }}
        </p>

        <div class="ff-lib-toolbar">
          <div class="ff-lib-chips" role="group" aria-label="按来源筛选">
            <button
              v-for="f in FILTERS"
              :key="f.id"
              type="button"
              class="ff-lib-chip"
              :class="{ on: filter === f.id }"
              :aria-pressed="filter === f.id"
              @click="filter = f.id"
            >
              {{ f.label }}<span class="ff-lib-chip-n ff-num">{{ counts[f.id] }}</span>
            </button>
          </div>

          <div class="ff-lib-tools">
            <label class="ff-lib-sort">
              <span class="ff-lib-sort-label">排序</span>
              <select v-model="sort" class="ff-input ff-lib-select">
                <option v-for="s in SORTS" :key="s.id" :value="s.id">{{ s.label }}</option>
              </select>
            </label>

            <div class="ff-lib-viewtoggle" role="group" aria-label="切换视图">
              <button
                type="button"
                class="ff-lib-viewbtn"
                :class="{ on: view === 'grid' }"
                :aria-pressed="view === 'grid'"
                aria-label="网格视图"
                title="网格视图"
                @click="view = 'grid'"
              >
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <rect x="3" y="3" width="5.5" height="5.5" rx="1" />
                  <rect x="11.5" y="3" width="5.5" height="5.5" rx="1" />
                  <rect x="3" y="11.5" width="5.5" height="5.5" rx="1" />
                  <rect x="11.5" y="11.5" width="5.5" height="5.5" rx="1" />
                </svg>
              </button>
              <button
                type="button"
                class="ff-lib-viewbtn"
                :class="{ on: view === 'list' }"
                :aria-pressed="view === 'list'"
                aria-label="列表视图"
                title="列表视图"
                @click="view = 'list'"
              >
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <rect x="3" y="4" width="14" height="3" rx="1" />
                  <rect x="3" y="8.5" width="14" height="3" rx="1" />
                  <rect x="3" y="13" width="14" height="3" rx="1" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </section>

      <!-- 切换视图/筛选时重建内容并播放入场动画。
           不用 <transition> 的 out-in:离场一旦没收到 transitionend
           (后台标签页、减少动效、合成层被丢弃),新内容会被卡在门外。
           这里只做入场,内容始终立即可见。 -->
      <div :key="view + ':' + filter + ':' + sort" class="ff-lib-swap">
        <div
          v-if="filtered.length"
          class="ff-lib-content"
          :class="view === 'grid' ? 'ff-lib-grid' : 'ff-lib-list'"
        >
          <CircuitCard
            v-for="(item, i) in filtered"
            :key="item.id"
            :item="item"
            :index="i"
            :view="view"
            :favorite="meta.isFavorite(item.id)"
            :viewed-at="meta.viewedAt(item.id)"
            :imported="meta.originOf(item.id) === 'imported'"
            @open="openItem"
            @share="openShare"
            @rename="startRename"
            @remove="startDelete"
            @favorite="toggleFavorite"
          />
        </div>

        <div v-else class="ff-lib-empty">
          <div class="ff-lib-empty-art" aria-hidden="true">
            <svg viewBox="0 0 120 80">
              <path class="e-wire" d="M18 22 H102 V58 H18 Z" />
              <line class="e-sym" x1="10" y1="36" x2="26" y2="36" />
              <line class="e-sym" x1="13" y1="44" x2="23" y2="44" />
              <circle class="e-body" cx="60" cy="22" r="8" />
              <line class="e-sym thin" x1="54" y1="16" x2="66" y2="28" />
              <line class="e-sym thin" x1="54" y1="28" x2="66" y2="16" />
              <line class="e-dash" x1="18" y1="58" x2="46" y2="58" />
              <line class="e-dash" x1="74" y1="58" x2="102" y2="58" />
            </svg>
          </div>
          <h2 class="ff-lib-empty-title">{{ emptyText.title }}</h2>
          <p class="ff-lib-empty-text">{{ emptyText.text }}</p>
          <div class="ff-lib-empty-actions">
            <button type="button" class="ff-btn primary" @click="router.push('/edit')">
              新建电路<span class="btn-arrow" aria-hidden="true">→</span>
            </button>
            <button type="button" class="ff-btn" :disabled="importing" @click="pickFile">
              导入 .ff.json
            </button>
          </div>
        </div>
      </div>
    </main>

    <!-- ---------- 分享 ---------- -->
    <ShareDialog v-if="shareItem" :item="shareItem" @close="closeShare" />

    <!-- ---------- 重命名 ---------- -->
    <div v-if="renaming" class="ff-dialog-layer">
      <div class="ff-dialog-scrim" @click="renaming = null"></div>
      <div class="ff-dialog ff-rename-dialog" role="dialog" aria-modal="true" aria-labelledby="ff-rename-title">
        <header class="ff-dialog-head">
          <span class="ff-dialog-kicker">作品库</span>
          <h2 id="ff-rename-title" class="ff-dialog-title">{{ strings.library.renameTitle }}</h2>
          <button type="button" class="ff-dialog-close" aria-label="关闭" @click="renaming = null">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </header>
        <div class="ff-dialog-body">
          <label class="ff-field-label" for="ff-rename-name">{{ strings.library.nameLabel }}</label>
          <input
            id="ff-rename-name"
            v-model="renameName"
            class="ff-input"
            type="text"
            maxlength="60"
            autocomplete="off"
            @keydown.enter.prevent="confirmRename"
          />
          <p v-if="renameError" class="ff-dialog-error" role="alert">{{ renameError }}</p>
        </div>
        <footer class="ff-dialog-foot">
          <button type="button" class="ff-btn ghost" @click="renaming = null">{{ strings.library.cancel }}</button>
          <button type="button" class="ff-btn primary" @click="confirmRename">{{ strings.library.save }}</button>
        </footer>
      </div>
    </div>

    <!-- ---------- 删除确认 ---------- -->
    <div v-if="deleting" class="ff-dialog-layer">
      <div class="ff-dialog-scrim" @click="deleting = null"></div>
      <div class="ff-dialog ff-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="ff-del-title">
        <header class="ff-dialog-head">
          <span class="ff-dialog-kicker">删除</span>
          <h2 id="ff-del-title" class="ff-dialog-title">{{ deleting.name }}</h2>
        </header>
        <div class="ff-dialog-body">
          <p class="ff-confirm-text">{{ strings.library.deleteConfirm }}</p>
        </div>
        <footer class="ff-dialog-foot">
          <button type="button" class="ff-btn ghost" @click="deleting = null">{{ strings.library.cancel }}</button>
          <button type="button" class="ff-btn danger-solid" @click="confirmDelete">删除</button>
        </footer>
      </div>
    </div>

    <transition name="ff-lib-tip">
      <div v-if="tip" class="ff-lib-toast" role="status">{{ tip }}</div>
    </transition>
  </div>
</template>
