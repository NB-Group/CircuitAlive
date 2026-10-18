/* CircuitAlive · solver — 节点电压法直流求解器(纯函数,Node 可测)
 *
 * 物理模型:
 *  - 参与求解的边都是"电阻 + (电池的)诺顿电流源",整体是 SPD 线性系统;
 *  - 导线默认理想(r=0,等势体):两端点合并为超节点,不进矩阵(0Ω 直接
 *    进矩阵会奇异);理想导线内的电流由 KCL 最短路路由补算。
 *    需要模拟真实导线时可给单根导线设 r > 0;
 *  - 电压表、断开的开关不进求解(开路);
 *  - 连通分量仅在含电池时才求解(无源孤岛是奇异拉普拉斯矩阵,直接跳过);
 *  - 电池 a 端为负极、b 端为正极,电动势把电势从 a 抬到 b。
 *
 * 最易错点(有专门单测):电池边电流必须含电动势项
 *   无源边:  I_a→b = (φa − φb) / r
 *   电池边:  I_a→b = (φa − φb + V) / r
 * 漏掉 +V 则幅值碰巧正确、符号与物理全错。 */
import { T, nodeKey, clamp, LIMITS } from './util.js';

/* 导线默认 1 mΩ(不得更低:数值条件);电池内阻取真实干电池量级 */
var R_WIRE = 1e-3;   /* 显式指定导线电阻时的下限;默认导线是理想的(r=0,超节点合并) */
var R_BAT = 0.1;
var R_AM = 1e-4;

var SHORT_I = 20;   /* 任一支路 |I| 超过此值 → 判定短路 */
var OPEN_I = 1e-6;  /* 有电池但最大电流低于此值 → 判定断路 */

function clampNum(v, lo, hi) {
  v = +v;
  if (!isFinite(v)) v = lo;
  return clamp(v, lo, hi);
}

/* 边的电阻(仅对参与求解的边调用)。导线电阻是全局统一值 wireR(默认 0=理想) */
function rOf(e, wireR) {
  var p = e.props || {};
  wireR = wireR == null ? 0 : wireR;
  switch (e.type) {
    case T.WIRE:
      return wireR === 0 ? 0 : clampNum(wireR, 1e-3, 50);
    case T.SWITCH: return p.closed ? R_WIRE : Infinity;
    case T.AMMETER: return R_AM;
    case T.BATTERY: return clampNum((p.r == null ? R_BAT : p.r), 0.01, 50);
    case T.RESISTOR:
    case T.LAMP: return clampNum(p.R, LIMITS.R[0], LIMITS.R[1]);
    /* 电动机/电铃是真实负载,必须有有限电阻,否则会被当成开路 */
    case T.MOTOR:
    case T.BELL: return clampNum(p.R == null ? 7.2 : p.R, LIMITS.R[0], LIMITS.R[1]);
    case T.RHEOSTAT: {
      var Rmax = clampNum(p.Rmax, LIMITS.Rmax[0], LIMITS.Rmax[1]);
      var w = clampNum(p.wiper == null ? 1 : p.wiper, 0, 1);
      return Math.max(0.01, w * Rmax);
    }
    default: return Infinity;
  }
}

/* 电动势:电池边从 a 端抬到 b 端的电势增量 */
function emfOf(e) {
  if (e.type !== T.BATTERY) return 0;
  return clampNum((e.props || {}).V, LIMITS.V[0], LIMITS.V[1]);
}

/* 参与求解(电气连通)的边:排除电压表与断开的开关 */
function isActive(e) {
  if (e.type === T.VOLTMETER) return false;
  if (e.type === T.SWITCH && !(e.props || {}).closed) return false;
  return true;
}

/* ---- 并查集 ---- */
function DSU() { this.p = {}; }
DSU.prototype.find = function (k) {
  var p = this.p;
  if (p[k] === undefined) p[k] = k;
  while (p[k] !== k) { p[k] = p[p[k]]; k = p[k]; }
  return k;
};
DSU.prototype.union = function (a, b) {
  var ra = this.find(a), rb = this.find(b);
  if (ra !== rb) this.p[ra] = rb;
};

/* ---- 部分主元高斯消元(矩阵 SPD,数值稳定) ---- */
function gauss(A, b) {
  var n = A.length, row, col, r, c;
  for (col = 0; col < n; col++) {
    var piv = col, mx = Math.abs(A[col][col]);
    for (r = col + 1; r < n; r++) {
      var v = Math.abs(A[r][col]);
      if (v > mx) { mx = v; piv = r; }
    }
    if (mx < 1e-12) return null; /* 奇异保护:按构造不应触发 */
    if (piv !== col) {
      row = A[piv]; A[piv] = A[col]; A[col] = row;
      var tb = b[piv]; b[piv] = b[col]; b[col] = tb;
    }
    var p = A[col][col];
    for (r = col + 1; r < n; r++) {
      var f = A[r][col] / p;
      if (f === 0) continue;
      for (c = col; c < n; c++) A[r][c] -= f * A[col][c];
      b[r] -= f * b[col];
    }
  }
  var x = new Array(n);
  for (r = n - 1; r >= 0; r--) {
    var s = b[r];
    for (c = r + 1; c < n; c++) s -= A[r][c] * x[c];
    x[r] = s / A[r][r];
  }
  return x;
}

/* ---- 理想导线簇的电流路由 ----
 * 超节点内电流分布本不确定(0Ω 并联路径分流任意);按"入口→出口最短路"
 * 路由,对串联链与星形结点(初中电路的绝对象)精确,并联网格上是合理近似。
 * pins: Map<node, 净流入(外部边注入)>;返回 Map<edgeId, signed I(a→b)> */
function routeIdealCluster(wires, pins, Imax) {
  var adj = new Map();
  function add(k, e, other) {
    if (!adj.has(k)) adj.set(k, []);
    adj.get(k).push({ edge: e, other: other });
  }
  wires.forEach(function (w) {
    add(nodeKey(w.a), w, nodeKey(w.b));
    add(nodeKey(w.b), w, nodeKey(w.a));
  });

  var EPS = Math.max(1e-9, 1e-9 * (Imax || 0));
  var sources = [], sinks = [];
  pins.forEach(function (f, n) {
    if (f > EPS) sources.push([n, f]);
    else if (f < -EPS) sinks.push([n, -f]);
  });
  sources.sort(function (a, b) { return b[1] - a[1]; });

  function bfs(s, t) {
    var prev = new Map();
    prev.set(s, null);
    var q = [s];
    while (q.length) {
      var v = q.shift();
      if (v === t) break;
      (adj.get(v) || []).forEach(function (r) {
        if (!prev.has(r.other)) { prev.set(r.other, { node: v, edge: r.edge }); q.push(r.other); }
      });
    }
    if (!prev.has(t)) return null;
    var path = [], cur = t;
    while (prev.get(cur)) {
      var p = prev.get(cur);
      path.push({ edge: p.edge, from: p.node, to: cur });
      cur = p.node;
    }
    return path.reverse();
  }

  var wireI = new Map(), guard = 0;
  sources.forEach(function (sv) {
    var rem = sv[1];
    while (rem > EPS && guard++ < 500) {
      sinks.sort(function (a, b) { return b[1] - a[1]; });
      var sink = null;
      for (var i = 0; i < sinks.length; i++) if (sinks[i][1] > EPS) { sink = sinks[i]; break; }
      if (!sink) break;
      var path = bfs(sv[0], sink[0]);
      if (!path) break;
      var d = Math.min(rem, sink[1]);
      path.forEach(function (step) {
        var e = step.edge;
        var forward = nodeKey(e.a) === step.from;
        wireI.set(e.id, (wireI.get(e.id) || 0) + (forward ? d : -d));
      });
      rem -= d;
      sink[1] -= d;
    }
  });
  return wireI;
}

/* ---- 主求解 ----
 * edges: 边数组(FF.E 构造)。返回:
 * {
 *   nodePhi: Map<nodeKey, number|null>   // null = 无源孤岛(未定义,显示"—")
 *   edgeI:   Map<edgeId,  number|null>   // 沿 a→b 方向的支路电流(理想导线由路由补算)
 *   comps:   [{ nodes, hasSource, Imax }]
 *   Imax, phiMax, phiMin, hasBattery,
 *   status: 'empty'|'noSource'|'short'|'open'|'normal'
 * }
 */
function solve(edges, opts) {
  edges = edges || [];
  var wireR = opts && opts.wireR != null ? opts.wireR : 0;
  var res = {
    nodePhi: new Map(),
    edgeI: new Map(),
    comps: [],
    Imax: 0,
    phiMax: 0,
    phiMin: 0,
    hasBattery: false,
    status: 'empty'
  };
  if (!edges.length) return res;

  var active = edges.filter(isActive);
  var hasBattery = edges.some(function (e) { return e.type === T.BATTERY; });
  res.hasBattery = hasBattery;

  edges.forEach(function (e) {
    res.nodePhi.set(nodeKey(e.a), null);
    res.nodePhi.set(nodeKey(e.b), null);
  });

  /* 两个层级:理想导线簇(超节点)与电气连通分量 */
  var dsuSuper = new DSU();   /* 仅理想导线 → 超节点 */
  var dsuComp = new DSU();    /* 全部激活边 → 连通分量 */
  active.forEach(function (e) {
    var ka = nodeKey(e.a), kb = nodeKey(e.b);
    if (rOf(e, wireR) === 0) dsuSuper.union(ka, kb);
  });
  active.forEach(function (e) {
    dsuComp.union(dsuSuper.find(nodeKey(e.a)), dsuSuper.find(nodeKey(e.b)));
  });
  function sup(k) { return dsuSuper.find(k); }

  var groups = new Map(); /* compRoot -> {supers:Set, edges:[], batteries:[], idealWires:[]} */
  active.forEach(function (e) {
    var root = dsuComp.find(sup(nodeKey(e.a)));
    var g = groups.get(root);
    if (!g) { g = { supers: new Set(), edges: [], batteries: [], idealWires: [] }; groups.set(root, g); }
    g.supers.add(sup(nodeKey(e.a)));
    g.supers.add(sup(nodeKey(e.b)));
    if (rOf(e, wireR) === 0) { g.idealWires.push(e); return; }   /* 理想导线不进矩阵 */
    g.edges.push(e);
    if (e.type === T.BATTERY) g.batteries.push(e);
  });

  groups.forEach(function (g) {
    var supers = Array.from(g.supers).sort();
    var nodes = [];
    /* 分量节点 = 其超节点的所有原节点(供显示/统计) */
    res.nodePhi.forEach(function (v, k) {
      if (g.supers.has(sup(k))) nodes.push(k);
    });
    var comp = { nodes: nodes, hasSource: g.batteries.length > 0, Imax: 0 };
    res.comps.push(comp);
    if (!g.batteries.length) return; /* 无源孤岛:不进线性代数 */

    /* 地 = 最小 id 电池负极(a 端)所在超节点,φ=0 */
    var bat0 = g.batteries.slice().sort(function (x, y) { return x.id - y.id; })[0];
    var ground = sup(nodeKey(bat0.a));

    var idx = new Map();
    supers.forEach(function (k) { if (k !== ground) idx.set(k, idx.size); });
    var n = idx.size;
    var G = [], J = new Array(n).fill(0);
    for (var i = 0; i < n; i++) G.push(new Array(n).fill(0));

    g.edges.forEach(function (e) {
      var r = rOf(e, wireR), g1 = 1 / r, V = emfOf(e);
      var ia = idx.get(sup(nodeKey(e.a)));
      var ib = idx.get(sup(nodeKey(e.b)));
      if (ia != null && ib != null) {
        /* 两端同超节点 = 被理想导线短接:内部环流,不 stamp(否则奇异) */
        if (ia === ib) return;
        G[ia][ia] += g1; G[ib][ib] += g1;
        G[ia][ib] -= g1; G[ib][ia] -= g1;
      } else if (ia != null) { G[ia][ia] += g1; }
      else if (ib != null) { G[ib][ib] += g1; }
      if (V !== 0) {
        if (ib != null) J[ib] += V * g1;
        if (ia != null) J[ia] -= V * g1;
      }
    });

    var x = n > 0 ? gauss(G, J) : [];
    if (n > 0 && !x) {
      /* 奇异矩阵:该分量无法求解。宁可标记未解,也不能静默置零
         (置零会让电池电流变成 V/r 并误判为短路) */
      comp.singular = true;
      nodes.forEach(function (k) { res.nodePhi.set(k, null); });
      return;
    }

    var phiSuper = new Map();
    supers.forEach(function (k) { phiSuper.set(k, k === ground ? 0 : x[idx.get(k)]); });
    nodes.forEach(function (k) { res.nodePhi.set(k, phiSuper.get(sup(k))); });
  });

  /* 死区:浮点残差不得驱动幽灵粒子 */
  var deadband = Math.max(1e-6, 1e-6 * res.Imax);

  /* 非理想边支路电流(自环电池:φa=φb → I=V/r 自动成立) */
  active.forEach(function (e) {
    if (rOf(e, wireR) === 0) return;
    var phiA = res.nodePhi.get(nodeKey(e.a));
    var phiB = res.nodePhi.get(nodeKey(e.b));
    if (phiA == null || phiB == null) { res.edgeI.set(e.id, null); return; }
    var I = (phiA - phiB + emfOf(e)) / rOf(e, wireR);
    if (Math.abs(I) < deadband) I = 0;
    res.edgeI.set(e.id, I);
    if (Math.abs(I) > res.Imax) res.Imax = Math.abs(I);
  });

  /* 理想导线:按簇做 KCL 流量路由 */
  var clusters = new Map(); /* superKey -> {wires:[], pins:Map} */
  active.forEach(function (e) {
    if (rOf(e, wireR) !== 0) return;
    if (res.nodePhi.get(nodeKey(e.a)) == null) { res.edgeI.set(e.id, null); return; }
    var root = sup(nodeKey(e.a));
    var c = clusters.get(root);
    if (!c) { c = { wires: [], pins: new Map() }; clusters.set(root, c); }
    c.wires.push(e);
  });
  /* 簇的引脚流量来自非理想边(含被理想导线短接的环流)。
     注意:一条非理想边的两端可能分属不同簇,引脚要分别归入各自簇 */
  active.forEach(function (e) {
    if (rOf(e, wireR) === 0) return;
    var I = res.edgeI.get(e.id);
    if (I == null) return;
    var ka = nodeKey(e.a), kb = nodeKey(e.b);
    var ca = clusters.get(sup(ka));
    var cb = clusters.get(sup(kb));
    if (ca) ca.pins.set(ka, (ca.pins.get(ka) || 0) - I);   /* 电流从 a 流出簇外 */
    if (cb) cb.pins.set(kb, (cb.pins.get(kb) || 0) + I);   /* 电流从 b 流入簇 */
  });
  clusters.forEach(function (c) {
    var wireI = routeIdealCluster(c.wires, c.pins, res.Imax);
    c.wires.forEach(function (w) {
      var I = wireI.get(w.id) || 0;
      if (Math.abs(I) < deadband) I = 0;
      res.edgeI.set(w.id, I);
      if (Math.abs(I) > res.Imax) res.Imax = Math.abs(I);
    });
  });

  /* φ 范围(只统计已解节点) */
  var pmax = 0, pmin = 0;
  res.nodePhi.forEach(function (v) {
    if (v == null) return;
    if (v > pmax) pmax = v;
    if (v < pmin) pmin = v;
  });
  res.phiMax = pmax; res.phiMin = pmin;

  /* 状态判定:短路 > 断路 > 正常。
     短路判据:任一支路 |I|>20A,或电池端电压塌陷(|I|>0.1A 且 U<0.3E)。
     被理想导线直接短接的电池:φa=φb → U=0、I=V/r,两条判据同时命中。 */
  var anyShort = false;
  res.edgeI.forEach(function (I) {
    if (I != null && Math.abs(I) > SHORT_I) anyShort = true;
  });
  if (!anyShort) edges.forEach(function (e) {
    if (e.type !== T.BATTERY) return;
    var I = res.edgeI.get(e.id);
    if (I == null || Math.abs(I) <= 0.1) return;
    var U = Math.abs(edgeU(e, res)), E = emfOf(e);
    if (U < 0.3 * E) anyShort = true;
  });
  if (!hasBattery) res.status = 'noSource';
  else if (anyShort) res.status = 'short';
  else if (res.Imax < OPEN_I) res.status = 'open';
  else res.status = 'normal';

  return res;
}

/* 支路电流(需先解出 nodePhi);无源孤岛返回 null */
function currentOf(e, sol) {
  var phiA = sol.nodePhi.get(nodeKey(e.a));
  var phiB = sol.nodePhi.get(nodeKey(e.b));
  if (phiA == null || phiB == null) return null;
  return (phiA - phiB + emfOf(e)) / rOf(e);
}

/* 端电压:无源边 = φa − φb(沿 a→b 压降);电池 = φb − φa(正负极间) */
function edgeU(e, sol) {
  var phiA = sol.nodePhi.get(nodeKey(e.a));
  var phiB = sol.nodePhi.get(nodeKey(e.b));
  if (phiA == null || phiB == null) return null;
  return e.type === T.BATTERY ? (phiB - phiA) : (phiA - phiB);
}

/* ---- 单回路检测(电势曲线用)—— 2-core 剥离 ----
 * 返回绕环序列 [{edge, from, to}] (从电池负极出发经电池正极绕行一周),
 * 不是单回路(并联/断路/figure-eight/多电池)返回 null。
 * 电压表探针线(deg=1 悬挂)会被自动剥掉。 */
function findSingleLoop(edges) {
  edges = edges || [];
  var active = edges.filter(isActive);
  if (!active.length) return null;

  var bats = edges.filter(function (e) { return e.type === T.BATTERY; });
  if (bats.length !== 1) return null;
  var bat = bats[0];
  if (active.indexOf(bat) < 0) return null;

  var adj = new Map(), deg = new Map();
  function addAdj(k, e, other) {
    if (!adj.has(k)) adj.set(k, []);
    adj.get(k).push({ e: e, other: other });
    deg.set(k, (deg.get(k) || 0) + 1);
  }
  active.forEach(function (e) {
    addAdj(nodeKey(e.a), e, nodeKey(e.b));
    addAdj(nodeKey(e.b), e, nodeKey(e.a));
  });

  var removed = new Set();
  var deg2 = new Map(deg);
  var queue = [];
  deg.forEach(function (d, k) { if (d <= 1) queue.push(k); });
  while (queue.length) {
    var v = queue.pop();
    (adj.get(v) || []).forEach(function (rec) {
      if (removed.has(rec.e)) return;
      removed.add(rec.e);
      var d = deg2.get(rec.other) - 1;
      deg2.set(rec.other, d);
      if (d === 1) queue.push(rec.other);
    });
  }
  var core = active.filter(function (e) { return !removed.has(e); });
  if (!core.length) return null;

  var cdeg = new Map();
  core.forEach(function (e) {
    var ka = nodeKey(e.a), kb = nodeKey(e.b);
    cdeg.set(ka, (cdeg.get(ka) || 0) + 1);
    cdeg.set(kb, (cdeg.get(kb) || 0) + 1);
  });
  var allDeg2 = true;
  cdeg.forEach(function (d) { if (d !== 2) allDeg2 = false; });
  if (!allDeg2) return null;

  var walk = [{ edge: bat, from: nodeKey(bat.a), to: nodeKey(bat.b) }];
  var node = nodeKey(bat.b), arrivedBy = bat, guard = 0;
  while (node !== nodeKey(bat.a) && guard++ < core.length + 2) {
    var rec = null;
    (adj.get(node) || []).forEach(function (r) {
      if (!removed.has(r.e) && r.e !== arrivedBy) rec = r;
    });
    if (!rec) return null;
    walk.push({ edge: rec.e, from: node, to: rec.other });
    arrivedBy = rec.e;
    node = rec.other;
  }
  if (walk.length !== core.length) return null;
  return walk;
}

export const solver = {
  solve: solve,
  currentOf: currentOf,
  edgeU: edgeU,
  emfOf: emfOf,
  rOf: rOf,
  isActive: isActive,
  findSingleLoop: findSingleLoop,
  R_WIRE: R_WIRE, R_BAT: R_BAT, R_AM: R_AM,
  SHORT_I: SHORT_I, OPEN_I: OPEN_I
};

