/* CircuitAlive · terrain — 电势地形(3D 预览)的纯数据构建
 *
 * 把电路图变成"路面网络":每条边一条带状路面(ribbon),高度 = 电势 φ
 * (俯视 X/Y 就是电路网格,高度轴是 φ)。导线两端同 φ → 平地;
 * 电阻两端不同 φ → 斜坡;电池 → 陡坡(化学力电梯)。结点放一块
 * 盖板把相邻路面接平。载流子球沿路面以漂移速度爬行(示意)。
 *
 * 视角语义:高度 = 当前载流子的电势能。电流视角高=φ,红球下坡;
 * 「电子流向」时整体翻转(高=−φ),蓝球同样下坡 —— 两种视角里
 * 电池永远是爬升、电阻永远是下坡。翻转由视图层做(高度乘 sign),
 * 这里输出的高度一律是原始 φ。
 *
 * 纯逻辑零 DOM,Node 可单测。 */

import { T, GRID, clamp } from './util.js';
import { solver } from './solver.js';

const G = GRID;

export const RIBBON_W = 14;      /* 路面半宽世界 px(格距 40) */
export const SEGS = 5;           /* 每条边沿程分段数(斜坡平滑) */

/* 高度换算:φ 跨度 → 世界 px。钳制保证悬崖不至于刺天、
 * 小电压也能看出坡。 */
export function heightScale(phiMin, phiMax) {
  const span = phiMax - phiMin;
  if (!(span > 0.01)) return 0;
  return clamp(96 / span, 3, 26);
}

/* buildTerrain(model, sol) → {
 *   ribbons: [{ id, key, type, kind, dir, w,
 *               rows: [{ x, y, phi }]          // SEGS+1 行,每行路面中心线上一点
 *             }],
 *   caps:   [{ x, y, phi }],                  // 结点盖板
 *   balls:  [{ key, count, speed, dir }],      // 载流子球(speed 世界 px/s,带符号沿 a→b)
 *   labels: [{ x, y, phi }],                   // φ 标注点(每个已解结点)
 *   meta:   { phiMin, phiMax, hScale }
 * }
 * kind: 'flat'(等势路面) / 'slope'(斜坡) / 'battery'(电梯)
 * dir:  球的运动方向沿边参数 t 的符号(正 = a→b)
 */
export function buildTerrain(model, sol) {
  const out = { ribbons: [], caps: [], balls: [], labels: [], meta: { phiMin: 0, phiMax: 0, hScale: 0 } };
  if (!model || !sol || !sol.nodePhi || sol.nodePhi.size === 0) return out;

  /* 已解 φ 的范围 */
  let lo = Infinity, hi = -Infinity;
  sol.nodePhi.forEach((v) => {
    if (v == null) return;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  });
  if (lo === Infinity) return out;
  out.meta = { phiMin: lo, phiMax: hi, hScale: heightScale(lo, hi) };

  const imax = sol.Imax || 0;
  const edges = model.list ? model.list() : Array.from(model.edges.values());

  edges.forEach((e) => {
    const phiA = sol.nodePhi.get(e.a[0] + ',' + e.a[1]);
    const phiB = sol.nodePhi.get(e.b[0] + ',' + e.b[1]);
    if (phiA == null || phiB == null) return;   /* 无源孤岛不进地形 */

    /* 路面中心线:SEGS+1 行 */
    const rows = [];
    for (let i = 0; i <= SEGS; i++) {
      const t = i / SEGS;
      rows.push({
        x: (e.a[0] + (e.b[0] - e.a[0]) * t) * G,
        y: (e.a[1] + (e.b[1] - e.a[1]) * t) * G,
        phi: e.type === T.BATTERY && SEGS > 1
          ? (i === 0 ? phiA : i === SEGS ? phiB : (phiA + phiB) / 2)   /* 电池:两端电极恒势,电解质取中值(视图画陡) */
          : phiA + (phiB - phiA) * t
      });
    }

    const I = sol.edgeI.get(e.id);
    const dPhi = Math.abs(phiB - phiA);
    let kind = 'flat';
    if (e.type === T.BATTERY) kind = 'battery';
    else if (dPhi > 0.01) kind = 'slope';

    out.ribbons.push({ id: e.id, key: e.key, type: e.type, kind, w: RIBBON_W, rows });

    /* 球:有电流的边上放(电池边上也有 —— 乘电梯)。
       速度 = 漂移示意 2.5..12 px/s ∝ |I|/Imax,方向沿电子真实运动
       (−sign(I));视图按 电流/电子 模式决定要不要再取反(电流模式
       显示的是"等效正电荷",沿 +sign(I))。 */
    if (I != null && Math.abs(I) >= 1e-6 && imax > 0) {
      const speed = 2.5 + 9.5 * clamp(Math.abs(I) / imax, 0, 1);
      out.balls.push({
        key: e.key,
        count: 4,
        speed,
        dir: -Math.sign(I)     /* 电子真实方向(沿 a→b 参数) */
      });
    }
  });

  /* 结点盖板:所有被已解 φ 覆盖的结点(与路面同高,把路口接平) */
  const capSeen = new Set();
  edges.forEach((e) => {
    for (const p of [e.a, e.b]) {
      const k = p[0] + ',' + p[1];
      if (capSeen.has(k)) continue;
      const phi = sol.nodePhi.get(k);
      if (phi == null) continue;
      capSeen.add(k);
      out.caps.push({ x: p[0] * G, y: p[1] * G, phi });
      out.labels.push({ x: p[0] * G, y: p[1] * G, phi });
    }
  });

  return out;
}

/* 视图翻转时球的方向:电流模式显示等效正电荷(+sign(I)),电子模式
   显示电子(−sign(I))。buildTerrain 给的是电子方向 dir=-sign(I),
   电流模式要取反。 */
export function ballDirFor(dirElectron, electronView) {
  return electronView ? dirElectron : -dirElectron;
}
