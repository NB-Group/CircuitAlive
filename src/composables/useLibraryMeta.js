/* FieldFlow · useLibraryMeta · 作品库的附加元数据
 *
 * useLibrary 只存电路本身(id/name/data/时间)。收藏、查看记录和来源
 * 单独放在这里,避免改动已经稳定的存储结构:
 *
 *   ff.library.meta.v1  { v: 1, favorites: {id: true}, viewed: {id: ts},
 *                         origin: {id: 'created' | 'imported'} }
 *
 * 键是电路 id。条目删除后调用 forget(id) 清掉,避免元数据越积越多。
 * localStorage 不可用时所有操作静默降级,读到的都是默认值。
 */
import { reactive } from 'vue'

const KEY = 'ff.library.meta.v1'

const state = reactive({
  favorites: {},
  viewed: {},
  origin: {}
})

let loaded = false

function store() {
  try {
    if (typeof localStorage === 'undefined' || !localStorage) return null
    return localStorage
  } catch (err) {
    return null
  }
}

function load() {
  if (loaded) return
  loaded = true
  const ls = store()
  if (!ls) return
  let raw
  try { raw = ls.getItem(KEY) } catch (err) { return }
  if (!raw) return
  try {
    const json = JSON.parse(raw)
    if (!json || typeof json !== 'object') return
    if (json.favorites && typeof json.favorites === 'object') {
      Object.keys(json.favorites).forEach((id) => {
        if (json.favorites[id]) state.favorites[id] = true
      })
    }
    if (json.viewed && typeof json.viewed === 'object') {
      Object.keys(json.viewed).forEach((id) => {
        const ts = Number(json.viewed[id])
        if (Number.isFinite(ts)) state.viewed[id] = ts
      })
    }
    if (json.origin && typeof json.origin === 'object') {
      Object.keys(json.origin).forEach((id) => {
        if (json.origin[id] === 'imported' || json.origin[id] === 'created') {
          state.origin[id] = json.origin[id]
        }
      })
    }
  } catch (err) {
    /* 损坏的元数据直接忽略,电路本身不受影响 */
  }
}

function persist() {
  const ls = store()
  if (!ls) return
  try {
    ls.setItem(KEY, JSON.stringify({
      v: 1,
      favorites: state.favorites,
      viewed: state.viewed,
      origin: state.origin
    }))
  } catch (err) {
    /* 配额或权限问题:元数据丢了不影响电路保存 */
  }
}

export function useLibraryMeta() {
  load()

  function isFavorite(id) {
    return !!state.favorites[id]
  }

  function toggleFavorite(id) {
    if (!id) return false
    if (state.favorites[id]) delete state.favorites[id]
    else state.favorites[id] = true
    persist()
    return !!state.favorites[id]
  }

  function viewedAt(id) {
    return state.viewed[id] || 0
  }

  function markViewed(id, ts) {
    if (!id) return
    state.viewed[id] = Number.isFinite(ts) ? ts : Date.now()
    persist()
  }

  function originOf(id) {
    return state.origin[id] || 'created'
  }

  function markOrigin(id, origin) {
    if (!id) return
    state.origin[id] = origin === 'imported' ? 'imported' : 'created'
    persist()
  }

  function forget(id) {
    if (!id) return
    delete state.favorites[id]
    delete state.viewed[id]
    delete state.origin[id]
    persist()
  }

  return {
    isFavorite,
    toggleFavorite,
    viewedAt,
    markViewed,
    originOf,
    markOrigin,
    forget
  }
}

export default useLibraryMeta
