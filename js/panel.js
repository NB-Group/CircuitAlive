/* FieldFlow · panel — 右侧分析栏
 *
 * 全部子面板都是 (model, sol) 的纯函数式重建(电路规模小,无需调和):
 *   状态 · 仪表读数 · 元件检查器(可编辑参数 + 严格定义式)· 元件明细表
 *   电势分布(图例 + 单回路 φ 曲线)· 截面探针(I = q/t 演示) */
(function (global) {
'use strict';

var FF = global.FF || (global.FF = {});
var T = FF.T;
var SUB = '₀₁₂₃₄₅₆₇₈₉';

function sub(n) {
  if (n <= 0) return '₁';
  var s = '';
  while (n > 0) { s = SUB[n % 10 + 1] + s; n = Math.floor(n / 10); }
  return s || '₁';
}

function $(id) { return document.getElementById(id); }

/* 严格定义式(工具的灵魂:用高中的可定义概念讲初中的元件) */
var DEFS = {};
DEFS[T.BATTERY] = '<b>电动势 E</b>:电源内非静电力把单位正电荷从负极移到正极所做的功(单位 V)。闭合电路欧姆定律 <b>U = E − I·r</b>:内阻 r 默认 0.1 Ω(真实干电池量级,可在下方修改)。短路时电流只受 r 限制,电动势几乎全降在电源内部,端电压≈0、导线几乎等势。';
DEFS[T.WIRE] = '理想导线的严格含义是<b>等势体</b>:两端 U = 0,内部 E = 0。默认每格 1 mΩ(真实铜线量级);把电阻设为 <b>0</b> 即理想导线,求解时两端点合并为同一节点,严格等势。';
DEFS[T.RESISTOR] = '电阻定义式 <b>R = U/I</b>:这个比值由导体本身(材料、长度、横截面积)决定 —— U/I 只是<b>量度</b>它,不是电压"产生"了电阻。';
DEFS[T.LAMP] = '灯泡亮度由<b>实际功率 P = U·I</b> 决定,不是由电流或电压单独决定。';
DEFS[T.RHEOSTAT] = '靠改变接入电路的电阻丝<b>长度</b>来改变电阻:接入越长,R 越大(与横截面积、材料共同决定 R)。';
DEFS[T.AMMETER] = '电流定义 <b>I = q/t</b>:单位时间内通过导体横截面的<b>电荷量</b>。电流表内阻≈0,必须<b>串联</b>在被测电路中,相当于一段导线。';
DEFS[T.VOLTMETER] = '电压即<b>电势差 U = φ₊ − φ₋</b>。电压表内阻≈∞,<b>并联</b>不改变电路;读数就是两接线柱的电势之差。';
DEFS[T.SWITCH] = '闭合 = 电阻 0(通路);断开 = 电阻 ∞(断路,该支路电流为 0,但两端可以有电压)。';

/* 给元件编号(R₁、A₁、V₁…),按类型各自计数,id 序 */
function labelEdges(model) {
  var counters = {}, labels = new Map();
  model.list().sort(function (a, b) { return a.id - b.id; }).forEach(function (e) {
    var base = { battery: 'E', resistor: 'R', lamp: 'L', rheostat: 'R′', switch: 'S', ammeter: 'A', voltmeter: 'V' }[e.type];
    if (!base) { labels.set(e.id, '导线'); return; }
    counters[e.type] = (counters[e.type] || 0) + 1;
    labels.set(e.id, base + sub(counters[e.type]));
  });
  return labels;
}

/* ---------- 状态 ---------- */

var STATE_TEXT = {
  normal: '电路闭合。正电荷从电池正极经外电路流向负极(朱红粒子即为电流方向)。电流处处遵循 I = q/t。',
  open: '<span class="em-amber">断路</span>:回路不闭合,处处 I = 0。<b>点击开关符号中部即可闭合它</b>;也要检查导线是否首尾相接。注意此时断开处两端的电压 ≈ 电源电动势 —— 把电压表并在断开的开关上就能测出来。',
  short: '<span class="em">电源被短接!</span>电流不经过任何用电器,只受内阻限制(I ≈ E/r,几十安培)。电动势几乎全部降在电源<b>内部</b>,端电压塌到接近 0,导线近似等势,灯全灭 —— 现实中这就是电源烧毁起火的原因。',
  noSource: '画布上没有电源:没有电动势,就没有电流。',
  empty: '空画布:从左侧元件栏选择<b>电池</b>,点击网格边放置,再用导线连成回路。'
};

var STATE_SHORT = { normal: '正常', open: '断路', short: '短路', noSource: '无电源', empty: '空' };

function renderState(sol, model, hasMulti) {
  var d = $('state-detail');
  d.innerHTML = STATE_TEXT[sol.status] || '';
  var def = document.createElement('div');
  def.className = 'def';
  def.innerHTML = '电流 <b>I = q/t</b>(单位时间通过截面的电荷量)· 电压 <b>U = φ<sub>A</sub> − φ<sub>B</sub></b>(电势差)';
  d.appendChild(def);
  if (hasMulti) {
    var m = document.createElement('div');
    m.className = 'def';
    m.innerHTML = '注意:画布上有多个互不相连的电路,各自以自己的电源负极为零电势参考。';
    d.appendChild(m);
  }
  var badge = $('state-badge');
  badge.textContent = STATE_SHORT[sol.status] || '—';
  badge.className = 'state-' + sol.status;
}

/* ---------- 仪表 ---------- */

function renderMeters(model, sol, labels) {
  var box = $('meter-list');
  box.innerHTML = '';
  var found = false;
  model.list().sort(function (a, b) { return a.id - b.id; }).forEach(function (e) {
    if (e.type !== T.AMMETER && e.type !== T.VOLTMETER) return;
    found = true;
    var I = sol.edgeI.get(e.id);
    var phiA = sol.nodePhi.get(FF.nodeKey(e.a));
    var phiB = sol.nodePhi.get(FF.nodeKey(e.b));
    var val, note = '';
    if (e.type === T.AMMETER) {
      if (I == null) val = null;
      else {
        val = I;
        if (I < 0) note = '电流从另一端流入';
      }
    } else {
      if (phiA == null || phiB == null) val = null;
      else {
        val = phiB - phiA;
        if (val < 0) note = '+ 接线柱接在低电势侧';
      }
    }
    var row = document.createElement('div');
    row.className = 'meter-row';
    row.innerHTML =
      '<span class="m-label">' + FF.TYPE_NAME[e.type] + ' ' + labels.get(e.id) + '</span>' +
      '<span style="display:flex;flex-direction:column;align-items:flex-end">' +
      '<span class="m-val' + (val == null ? ' null' : '') + '">' + (val == null ? '—' : FF.fmt(val, e.type === T.AMMETER ? 'A' : 'V')) + '</span>' +
      (note ? '<span class="m-sub">' + note + '</span>' : '') +
      '</span>';
    box.appendChild(row);
  });
  if (!found) box.innerHTML = '<div class="panel-empty">无仪表 — 放置电流表(串联)/电压表(并联)</div>';
}

/* ---------- 检查器 ---------- */

var sliderSnap = null;

function numRow(label, unit, value, min, max, step, onInput, onStart, onEnd) {
  var row = document.createElement('div');
  row.className = 'param-row';
  var lab = document.createElement('label'); lab.textContent = label;
  var input = document.createElement('input');
  input.type = 'number'; input.value = value;
  if (min != null) input.min = min;
  if (max != null) input.max = max;
  if (step != null) input.step = step;
  input.addEventListener('change', function () { onInput(parseFloat(input.value)); });
  row.appendChild(lab);
  var u = document.createElement('span'); u.className = 'param-unit'; u.textContent = unit;
  row.appendChild(input); row.appendChild(u);
  return row;
}

function renderInspector(model, sol, labels) {
  var box = $('inspector-body');
  box.innerHTML = '';
  var key = FF.render.selectedKey();
  var e = key ? model.edges.get(key) : null;
  if (!e) { box.innerHTML = '<div class="panel-empty">点击画布上的元件</div>'; return; }

  var name = document.createElement('div');
  name.className = 'insp-name';
  name.textContent = FF.TYPE_NAME[e.type] + (labels.get(e.id) && e.type !== T.WIRE ? ' ' + labels.get(e.id) : '');
  box.appendChild(name);

  var def = document.createElement('div');
  def.className = 'insp-def';
  def.innerHTML = DEFS[e.type] || '';
  box.appendChild(def);

  /* 可编辑参数 */
  var P = e.props;
  function setProp(patch) { model.setProps(key, patch); }

  if (e.type === T.WIRE) {
    box.appendChild(numRow('电阻 r', 'Ω', P.r == null ? 0.001 : P.r, 0, 50, 0.001, function (v) {
      setProp({ r: v === 0 ? 0 : FF.clamp(v, 0.001, 50) });
    }));
  }

  if (e.type === T.BATTERY) {
    box.appendChild(numRow('电动势 E', 'V', P.V || 3, 0.1, 24, 0.1, function (v) {
      setProp({ V: FF.clamp(v || 1.5, FF.LIMITS.V[0], FF.LIMITS.V[1]) });
    }));
    box.appendChild(numRow('内阻 r', 'Ω', P.r == null ? 0.1 : P.r, 0.01, 50, 0.01, function (v) {
      setProp({ r: FF.clamp(v || 0.1, 0.01, 50) });
    }));
  }
  if (e.type === T.RESISTOR || e.type === T.LAMP) {
    box.appendChild(numRow('电阻 R', 'Ω', P.R || 10, 0.1, 9999, 0.5, function (v) {
      setProp({ R: FF.clamp(v || 10, FF.LIMITS.R[0], FF.LIMITS.R[1]) });
    }));
  }
  if (e.type === T.RHEOSTAT) {
    box.appendChild(numRow('最大阻值', 'Ω', P.Rmax || 50, 1, 999, 1, function (v) {
      setProp({ Rmax: FF.clamp(v || 50, FF.LIMITS.Rmax[0], FF.LIMITS.Rmax[1]) });
    }));
    /* 滑片:拖动实时变化,整个拖动手势记一次 undo */
    var row = document.createElement('div');
    row.className = 'param-row';
    row.innerHTML = '<label>滑片位置</label>';
    var range = document.createElement('input');
    range.type = 'range'; range.min = 0; range.max = 1; range.step = 0.01;
    range.value = P.wiper == null ? 1 : P.wiper;
    var cur = document.createElement('span');
    cur.className = 'param-unit';
    function fmtWiper() { cur.textContent = FF.fmt(FF.solver.rOf(e), 'Ω'); }
    fmtWiper();
    range.addEventListener('pointerdown', function () { sliderSnap = model.serializeStr(); });
    range.addEventListener('input', function () {
      e.props.wiper = parseFloat(range.value);
      fmtWiper();
      FF.bus.emit('changed');
    });
    range.addEventListener('change', function () {
      if (sliderSnap) { model.commit(sliderSnap); sliderSnap = null; }
    });
    row.appendChild(range); row.appendChild(cur);
    box.appendChild(row);
  }
  if (e.type === T.SWITCH) {
    var r = document.createElement('div');
    r.className = 'param-row';
    var btn = document.createElement('button');
    btn.textContent = P.closed ? '断开开关' : '闭合开关';
    btn.style.cssText = 'padding:4px 14px;border:1px solid var(--hairline);background:transparent;cursor:pointer;border-radius:2px';
    btn.addEventListener('click', function () { model.toggleSwitch(key); });
    var st = document.createElement('span'); st.className = 'param-unit'; st.textContent = P.closed ? '闭合' : '断开';
    r.innerHTML = '<label>状态</label>';
    r.appendChild(btn); r.appendChild(st);
    box.appendChild(r);
  }

  /* 计算值 */
  var I = sol.edgeI.get(e.id);
  var U = FF.solver.edgeU(e, sol);
  var vals = document.createElement('div');
  vals.className = 'insp-vals';
  function kv(k, v) {
    return '<div class="kv"><span>' + k + '</span><b>' + v + '</b></div>';
  }
  var html = '';
  if (e.type === T.BATTERY) {
    var E = FF.solver.emfOf(e);
    html += kv('端电压 U', U == null ? '—' : FF.fmt(U, 'V'));
    html += kv('电动势 E', FF.fmt(E, 'V'));
    html += kv('内阻 r', FF.fmt(FF.solver.rOf(e), 'Ω'));
    html += kv('电流 I', I == null ? '—' : FF.fmt(I, 'A'));
    html += kv('输出功率', (I == null || U == null) ? '—' : FF.fmt(Math.abs(U * I), 'W'));
  } else if (e.type === T.RESISTOR || e.type === T.LAMP || e.type === T.RHEOSTAT) {
    html += kv('电压 U', U == null ? '—' : FF.fmt(U, 'V'));
    html += kv('电流 I', I == null ? '—' : FF.fmt(I, 'A'));
    html += kv('电阻 R', FF.fmt(FF.solver.rOf(e), 'Ω'));
    html += kv('功率 P', (I == null || U == null) ? '—' : FF.fmt(Math.abs(U * I), 'W'));
  } else if (e.type === T.AMMETER) {
    html += kv('电流 I', I == null ? '—' : FF.fmt(I, 'A'));
  } else if (e.type === T.VOLTMETER) {
    var phiA = sol.nodePhi.get(FF.nodeKey(e.a)), phiB = sol.nodePhi.get(FF.nodeKey(e.b));
    html += kv('φ(+接线柱)', phiB == null ? '—' : FF.fmt(phiB, 'V'));
    html += kv('φ(−接线柱)', phiA == null ? '—' : FF.fmt(phiA, 'V'));
    html += kv('读数 U', (phiA == null || phiB == null) ? '—' : FF.fmt(phiB - phiA, 'V'));
  } else if (e.type === T.WIRE) {
    html += kv('电流 I', I == null ? '—' : FF.fmt(I, 'A'));
    html += kv('两端 U', U == null ? '—' : FF.fmt(U, 'V'));
    html += kv('电阻 r', FF.solver.rOf(e) === 0 ? '理想' : FF.fmt(FF.solver.rOf(e), 'Ω'));
  } else if (e.type === T.SWITCH) {
    html += kv('电流 I', I == null ? '—' : FF.fmt(I || 0, 'A'));
    html += kv('两端 U', U == null ? '—' : FF.fmt(U, 'V'));
  }
  vals.innerHTML = html;
  box.appendChild(vals);

  /* 动作 */
  var act = document.createElement('div');
  act.className = 'insp-actions';
  var flipBtn = document.createElement('button');
  flipBtn.textContent = '翻转两端 (R)';
  flipBtn.addEventListener('click', function () { model.flip(key); });
  var delBtn = document.createElement('button');
  delBtn.textContent = '删除 (Del)';
  delBtn.addEventListener('click', function () { model.remove(key); FF.render.select(null); });
  act.appendChild(flipBtn); act.appendChild(delBtn);
  box.appendChild(act);
}

/* ---------- 元件明细表 ---------- */

function renderTable(model, sol, labels) {
  var box = $('element-table');
  var comps = model.list().filter(function (e) { return e.type !== T.WIRE; })
    .sort(function (a, b) { return a.id - b.id; });
  if (!comps.length) { box.innerHTML = '<div class="panel-empty">无元件</div>'; return; }
  var selKey = FF.render.selectedKey();
  var html = '<table class="el-table"><thead><tr>' +
    '<th>元件</th><th>U/V</th><th>I/A</th><th>R/Ω</th><th>P/W</th></tr></thead><tbody>';
  comps.forEach(function (e) {
    var I = sol.edgeI.get(e.id);
    var U = FF.solver.edgeU(e, sol);
    var R = (e.type === T.RESISTOR || e.type === T.LAMP || e.type === T.RHEOSTAT) ? FF.fmt(FF.solver.rOf(e), '') : '—';
    var P = (I == null || U == null) ? '—' : FF.fmt(Math.abs(U * I), '');
    html += '<tr class="cur' + (e.key === selKey ? ' sel' : '') + '" data-key="' + e.key + '">' +
      '<td>' + FF.TYPE_NAME[e.type] + ' ' + (labels.get(e.id) || '') + '</td>' +
      '<td>' + (U == null ? '—' : FF.fmt(U, '')) + '</td>' +
      '<td>' + (I == null ? '—' : FF.fmt(I, '')) + '</td>' +
      '<td>' + R + '</td><td>' + P + '</td></tr>';
  });
  html += '</tbody></table>';
  box.innerHTML = html;
  box.querySelectorAll('tr[data-key]').forEach(function (tr) {
    tr.addEventListener('click', function () {
      FF.render.select(tr.getAttribute('data-key'));
      FF.panel.update();
    });
  });
}

/* ---------- 电势分布:图例 + 单回路 φ 曲线 ---------- */

function renderPotential(model, sol) {
  var box = $('potential-body');
  box.innerHTML = '';
  var hasSolved = false;
  sol.nodePhi.forEach(function (v) { if (v != null) hasSolved = true; });
  if (!hasSolved) {
    box.innerHTML = '<div class="panel-empty">无电源,电势无定义</div>';
    return;
  }

  /* 图例:群青 ← 0 → 朱红 */
  var wrap = document.createElement('div');
  wrap.className = 'legend-wrap';
  var pm = Math.max(Math.abs(sol.phiMax), Math.abs(sol.phiMin), 0.05);
  var stops = [];
  for (var i = 0; i <= 10; i++) {
    stops.push('<stop offset="' + i * 10 + '%" stop-color="' + FF.phiColor(-pm + 2 * pm * i / 10) + '"/>');
  }
  wrap.innerHTML =
    '<svg width="100%" height="34" viewBox="0 0 264 34" preserveAspectRatio="none">' +
    '<defs><linearGradient id="phi-leg">' + stops.join('') + '</linearGradient></defs>' +
    '<rect x="1" y="1" width="262" height="14" fill="url(#phi-leg)" stroke="#6f6557" stroke-width="1"/>' +
    '<text x="4" y="30" class="phi-label">' + FF.fmt(-pm, 'V', 2) + '</text>' +
    '<text x="132" y="30" class="phi-label" text-anchor="middle">0</text>' +
    '<text x="260" y="30" class="phi-label" text-anchor="end">' + FF.fmt(pm, 'V', 2) + '</text>' +
    '</svg>' +
    '<div class="legend-note">零参考:' + (FF.interact.refNode() ? '自定义节点 (' + FF.interact.refNode() + ')' : '电池负极') +
    ' · 颜色越红电势越高。导线颜色几乎不变 —— 两端电势相等。</div>';
  box.appendChild(wrap);

  /* 单回路 φ 曲线 */
  var walk = FF.solver.findSingleLoop(model.list());
  if (walk) drawProfile(box, walk, sol, model);
  else {
    var t = document.createElement('div');
    t.className = 'panel-empty';
    t.textContent = '绕回路电势曲线:仅单回路电路显示';
    box.appendChild(t);
  }
}

function drawProfile(box, walk, sol, model) {
  var labels = labelEdges(model);
  var W = 264, H = 130, ml = 34, mr = 8, mt = 10, mb = 20;
  var n = walk.length;
  var phis = [];
  walk.forEach(function (w, i) {
    phis.push(sol.nodePhi.get(w.from));
  });
  phis.push(sol.nodePhi.get(walk[0].from));   /* 闭合回到起点 */

  var vals = phis.filter(function (v) { return v != null; });
  if (vals.length < 2) return;
  var lo = Math.min(0, Math.min.apply(null, vals)), hi = Math.max(0, Math.max.apply(null, vals));
  if (hi - lo < 1e-6) { hi = lo + 1; }
  var pad = (hi - lo) * 0.12;
  lo -= pad; hi += pad;

  function X(i) { return ml + (W - ml - mr) * i / n; }
  function Y(v) { return mt + (H - mt - mb) * (1 - (v - lo) / (hi - lo)); }

  var pts = '';
  walk.forEach(function (w, i) {
    var v = phis[i];
    if (v == null) return;
    pts += X(i) + ',' + Y(v).toFixed(1) + ' ';
    var v2 = phis[i + 1];
    if (v2 != null) pts += X(i + 1) + ',' + Y(v2).toFixed(1) + ' ';
  });

  var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', H);
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  var inner =
    '<rect x="' + ml + '" y="' + mt + '" width="' + (W - ml - mr) + '" height="' + (H - mt - mb) + '" fill="#f2ecd9" stroke="none" opacity="0.55"/>' +
    /* φ=0 虚线 */
    (lo < 0 && hi > 0 ? '<line x1="' + ml + '" y1="' + Y(0).toFixed(1) + '" x2="' + (W - mr) + '" y2="' + Y(0).toFixed(1) + '" stroke="#6f6557" stroke-width="0.8" stroke-dasharray="3 3"/>' : '') +
    /* y 轴刻度:0 与最大值 */
    '<text x="' + (ml - 4) + '" y="' + (Y(hi - pad) + 3.5).toFixed(1) + '" text-anchor="end" class="phi-label">' + FF.fmt(hi - pad, '', 2) + '</text>' +
    '<text x="' + (ml - 4) + '" y="' + (Y(lo + pad) + 3.5).toFixed(1) + '" text-anchor="end" class="phi-label">' + FF.fmt(lo + pad, '', 2) + '</text>' +
    '<text x="' + (ml - 4) + '" y="' + (Y(0) + 3.5).toFixed(1) + '" text-anchor="end" class="phi-label">0</text>' +
    /* 轴 */
    '<line x1="' + ml + '" y1="' + mt + '" x2="' + ml + '" y2="' + (H - mb) + '" stroke="#6f6557" stroke-width="1"/>' +
    '<line x1="' + ml + '" y1="' + (H - mb) + '" x2="' + (W - mr) + '" y2="' + (H - mb) + '" stroke="#6f6557" stroke-width="1"/>' +
    /* 曲线 */
    '<polyline points="' + pts + '" fill="none" stroke="#c8451f" stroke-width="1.8" stroke-linejoin="round"/>';
  /* 元件标注(非导线) */
  walk.forEach(function (w, i) {
    if (w.edge.type === T.WIRE) return;
    var lab = FF.TYPE_NAME[w.edge.type] === undefined ? '' : labels.get(w.edge.id);
    inner += '<line x1="' + X(i + 0.5).toFixed(1) + '" y1="' + (H - mb) + '" x2="' + X(i + 0.5).toFixed(1) + '" y2="' + (H - mb + 3) + '" stroke="#6f6557" stroke-width="1"/>' +
      '<text x="' + X(i + 0.5).toFixed(1) + '" y="' + (H - mb + 12) + '" text-anchor="middle" class="phi-label">' + (lab || '') + '</text>';
  });
  svg.innerHTML = inner;

  var wrap = document.createElement('div');
  wrap.className = 'profile-wrap';
  var title = document.createElement('div');
  title.className = 'profile-title';
  title.textContent = '绕回路一周的电势变化(电池抬升电势,电阻降落电势)';
  wrap.appendChild(title);
  wrap.appendChild(svg);
  box.appendChild(wrap);
}

/* ---------- 截面探针 ---------- */

var probe = { edge: null, raf: null, t: 0, dots: [], lastT: 0, svg: null, countEl: null };

function probeStop() {
  if (probe.raf) { cancelAnimationFrame(probe.raf); probe.raf = null; }
}

function probeTick(now) {
  var sol = FF.panel.__sol;
  var e = probe.edge;
  if (!e || !sol) { probeStop(); return; }
  var I = sol.edgeI.get(e.id);
  var dt = Math.min(0.05, (now - probe.lastT) / 1000);
  probe.lastT = now;
  var dir = (I == null || I === 0) ? 0 : (I > 0 ? 1 : -1) * (FF.render.opts().electrons ? -1 : 1);
  var speed = 24 + 170 * Math.min(1, Math.abs(I || 0) / Math.max(sol.Imax, 1e-9));
  probe.dots.forEach(function (d) {
    d.x += dir * speed * dt;
    if (d.x > 250) d.x -= 230;
    if (d.x < 20) d.x += 230;
    d.el.setAttribute('cx', d.x);
  });
  if (I) probe.t += dt;
  var Q = Math.abs(I || 0) * probe.t;
  var eCount = Math.abs(I || 0) / 1.602e-19;
  probe.countEl.innerHTML =
    '通电 <b>' + probe.t.toFixed(1) + ' s</b> · 通过截面电荷量 Q = I·t = <b>' + FF.fmt(Q, 'C') + '</b>' +
    '<br>I = ' + FF.fmt(Math.abs(I || 0), 'A') + ' ⇔ 每秒 <b>' + (eCount > 0 ? eCount.toExponential(1) : '0') + '</b> 个元电荷穿过此截面';
  probe.raf = requestAnimationFrame(probeTick);
}

function renderProbe(model, sol) {
  var sec = $('sec-probe');
  var key = FF.render.probe();
  var e = key ? model.edges.get(key) : null;
  if (!e) { sec.hidden = true; probeStop(); probe.edge = null; return; }
  sec.hidden = false;
  probe.edge = e;
  probe.t = 0;

  var box = $('probe-body');
  box.innerHTML = '';
  var I = sol.edgeI.get(e.id);

  var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'probe-svg');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '84');
  svg.setAttribute('viewBox', '0 0 264 84');
  var inner =
    '<rect x="16" y="30" width="232" height="26" rx="4" fill="#fdfaf1" stroke="#2c2822" stroke-width="1.6"/>' +
    '<line x1="132" y1="22" x2="132" y2="64" stroke="#c8451f" stroke-width="1.6" stroke-dasharray="4 3"/>' +
    '<text x="132" y="16" text-anchor="middle" class="phi-label" fill="#b03517">截面</text>';
  svg.innerHTML = inner;
  box.appendChild(svg);
  probe.svg = svg;

  /* 载流子点 */
  probe.dots = [];
  var dotClass = 'particle' + (FF.render.opts().electrons ? ' electron' : '');
  for (var i = 0; i < 11; i++) {
    var c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('cx', 20 + i * 21);
    c.setAttribute('cy', 36 + (i * 7.3) % 15);
    c.setAttribute('r', 2.6);
    c.setAttribute('class', dotClass);
    svg.appendChild(c);
    probe.dots.push({ el: c, x: 20 + i * 21 });
  }

  var count = document.createElement('div');
  count.className = 'probe-count';
  box.appendChild(count);
  probe.countEl = count;

  var note = document.createElement('div');
  note.className = 'probe-note';
  note.innerHTML = '电流的严格定义:<b>I = q / t</b> —— 单位时间通过这个截面的电荷量。' +
    (I ? '' : '(当前导线无电流,粒子静止)') +
    '<br>点为示意,未按真实比例;真实比例下每库仑 = 6.2×10¹⁸ 个元电荷。';
  box.appendChild(note);

  probeStop();
  probe.lastT = performance.now();
  probe.raf = requestAnimationFrame(probeTick);
}

/* ---------- 总入口 ---------- */

FF.panel = {
  update: function () {
    var model = FF.panel.__model, sol = FF.panel.__sol;
    if (!model || !sol) return;
    var labels = labelEdges(model);
    var hasMulti = sol.comps.filter(function (c) { return c.hasSource; }).length > 1;
    renderState(sol, model, hasMulti);
    renderMeters(model, sol, labels);
    renderInspector(model, sol, labels);
    renderTable(model, sol, labels);
    renderPotential(model, sol);
    renderProbe(model, sol);
  },
  setSource: function (model, sol) {
    FF.panel.__model = model;
    FF.panel.__sol = sol;
  },
  __sol: null, __model: null
};

if (typeof module !== 'undefined' && module.exports) module.exports = FF;
})(typeof window !== 'undefined' ? window : globalThis);
