/* CircuitAlive · bell-audio — 电铃音源(Web Audio 合成)
 *
 * 振幅数据由 render.js 的 bell 驱动逻辑给出(铃两端电压 / 3,截到 0~1),
 * 这里只负责把 0~1 的振幅变成声音:
 *   - 铃壳:两路失谐正弦(2.65k / 3.17k Hz,非整数比才有金属感)
 *   - 连续敲击感:28Hz 方波对增益做幅度调制,模拟锤快速来回打
 *   - 音量随振幅平滑变化,断电(振幅归 0)约 120ms 内收掉
 *
 * 浏览器自动播放策略:首次用户手势时创建/resume AudioContext。
 * 页面里没有任何交互之前电路也不会动,所以解锁时机天然满足。
 *
 * 全局开关走 bus 'bell-sound'(true/false),默认开。
 */
import { bus } from './util.js';

/* 每个电铃实例一条声音链 */
function makeVoice(ctx, out) {
  const ringGain = ctx.createGain();
  ringGain.gain.value = 0;
  ringGain.connect(out);

  /* 28Hz 方波 LFO 做断续(锤的敲击率)。
     ringGain.gain 同时收到基准值(参数值)和 LFO 信号(音频率),
     两者相加正好是"有底值 + 摆动"的断续包络。 */
  const lfoDepth = ctx.createGain();
  lfoDepth.gain.value = 0;
  const lfo = ctx.createOscillator();
  lfo.type = 'square';
  lfo.frequency.value = 28;
  lfo.connect(lfoDepth);
  lfoDepth.connect(ringGain.gain);
  lfo.start();

  const oscs = [];
  [[2650, 0.5], [3170, 0.42], [5230, 0.1]].forEach(([f, w]) => {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.value = w;
    o.connect(g);
    g.connect(ringGain);
    o.start();
    oscs.push(o);
  });

  return {
    /* level 0~1。0.7 次方让小音量段也更听得见;起音快、收音稍慢 */
    set(level) {
      const t = ctx.currentTime;
      const amp = Math.max(0, Math.min(1, level));
      const peak = Math.pow(amp, 0.7) * 0.15;
      const half = peak * 0.5;
      const tc = amp > 0 ? 0.03 : 0.06;
      ringGain.gain.setTargetAtTime(half, t, tc);
      lfoDepth.gain.setTargetAtTime(half, t, tc);
    },
    stop() {
      const t = ctx.currentTime;
      ringGain.gain.setTargetAtTime(0, t, 0.04);
      lfoDepth.gain.setTargetAtTime(0, t, 0.04);
    }
  };
}

export function createBellAudio() {
  let ctx = null;
  let master = null;
  let enabled = true;
  const voices = new Map();   /* edgeId -> voice */

  function ensure() {
    if (ctx || typeof AudioContext === 'undefined' && typeof webkitAudioContext === 'undefined') return ctx;
    const AC = typeof AudioContext !== 'undefined' ? AudioContext : webkitAudioContext;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = enabled ? 1 : 0;
      master.connect(ctx.destination);
    } catch (e) { ctx = null }
    return ctx;
  }

  function unlock() {
    if (!ensure()) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
  }

  const onSound = (on) => {
    enabled = !!on;
    if (master && ctx) master.gain.setTargetAtTime(enabled ? 1 : 0, ctx.currentTime, 0.02);
  };
  bus.on('bell-sound', onSound);

  return {
    setLevel(id, level) {
      if (!ctx) {
        if (level <= 0.02) return;
        if (!ensure()) return;
      }
      let v = voices.get(id);
      if (level > 0.02) {
        if (!v) { v = makeVoice(ctx, master); voices.set(id, v) }
        v.set(level);
      } else if (v) {
        v.set(0);
      }
    },
    /* 结构变化(删元件/清空画布)后统一收声并释放声音链,
       下一帧 solution 会按当前电铃重新建。 */
    allOff() {
      voices.forEach((v) => v.stop());
      voices.clear();
    },
    dispose() {
      bus.off('bell-sound', onSound);
      voices.forEach((v) => v.stop());
      voices.clear();
      if (ctx) { try { ctx.close() } catch (e) {} ctx = null; master = null }
      if (typeof window !== 'undefined') {
        window.removeEventListener('pointerdown', unlock, { capture: true });
        window.removeEventListener('keydown', unlock, { capture: true });
      }
    }
  };
}
