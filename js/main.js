/* FieldFlow · main — 启动与接线
 *
 * 数据流:model 任何变更 → bus 'changed' → 求解 → 电势参考平移 →
 *         render.syncStructure/Solution → panel.update → localStorage 尽力持久化 */
(function (global) {
'use strict';

var FF = global.FF || (global.FF = {});
var T = FF.T;
var model = null;
var STORAGE_KEY = 'fieldflow-circuit';

function $(id) { return document.getElementById(id); }

/* 自定义电势零点:解后整体平移(电流、电势差都是差值,不受影响) */
function applyPhiReference(sol, refKey) {
  if (!refKey) return;
  var v = sol.nodePhi.get(refKey);
  if (v == null || !isFinite(v)) return;
  sol.nodePhi.forEach(function (val, k, m) {
    if (val != null) m.set(k, val - v);
  });
  var pmax = 0, pmin = 0;
  sol.nodePhi.forEach(function (val) {
    if (val == null) return;
    if (val > pmax) pmax = val;
    if (val < pmin) pmin = val;
  });
  sol.phiMax = pmax;
  sol.phiMin = pmin;
}

function onChange() {
  var sol = FF.solver.solve(model.list(), { wireR: model.wireR });
  applyPhiReference(sol, FF.interact.refNode());

  FF.render.setSolution(sol);
  FF.render.syncStructure();
  FF.render.syncSolution();

  FF.panel.setSource(model, sol);
  FF.panel.update();

  $('btn-undo').disabled = !model.canUndo();
  $('btn-redo').disabled = !model.canRedo();

  try { localStorage.setItem(STORAGE_KEY, model.serializeStr()); } catch (e) { /* file:// 下可能不可用,静默 */ }
}

/* ---------- 元件栏 ---------- */

function buildPalette() {
  var pal = $('palette');
  FF.symbols.PALETTE.forEach(function (def) {
    var btn = document.createElement('button');
    btn.className = 'pal-btn';
    btn.dataset.type = def.type;
    btn.appendChild(FF.symbols.paletteIcon(def.type, def.props));
    var name = document.createElement('span');
    name.className = 'pal-name';
    name.textContent = def.name;
    btn.appendChild(name);
    btn.title = def.name;
    btn.addEventListener('click', function () {
      if (def.type === 'eraser') FF.interact.setTool('eraser');
      else FF.interact.setTool(def.type, def.type === T.SWITCH ? { closed: false } : JSON.parse(JSON.stringify(def.props || {})));
    });
    pal.appendChild(btn);
  });
}

/* ---------- 可视化开关 ---------- */

/* 电流/电子流向互斥:同一流动层的两种方向模式,亮灯也互斥 */
function syncToggleUI() {
  document.querySelectorAll('#overlay-toggles .toggle').forEach(function (b) {
    var o = FF.render.opts();
    var on = b.dataset.layer === 'particles' ? (o.particles && !o.electrons)
      : b.dataset.layer === 'electrons' ? !!o.electrons
      : !!o[b.dataset.layer];
    b.classList.toggle('on', on);
  });
}

function wireToggles() {
  document.querySelectorAll('#overlay-toggles .toggle').forEach(function (btn) {
    var layer = btn.dataset.layer;
    syncToggleUI();
    btn.addEventListener('click', function () {
      var cur = FF.render.opts();
      var opts;
      if (layer === 'particles') {
        /* 电流 = 正电荷方向;电子模式下点它 = 切回正电荷方向;再点 = 关闭流动 */
        opts = cur.electrons ? { particles: true, electrons: false }
                             : { particles: !cur.particles, electrons: false };
      } else if (layer === 'electrons') {
        /* 电子流向 = 反向模式;再点 = 关闭流动 */
        opts = cur.electrons ? { particles: false, electrons: false }
                             : { particles: true, electrons: true };
      } else {
        opts = {};
        opts[layer] = !cur[layer];
      }
      FF.render.setOpts(opts);
      FF.panel.update();
      syncToggleUI();
    });
  });
}

/* ---------- 移动端底部抽屉:拖把手自由调整露出多少 ---------- */

var sheet = { shift: null, drag: null };

function sheetMaxShift() {
  var panel = $('panel');
  return Math.max(0, panel.offsetHeight - 44);   /* 44 = 把手高度(露出的部分) */
}

function sheetSet(shift, animate) {
  var panel = $('panel');
  panel.classList.toggle('no-anim', !animate);
  panel.style.transform = 'translateY(' + Math.round(shift) + 'px)';
  sheet.shift = shift;
  document.body.classList.toggle('panel-open', shift < sheetMaxShift() / 2);
}

function sheetToggle() {
  var max = sheetMaxShift();
  sheetSet((sheet.shift != null ? sheet.shift : max) > 30 ? 0 : max, true);
}

function setupSheet() {
  var panel = $('panel');
  var handle = $('panel-handle');
  handle.addEventListener('pointerdown', function (ev) {
    handle.setPointerCapture(ev.pointerId);
    var base = (sheet.shift != null) ? sheet.shift : (document.body.classList.contains('panel-open') ? 0 : sheetMaxShift());
    sheet.drag = { y0: ev.clientY, base: base, moved: false };
    panel.classList.add('no-anim');
  });
  handle.addEventListener('pointermove', function (ev) {
    if (!sheet.drag) return;
    var dy = ev.clientY - sheet.drag.y0;
    if (Math.abs(dy) > 6) sheet.drag.moved = true;
    sheetSet(FF.clamp(sheet.drag.base + dy, 0, sheetMaxShift()), false);
  });
  function end(ev) {
    if (!sheet.drag) return;
    var d = sheet.drag;
    sheet.drag = null;
    if (!d.moved) { sheetToggle(); return; }   /* 原地点击 = 开/收 */
    var max = sheetMaxShift();
    var cur = sheet.shift || 0;
    if (cur < max * 0.25) sheetSet(0, true);            /* 拉得够高 → 全开 */
    else if (cur > max * 0.8) sheetSet(max, true);      /* 推得够低 → 收起只露把手 */
    /* 中间位置:保持现状,露出多少随手指 */
  }
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}

/* ---------- 顶栏动作 ---------- */

function wireActions() {
  var sel = $('preset-select');
  FF.presets.forEach(function (p, i) {
    var opt = document.createElement('option');
    opt.value = i;
    opt.textContent = p.name;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', function () {
    if (sel.value === '') return;
    var p = FF.presets[+sel.value];
    model.loadPreset(p.tuples);
    FF.render.fitView();
    FF.interact.resetRef();
    FF.render.select(null);
    FF.bus.emit('selected', null);
  });

  $('btn-undo').addEventListener('click', function () { model.undo(); });
  $('btn-redo').addEventListener('click', function () { model.redo(); });
  $('btn-panel').addEventListener('click', sheetToggle);

  $('btn-clear').addEventListener('click', function () {
    model.clear();
    FF.render.select(null);
    FF.interact.resetRef();
  });
}

/* ---------- 启动 ---------- */

/* iOS Safari 偶尔无视 touch-action,显式拦掉系统捏合 */
['gesturestart', 'gesturechange', 'gestureend'].forEach(function (ev) {
  document.addEventListener(ev, function (e) { e.preventDefault(); }, { passive: false });
});

document.addEventListener('DOMContentLoaded', function () {
  model = new FF.Model();
  FF.render.setModel(model);

  var svg = $('canvas');
  FF.render.init(svg);
  FF.interact.init(svg, model);

  buildPalette();
  wireToggles();
  wireActions();
  setupSheet();

  /* 恢复上次电路,否则载入串联预置 */
  var restored = false;
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      var data = JSON.parse(raw);
      if (data && data.edges && data.edges.length) {
        model.restore(data);
        restored = true;
      }
    }
  } catch (e) { /* 静默 */ }

  if (!restored) {
    model.loadPreset(FF.presets[0].tuples);
  }

  FF.bus.on('changed', onChange);
  FF.bus.on('selected', function () { FF.panel.update(); });
  FF.bus.on('probe', function () { FF.panel.update(); });

  onChange();
  FF.render.fitView();
  FF.interact.hint('预置电路已载入 · 点开关闭合它,看灯亮');
});

if (typeof module !== 'undefined' && module.exports) module.exports = FF;
})(typeof window !== 'undefined' ? window : globalThis);
