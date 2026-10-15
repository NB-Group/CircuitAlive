/* FieldFlow · solver — 节点电压法直流求解器(纯函数,Node 可测)
 *
 * 物理模型(已验证):
 *  - 所有参与求解的边都是"小电阻 + (电池的)诺顿电流源",整体是 SPD 线性系统;
 *  - 电压表、断开的开关不进线性代数(开路);
 *  - 连通分量仅在含电池时才求解(纯导线孤岛是奇异拉普拉斯矩阵,直接跳过);
 *  - 电池 a 端为负极、b 端为正极,电动势把电势从 a 抬到 b。
 *
 * 最易错点(有专门单测):电池边电流必须含电动势项
 *   无源边:  I_a→b = (φa − φb) / r
 *   电池边:  I_a→b = (φa − φb + V) / r
 * 漏掉 +V 则幅值碰巧正确、符号与物理全错。
 */
(function (global) {
'use strict';

var FF = global.FF || (global.FF = {});
var T = FF.T;

/* 内部小电阻。注意:导线电阻不得低于 1e-3,再低会破坏数值条件 */
var R_WIRE = 1e-3;
var R_BAT = 1e-3;
var R_AM = 1e-4;

var SHORT_I = 20;   /* 任一支路 |I| 超过此值 → 判定短路 */
var OPEN_I = 1e-6;  /* 有电池但最大电流低于此值 → 判定断路 */

function clampNum(v, lo, hi) {
  v = +v;
  if (!isFinite(v)) v = lo;
  return FF.clamp(v, lo, hi);
}

/* 边的电阻(仅对参与求解的边调用) */
function rOf(e) {
  var p = e.props || {};
  switch (e.type) {
    case T.WIRE: return R_WIRE;
    case T.SWITCH: return p.closed ? R_WIRE : Infinity;
    case T.AMMETER: return R_AM;
    case T.BATTERY: return R_BAT;
    case T.RESISTOR:
    case T.LAMP: return clampNum(p.R, FF.LIMITS.R[0], FF.LIMITS.R[1]);
    case T.RHEOSTAT: {
      var Rmax = clampNum(p.Rmax, FF.LIMITS.Rmax[0], FF.LIMITS.Rmax[1]);
      var w = clampNum(p.wiper == null ? 1 : p.wiper, 0, 1);
      return Math.max(0.01, w * Rmax);
    }
    default: return Infinity;
  }
}

/* 电动势:电池边从 a 端抬到 b 端的电势增量 */
function emfOf(e) {
  if (e.type !== T.BATTERY) return 0;
  return clampNum((e.props || {}).V, FF.LIMITS.V[0], FF.LIMITS.V[1]);
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

/* ---- 主求解 ----
 * edges: 边数组(FF.E 构造)。返回:
 * {
 *   nodePhi: Map<nodeKey, number|null>   // null = 无源孤岛(未定义,显示"—")
 *   edgeI:   Map<edgeId,  number|null>   // 沿 a→b 方向的支路电流
 *   comps:   [{ nodes, hasSource, Imax }]
 *   Imax, phiMax, phiMin, hasBattery,
 *   status: 'empty'|'noSource'|'short'|'open'|'normal'
 * }
 */
function solve(edges) {
  edges = edges || [];
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

  /* 所有出现过的节点都登记(含电压表/断开关端点),默认未解 */
  edges.forEach(function (e) {
    res.nodePhi.set(FF.nodeKey(e.a), null);
    res.nodePhi.set(FF.nodeKey(e.b), null);
  });

  /* 激活边上的连通分量 */
  var dsu = new DSU();
  active.forEach(function (e) { dsu.union(FF.nodeKey(e.a), FF.nodeKey(e.b)); });

  var groups = new Map(); /* root -> {nodes:Set, edges:[], batteries:[]} */
  active.forEach(function (e) {
    var root = dsu.find(FF.nodeKey(e.a));
    var g = groups.get(root);
    if (!g) { g = { nodes: new Set(), edges: [], batteries: [] }; groups.set(root, g); }
    g.nodes.add(FF.nodeKey(e.a));
    g.nodes.add(FF.nodeKey(e.b));
    g.edges.push(e);
    if (e.type === T.BATTERY) g.batteries.push(e);
  });

  groups.forEach(function (g) {
    var nodes = Array.from(g.nodes).sort();
    var comp = { nodes: nodes, hasSource: g.batteries.length > 0, Imax: 0 };
    res.comps.push(comp);

    if (!g.batteries.length) return; /* 无源孤岛:不进线性代数 */

    /* 地 = 最小 id 电池的负极(a 端),φ=0。确定性选取 */
    var bat0 = g.batteries.slice().sort(function (x, y) { return x.id - y.id; })[0];
    var ground = FF.nodeKey(bat0.a);

    var idx = new Map();
    nodes.forEach(function (k) { if (k !== ground) idx.set(k, idx.size); });
    var n = idx.size;
    var G = [], J = new Array(n).fill(0);
    for (var i = 0; i < n; i++) G.push(new Array(n).fill(0));

    /* 诺顿_stamp:电阻导纳进 G;电池再注入电流源 J[b]+=V·g, J[a]−=V·g。
       地节点行/列直接不建(φ_ground=0),其对角贡献照常计入其它节点。 */
    g.edges.forEach(function (e) {
      var r = rOf(e), g1 = 1 / r, V = emfOf(e);
      var ka = FF.nodeKey(e.a), kb = FF.nodeKey(e.b);
      var ia = idx.get(ka), ib = idx.get(kb);
      if (ia != null && ib != null) {
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
    if (n === 0) x = [];
    else if (!x) x = nodes.map(function () { return 0; }); /* 保险:不应发生 */

    nodes.forEach(function (k) {
      res.nodePhi.set(k, k === ground ? 0 : x[idx.get(k)]);
    });

    /* 分量内最大电流(用于死区阈值与状态) */
    g.edges.forEach(function (e) {
      var I = Math.abs(currentOf(e, res));
      if (I > comp.Imax) comp.Imax = I;
    });
    if (comp.Imax > res.Imax) res.Imax = comp.Imax;
  });

  /* 死区:浮点残差(如电压表探针线 ~1e-5 A)不得驱动幽灵粒子 */
  var deadband = Math.max(1e-6, 1e-6 * res.Imax);
  active.forEach(function (e) {
    var phiA = res.nodePhi.get(FF.nodeKey(e.a));
    var phiB = res.nodePhi.get(FF.nodeKey(e.b));
    if (phiA == null || phiB == null) { res.edgeI.set(e.id, null); return; }
    var I = (phiA - phiB + emfOf(e)) / rOf(e);
    if (Math.abs(I) < deadband) I = 0;
    res.edgeI.set(e.id, I);
  });

  /* φ 范围(只统计已解节点) */
  var pmax = 0, pmin = 0;
  res.nodePhi.forEach(function (v) {
    if (v == null) return;
    if (v > pmax) pmax = v;
    if (v < pmin) pmin = v;
  });
  res.phiMax = pmax; res.phiMin = pmin;

  /* 状态判定:短路 > 断路 > 正常 */
  var anyShort = false;
  res.edgeI.forEach(function (I) {
    if (I != null && Math.abs(I) > SHORT_I) anyShort = true;
  });
  if (!hasBattery) res.status = 'noSource';
  else if (anyShort) res.status = 'short';
  else if (res.Imax < OPEN_I) res.status = 'open';
  else res.status = 'normal';

  return res;
}

/* 支路电流(需先解出 nodePhi);无源孤岛返回 null */
function currentOf(e, sol) {
  var phiA = sol.nodePhi.get(FF.nodeKey(e.a));
  var phiB = sol.nodePhi.get(FF.nodeKey(e.b));
  if (phiA == null || phiB == null) return null;
  return (phiA - phiB + emfOf(e)) / rOf(e);
}

/* 端电压:无源边 = φa − φb(沿 a→b 压降);电池 = φb − φa(正负极间) */
function edgeU(e, sol) {
  var phiA = sol.nodePhi.get(FF.nodeKey(e.a));
  var phiB = sol.nodePhi.get(FF.nodeKey(e.b));
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
  if (active.indexOf(bat) < 0) return null; /* 电池不在激活图上(理论上不可能) */

  var adj = new Map(), deg = new Map();
  function addAdj(k, e, other) {
    if (!adj.has(k)) adj.set(k, []);
    adj.get(k).push({ e: e, other: other });
    deg.set(k, (deg.get(k) || 0) + 1);
  }
  active.forEach(function (e) {
    addAdj(FF.nodeKey(e.a), e, FF.nodeKey(e.b));
    addAdj(FF.nodeKey(e.b), e, FF.nodeKey(e.a));
  });

  /* 剥掉所有悬挂链(电压表探针、断开支路) */
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

  /* 单回路 ⇔ 核心所有节点度数恰为 2 */
  var cdeg = new Map();
  core.forEach(function (e) {
    var ka = FF.nodeKey(e.a), kb = FF.nodeKey(e.b);
    cdeg.set(ka, (cdeg.get(ka) || 0) + 1);
    cdeg.set(kb, (cdeg.get(kb) || 0) + 1);
  });
  var allDeg2 = true;
  cdeg.forEach(function (d) { if (d !== 2) allDeg2 = false; });
  if (!allDeg2) return null;

  /* 从电池出发绕行一周;走不完一圈(多个不相连环)则不是单环 */
  var walk = [{ edge: bat, from: FF.nodeKey(bat.a), to: FF.nodeKey(bat.b) }];
  var node = FF.nodeKey(bat.b), arrivedBy = bat, guard = 0;
  while (node !== FF.nodeKey(bat.a) && guard++ < core.length + 2) {
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

FF.solver = {
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

if (typeof module !== 'undefined' && module.exports) module.exports = FF;
})(typeof window !== 'undefined' ? window : globalThis);
