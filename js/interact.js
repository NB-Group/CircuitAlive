/* FieldFlow · interact — 工具状态机与指针/键盘/触摸交互
 *
 * 工具:select(默认)· wire · eraser · 各元件放置(保持武装便于连放)。
 * 命中一律走几何计算,不依赖 DOM 事件目标:
 *   hitEdge    只找已存在的边(选择/擦除)
 *   gridEdgeAt 找光标下最近的网格边,空边也算(放置/预览)
 *
 * 导线 = 跟随式布线:按下定起点(磁吸已有节点),拖动逐格跟随光标铺线,
 * 松手一次提交(一次 undo);原地单击 = 放光标下那一段。
 * 开关:任意工具下点符号中部 = 开合。滑变:拖符号上的滑片把手直接调阻值。
 * 触摸:单指 = 鼠标;双指 = 平移 + 捏合缩放。 */
(function (global) {
'use strict';

var FF = global.FF || (global.FF = {});
var T = FF.T;
var G = FF.GRID;

var svg = null;
var model = null;

var I = {
  tool: 'select',
  armed: null,          /* {type, props} 放置武装 */
  hoverKey: null,
  ghost: null,          /* 放置预览 <g> */
  drag: null,           /* {mode:'wire'|'erase'|'pan'|'wiper', ...} */
  pinch: null,          /* 双指手势状态 */
  pointers: new Map(),  /* 活动指针(触摸多点) */
  spaceDown: false,
  refNode: null,        /* 电势零点(nodeKey|null = 电池负极) */
  recentPlaces: []
};

var HINTS = {
  select: '点击元件选中 · 点开关中部切换开合 · 拖滑变滑片调阻值 · 双击导线开截面探针',
  wire: '单击空边放一段 · 按住拖动,导线逐格跟随光标铺过去',
  eraser: '点击或拖过要删除的边',
  battery: '点击网格边放置电池(R 翻转正负极,Esc 结束)',
  switch: '点击网格边放置开关,再点符号中部切换开合',
  resistor: '点击网格边放置定值电阻',
  lamp: '点击网格边放置小灯泡',
  rheostat: '点击网格边放置滑动变阻器,拖符号上的滑片调阻值',
  ammeter: '点击网格边放置电流表(串联进电路)',
  voltmeter: '点击网格边放置电压表(并联在被测元件两端)'
};

function hint(msg) {
  var el = document.getElementById('status-hint');
  if (el) el.textContent = msg;
}

function setTool(t, props) {
  cancelDrag();
  I.tool = t;
  I.armed = props ? { type: t, props: props } : null;
  clearGhost();
  document.querySelectorAll('.pal-btn').forEach(function (b) {
    b.classList.toggle('active', b.dataset.type === t);
  });
  svg.setAttribute('class', t === 'select' ? 'tool-select' : (t === 'eraser' ? 'tool-eraser' : ''));
  hint(HINTS[t] || '');
  FF.bus.emit('tool', t);
}

/* ---- 放置预览 ---- */

function clearGhost() {
  if (I.ghost) { I.ghost.remove(); I.ghost = null; }
  I.hoverKey = null;
}

function showGhost(key) {
  clearGhost();
  if (!I.armed || !key) return;
  var occ = model.edges.get(key);
  if (occ && occ.type !== T.WIRE) return;      /* 被元件占用,不可放 */
  if (occ && I.armed.type === T.WIRE) return;  /* 导线叠导线无意义 */
  var ends = FF.render.keyEnds(key);
  var pa = ends[0], pb = ends[1];
  var angle = FF.symbols.angleOf(pa, pb);
  I.ghost = FF.svgEl('g', {
    'class': 'sym',
    opacity: 0.45,
    transform: 'translate(' + (pa[0] + pb[0]) / 2 * G + ',' + (pa[1] + pb[1]) / 2 * G + ') rotate(' + angle + ')'
  }, FF.render.overlay());
  if (I.armed.type === T.WIRE) I.ghost.setAttribute('stroke-dasharray', '6 4');
  I.ghost.appendChild(FF.symbols.build(I.armed.type, angle, I.armed.props));
}

/* ---- 磁吸:让新导线一定接到已有电路上 ---- */

function nodeDeg() {
  if (!I._degCache) I._degCache = model.nodeDegrees();
  return I._degCache;
}
FF.bus.on('changed', function () { I._degCache = null; });

/* 光标附近有"已有节点"(距 < 0.4 格)就吸过去,否则取最近格点 */
function snapPoint(world) {
  var deg = nodeDeg();
  var gx = Math.round(world.x / G), gy = Math.round(world.y / G);
  var cx = Math.floor(world.x / G), cy = Math.floor(world.y / G);
  var cand = [[gx, gy], [cx, cy], [cx + 1, cy], [cx, cy + 1], [cx + 1, cy + 1]];
  var best = null, bestD = G * 0.4;
  cand.forEach(function (p) {
    if (!deg.has(p[0] + ',' + p[1])) return;
    var d = Math.hypot(world.x - p[0] * G, world.y - p[1] * G);
    if (d < bestD) { bestD = d; best = p; }
  });
  return best || [gx, gy];
}

function distToSeg(pt, a, b) {
  var ax = a[0] * G, ay = a[1] * G, bx = b[0] * G, by = b[1] * G;
  var vx = bx - ax, vy = by - ay;
  var t = FF.clamp(((pt.x - ax) * vx + (pt.y - ay) * vy) / (vx * vx + vy * vy), 0, 1);
  return Math.hypot(pt.x - (ax + vx * t), pt.y - (ay + vy * t));
}

/* 单击放一段:以磁吸节点为中心,选离光标最近的"空边" */
function clickPlaceSegment(world) {
  var N = snapPoint(world);
  var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  var best = null, bestD = G * 0.6;
  dirs.forEach(function (d) {
    var a = N, b = [N[0] + d[0], N[1] + d[1]];
    if (model.edges.has(FF.edgeKey(a, b))) return;
    var dd = distToSeg(world, a, b);
    if (dd < bestD) { bestD = dd; best = [a, b]; }
  });
  if (best) {
    model.placeWire(best[0], best[1]);
    I.recentPlaces.push(performance.now());
  } else {
    hint('该节点四周都已被占用');
  }
}

function clearPreview() {
  if (I.preview) { I.preview.remove(); I.preview = null; }
}

function cancelDrag() {
  I.drag = null;
  clearPreview();
}

/* ---- 滑变滑片:把世界坐标投到符号局部坐标 ----
 * lx ∈ [-20,20] 沿边方向(局部 +x);ly 法向 */
function rheostatLocal(e, world) {
  var ax = e.a[0] * G, ay = e.a[1] * G, bx = e.b[0] * G, by = e.b[1] * G;
  var len = Math.hypot(bx - ax, by - ay);
  var ux = (bx - ax) / len, uy = (by - ay) / len;
  var mx = (ax + bx) / 2, my = (ay + by) / 2;
  var dx = world.x - mx, dy = world.y - my;
  return { lx: dx * ux + dy * uy, ly: -dx * uy + dy * ux };
}

/* 光标是否抓到滑轨条带:符号上方的箭头线区域(法向 −18..−4) */
function wiperGrab(e, world) {
  var loc = rheostatLocal(e, world);
  return loc.ly <= -3.5 && loc.ly >= -18.5 && loc.lx >= -17 && loc.lx <= 17;
}

/* ---- 指针 ---- */

function onDown(ev) {
  I.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

  /* 双指:进入捏合/平移手势,丢弃未完成的单指手势 */
  if (I.pointers.size === 2) {
    cancelDrag();
    I.pinch = { d0: pinchDist(), c0: pinchCenter(), view0: Object.assign({}, FF.render.view()) };
    return;
  }

  if (ev.button === 1 || ev.button === 2 || I.spaceDown) {
    I.drag = { mode: 'pan', sx: ev.clientX, sy: ev.clientY };
    ev.preventDefault();
    return;
  }
  if (ev.button !== 0) return;
  var world = FF.render.screenToWorld(ev.clientX, ev.clientY);

  /* 点开关符号中部 = 开合,与当前工具无关(橡皮除外,它负责删除) */
  var hitKey = FF.render.hitEdge(world);
  var hit = hitKey ? model.edges.get(hitKey) : null;
  if (hit && hit.type === T.SWITCH && I.tool !== 'eraser') {
    var smx = (hit.a[0] + hit.b[0]) / 2 * G, smy = (hit.a[1] + hit.b[1]) / 2 * G;
    if (Math.hypot(world.x - smx, world.y - smy) < 16) {
      FF.render.select(hitKey);
      FF.bus.emit('selected', hitKey);
      model.toggleSwitch(hitKey);
      hint(hit.props.closed ? '开关闭合 — 电路接通' : '开关断开 — 电路断开');
      return;
    }
  }

  /* 抓滑变滑轨 = 直接拖拽调阻值(任何工具下) */
  if (hit && hit.type === T.RHEOSTAT && wiperGrab(hit, world)) {
    FF.render.select(hitKey);
    FF.bus.emit('selected', hitKey);
    I.drag = { mode: 'wiper', edge: hit, key: hitKey, snap: model.serializeStr() };
    hint('拖动滑片调阻值');
    return;
  }

  switch (I.tool) {
    case 'select': {
      var key = FF.render.hitEdge(world);
      if (key) {
        FF.render.select(key);
        FF.bus.emit('selected', key);
      } else {
        FF.render.select(null);
        FF.bus.emit('selected', null);
      }
      break;
    }

    case 'wire': {
      var N = snapPoint(world);
      I.drag = { mode: 'wire', last: N, everMoved: false, snap: model.serializeStr() };
      break;
    }

    case 'eraser': {
      var ekey = FF.render.hitEdge(world);
      if (ekey) {
        I.drag = { mode: 'erase', snap: model.serializeStr() };
        model.rawRemove(ekey);
        FF.bus.emit('changed');
      }
      break;
    }

    default: {   /* 元件放置:空边直接放,导线边替换,元件边拒绝 */
      var gkey = FF.render.gridEdgeAt(world);
      if (!gkey) break;
      var occ = model.edges.get(gkey);
      if (occ && occ.type !== T.WIRE) {
        hint('该边已有元件 — 先删除,或换个位置');
        break;
      }
      var ends = FF.render.keyEnds(gkey);
      var res = model.place(I.tool, ends[0], ends[1], I.armed ? I.armed.props : {});
      if (res) {
        FF.render.select(gkey);
        FF.bus.emit('selected', gkey);
      }
    }
  }
  if (I.drag) {
    try { svg.setPointerCapture(ev.pointerId); } catch (err) { /* 合成事件/多点下可能抛错,窗口级监听兜底 */ }
  }
}

function pinchDist() {
  var pts = Array.from(I.pointers.values());
  if (pts.length < 2) return 0;
  return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
}

function pinchCenter() {
  var pts = Array.from(I.pointers.values());
  if (!pts.length) return { x: 0, y: 0 };
  var cx = 0, cy = 0;
  pts.forEach(function (p) { cx += p.x; cy += p.y; });
  return { x: cx / pts.length, y: cy / pts.length };
}

function onMove(ev) {
  if (I.pointers.has(ev.pointerId)) {
    I.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  }

  /* 双指手势:捏合缩放 + 中点平移(锚定手势起始视图) */
  if (I.pinch && I.pointers.size >= 2) {
    var d = pinchDist(), c = pinchCenter();
    var v0 = I.pinch.view0;
    var r = svg.getBoundingClientRect();
    var scale = FF.clamp(I.pinch.d0 / Math.max(d, 10), 0.2, 5);
    var nw = FF.clamp(v0.w * scale, 200, 4000);
    var nh = nw * (r.height / r.width || 0.65);
    FF.render.setView(
      v0.x + v0.w / 2 - (c.x - I.pinch.c0.x) * nw / r.width - nw / 2,
      v0.y + v0.h / 2 - (c.y - I.pinch.c0.y) * nh / r.height - nh / 2,
      nw
    );
    return;
  }

  var world = FF.render.screenToWorld(ev.clientX, ev.clientY);

  if (I.drag && I.drag.mode === 'pan') {
    var r2 = svg.getBoundingClientRect();
    FF.render.panBy((ev.clientX - I.drag.sx) * FF.render.view().w / r2.width,
                    (ev.clientY - I.drag.sy) * FF.render.view().h / r2.height);
    I.drag.sx = ev.clientX; I.drag.sy = ev.clientY;
    return;
  }

  /* 滑变滑片拖拽:投影到 [0,1] */
  if (I.drag && I.drag.mode === 'wiper') {
    var we = I.drag.edge;
    if (!model.edges.get(I.drag.key)) { I.drag = null; return; }  /* 元件被删 */
    var loc = rheostatLocal(we, world);
    we.props.wiper = FF.clamp((loc.lx + 13) / 26, 0, 1);
    FF.bus.emit('changed');
    return;
  }

  /* 跟随式布线:朝光标逐格推进(主轴优先一格一格铺) */
  if (I.drag && I.drag.mode === 'wire') {
    var target = snapPoint(world);
    var guard = 0;
    while (guard++ < 64) {
      var dx = target[0] - I.drag.last[0], dy = target[1] - I.drag.last[1];
      if (Math.abs(dx) + Math.abs(dy) === 0) break;
      var next;
      if (Math.abs(dx) >= Math.abs(dy)) next = [I.drag.last[0] + Math.sign(dx), I.drag.last[1]];
      else next = [I.drag.last[0], I.drag.last[1] + Math.sign(dy)];
      if (model.rawPlaceWire(I.drag.last, next)) FF.bus.emit('changed');
      I.drag.everMoved = true;
      I.drag.last = next;
    }
    return;
  }

  if (I.drag && I.drag.mode === 'erase') {
    var dkey = FF.render.hitEdge(world);
    if (dkey && model.rawRemove(dkey)) FF.bus.emit('changed');
    return;
  }

  /* 悬停预览(放置工具) */
  if (I.armed) {
    var hk = FF.render.gridEdgeAt(world);
    if (hk !== I.hoverKey) showGhost(hk);
  }
}

function onUp(ev) {
  I.pointers.delete(ev.pointerId);
  if (I.pinch && I.pointers.size < 2) I.pinch = null;
  if (!I.drag) return;
  var d = I.drag;
  clearPreview();
  I.drag = null;

  if (d.mode === 'pan') return;

  if (d.mode === 'wiper') {
    model.commit(d.snap);   /* 整个拖拽 = 一次 undo */
    hint('滑片位置: ' + FF.fmt(FF.solver.rOf(d.edge), 'Ω'));
    return;
  }

  if (d.mode === 'wire') {
    if (!d.everMoved) {
      /* 原地单击:以磁吸节点为中心放一段 */
      var world = FF.render.screenToWorld(ev.clientX, ev.clientY);
      clickPlaceSegment(world);
      return;
    }
    model.commit(d.snap);
    return;
  }

  if (d.mode === 'erase') model.commit(d.snap);
}

/* ---- 双击:导线→截面探针 · 节点→电势零点 ---- */

function onDblClick(ev) {
  var world = FF.render.screenToWorld(ev.clientX, ev.clientY);
  var node = FF.render.nodeAt(world);
  if (node && FF.render.opts().potential) {
    I.refNode = FF.nodeKey(node);
    hint('电势零点已设为 (' + node[0] + ',' + node[1] + '),φ 参考平移');
    FF.bus.emit('changed');
    return;
  }
  var key = FF.render.hitEdge(world);
  if (key) {
    var e = model.edges.get(key);
    if (e && e.type === T.WIRE) {
      /* 导线工具下,双击的前两次单击可能误放了支线段 —— 收回(它们是最新的变更) */
      if (I.tool === 'wire' && I.recentPlaces.length) {
        var now = performance.now(), n = 0;
        I.recentPlaces = I.recentPlaces.filter(function (t) {
          if (now - t < 500) { n++; return false; }
          return true;
        });
        while (n-- > 0) model.undo();
      }
      FF.render.probe(FF.render.probe() === key ? null : key);
      FF.bus.emit('probe', FF.render.probe());
      hint(FF.render.probe() ? '截面探针已放置(右侧面板演示 I=q/t)' : '探针已移除');
    } else if (node) {
      I.refNode = FF.nodeKey(node);
      FF.bus.emit('changed');
    }
  }
}

/* ---- 键盘 ---- */

function onKeyDown(ev) {
  if (ev.target && /INPUT|SELECT|TEXTAREA/.test(ev.target.tagName)) return;
  if (ev.code === 'Space') { I.spaceDown = true; svg.classList.add('panning'); ev.preventDefault(); return; }
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') { ev.preventDefault(); model.undo(); return; }
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'y') { ev.preventDefault(); model.redo(); return; }
  switch (ev.key) {
    case 'Escape':
      cancelDrag();
      setTool('select');
      FF.render.select(null);
      FF.bus.emit('selected', null);
      break;
    case 'r': case 'R': {
      var sk = FF.render.selectedKey();
      if (sk) { model.flip(sk); hint('已翻转极性(交换两端)'); }
      break;
    }
    case 'Delete': case 'Backspace': {
      var sk2 = FF.render.selectedKey();
      if (sk2) model.remove(sk2);
      ev.preventDefault();
      break;
    }
    case 'f': case 'F':
      FF.render.fitView();
      break;
  }
}

function onKeyUp(ev) {
  if (ev.code === 'Space') { I.spaceDown = false; svg.classList.remove('panning'); }
}

/* ---- 初始化 ---- */

FF.interact = {
  init: function (svgEl, modelObj) {
    svg = svgEl;
    model = modelObj;

    svg.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    svg.addEventListener('dblclick', onDblClick);
    svg.addEventListener('wheel', function (ev) {
      ev.preventDefault();
      FF.render.zoomAt(ev.clientX, ev.clientY, ev.deltaY < 0 ? 1.15 : 1 / 1.15);
    }, { passive: false });
    svg.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });
    svg.addEventListener('pointerleave', clearGhost);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    setTool('select');
  },
  setTool: setTool,
  tool: function () { return I.tool; },
  armed: function () { return I.armed; },
  refNode: function () { return I.refNode; },
  resetRef: function () { I.refNode = null; FF.bus.emit('changed'); },
  hint: hint
};

if (typeof module !== 'undefined' && module.exports) module.exports = FF;
})(typeof window !== 'undefined' ? window : globalThis);
