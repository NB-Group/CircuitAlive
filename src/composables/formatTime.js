/* FieldFlow · formatTime — 中文相对时间
 *
 * 只做一件事:把时间戳变成「刚刚 / 5 分钟前 / 3 天前 / 2 个月前」。
 * 调用方自己拼后面的动词(已查看 / 已保存),这里不掺业务词。
 */

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const MONTH = 30 * DAY
const YEAR = 365 * DAY

export function relativeTime(ts, now) {
  const t = Number(ts)
  if (!Number.isFinite(t) || t <= 0) return ''
  const base = Number.isFinite(now) ? now : Date.now()
  const d = Math.max(0, base - t)

  if (d < MINUTE) return '刚刚'
  if (d < HOUR) return Math.floor(d / MINUTE) + ' 分钟前'
  if (d < DAY) return Math.floor(d / HOUR) + ' 小时前'
  if (d < MONTH) return Math.floor(d / DAY) + ' 天前'
  if (d < YEAR) return Math.max(1, Math.floor(d / MONTH)) + ' 个月前'
  return Math.max(1, Math.floor(d / YEAR)) + ' 年前'
}

export default relativeTime
