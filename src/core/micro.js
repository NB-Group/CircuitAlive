/* CircuitAlive · micro — 真实物理模式的纯逻辑(浏览器 / Node 双端)
 *
 * 三件事,全部不碰 DOM:
 *   1. 表面电荷:σ ∝ (φ − φ̄),φ̄ 取每个已解含源连通分量内
 *      (φmax+φmin)/2 —— 孤立中性体系 ±电荷等量反号,零电荷参考
 *      恰是极值中点;节点均值/中位数会随导线长度漂移(布局伪影)。
 *      电池边不插值:两端各 30% 区段画恒定端电势记号(电极恒势,
 *      电解质里电势跃变不画)。死支路(电压表探针/断开关)按所附
 *      φ 画记号 —— 有电荷分布、无电流、内部 E=0。
 *   2. 坡印廷能量流:源=放电电池两端子,汇=耗能元件(含被充电池
 *      与电池内阻耗散),方向严格 源→汇;贝塞尔背离电路质心外鼓。
 *   3. 显微镜头的物理量与微观模拟(Drude 简化):漂移速度是刚性
 *      叠加项,与散射率无关 —— 串联处处相同是教学红线,靠构造
      保证而非数值涌现。
 */

import { T, GRID, clamp, lerp, nodeKey } from './util.js';
import { solver } from './solver.js';

const G = GRID;
const OPEN_I = 1e-6;   /* 与 solver 的死区一致 */

/* ---- 确定性散列:表面电荷抽稀要可复现(重渲染不闪、单测可数) ---- */
export function hash01(a, b, c) {
  let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(c | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245) | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/* mulberry32 —— 注入式种子随机数,镜头模拟用它保证确定性 */
export function mulberry32(seed) {
  let s = seed | 0;
  return function () {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* =====================================================================
 * 一、表面电荷
 * ===================================================================== */

/* 每个已解含源分量的参考电势:φ̄=(φmax+φmin)/2,φhalf=(φmax−φmin)/2
 * 返回 { compIdxOf: Map<nodeKey, idx>, refs: [{phiBar, phiHalf}] } */
export function componentRefs(sol) {
  const compIdxOf = new Map();
  const refs = [];
  (sol.comps || []).forEach((comp, i) => {
    let lo = Infinity, hi = -Infinity;
    (comp.nodes || []).forEach((k) => {
      const v = sol.nodePhi.get(k);
      if (v == null) return;
      compIdxOf.set(k, i);
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    });
    if (lo === Infinity) return;
    refs[i] = { phiBar: (hi + lo) / 2, phiHalf: Math.max(0.05, (hi - lo) / 2) };
  });
  return { compIdxOf, refs };
}

/* 边上 t 处的归一化电荷(q∈[−1,1])。电池边 t∈[0.05,0.3] 用 φa、
 * t∈[0.7,0.95] 用 φb(两端恒定端电势),中段返回 0(电解质不画)。 */
function chargeAt(e, t, phiA, phiB, ref) {
  let phi;
  if (e.type === T.BATTERY) {
    if (t < 0.3) phi = phiA;
    else if (t > 0.7) phi = phiB;
    else return 0;
  } else {
    phi = lerp(phiA, phiB, t);
  }
  return clamp((phi - ref.phiBar) / ref.phiHalf, -1, 1);
}

/* 表面电荷记号。返回 [{x, y, q}](世界 px,+q 正/红,−q 负/蓝)。
 * 密度 ∝|q|;|q|<0.05 跳过;确定性抽稀;边多时降采样。 */
export function computeSurfaceCharges(edges, sol) {
  const { compIdxOf, refs } = componentRefs(sol);
  const marks = [];
  const crowded = edges.length > 60;
  edges.forEach((e) => {
    const phiA = sol.nodePhi.get(nodeKey(e.a));
    const phiB = sol.nodePhi.get(nodeKey(e.b));
    if (phiA == null || phiB == null) return;
    const idx = compIdxOf.get(nodeKey(e.a));
    const ref = idx == null ? null : refs[idx];
    if (!ref) return;

    const ax = e.a[0] * G, ay = e.a[1] * G, bx = e.b[0] * G, by = e.b[1] * G;
    /* 垂直方向(单位向量):边水平时上偏为 −y,竖直时右偏 +x,无所谓正负 */
    const dx = bx - ax, dy = by - ay;
    const px = -dy / G, py = dx / G;   /* 单位法向(GRID=40=边长) */

    /* 该边平均 |q| 决定每侧采样点数 */
    let qbar = 0;
    const probe = 5;
    for (let i = 0; i < probe; i++) qbar += Math.abs(chargeAt(e, (i + 0.5) / probe, phiA, phiB, ref));
    qbar /= probe;
    const base = crowded ? 2 : 3;
    const n = Math.min(6, base + Math.round((crowded ? 2 : 3) * Math.min(1, qbar)));

    for (let side = 0; side < 2; side++) {
      const off = (side === 0 ? -1 : 1) * 4.5;
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const q = chargeAt(e, t, phiA, phiB, ref);
        if (Math.abs(q) < 0.05) continue;
        if (hash01(e.id, side, i) >= Math.min(1, Math.abs(q) * 1.4)) continue;
        marks.push({
          x: ax + dx * t + px * off,
          y: ay + dy * t + py * off,
          q
        });
      }
    }
  });
  return marks;
}

/* =====================================================================
 * 二、坡印廷能量流
 * ===================================================================== */

const DISSIPATIVE = [T.RESISTOR, T.LAMP, T.RHEOSTAT, T.MOTOR, T.BELL];

/* 流线:源(电池端子)→ 汇(耗能处)。返回
 * [{ d, width, dur, arrow: {x, y, angle} }](世界 px)。 */
export function buildPoyntingFlows(edges, sol, wireR) {
  if (!edges.length || !sol) return [];
  const { compIdxOf } = componentRefs(sol);

  /* 电路质心:侧向选择背离它 */
  let cx = 0, cy = 0, cn = 0;
  edges.forEach((e) => {
    cx += (e.a[0] + e.b[0]) / 2 * G;
    cy += (e.a[1] + e.b[1]) / 2 * G;
    cn++;
  });
  if (!cn) return [];
  cx /= cn; cy /= cn;

  /* 按分量收集源与汇 */
  const byComp = new Map();   /* compIdx -> { sources: [], sinks: [] } */
  const compOf = (e) => {
    const i = compIdxOf.get(nodeKey(e.a));
    return i == null ? compIdxOf.get(nodeKey(e.b)) : i;
  };
  const bucket = (i) => {
    if (i == null) return null;
    let b = byComp.get(i);
    if (!b) { b = { sources: [], sinks: [] }; byComp.set(i, b); }
    return b;
  };

  let pMax = 0;
  edges.forEach((e) => {
    const I = sol.edgeI.get(e.id);
    if (I == null) return;
    const b = bucket(compOf(e));
    if (!b) return;

    if (e.type === T.BATTERY) {
      const emf = solver.emfOf(e);
      const pChem = I * emf;                      /* >0 放电,<0 被充电 */
      const pInternal = I * I * solver.rOf(e);    /* 内阻永远发热 */
      if (pChem > 1e-3) {
        b.sources.push({ e, P: pChem });
        pMax = Math.max(pMax, pChem);
      }
      /* 被充电池 = 汇;内阻耗散 = 低优先级汇(同一位置,功率小) */
      if (pChem < -1e-3) {
        b.sinks.push({ e, P: -pChem, at: 0.5 });
        pMax = Math.max(pMax, -pChem);
      }
      if (pInternal >= 1e-3) {
        b.sinks.push({ e, P: pInternal, at: 0.5 });
        pMax = Math.max(pMax, pInternal);
      }
      return;
    }

    const U = solver.edgeU(e, sol);
    if (U == null) return;
    if (DISSIPATIVE.includes(e.type)) {
      const P = Math.abs(U * I);
      if (P >= 1e-3) {
        b.sinks.push({ e, P, at: 0.5 });
        pMax = Math.max(pMax, P);
      }
    } else if (e.type === T.WIRE && (wireR || 0) > 0) {
      const P = I * I * wireR;
      if (P >= 1e-3) {
        b.sinks.push({ e, P, at: 0.5 });
        pMax = Math.max(pMax, P);
      }
    }
  });
  if (pMax <= 0) return [];

  const flows = [];
  const mkCurve = (sx, sy, ex, ey, P) => {
    /* 侧向:背离电路质心外鼓 */
    const vx = ex - sx, vy = ey - sy;
    const chord = Math.hypot(vx, vy) || 1;
    const crossZ = vx * (cy - sy) - vy * (cx - sx);
    const s = crossZ === 0 ? 1 : -Math.sign(crossZ);
    const h = clamp(0.22 * chord, 18, 70);
    const nx = -vy / chord * s, ny = vx / chord * s;
    const p1x = sx + vx / 3 + nx * h, p1y = sy + vy / 3 + ny * h;
    const p2x = sx + vx * 2 / 3 + nx * h, p2y = sy + vy * 2 / 3 + ny * h;
    flows.push({
      d: 'M ' + sx + ' ' + sy + ' C ' + p1x + ' ' + p1y + ' ' + p2x + ' ' + p2y + ' ' + ex + ' ' + ey,
      width: 1 + 1.6 * (P / pMax),
      dur: clamp(chord / 160, 0.9, 2.2),
      arrow: { x: ex, y: ey, angle: Math.atan2(ey - p2y, ex - p2x) * 180 / Math.PI }
    });
  };

  const pointOn = (e, t, off) => {
    const ax = e.a[0] * G, ay = e.a[1] * G, bx = e.b[0] * G, by = e.b[1] * G;
    const dx = bx - ax, dy = by - ay;
    const L = Math.hypot(dx, dy) || 1;
    const nx = -dy / L, ny = dx / L;
    return [ax + dx * t + nx * off, ay + dy * t + ny * off];
  };

  byComp.forEach((b) => {
    if (!b.sources.length || !b.sinks.length) return;
    b.sources.forEach((src) => {
      b.sinks.forEach((snk) => {
        const n = Math.min(3, 1 + Math.floor(2 * snk.P / pMax));
        for (let k = 0; k < n; k++) {
          /* 起点:两极交替;终点:沿耗能边扇形落点 */
          const term = k % 2 === 0 ? 1 : 0;               /* 1=b 端(正极) */
          const [sx, sy] = pointOn(src.e, term, (k - (n - 1) / 2) * 6);
          const tEnd = n === 1 ? 0.5 : (n === 2 ? [0.35, 0.65][k] : [0.32, 0.5, 0.68][k]);
          const sideEnd = k % 2 === 0 ? -9 : 9;
          const [ex, ey] = pointOn(snk.e, tEnd, sideEnd);
          mkCurve(sx, sy, ex, ey, snk.P);
        }
      });
    });
  });

  /* 总量护栏:按宽度(∝功率)排序截断 */
  if (flows.length > 16) {
    flows.sort((a, b2) => b2.width - a.width);
    flows.length = 16;
  }
  return flows;
}

/* =====================================================================
 * 三、显微镜头:分类 / 物理量 / 微观模拟
 * ===================================================================== */

/* 镜头内容分类:金属导体 / 电池 / 无电流 / (无目标 → 由 lens.js 定 empty) */
export function lensKindOf(e, I) {
  if (e.type === T.BATTERY) return 'battery';
  if (I == null || Math.abs(I) < OPEN_I) return 'dead';
  return 'metal';
}

/* 散射率表(Hz):电阻的微观机制 —— 电阻大不是电子跑得慢,
 * 是碰撞频繁、更难走,需要更大的 E 维持同一漂移速度。 */
export function scatterRateOf(e) {
  switch (e.type) {
    case T.WIRE: return 0.7;
    case T.SWITCH: return 0.9;
    case T.AMMETER: return 0.8;
    case T.RESISTOR: case T.LAMP: return 7;
    case T.MOTOR: case T.BELL: return 6;
    case T.RHEOSTAT: {
      const w = clamp(e.props && e.props.wiper == null ? 1 : e.props.wiper, 0, 1);
      return 3 + 6 * w;
    }
    case T.BATTERY: return 2;   /* 电解质 */
    default: return 1;
  }
}

/* 名义物理换算(教学约定,单测锁死):
 *   一格边 = 0.1 m ⇒ E = |U| × 10 V/m
 *   铜 1 mm²:n=8.5e28 /m³,e=1.6e-19 C ⇒ v_d = |I| / 1.36e4 m/s */
export const EDGE_LEN_M = 0.1;
export const VD_PER_A = 73.4e-6;   /* m/s per A */

/* 镜头物理量。Uref = 本电路金属类边最大 |U|(E 箭头长度基准);
 * vdPx = 镜头局部坐标里电子海的漂移速度(+x = a→b,电子取 −sign(I))。 */
export function lensFacts(e, sol, edges) {
  const I = sol ? sol.edgeI.get(e.id) : null;
  const kind = lensKindOf(e, I);
  const out = {
    kind,
    scatter: scatterRateOf(e),
    vdPx: 0,              /* px/s,镜头模拟直接用 */
    Efrac: 0,             /* E 箭头长度比例 0..1 */
    E: 0, vdSI: 0,        /* 显示值:V/m 与 m/s */
    battery: null
  };
  /* 漂移的视觉速度:10..60 px/s ∝ |I|/Imax,方向 = −sign(I)·x̂。
   * 金属与电池统一 —— 电池内 I>0(放电)时电子同样沿 −x̂(正极→负极)。 */
  const imax = sol ? (sol.Imax || 0) : 0;
  if (kind !== 'dead' && I != null && Math.abs(I) >= OPEN_I && imax > 0) {
    out.vdPx = -Math.sign(I) * (10 + 50 * clamp(Math.abs(I) / imax, 0, 1));
  }
  if (kind === 'battery' && sol) {
    const U = solver.edgeU(e, sol);       /* 端电压 φb−φa */
    const emf = solver.emfOf(e);
    out.battery = {
      Echem: emf / EDGE_LEN_M,
      Eelec: (U == null ? 0 : U) / EDGE_LEN_M,
      Enet: (emf - (U == null ? emf : U)) / EDGE_LEN_M,   /* = I·r/L */
      discharging: (I || 0) * emf >= 0
    };
    return out;
  }
  if (kind === 'metal' && sol) {
    const U = solver.edgeU(e, sol);
    let uRef = 0;
    (edges || []).forEach((o) => {
      if (o.type === T.BATTERY || o.type === T.VOLTMETER) return;
      const i2 = sol.edgeI.get(o.id);
      if (i2 == null) return;
      const u2 = solver.edgeU(o, sol);
      if (u2 != null && Math.abs(u2) > uRef) uRef = Math.abs(u2);
    });
    const absU = U == null ? 0 : Math.abs(U);
    out.E = absU / EDGE_LEN_M;
    out.vdSI = Math.abs(I || 0) * VD_PER_A;
    out.Efrac = uRef > 0 ? clamp(absU / uRef, 0, 1) : 0;
  }
  return out;
}

/* ---- Drude 简化模拟(纯) --------------------------------------------
 * 漂移是刚性叠加项:pos += (v_th + v_d·x̂)·dt。
 * 不管散射多频繁,电子海的平均速度恒等于 v_d —— 串联路径处处相同。 */
export function createLensSim(opts, rng) {
  const r = opts.radius || 66;
  const rand = rng || mulberry32(42);
  const count = opts.kind === 'battery' ? 36 : 42;
  const VTH = 55;                        /* 热速度 px/s */

  const agents = [];
  function newAgent() {
    return {
      x: (rand() * 2 - 1) * r,
      y: (rand() * 2 - 1) * r * 0.97,
      thx: 0, thy: 0, tS: 0,
      scatterCount: 0
    };
  }
  function reDir(a) {
    const ang = rand() * Math.PI * 2;
    const sp = VTH * (0.85 + rand() * 0.3);
    a.thx = Math.cos(ang) * sp;
    a.thy = Math.sin(ang) * sp;
  }
  for (let i = 0; i < count; i++) {
    const a = newAgent();
    reDir(a);
    a.tS = -Math.log(1 - rand()) / opts.scatter;   /* Exp(ν) 自由飞行 */
    agents.push(a);
  }

  let vd = opts.vd || 0;                 /* px/s,沿 +x 带符号 */
  let nu = opts.scatter || 0.7;          /* 散射率 Hz */

  function step(dt) {
    for (const a of agents) {
      a.x += (a.thx + vd) * dt;
      a.y += a.thy * dt;
      a.tS -= dt;
      if (a.tS <= 0) {
        reDir(a);
        a.scatterCount++;
        a.tS = -Math.log(1 - rand()) / nu;
      }
      /* 圆柱边界:x 回绕,y 出界重随机 */
      if (a.x > r) a.x -= 2 * r;
      else if (a.x < -r) a.x += 2 * r;
      if (Math.abs(a.y) > r * 0.97) {
        a.y = (rand() * 2 - 1) * r * 0.9;
      }
    }
  }

  return {
    agents,
    step,
    /* 仅参数变化(滑片拖动)不重播种 —— 位置连续,不闪 */
    setDrift(v) { vd = v; },
    setScatter(v) { nu = v; },
    meanVx() {
      let s = 0;
      for (const a of agents) s += a.thx + vd;
      return s / agents.length;
    },
    scatterTotal() {
      let s = 0;
      for (const a of agents) s += a.scatterCount;
      return s;
    }
  };
}
