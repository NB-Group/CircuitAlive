/* CircuitAlive · useOnboarding · 新手教程的"看过没有"状态
 *
 * 只存一个键:ff.onboarding.v1 = { done: true }
 * localStorage 不可用(隐私模式)时退化为内存标记,本次会话内不再弹。
 */
import { ref } from 'vue'

const KEY = 'ff.onboarding.v1'
const done = ref(false)
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
  try {
    const raw = ls.getItem(KEY)
    if (!raw) return
    const json = JSON.parse(raw)
    done.value = !!(json && json.done)
  } catch (err) {
    /* 损坏就当没看过 */
  }
}

export function useOnboarding() {
  load()

  function seen() {
    load()
    return done.value
  }

  function markSeen() {
    load()
    done.value = true
    const ls = store()
    if (ls) {
      try { ls.setItem(KEY, JSON.stringify({ done: true })) } catch (err) { /* 忽略 */ }
    }
  }

  function reset() {
    load()
    done.value = false
    const ls = store()
    if (ls) {
      try { ls.removeItem(KEY) } catch (err) { /* 忽略 */ }
    }
  }

  return { done, seen, markSeen, reset }
}
