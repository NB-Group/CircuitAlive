/* CircuitAlive · useLibrary · 浏览器本地的电路收藏夹
 *
 * 存储结构(localStorage,两个键):
 *   ff.library.v1  { v: 1, items: [{ id, name, data, createdAt, updatedAt }] }
 *   ff.draft.v1    { v: 1, data, circuitId, savedAt }
 *
 * data 一律存成 { v, wireR, edges } 的规范化形式,与分享码、.ff.json 同一套
 * 校验规则。列表用 Vue 的 ref 暴露,组件直接绑定即可。
 *
 * 浏览器禁用 localStorage(隐私模式、iframe 限制)时所有写操作返回
 * { ok: false, error: 'unavailable' },读操作返回空列表,不抛异常。
 */

import { ref, readonly } from 'vue'
import { serializeCircuit, SCHEMA_VERSION } from '../core/share.js'
import { copy } from '../data/copy.js'

const LIB_KEY = 'ff.library.v1'
const DRAFT_KEY = 'ff.draft.v1'
const MAX_ITEMS = 50
const MAX_NAME = 60

/* 模块级单例:同一页面里多个组件共享一份列表 */
const items = ref([])
const draft = ref(null)
const ready = ref(false)
let loaded = false

function store() {
  try {
    if (typeof localStorage === 'undefined' || !localStorage) return null
    return localStorage
  } catch (err) {
    return null
  }
}

function readRaw(key) {
  const ls = store()
  if (!ls) return null
  try {
    return ls.getItem(key)
  } catch (err) {
    return null
  }
}

function writeRaw(key, text) {
  const ls = store()
  if (!ls) return { ok: false, error: 'unavailable' }
  try {
    ls.setItem(key, text)
    return { ok: true }
  } catch (err) {
    /* 配额超限:多数浏览器抛 QuotaExceededError,部分只给 code 22 */
    const quota =
      err &&
      (err.name === 'QuotaExceededError' ||
        err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
        err.code === 22 ||
        err.code === 1014)
    return { ok: false, error: quota ? 'quota' : 'unavailable' }
  }
}

function removeRaw(key) {
  const ls = store()
  if (!ls) return { ok: false, error: 'unavailable' }
  try {
    ls.removeItem(key)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: 'unavailable' }
  }
}

function fail(error) {
  return { ok: false, error, message: messageFor(error) }
}

function messageFor(error) {
  if (error === 'quota') return copy.library.quota
  if (error === 'unavailable') return copy.library.unavailable
  if (error === 'max') return copy.library.maxReached
  if (error === 'name') return copy.library.invalidName
  if (error === 'data') return copy.library.invalidData
  return ''
}

function normalizeData(data) {
  try {
    const clean = serializeCircuit(data)
    return { v: SCHEMA_VERSION, wireR: clean.wireR, edges: clean.edges }
  } catch (err) {
    return null
  }
}

function cleanName(name) {
  if (typeof name !== 'string') return null
  const trimmed = name.trim().replace(/\s+/g, ' ')
  if (!trimmed) return null
  return trimmed.slice(0, MAX_NAME)
}

function newId() {
  const t = Date.now().toString(36)
  const r = Math.random().toString(36).slice(2, 8)
  return 'c_' + t + '_' + r
}

function parseLibrary(text) {
  if (!text) return []
  let json
  try {
    json = JSON.parse(text)
  } catch (err) {
    return []
  }
  if (!json || typeof json !== 'object' || !Array.isArray(json.items)) return []
  const out = []
  json.items.forEach((item) => {
    if (!item || typeof item !== 'object') return
    const data = normalizeData(item.data)
    if (!data) return
    const name = cleanName(item.name)
    if (!name) return
    out.push({
      id: typeof item.id === 'string' ? item.id : newId(),
      name,
      data,
      createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
      updatedAt: Number.isFinite(item.updatedAt) ? item.updatedAt : Date.now()
    })
  })
  return out
}

function persist() {
  const payload = { v: SCHEMA_VERSION, items: items.value }
  return writeRaw(LIB_KEY, JSON.stringify(payload))
}

function load() {
  if (loaded) return
  loaded = true
  const list = parseLibrary(readRaw(LIB_KEY))
  list.sort((a, b) => b.updatedAt - a.updatedAt)
  items.value = list
  const draftText = readRaw(DRAFT_KEY)
  if (draftText) {
    try {
      const d = JSON.parse(draftText)
      const data = d && normalizeData(d.data)
      if (data) {
        draft.value = {
          data,
          circuitId: typeof d.circuitId === 'string' ? d.circuitId : null,
          savedAt: Number.isFinite(d.savedAt) ? d.savedAt : null
        }
      }
    } catch (err) {
      draft.value = null
    }
  }
  ready.value = true
}

/* ---------- 公开接口 ---------- */

export function useLibrary() {
  load()

  function list() {
    load()
    return items.value.slice()
  }

  function get(id) {
    load()
    return items.value.find((x) => x.id === id) || null
  }

  function save({ name, data } = {}) {
    load()
    const clean = cleanName(name)
    if (!clean) return fail('name')
    const normalized = normalizeData(data)
    if (!normalized) return fail('data')
    if (items.value.length >= MAX_ITEMS) return fail('max')

    const now = Date.now()
    const item = {
      id: newId(),
      name: clean,
      data: normalized,
      createdAt: now,
      updatedAt: now
    }
    const next = [item].concat(items.value)
    const prev = items.value
    items.value = next
    const res = persist()
    if (!res.ok) {
      items.value = prev
      return fail(res.error)
    }
    return { ok: true, item, message: copy.library.saved }
  }

  /* 覆盖已有条目(手动保存到同一个 id) */
  function update(id, patch = {}) {
    load()
    const idx = items.value.findIndex((x) => x.id === id)
    if (idx < 0) return fail('data')

    let name = items.value[idx].name
    if (patch.name !== undefined) {
      name = cleanName(patch.name)
      if (!name) return fail('name')
    }
    let data = items.value[idx].data
    if (patch.data !== undefined) {
      data = normalizeData(patch.data)
      if (!data) return fail('data')
    }

    const prev = items.value
    const next = prev.slice()
    next[idx] = { ...prev[idx], name, data, updatedAt: Date.now() }
    next.sort((a, b) => b.updatedAt - a.updatedAt)
    items.value = next
    const res = persist()
    if (!res.ok) {
      items.value = prev
      return fail(res.error)
    }
    return { ok: true, item: next.find((x) => x.id === id), message: copy.library.saved }
  }

  function remove(id) {
    load()
    const prev = items.value
    const next = prev.filter((x) => x.id !== id)
    if (next.length === prev.length) return fail('data')
    items.value = next
    const res = persist()
    if (!res.ok) {
      items.value = prev
      return fail(res.error)
    }
    if (draft.value && draft.value.circuitId === id) {
      draft.value = { ...draft.value, circuitId: null }
      writeRaw(DRAFT_KEY, JSON.stringify({ v: SCHEMA_VERSION, ...draft.value }))
    }
    return { ok: true, message: copy.library.deleted }
  }

  function rename(id, name) {
    return update(id, { name })
  }

  /* ---------- 自动保存草稿 ---------- */

  function saveDraft(data, circuitId) {
    const normalized = normalizeData(data)
    if (!normalized) return fail('data')
    const payload = {
      data: normalized,
      circuitId: typeof circuitId === 'string' ? circuitId : null,
      savedAt: Date.now()
    }
    const res = writeRaw(DRAFT_KEY, JSON.stringify({ v: SCHEMA_VERSION, ...payload }))
    if (!res.ok) return fail(res.error)
    draft.value = payload
    return { ok: true }
  }

  function loadDraft() {
    load()
    return draft.value ? { ...draft.value, data: draft.value.data } : null
  }

  function clearDraft() {
    const res = removeRaw(DRAFT_KEY)
    if (!res.ok) return fail(res.error)
    draft.value = null
    return { ok: true }
  }

  function isAvailable() {
    return store() !== null
  }

  return {
    items: readonly(items),
    draft: readonly(draft),
    ready: readonly(ready),
    list,
    get,
    save,
    update,
    remove,
    rename,
    saveDraft,
    loadDraft,
    clearDraft,
    isAvailable,
    MAX_ITEMS,
    STORAGE_KEY: LIB_KEY
  }
}

export default useLibrary
