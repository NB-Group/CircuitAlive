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
  var sol = FF.solver.solve(model.list());
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

function wireToggles() {
  document.querySelectorAll('#overlay-toggles .toggle').forEach(function (btn) {
    var layer = btn.dataset.layer;
    var sync = function () {
      btn.classList.toggle('on', !!FF.render.opts()[layer]);
    };
    sync();
    btn.addEventListener('click', function () {
      var opts = {};
      opts[layer] = !FF.render.opts()[layer];
      /* 开"电子流向"时自动开粒子层,否则看不到效果 */
      if (layer === 'electrons' && opts[layer]) opts.particles = true;
      FF.render.setOpts(opts);
      FF.panel.update();
      document.querySelectorAll('#overlay-toggles .toggle').forEach(function (b) {
        b.classList.toggle('on', !!FF.render.opts()[b.dataset.layer]);
      });
    });
  });
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
  $('btn-panel').addEventListener('click', function () {
    document.body.classList.toggle('panel-open');
  });

  $('btn-clear').addEventListener('click', function () {
    model.clear();
    FF.render.select(null);
    FF.interact.resetRef();
  });
}

/* ---------- 启动 ---------- */

document.addEventListener('DOMContentLoaded', function () {
  model = new FF.Model();
  FF.render.setModel(model);

  var svg = $('canvas');
  FF.render.init(svg);
  FF.interact.init(svg, model);

  buildPalette();
  wireToggles();
  wireActions();

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
