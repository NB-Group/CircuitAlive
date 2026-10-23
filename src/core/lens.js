/* CircuitAlive · lens — 真实物理模式的显微镜头(DOM/交互/绘制)
 *
 * 结构:.ff-canvas 下(与 .ff-scene-wrap 平级,检查器模糊不影响它):
 *   div.ff-lens
 *     div.ff-lens-body   132px 圆,overflow hidden,内含专用 canvas
 *     div.ff-lens-chip   镜头下方读数条(等宽字体)
 *
 * 状态机(自听 window 指针,画布组件零改动):
 *   follow  镜头 = 指针 + 偏移;指针移进镜头圆内 → 悬停冻结(不逃跑,可点)
 *   pinned  点镜头钉住;拖动可移;再点取消。锚点存世界坐标,平移缩放跟随
 *
 * 镜头局部坐标:原点 = 圆心,+x = 目标边 a→b(镜头沿导线滑动视图不旋转)。
 * 微观模拟在 micro.js(纯),本文件只做 retarget / 绘制 / HUD。
 *
 * 物理立场:不逐电荷求和 —— 指定电子上的合场强箭头画的就是宏观合场
 * (E=U/L),它正是全电路表面电荷叠加的结果。
 */

import { T, TYPE_NAME, GRID, clamp, fmt } from './util.js';
import {
  lensKindOf, lensFacts, scatterRateOf, createLensSim, mulberry32
} from './micro.js';
import { solver } from './solver.js';

const R_PX = 66;                 /* 镜头半径(px) */
const OFFSET = [86, -78];       /* follow 态相对指针的偏移 */
const OPEN_I = 1e-6;

/* 颜色从 CSS 变量取,深色主题自动跟随 */
function cssVar(name, fallback) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch (err) { return fallback; }
}

export function createLens(host, deps) {
  const { screenToWorld, hitEdge, view, getModel, getSol, getOpts } = deps;

  /* ---------- DOM ---------- */
  let built = false;
  let root = null, body = null, cv = null, ctx = null, chip = null;
  let dpr = 1;
  let destroyed = false;

  /* ---------- 状态 ---------- */
  let active = false;
  let pinned = false;
  let drag = null;                    /* { id, moved, dx, dy } */
  let lastPtr = null;                 /* 最近一次指针(屏幕 px,画布内) */
  let pos = { x: 0, y: 0 };           /* 镜头圆心(屏幕 px,相对 host) */
  let anchor = null;                  /* pinned 世界坐标 */
  let targetKey = null;               /* 当前目标边 key */
  let targetEdge = null;
  let kind = 'empty';
  let sim = null;
  let simSeed = 1;
  let hudDirty = true;
  let lastHudT = 0;
  let reduced = false;
  try {
    reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (err) { /* Node 环境(缩略图)不会走到这 */ }

  function build() {
    if (built) return;
    built = true;
    root = document.createElement('div');
    root.className = 'ff-lens';
    body = document.createElement('div');
    body.className = 'ff-lens-body';
    cv = document.createElement('canvas');
    cv.className = 'ff-lens-cv';
    body.appendChild(cv);
    root.appendChild(body);
    chip = document.createElement('div');
    chip.className = 'ff-lens-chip';
    root.appendChild(chip);
    host.appendChild(root);

    dpr = Math.min(3, window.devicePixelRatio || 1);
    cv.width = R_PX * 2 * dpr;
    cv.height = R_PX * 2 * dpr;
    ctx = cv.getContext('2d');

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
    window.addEventListener('blur', onWinBlur);
  }

  function destroy() {
    destroyed = true;
    if (!built) return;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onUp, true);
    window.removeEventListener('blur', onWinBlur);
    root.remove();
  }

  /* ---------- 指针 → 目标 ---------- */

  function hostRect() { return host.getBoundingClientRect(); }

  function lensHit(cx, cy) {
    /* 屏幕坐标是否落在镜头圆内(命中区放宽到 rim 内 4px) */
    const r = hostRect();
    const lx = pos.x + r.left, ly = pos.y + r.top;
    return Math.hypot(cx - lx, cy - ly) <= R_PX - 4;
  }

  function inCanvas(cx, cy) {
    const r = hostRect();
    return cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
  }

  function onMove(ev) {
    if (!active || destroyed || ev.isPrimary === false) return;
    lastPtr = { x: ev.clientX, y: ev.clientY };
    if (drag && drag.id === ev.pointerId) {
      /* 拖动钉住的镜头 */
      drag.moved = drag.moved || Math.hypot(ev.clientX - drag.x0, ev.clientY - drag.y0) > 6;
      if (drag.moved) {
        pinned = true;
        root.classList.add('pinned');
        const r = hostRect();
        pos.x = clamp(ev.clientX - r.left - drag.dx, R_PX, r.width - R_PX);
        pos.y = clamp(ev.clientY - r.top - drag.dy, R_PX, r.height - R_PX);
        reanchor();
        applyPos();
      }
      return;
    }
    /* follow 态:指针移进镜头圆内 → 冻结,不逃跑 */
    if (!pinned && lensHit(ev.clientX, ev.clientY)) return;
    if (!pinned) followPointer();
    /* 指针在哪条边上,镜头就看哪条边 */
    retargetFromPointer();
  }

  function followPointer() {
    if (!lastPtr) return;
    const r = hostRect();
    if (!inCanvas(lastPtr.x, lastPtr.y)) {
      root.style.opacity = '0.25';
      return;
    }
    root.style.opacity = '';
    let ox = OFFSET[0], oy = OFFSET[1];
    /* 贴边自动翻侧:右半边 → 镜头放左边;下缘 → 镜头放上方 */
    const rel = lastPtr.x - r.left;
    if (rel > r.width * 0.62) ox = -OFFSET[0];
    if (lastPtr.y - r.top < r.height * 0.3) oy = Math.abs(OFFSET[1]);
    pos.x = clamp(lastPtr.x - r.left + ox, R_PX + 4, r.width - R_PX - 4);
    pos.y = clamp(lastPtr.y - r.top + oy, R_PX + 4, r.height - R_PX - 4);
    applyPos();
  }

  function applyPos() {
    root.style.left = (pos.x - R_PX) + 'px';
    root.style.top = (pos.y - R_PX) + 'px';
  }

  function reanchor() {
    anchor = null;
    const v = view();
    const r = hostRect();
    const svg = host.querySelector('svg.ff-stage') || host.querySelector('svg');
    if (!svg) return;
    const sr = svg.getBoundingClientRect();
    anchor = {
      x: v.x + (pos.x + r.left - sr.left) / sr.width * v.w,
      y: v.y + (pos.y + r.top - sr.top) / sr.height * v.h
    };
  }

  function placeFromAnchor() {
    if (!anchor) return;
    const v = view();
    const r = hostRect();
    const svg = host.querySelector('svg.ff-stage') || host.querySelector('svg');
    if (!svg) return;
    const sr = svg.getBoundingClientRect();
    pos.x = clamp((anchor.x - v.x) / v.w * sr.width + (sr.left - r.left), R_PX + 4, r.width - R_PX - 4);
    pos.y = clamp((anchor.y - v.y) / v.h * sr.height + (sr.top - r.top), R_PX + 4, r.height - R_PX - 4);
    applyPos();
  }

  function onDown(ev) {
    if (!active || destroyed) return;
    if (!lensHit(ev.clientX, ev.clientY)) return;
    ev.stopPropagation();
    try { body.setPointerCapture(ev.pointerId); } catch (err) { /* 已释放 */ }
    const r = hostRect();
    drag = {
      id: ev.pointerId, moved: false,
      x0: ev.clientX, y0: ev.clientY,
      dx: ev.clientX - r.left - pos.x, dy: ev.clientY - r.top - pos.y
    };
  }

  function onUp(ev) {
    if (!drag || drag.id !== ev.pointerId) return;
    const wasMoved = drag.moved;
    drag = null;
    if (!wasMoved) {
      /* 单击:钉住 ⇄ 跟随 */
      pinned = !pinned;
      root.classList.toggle('pinned', pinned);
      if (pinned) reanchor();
    }
  }

  function onWinBlur() { drag = null; }

  /* ---------- 目标与模拟 ---------- */

  function retargetFromPointer() {
    if (!lastPtr) return;
    const model = getModel();
    const sol = getSol();
    if (!model || !sol) { setTarget(null); return; }
    const wp = screenToWorld(lastPtr.x, lastPtr.y);
    const key = hitEdge(wp);
    const e = key ? model.edges.get(key) : null;
    setTarget(e || null);
  }

  function setTarget(e) {
    const nk = e ? e.key : null;
    const sol = getSol();
    if (e && targetKey === nk) {
      /* 同一条边:只更新参数(滑片拖动连续过渡,不重播种) */
      if (sim && sol) {
        facts = lensFacts(e, sol, getModel().list());
        sim.setDrift(facts.vdPx);
        sim.setScatter(facts.scatter);
      }
      hudDirty = true;
      return;
    }
    targetKey = nk;
    targetEdge = e;
    kind = e ? lensKindOf(e, sol ? sol.edgeI.get(e.id) : null) : 'empty';
    simSeed = e ? ((e.id * 2654435761) ^ 0x9e3779b9) | 0 : 1;
    sim = null;
    hudDirty = true;
    ensureSim();
  }

  function ensureSim() {
    if (!targetEdge || kind === 'empty') { sim = null; return; }
    const sol = getSol();
    if (!sol) { sim = null; return; }
    facts = lensFacts(targetEdge, sol, getModel().list());
    kind = facts.kind;
    sim = createLensSim(
      { kind: facts.kind, radius: R_PX, vd: facts.vdPx, scatter: facts.scatter },
      mulberry32(simSeed)
    );
  }

  let facts = null;


  /* ---------- 绘制 ---------- */

  let staticSprite = null;   /* 离屏:点阵/极板/E 箭头(按 kind+参数缓存) */
  let staticSig = '';

  function buildStatic() {
    const f = facts;
    const sig = kind + '|' + (f ? (f.Efrac.toFixed(2) + '|' + (f.battery ? f.battery.Echem.toFixed(1) + f.battery.Eelec.toFixed(1) : '')) : '');
    if (staticSig === sig && staticSprite) return;
    staticSig = sig;
    const c = document.createElement('canvas');
    c.width = R_PX * 2 * dpr; c.height = R_PX * 2 * dpr;
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    g.translate(R_PX, R_PX);
    const inkFaint = cssVar('--ink-faint', '#a89d8c');
    const inkSoft = cssVar('--ink-soft', '#6f6557');
    const ink = cssVar('--ink', '#2c2822');
    const verm = cssVar('--vermilion', '#c8451f');

    if (kind === 'metal' || kind === 'dead') {
      /* 晶格正离子:13px 错排网格 */
      g.fillStyle = inkFaint;
      for (let x = -R_PX + 7; x < R_PX; x += 13) {
        const yo = (Math.round((x + R_PX) / 13) % 2) * 6.5;
        for (let y = -R_PX + 5 + yo; y < R_PX; y += 13) {
          if (x * x + y * y > (R_PX - 3) * (R_PX - 3)) continue;
          g.beginPath();
          g.arc(x, y, 1.5, 0, Math.PI * 2);
          g.fill();
        }
      }
      /* E 箭头(导线里几乎没有,电阻里长) */
      if (kind === 'metal' && f && f.Efrac > 0.02) {
        const len = 10 + 40 * f.Efrac;
        const dir = f.vdPx < 0 ? 1 : -1;   /* E 沿电流方向 = −电子漂移方向 */
        for (const yy of [-30, 30]) {
          drawArrow(g, dir * (len / 2 - 6), yy, dir * (len / 2 + 6), yy, inkSoft, 1.2);
        }
      }
    } else if (kind === 'battery' && f && f.battery) {
      /* 极板:左负(短粗)右正(长细) */
      g.strokeStyle = ink; g.lineWidth = 3;
      g.beginPath(); g.moveTo(-12, -16); g.lineTo(-12, 16); g.stroke();
      g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(12, -26); g.lineTo(12, 26); g.stroke();
      /* 电解质淡纹理 */
      g.strokeStyle = inkFaint; g.lineWidth = 0.7;
      for (let y = -22; y <= 22; y += 9) {
        g.beginPath(); g.moveTo(-7, y + Math.sin(y) * 1.2); g.lineTo(7, y); g.stroke();
      }
      /* 角标 −/+ */
      g.fillStyle = inkSoft;
      g.font = '600 10px ui-monospace, monospace';
      g.textAlign = 'center';
      g.fillText('−', -12, -32);
      g.fillText('+', 12, -36);
    }
    staticSprite = c;
  }

  function drawArrow(g, x1, y1, x2, y2, color, w) {
    g.strokeStyle = color; g.fillStyle = color; g.lineWidth = w;
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const hl = 5;
    g.beginPath();
    g.moveTo(x2, y2);
    g.lineTo(x2 - hl * Math.cos(ang - 0.42), y2 - hl * Math.sin(ang - 0.42));
    g.lineTo(x2 - hl * Math.cos(ang + 0.42), y2 - hl * Math.sin(ang + 0.42));
    g.closePath(); g.fill();
  }

  function draw() {
    if (!built || !ctx) return;
    const indigo = cssVar('--indigo', '#2f62a8');
    const ink = cssVar('--ink', '#2c2822');
    const verm = cssVar('--vermilion', '#c8451f');
    const inkSoft = cssVar('--ink-soft', '#6f6557');
    const paper = cssVar('--paper', '#f7f2e5');

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, R_PX * 2, R_PX * 2);
    ctx.save();
    ctx.beginPath();
    ctx.arc(R_PX, R_PX, R_PX - 1, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, R_PX * 2, R_PX * 2);

    buildStatic();
    if (staticSprite) ctx.drawImage(staticSprite, 0, 0, R_PX * 2, R_PX * 2);

    ctx.translate(R_PX, R_PX);

    /* 电子海 */
    if (sim) {
      ctx.fillStyle = indigo;
      for (let i = 0; i < sim.agents.length; i++) {
        if (i === 0) continue;   /* agents[0] 是指定电子,单独画 */
        const a = sim.agents[i];
        ctx.beginPath();
        ctx.arc(a.x, a.y, 2.1, 0, Math.PI * 2);
        ctx.fill();
      }
      /* 指定电子:常亮细环;钉住细看时显示 自身的场 + 所受合场强 */
      const a = sim.agents[0];
      ctx.strokeStyle = verm;
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(a.x, a.y, 4.6, 0, Math.PI * 2); ctx.stroke();
      if (pinned) {
        /* 自带的电场:8 根径向辐条,随距离衰减 */
        ctx.strokeStyle = indigo;
        for (let k = 0; k < 8; k++) {
          const ang = k * Math.PI / 4 + 0.2;
          ctx.globalAlpha = 0.5;
          ctx.lineWidth = 0.9;
          ctx.beginPath();
          ctx.moveTo(a.x + Math.cos(ang) * 6, a.y + Math.sin(ang) * 6);
          ctx.lineTo(a.x + Math.cos(ang) * 15, a.y + Math.sin(ang) * 15);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        /* 合场强箭头:全电路表面电荷的场在该处的叠加 */
        if (kind === 'metal' && facts && facts.Efrac > 0.02) {
          const len = 10 + 26 * facts.Efrac;
          const dir = facts.vdPx < 0 ? 1 : -1;
          drawArrow(ctx, a.x + dir * 8, a.y - 14, a.x + dir * (8 + len), a.y - 14, ink, 1.4);
        } else if (kind === 'battery' && facts && facts.battery) {
          /* 对峙双箭头:化学力(沿电子运动)vs 静电场力(逆向,略短) */
          const b = facts.battery;
          const mdir = facts.vdPx < 0 ? -1 : 1;
          const Lc = clamp(b.Echem / 60, 0.3, 1.3);
          const Le = clamp(b.Eelec / 60, 0.3, 1.3) * 0.85;
          drawArrow(ctx, a.x, a.y - 18, a.x + mdir * (14 + 22 * Lc), a.y - 18, verm, 1.5);
          drawArrow(ctx, a.x, a.y - 26, a.x - mdir * (14 + 22 * Le), a.y - 26, inkSoft, 1.3);
        }
      }
    }
    ctx.restore();
  }

  /* ---------- HUD ---------- */

  function updateHud(now) {
    if (!built || !hudDirty) return;
    if (now - lastHudT < 250) return;   /* ~4Hz */
    lastHudT = now;
    hudDirty = false;
    const sol = getSol();
    let html = '';
    if (kind === 'empty' || !targetEdge || !sol) {
      html = '<b>显微镜头</b><span>把镜头移到导线或元件上 · 点镜头可钉住</span>';
    } else {
      const I = sol.edgeI.get(targetEdge.id);
      const name = TYPE_NAME[targetEdge.type] || targetEdge.type;
      if (kind === 'battery' && facts && facts.battery) {
        const b = facts.battery;
        html = '<b>电池</b>' +
          '<span>E<sub>化</sub> ' + fmt(b.Echem, 'V/m') + ' − E<sub>静</sub> ' + fmt(b.Eelec, 'V/m') +
          ' = 净驱动 ' + fmt(b.Enet, 'V/m') + '</span>' +
          '<span>电子:正极 → 负极(与外电路相反)</span>';
      } else if (kind === 'dead') {
        html = '<b>' + name + ' · 无电流</b>' +
          '<span>表面电荷的场在内部恰好抵消,E=0</span>' +
          '<span>电子仅热运动</span>';
      } else if (facts) {
        html = '<b>' + name + '</b>' +
          '<span>I ' + fmt(Math.abs(I), 'A') + ' · U ' + fmt(Math.abs(solver.edgeU(targetEdge, sol) || 0), 'V') +
          ' · E≈U/L ' + fmt(facts.E, 'V/m') + '</span>' +
          '<span>v<sub>d</sub> ≈ ' + fmt(facts.vdSI * 1e6, 'µm/s') + ' — 串联路径处处相同</span>';
      }
      if (pinned && kind !== 'empty') {
        html += '<span class="lens-sel">指定电子:合力 = 全电路表面电荷的场叠加</span>';
      }
    }
    chip.innerHTML = html;
  }

  /* ---------- 每帧入口(由 render.tick 调) ---------- */

  function step(dt, now) {
    if (!active || !built || destroyed) return;
    if (pinned) placeFromAnchor();
    else if (lastPtr) { /* follow:位置由 pointermove 更新,这里兜底重算 */ }
    if (sim && !reduced) sim.step(Math.min(0.05, dt));
    draw();
    updateHud(now || performance.now());
  }

  /* ---------- 对外 ---------- */

  const api = {
    setActive(on) {
      active = !!on;
      if (!built && !active) return;
      if (active) {
        build();
        root.classList.remove('pinned');
        pinned = false;
        /* 开启瞬间置于画布中央,empty 态可发现 */
        const r = hostRect();
        pos = { x: r.width / 2, y: r.height / 2 };
        applyPos();
        root.style.opacity = '';
        hudDirty = true;
      }
      root.style.display = active ? '' : 'none';
    },
    step,
    active: () => active && built && !destroyed,
    notifySolution() {
      /* 解变了:重新取 facts;目标边可能已删 */
      if (!active) return;
      if (targetKey) {
        const e = getModel() && getModel().edges.get(targetKey);
        if (!e) { setTarget(null); }
        else {
          targetEdge = e;
          ensureSim();
          hudDirty = true;
        }
      }
    },
    onViewport() { if (pinned && built && active) placeFromAnchor(); },
    destroy
  };
  return api;
}
