/* FieldFlow · interact — 工具状态机与指针/键盘交互
 *
 * 工具:select(默认)· wire · eraser · 各元件放置(保持武装便于连放)。
 * 命中一律走几何计算,不依赖 DOM 事件目标:
 *   hitEdge    只找已存在的边(选择/擦除)
 *   gridEdgeAt 找光标下最近的网格边,空边也算(放置/预览的关键)
 *
 * 导线 = L 形布线:按下定起点,拖动实时预览直角路径,松手整条落线(一次 undo);
 * 原地单击 = 只放光标下那一段。 */
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
  preview: null,        /* 导线 L 形预览 <g> */
  drag: null,           /* {mode:'wire'|'erase'|'pan', ...} */
  spaceDown: false,
  refNode: null         /* 电势零点(nodeKey|null = 电池负极) */
};

var HINTS = {
  select: '点击元件选中 · 点开关切换开合 · 双击导线开截面探针 · 双击节点设电势零点',
  wire: '单击空边放一段 · 按住拖到目标松手,L 形直角布线',
  eraser: '点击或拖过要删除的边',
  battery: '点击网格边放置电池(R 翻转正负极,Esc 结束)',
  switch: '点击网格边放置开关,再点符号切换开合',
  resistor: '点击网格边放置定值电阻',
  lamp: '点击网格边放置小灯泡',
  rheostat: '点击网格边放置滑动变阻器(选中后右侧调滑片)',
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

/* 光标附近有"已有节点"(距 < 0.4 格)就吸过去,否则取最近格点。
 * 这保证在导线附近按下/松手时一定接到它的端点上,而不是隔壁空格点。 */
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

/* 单击放一段:以磁吸节点为中心,选离光标最近的"空边"——
 * 点在导线端点附近自然延长,点在导线中段附近自然分支(T 结点) */
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
    (I.recentPlaces = I.recentPlaces || []).push(performance.now());
  } else {
    hint('该节点四周都已被占用');
  }
}

/* ---- L 形布线 ---- */

/* 起点到终点的直角折点序列(横长先横,竖长先竖) */
function lPath(a, b) {
  var pts = [a.slice()];
  if (a[0] !== b[0] && a[1] !== b[1]) {
    if (Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1])) pts.push([b[0], a[1]]);
    else pts.push([a[0], b[1]]);
  }
  pts.push(b.slice());
  return pts;
}

/* 折点序列 → 逐格导线段 */
function pathSegments(pts) {
  var segs = [];
  for (var i = 0; i + 1 < pts.length; i++) {
    var cur = pts[i].slice();
    var bx = pts[i + 1][0], by = pts[i + 1][1];
    while (cur[0] !== bx || cur[1] !== by) {
      var nxt = cur[0] !== bx
        ? [cur[0] + Math.sign(bx - cur[0]), cur[1]]
        : [cur[0], cur[1] + Math.sign(by - cur[1])];
      segs.push([cur.slice(), nxt]);
      cur = nxt;
    }
  }
  return segs;
}

function clearPreview() {
  if (I.preview) { I.preview.remove(); I.preview = null; }
}

function drawWirePreview(start, end) {
  clearPreview();
  if (start[0] === end[0] && start[1] === end[1]) return;
  var pts = lPath(start, end).map(function (p) { return (p[0] * G) + ',' + (p[1] * G); }).join(' ');
  I.preview = FF.svgEl('g', {}, FF.render.overlay());
  FF.svgEl('polyline', {
    points: pts, fill: 'none', stroke: '#c8451f',
    'stroke-width': 2.4, 'stroke-linecap': 'round', opacity: 0.55
  }, I.preview);
  FF.svgEl('circle', { cx: end[0] * G, cy: end[1] * G, r: 3.4, fill: '#c8451f', opacity: 0.8 }, I.preview);
}

function cancelDrag() {
  I.drag = null;
  clearPreview();
}

/* ---- 指针 ---- */

function onDown(ev) {
  if (ev.button === 1 || ev.button === 2 || I.spaceDown) {
    I.drag = { mode: 'pan', sx: ev.clientX, sy: ev.clientY };
    ev.preventDefault();
    return;
  }
  if (ev.button !== 0) return;
  var world = FF.render.screenToWorld(ev.clientX, ev.clientY);

  /* 点开关符号中部 = 开合,与当前工具无关(橡皮除外,它负责删除) */
  var swKey = FF.render.hitEdge(world);
  var sw = swKey ? model.edges.get(swKey) : null;
  if (sw && sw.type === T.SWITCH && I.tool !== 'eraser') {
    var mx = (sw.a[0] + sw.b[0]) / 2 * G, my = (sw.a[1] + sw.b[1]) / 2 * G;
    if (Math.hypot(world.x - mx, world.y - my) < 16) {
      FF.render.select(swKey);
      FF.bus.emit('selected', swKey);
      model.toggleSwitch(swKey);
      hint(sw.props.closed ? '开关闭合 — 电路接通' : '开关断开 — 电路断开');
      return;
    }
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
      I.drag = { mode: 'wire', start: N, end: N, everMoved: false, snap: model.serializeStr() };
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
    try { svg.setPointerCapture(ev.pointerId); } catch (err) { /* 某些环境下无效果,不影响窗口级监听 */ }
  }
}

function onMove(ev) {
  var world = FF.render.screenToWorld(ev.clientX, ev.clientY);

  if (I.drag && I.drag.mode === 'pan') {
    var r = svg.getBoundingClientRect();
    FF.render.panBy((ev.clientX - I.drag.sx) * FF.render.view().w / r.width,
                    (ev.clientY - I.drag.sy) * FF.render.view().h / r.height);
    I.drag.sx = ev.clientX; I.drag.sy = ev.clientY;
    return;
  }

  if (I.drag && I.drag.mode === 'wire') {
    var N = snapPoint(world);
    if (N[0] !== I.drag.end[0] || N[1] !== I.drag.end[1]) {
      I.drag.end = N;
      drawWirePreview(I.drag.start, I.drag.end);
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
  if (!I.drag) return;
  var d = I.drag;
  clearPreview();
  I.drag = null;

  if (d.mode === 'pan') return;

  if (d.mode === 'wire') {
    var segs = pathSegments(lPath(d.start, d.end));
    if (!segs.length) {
      /* 原地单击:以磁吸节点为中心放一段 */
      var world = FF.render.screenToWorld(ev.clientX, ev.clientY);
      clickPlaceSegment(world);
      return;
    }
    segs.forEach(function (s) { model.rawPlaceWire(s[0], s[1]); });
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
      if (I.tool === 'wire' && I.recentPlaces && I.recentPlaces.length) {
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
