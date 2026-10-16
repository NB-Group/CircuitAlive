/* FieldFlow · model — 电路数据模型(边 Map + 快照式 undo/redo,Node 可测)
 *
 * 节点不存储,由边的端点派生。边的占位规则(Falstad 手感):
 *   - 元件放到导线边上 → 替换导线;
 *   - 元件放到其他元件上 → 拒绝(返回 false);
 *   - 导线只铺在空边上。
 * 所有变更走 mutate():先压 undo 快照,再执行,最后发 'changed' 事件。 */
(function (global) {
'use strict';

var FF = global.FF || (global.FF = {});
var T = FF.T;
var UNDO_CAP = 100;

function Model() {
  this.edges = new Map();   /* edgeKey -> edge */
  this.wireR = 0;           /* 全局导线电阻(0 = 理想);所有导线统一 */
  this.undoStack = [];
  this.redoStack = [];
}

Model.prototype.list = function () {
  return Array.from(this.edges.values());
};

/* ---- 序列化(快照 = undo 格式 = 持久化格式,保留 id 稳定性) ---- */
Model.prototype.serialize = function () {
  return {
    v: 1,
    wireR: this.wireR || 0,
    edges: this.list().map(function (e) {
      var p = e.type === T.WIRE ? {} : e.props;   /* 导线不再有个体属性 */
      return { id: e.id, t: e.type, a: e.a, b: e.b, p: p };
    })
  };
};

Model.prototype.restore = function (data) {
  this.edges.clear();
  var self = this;
  var maxId = 0;
  this.wireR = 0;
  /* 旧版数据迁移:曾有单根导线自定义电阻 → 取第一个非零值作全局值 */
  (data && data.edges || []).forEach(function (r) {
    if (r.t === T.WIRE && r.p && r.p.r > 0 && self.wireR === 0) self.wireR = r.p.r;
  });
  if (data && data.wireR) this.wireR = data.wireR;
  (data && data.edges || []).forEach(function (r) {
    var e = FF.E(r.t, r.a[0], r.a[1], r.b[0], r.b[1], r.p);
    e.id = r.id;                      /* 保留原 id,渲染层可做增量更新 */
    e.key = FF.edgeKey(r.a, r.b);
    if (r.id > maxId) maxId = r.id;
    self.edges.set(e.key, e);
  });
  FF.setSeq(maxId);
};

/* ---- 变更包装:单次 undo 粒度 ---- */
Model.prototype.mutate = function (fn) {
  var snap = JSON.stringify(this.serialize());
  var result = fn();
  /* 无实际变化时不污染 undo 栈 */
  if (snap === JSON.stringify(this.serialize())) return result;
  this.undoStack.push(snap);
  if (this.undoStack.length > UNDO_CAP) this.undoStack.shift();
  this.redoStack.length = 0;
  FF.bus.emit('changed');
  return result;
};

Model.prototype.undo = function () {
  if (!this.undoStack.length) return false;
  this.redoStack.push(JSON.stringify(this.serialize()));
  this.restore(JSON.parse(this.undoStack.pop()));
  FF.bus.emit('changed');
  return true;
};

Model.prototype.redo = function () {
  if (!this.redoStack.length) return false;
  this.undoStack.push(JSON.stringify(this.serialize()));
  this.restore(JSON.parse(this.redoStack.pop()));
  FF.bus.emit('changed');
  return true;
};

Model.prototype.canUndo = function () { return this.undoStack.length > 0; };
Model.prototype.canRedo = function () { return this.redoStack.length > 0; };

Model.prototype.clear = function () {
  var self = this;
  this.mutate(function () { self.edges.clear(); self.wireR = 0; });
};

/* 全局导线电阻(所有导线统一;0 = 理想) */
Model.prototype.setWireR = function (v) {
  var self = this;
  return this.mutate(function () {
    self.wireR = v === 0 ? 0 : FF.clamp(+v || 0.001, 0.001, 50);
  });
};

/* ---- 批量拖画支持:拖拽过程直接改,松手时一次 commit ----
 * interact 在拖画开始时取 snapshot(),拖动中调用 raw* 原语(不入 undo 栈),
 * 结束时若内容有变则 commit(snapshot),整个手势 = 一次 undo。 */
Model.prototype.serializeStr = function () {
  return JSON.stringify(this.serialize());
};

Model.prototype.rawPlaceWire = function (a, b) {
  var key = FF.edgeKey(a, b);
  if (this.edges.has(key)) return false;
  this.edges.set(key, FF.E(T.WIRE, a[0], a[1], b[0], b[1], {}));
  return true;
};

Model.prototype.rawRemove = function (key) {
  return this.edges.delete(key);
};

Model.prototype.commit = function (snapshotStr) {
  if (snapshotStr === this.serializeStr()) return false;
  this.undoStack.push(snapshotStr);
  if (this.undoStack.length > UNDO_CAP) this.undoStack.shift();
  this.redoStack.length = 0;
  FF.bus.emit('changed');
  return true;
};

/* ---- 放置 ----
 * 元件:目标边为空或为导线时可放(替换导线);否则拒绝。 */
Model.prototype.place = function (type, a, b, props) {
  var self = this;
  return this.mutate(function () {
    var key = FF.edgeKey(a, b);
    var occ = self.edges.get(key);
    if (occ && occ.type !== T.WIRE) return false;
    var e = FF.E(type, a[0], a[1], b[0], b[1], props || {});
    self.edges.set(key, e);
    return e;
  });
};

/* 导线只铺空边;返回是否新增 */
Model.prototype.placeWire = function (a, b) {
  var self = this;
  return this.mutate(function () {
    var key = FF.edgeKey(a, b);
    if (self.edges.has(key)) return false;
    self.edges.set(key, FF.E(T.WIRE, a[0], a[1], b[0], b[1], {}));
    return true;
  });
};

Model.prototype.remove = function (key) {
  var self = this;
  return this.mutate(function () {
    return self.edges.delete(key);
  });
};

/* 合并式属性更新(数值钳制在 solver 之外的入口统一做) */
Model.prototype.setProps = function (key, patch) {
  var self = this;
  return this.mutate(function () {
    var e = self.edges.get(key);
    if (!e) return false;
    for (var k in patch) e.props[k] = patch[k];
    return e;
  });
};

/* 翻转极性(交换 a↔b:电池正负极对调、开关倾斜方向翻转) */
Model.prototype.flip = function (key) {
  var self = this;
  return this.mutate(function () {
    var e = self.edges.get(key);
    if (!e) return false;
    var t = e.a; e.a = e.b; e.b = t;
    return e;
  });
};

/* 开关开合切换 */
Model.prototype.toggleSwitch = function (key) {
  var self = this;
  return this.mutate(function () {
    var e = self.edges.get(key);
    if (!e || e.type !== T.SWITCH) return false;
    e.props.closed = !e.props.closed;
    return e.props.closed;
  });
};

/* 批量载入(预置电路):整体作为一次 undo 粒度 */
Model.prototype.loadPreset = function (edgeTuples) {
  var self = this;
  this.mutate(function () {
    self.edges.clear();
    edgeTuples.forEach(function (t) {
      var e = FF.E(t[0], t[1], t[2], t[3], t[4], t[5] || {});
      self.edges.set(e.key, e);
    });
  });
};

/* ---- 派生量 ---- */

/* 节点度数(在全部画出的边上数,含断开关/电压表——结点是拓扑概念) */
Model.prototype.nodeDegrees = function () {
  var deg = new Map();
  this.edges.forEach(function (e) {
    var ka = FF.nodeKey(e.a), kb = FF.nodeKey(e.b);
    deg.set(ka, (deg.get(ka) || 0) + 1);
    deg.set(kb, (deg.get(kb) || 0) + 1);
  });
  return deg;
};

/* 邻接表:nodeKey -> [{edge, other}] */
Model.prototype.adjacency = function () {
  var adj = new Map();
  function add(k, e, other) {
    if (!adj.has(k)) adj.set(k, []);
    adj.get(k).push({ edge: e, other: other });
  }
  this.edges.forEach(function (e) {
    add(FF.nodeKey(e.a), e, FF.nodeKey(e.b));
    add(FF.nodeKey(e.b), e, FF.nodeKey(e.a));
  });
  return adj;
};

FF.Model = Model;

if (typeof module !== 'undefined' && module.exports) module.exports = FF;
})(typeof window !== 'undefined' ? window : globalThis);
