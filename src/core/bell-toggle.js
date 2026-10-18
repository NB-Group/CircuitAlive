/* CircuitAlive · bell-toggle — 电铃声音开关
 *
 * 单独成文件而不是塞进 bell-audio:后者只在渲染器创建时实例化,
 * 而顶栏按钮在挂载时就要读初始状态,还不能触发 AudioContext 创建
 * (浏览器把它算成无手势的音频初始化,会留下 suspended 的上下文)。
 */
import { bus } from './util.js'

const KEY = 'ff.bellSound.v1'

export function bellSoundOn() {
  try { return localStorage.getItem(KEY) !== '0' } catch (e) { return true }
}

export function setBellSound(on) {
  bus.emit('bell-sound', !!on)
  try { localStorage.setItem(KEY, on ? '1' : '0') } catch (e) {}
}
