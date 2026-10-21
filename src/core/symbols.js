/* CircuitAlive · symbols — 人教版教科书风格的电路符号(ESM)
 *
 * 所有符号在局部坐标系里绘制:边从 (-20,0) 到 (+20,0),+x = 边方向 a→b。
 * render 层对 <g> 施加 rotate(angle)。
 *
 * 文字策略:build(type, angle, props, { text:false }) 供画布使用 —— 画布上的
 * 字母(A/V/M)由 render 的未旋转文字层统一摆放,避免 rotate(-angle) 在不同
 * 朝向下把字挤到中点的上方/左侧。元件栏图标仍用内置文字(angle=0)。
 *
 * 动态部件用 data-hook 标记,render 拿引用做原位更新:
 *   lever 开关杠杆 · glow 灯泡光晕 · wiper/wiper-knob 滑片
 *   rotor 电动机转子 · bell 电铃摇动组
 */
import { T, GRID, clamp, lerp, svgEl } from './util.js';

const HALF = GRID / 2; /* 20:局部坐标半径 */

function el(name, attrs, parent) { return svgEl(name, attrs, parent); }
function line(g, x1, y1, x2, y2, cls) {
  return el('line', { x1: x1, y1: y1, x2: x2, y2: y2, class: cls || '' }, g);
}
function dot(g, cx, cy, r) { return el('circle', { cx: cx, cy: cy, r: r, class: 'junction-dot' }, g); }

/* 文字保持正立:抵消外层旋转(仅元件栏/旧式静态用法) */
function text(g, x, y, str, size, angle, attrs) {
  const t = el('text', Object.assign({
    x: x, y: y, 'font-size': size,
    'text-anchor': 'middle',
    transform: 'rotate(' + (-angle) + ' ' + x + ' ' + y + ')'
  }, attrs || {}), g);
  t.textContent = str;
  return t;
}

function stubs(g) {
  line(g, -HALF, 0, -14, 0);
  line(g, 14, 0, HALF, 0);
}

/* ---- 各元件符号(angle 为边方向角,度) ---- */

const BUILDERS = {};

BUILDERS[T.WIRE] = function (g) {
  line(g, -HALF, 0, HALF, 0, 'wire-line');
};

/* 干电池:长线 = 正极(在 b 端,局部 +x),短粗线 = 负极 */
BUILDERS[T.BATTERY] = function (g, angle, props, showText) {
  line(g, -HALF, 0, -4, 0);
  line(g, 4, 0, HALF, 0);
  line(g, 4, -8, 4, 8);                      /* 长细线:正极 */
  line(g, -4, -4.5, -4, 4.5, 'thick');       /* 短粗线:负极 */
  if (showText) text(g, 11.5, -6.5, '+', 10, angle);
};

/* 开关:两个接线柱点 + 杠杆(开:上翘;合:水平)。lever 由 render 动态更新 */
BUILDERS[T.SWITCH] = function (g, angle, props) {
  line(g, -HALF, 0, -7, 0);
  line(g, 7, 0, HALF, 0);
  dot(g, -7, 0, 1.8);
  dot(g, 7, 0, 1.8);
  const lever = line(g, -7, 0, 5.4, -8.5);
  lever.setAttribute('data-hook', 'lever');
};

/* 定值电阻:空矩形(IEC / 人教版) */
BUILDERS[T.RESISTOR] = function (g) {
  stubs(g);
  el('rect', { x: -11, y: -6.5, width: 22, height: 13, class: 'fill-paper' }, g);
};

/* 小灯泡:圆圈内打叉 + 暖色泛光 + 白热核。
 * 亮度连续受控,稳定通电时不闪烁(白炽灯不该抖)。 */
BUILDERS[T.LAMP] = function (g) {
  line(g, -HALF, 0, -8.5, 0);
  line(g, 8.5, 0, HALF, 0);
  el('circle', { cx: 0, cy: 0, r: 8.5, class: 'fill-paper' }, g);
  line(g, -6, -6, 6, 6, 'thin');
  line(g, -6, 6, 6, -6, 'thin');

  const glow = el('g', { class: 'lamp-glow', opacity: 0 }, g);
  glow.setAttribute('data-hook', 'glow');

  /* 泛光(紧贴灯泡的暖色光晕,不做大范围纸面投影) */
  el('circle', {
    cx: 0, cy: 0, r: 10.5, fill: '#ffca66', filter: 'url(#lamp-bloom)',
    'data-part': 'bloom', opacity: 0
  }, glow);
  /* 白热核 */
  el('circle', {
    cx: 0, cy: 0, r: 3, fill: 'url(#lamp-core)',
    'data-part': 'core', opacity: 0
  }, glow);
  /* 灯丝(与墨色叉线重合的暖色发光副本) */
  const f1 = line(glow, -6, -6, 6, 6, 'lamp-filament');
  const f2 = line(glow, -6, 6, 6, -6, 'lamp-filament');
  f1.setAttribute('data-part', 'filament');
  f2.setAttribute('data-part', 'filament');
};

/* 滑动变阻器(课本标准画法):
 *   长方形电阻体居中;左接线柱从格边直接接到长方形的左端中点;
 *   长方形右端悬空(课本里滑变的另一个固定接线柱不用)。
 *   右接线柱从格边水平进来,在长方形右侧留出一段空隙后直角向上,
 *   再向左绕过顶部,向下落成一根细竖杆,末端是开口 V 形箭头,
 *   箭头尖垂直戳在长方形的上长边上。
 *
 *   要害:绕行导线的外端向外折到格边,不许再连回长方形右端 ——
 *   连回去等于把滑片端和固定端短接(用户 2026-10-21 草图指出)。
 *
 * 整个符号必须留在 ±HALF(20) 的格子里,否则会和相邻导线重叠。
 * 局部坐标:x 沿元件方向,y 负方向为"上方"。 */
const RH_L = -9;           /* 长方形左边 */
const RH_R = 9;            /* 长方形右边 */
const RH_HH = 5;           /* 半高 */
const RH_STUB = 15;        /* 右接线柱折点 x(向上) */
const RH_TOP = -13;        /* 顶部绕行高度 */
const RH_WX0 = -7, RH_WX1 = 7;   /* 滑片尖可达范围 */

BUILDERS[T.RHEOSTAT] = function (g, angle, props) {
  /* 左接线柱:格边 → 长方形左端中点 */
  line(g, -HALF, 0, RH_L, 0);

  /* 长方形电阻体(右端不接线) */
  el('rect', {
    x: RH_L, y: -RH_HH,
    width: RH_R - RH_L, height: RH_HH * 2,
    class: 'fill-paper'
  }, g);

  const w = clamp(props && props.wiper == null ? 1 : props.wiper, 0, 1);
  const wx = lerp(RH_WX0, RH_WX1, w);

  /* 右接线柱:格边水平进来 → 在长方形右侧的空隙处直角向上 →
   * 绕过顶部 → 细竖杆落到箭头上。
   * 注意不要从长方形右端引线,否则滑片端和固定端就短接了。 */
  el('path', {
    d: 'M ' + HALF + ' 0 L ' + RH_STUB + ' 0 L ' + RH_STUB + ' ' + RH_TOP +
       ' L ' + wx + ' ' + RH_TOP + ' L ' + wx + ' ' + (-RH_HH),
    class: 'thin rheo-over',
    fill: 'none'
  }, g);

  /* 箭头:细线 + 开口 V 形箭头(课本画法),尖戳在上长边上 */
  const tip = el('path', {
    d: 'M ' + (wx - 2.6) + ' ' + (-RH_HH - 4.6) +
       ' L ' + wx + ' ' + (-RH_HH) +
       ' L ' + (wx + 2.6) + ' ' + (-RH_HH - 4.6),
    class: 'rheo-arrow',
    fill: 'none'
  }, g);
  tip.setAttribute('stroke-width', '1.6');
  tip.setAttribute('stroke-linecap', 'round');
  tip.setAttribute('stroke-linejoin', 'round');
  tip.setAttribute('data-hook', 'wiper');
};

/* 电流表 / 电压表:圆圈 + 字母;读数文字由 render 层放到符号下方 */
function meter(g, angle, letter, showText) {
  line(g, -HALF, 0, -9.5, 0);
  line(g, 9.5, 0, HALF, 0);
  el('circle', { cx: 0, cy: 0, r: 9.5, class: 'fill-paper' }, g);
  if (showText) text(g, 0, 4, letter, 11, angle);
}
BUILDERS[T.AMMETER] = function (g, angle, props, showText) { meter(g, angle, 'A', showText); };
BUILDERS[T.VOLTMETER] = function (g, angle, props, showText) { meter(g, angle, 'V', showText); };

/* 电动机:圆圈 + 字母 M + 转子标记(虚线环 + 两段径向短线,通电时旋转)。
 * 字母由 render 的未旋转文字层画在圆心;这里的径向线只落在字母上下的
 * 空白扇区里,不穿过 M,避免 90°/270° 时糊成一团。 */
BUILDERS[T.MOTOR] = function (g, angle, props, showText) {
  line(g, -HALF, 0, -9.5, 0);
  line(g, 9.5, 0, HALF, 0);
  el('circle', { cx: 0, cy: 0, r: 9.5, class: 'fill-paper' }, g);
  const rotor = el('g', { class: 'motor-rotor' }, g);
  rotor.setAttribute('data-hook', 'rotor');
  el('circle', {
    cx: 0, cy: 0, r: 7.8, class: 'thin motor-rotor-ring',
    'stroke-dasharray': '2 5.2'
  }, rotor);
  line(rotor, 0, -5.9, 0, -7.8, 'thin');
  line(rotor, 0, 5.9, 0, 7.8, 'thin');
  if (showText) text(g, 0, 4, 'M', 11, angle);
};

/* 电铃:上置半圆铃壳,直径两端各向下一根线接到导线(课本画法)。
   铃壳与两根引线单独成组,通电时按振幅摇动。 */
BUILDERS[T.BELL] = function (g) {
  line(g, -HALF, 0, -9, 0);
  line(g, 9, 0, HALF, 0);
  const bell = el('g', { class: 'bell-shake' }, g);
  bell.setAttribute('data-hook', 'bell');
  el('path', {
    d: 'M -9 -3 A 9 9 0 0 1 9 -3 Z',
    class: 'fill-paper'
  }, bell);
  line(bell, -9, -3, -9, 0);
  line(bell, 9, -3, 9, 0);
};

/* 橡皮(仅元件栏图标,画布上不出现) */
BUILDERS.eraser = function (g) {
  const r = el('g', { transform: 'rotate(-18)' }, g);
  el('rect', { x: -8, y: -6, width: 16, height: 11, rx: 1.5, class: 'fill-paper' }, r);
  line(r, -8, -0.5, 8, -0.5, 'thin');
};

/* ---- 动态部件 ---- */

/* 开关杠杆:240ms 带过冲回弹(闸刀合闸的机械甩动) */
function setLever(hookEl, closed) {
  if (!hookEl) return;
  const to = closed ? { x: 7, y: 0 } : { x: 5.4, y: -8.5 };
  let from = {
    x: parseFloat(hookEl.getAttribute('x2')),
    y: parseFloat(hookEl.getAttribute('y2'))
  };
  if (!isFinite(from.x)) from = { x: 5.4, y: -8.5 };
  if (hookEl.__raf) cancelAnimationFrame(hookEl.__raf);
  const t0 = (typeof performance !== 'undefined') ? performance.now() : 0;
  function frame(now) {
    const t = Math.min(1, ((now || t0 + 240) - t0) / 240);
    /* easeOutBack:冲过头一点再回位 */
    const c1 = 1.70158, c3 = c1 + 1;
    const e = 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    hookEl.setAttribute('x2', from.x + (to.x - from.x) * e);
    hookEl.setAttribute('y2', from.y + (to.y - from.y) * e);
    if (t < 1) hookEl.__raf = requestAnimationFrame(frame);
    else hookEl.__raf = 0;
  }
  hookEl.__raf = requestAnimationFrame(frame);
}

/* 滑片位置(0..1):顶部绕行线的末端与箭头一起平移 */
function setWiper(hooks, wiper) {
  const tip = hooks && hooks.wiper;
  if (!tip || !tip.setAttribute) return;
  const x = lerp(RH_WX0, RH_WX1, clamp(wiper == null ? 1 : wiper, 0, 1));
  tip.setAttribute('d',
    'M ' + (x - 2.6) + ' ' + (-RH_HH - 4.6) +
    ' L ' + x + ' ' + (-RH_HH) +
    ' L ' + (x + 2.6) + ' ' + (-RH_HH - 4.6));
  const path = tip.parentNode && tip.parentNode.querySelector('path.rheo-over');
  if (path) {
    path.setAttribute('d',
      'M ' + HALF + ' 0 L ' + RH_STUB + ' 0 L ' + RH_STUB + ' ' + RH_TOP +
      ' L ' + x + ' ' + RH_TOP + ' L ' + x + ' ' + (-RH_HH));
  }
}

/* 灯泡光晕强度(0..1.2,可过曝):暖色泛光 + 白热核 + 纸面投影光。
 * 泛光带模糊滤镜,半径随功率放大;纸面光透明度压得很低,只做"照亮周围"
 * 的氛围,不参与亮度编码。 */
function setGlow(hookEl, k) {
  if (!hookEl) return;
  k = clamp(k, 0, 1.2);
  hookEl.setAttribute('opacity', Math.min(1, k * 1.05).toFixed(3));
  const bloom = hookEl.querySelector('[data-part="bloom"]');
  const core = hookEl.querySelector('[data-part="core"]');
  if (bloom) {
    bloom.setAttribute('r', (8.2 + 3.4 * k).toFixed(1));
    bloom.setAttribute('opacity', (k * 0.62).toFixed(3));
  }
  if (core) {
    core.setAttribute('r', (2.6 + 5.2 * k).toFixed(1));
    core.setAttribute('opacity', Math.min(1, k * 1.4).toFixed(3));
  }
  const filaments = hookEl.querySelectorAll('[data-part="filament"]');
  for (let i = 0; i < filaments.length; i++) {
    filaments[i].setAttribute('opacity', Math.min(1, k * 1.25).toFixed(3));
  }
}

/* 电动机转子:rpm 可正可负(转向随电流反向)。每台电机独立 rAF,
 * rpm≈0 时立即停表,不留下空转的动画循环。 */
function setSpin(hookEl, rpm) {
  if (!hookEl) return;
  const r = +rpm || 0;
  hookEl.__spinRpm = r;
  if (Math.abs(r) < 0.5) {
    if (hookEl.__spinRaf) { cancelAnimationFrame(hookEl.__spinRaf); hookEl.__spinRaf = 0; }
    return;
  }
  if (hookEl.__spinRaf) return; /* 已在转,只更新目标转速 */
  hookEl.__spinLast = performance.now();
  function step(now) {
    if (!hookEl.isConnected || Math.abs(hookEl.__spinRpm || 0) < 0.5) {
      hookEl.__spinRaf = 0;
      return;
    }
    const dt = Math.min(0.05, (now - hookEl.__spinLast) / 1000);
    hookEl.__spinLast = now;
    /* rpm → 度/秒:1 转 = 360° */
    hookEl.__spinAngle = ((hookEl.__spinAngle || 0) + hookEl.__spinRpm * 6 * dt) % 360;
    hookEl.setAttribute('transform', 'rotate(' + hookEl.__spinAngle.toFixed(2) + ')');
    hookEl.__spinRaf = requestAnimationFrame(step);
  }
  hookEl.__spinRaf = requestAnimationFrame(step);
}

/* 电铃摇动:amplitude 0..1;0 = 完全静止(动画暂停在零位) */
function setRing(hookEl, amplitude) {
  if (!hookEl) return;
  const a = clamp(+amplitude || 0, 0, 1);
  hookEl.style.setProperty('--ring-amp', a.toFixed(3));
  hookEl.style.animationPlayState = a > 0.02 ? 'running' : 'paused';
}

/* ---- 对外接口 ---- */

export const symbols = {
  /* 构建一个元件的符号组(不含导线),返回 <g class="sym"> */
  build(type, angle, props, options) {
    const g = svgEl('g', { class: 'sym' });
    const showText = !options || options.text !== false;
    (BUILDERS[type] || BUILDERS[T.WIRE])(g, angle || 0, props || {}, showText);
    return g;
  },

  /* 边方向角(dx,dy → 度) */
  angleOf(a, b) {
    return Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
  },

  setLever,
  setWiper,
  setGlow,
  setSpin,
  setRing,

  /* ---- 元件栏图标(56×36,静态示意) ---- */
  paletteIcon(type, props) {
    /* 元件栏图标自带内联样式:不依赖外部 CSS,颜色跟随主题变量 */
    const svg = svgEl('svg', {
      width: 56, height: 36, viewBox: '-30 -22 60 44',
      'aria-hidden': 'true',
      style: 'color: currentColor'
    });
    const g = svgEl('g', {
      class: 'sym',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 1.5,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round'
    }, svg);
    (BUILDERS[type] || BUILDERS[T.WIRE])(g, 0, props || {}, true);
    /* fill-paper 的圆盘在图标里改为透明描边,避免无 CSS 时变实心 */
    g.querySelectorAll('.fill-paper').forEach(el => {
      el.setAttribute('fill', 'none');
      el.setAttribute('stroke', 'currentColor');
    });
    return svg;
  },

  /* 元件栏定义(顺序即展示顺序) */
  PALETTE: [
    { type: T.WIRE,      name: '导线' },
    { type: T.BATTERY,   name: '电池', props: { V: 3 } },
    { type: T.SWITCH,    name: '开关', props: { closed: false } },
    { type: T.RESISTOR,  name: '电阻', props: { R: 10 } },
    { type: T.LAMP,      name: '灯泡', props: { R: 10 } },
    { type: T.RHEOSTAT,  name: '滑变', props: { Rmax: 50, wiper: 0.5 } },
    { type: T.AMMETER,   name: '电流表' },
    { type: T.VOLTMETER, name: '电压表' },
    { type: T.MOTOR,     name: '电动机' },
    { type: T.BELL,      name: '电铃' },
    { type: 'eraser',    name: '橡皮' }
  ]
};

export { setLever, setWiper, setGlow, setSpin, setRing };
export const PALETTE = symbols.PALETTE;
