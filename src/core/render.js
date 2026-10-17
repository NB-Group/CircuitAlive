/* FieldFlow · render — SVG 场景渲染(ESM)
 *
 * 分两层:
 *   syncStructure(model)      模型变了:边/符号/结点/文字层(按 edge.id 增量调和)
 *   syncSolution(model, sol)  解变了:电势着色/读数/光晕/电机转速/铃振幅/E 箭头
 * 粒子独立 rAF 循环,速度跟随 |I|,方向跟随电流符号,电子模式反向。
 *
 * 文字层修正:旧实现把字母放在符号 <g> 内再用 rotate(-angle) 抵消旋转,
 * 旋转支点在文字自身锚点上,不同朝向下字形包围盒会把字挤到中点的上方/左侧。
 * 现在所有字母/读数/「+」都画在独立的未旋转层 symbol-text 里,位置由局部
 * 锚点经边方向旋转到世界坐标后给出,文字本身永远正立、锚点永远在中点,
 * 0°/90°/180°/270° 四种朝向视觉一致。
 *
 * 电势色阶:发散,OKLab 插值 群青(#2f62a8) ← 纸色 → 朱红(#c8451f),
 * 锚定 φ=0 对称 ±φmax。 */
import { T, GRID, clamp, lerp, nodeKey, edgeKey, fmt, svgEl } from './util.js';
import { symbols } from './symbols.js';
import { solver } from './solver.js';

const G = GRID;

/* ---------- OKLab 颜色 ---------- */
function hexToRgb(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
function s2l(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function l2s(c) { return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055); }

function rgbToOklab(rgb) {
  const r = s2l(rgb[0]), g = s2l(rgb[1]), b = s2l(rgb[2]);
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
  return [
    0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
  ];
}

function oklabToHex(lab) {
  const l_ = lab[0] + 0.3963377774 * lab[1] + 0.2158037573 * lab[2];
  const m_ = lab[0] - 0.1055613458 * lab[1] - 0.0638541728 * lab[2];
  const s_ = lab[0] - 0.0894841775 * lab[1] - 1.2914855480 * lab[2];
  const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const b = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
  function ch(c) { c = Math.round(l2s(Math.min(1, Math.max(0, c)))); const h = c.toString(16); return h.length < 2 ? '0' + h : h; }
  return '#' + ch(r) + ch(g) + ch(b);
}

const PAPER = '#f7f2e5', VERMILION = '#c8451f', INDIGO = '#2f62a8';
const LAB_PAPER = rgbToOklab(hexToRgb(PAPER));
const LAB_HI = rgbToOklab(hexToRgb(VERMILION));
const LAB_LO = rgbToOklab(hexToRgb(INDIGO));

let phiMaxScale = 1;
const colorCache = new Map();

export function phiColor(phi) {
  if (phi == null) return '#b4a996';
  const t = clamp(phi / phiMaxScale, -1, 1);
  const key = Math.round(t * 128);
  const c = colorCache.get(key);
  if (c) return c;
  const lab = t >= 0 ? LAB_HI : LAB_LO, a = Math.abs(t);
  const out = oklabToHex([
    LAB_PAPER[0] + (lab[0] - LAB_PAPER[0]) * a,
    LAB_PAPER[1] + (lab[1] - LAB_PAPER[1]) * a,
    LAB_PAPER[2] + (lab[2] - LAB_PAPER[2]) * a
  ]);
  colorCache.set(key, out);
  return out;
}

export function setPhiScale(m) { phiMaxScale = Math.max(m, 0.05); }

/* ---------- 世界坐标 ---------- */
const w2 = (x) => x * G;
const edgeMidWorld = (e) => [(e.a[0] + e.b[0]) / 2 * G, (e.a[1] + e.b[1]) / 2 * G];

/* 局部坐标(边中点为原点,+x = a→b)→ 世界坐标。
 * 符号层 rotate(angle) 与这里的旋转严格一致,所以文字锚点永远落在
 * 符号上同一个相对位置,而文字自身不旋转。 */
function localToWorld(e, lx, ly) {
  const ang = symbols.angleOf(e.a, e.b) * Math.PI / 180;
  const c = Math.cos(ang), s = Math.sin(ang);
  const [mx, my] = edgeMidWorld(e);
  return [mx + lx * c - ly * s, my + lx * s + ly * c];
}

/* 需要文字层的元件:局部锚点(字母在正中) */
const LETTERS = {
  [T.AMMETER]: 'A',
  [T.VOLTMETER]: 'V',
  [T.MOTOR]: 'M'
};

function makeRenderer(svg) {
  if (!svg) throw new Error('render: 需要一个 <svg> 元素');

  const R = {
    svg,
    layers: {},
    model: null,
    sol: null,
    edgeEls: new Map(),   /* edgeId -> {group, sym, hit, text:{}, hooks, type, tr, key} */
    version: 0,
    opts: { particles: true, electrons: false, potential: false, phiLabels: false, efield: false },
    view: { x: -60, y: -60, w: 920, h: 640 },
    probeKey: null,
    selKey: null,
    raf: null,
    lastT: 0,
    destroyed: false
  };

  /* ---------- 图层 ---------- */

  const LAYER_NAMES = ['defs', 'grid', 'underlay', 'edges', 'junctions', 'efield', 'readings', 'symbol-text', 'particles', 'overlay'];

  function ensureLayers() {
    let root = svg.querySelector('g.ff-scene');
    if (!root) {
      root = svgEl('g', { class: 'ff-scene' }, svg);
    }
    /* defs 是独立元素,不是场景层 */
    let defs = svg.querySelector('defs.ff-defs');
    if (!defs) defs = svgEl('defs', { class: 'ff-defs' }, svg);
    R.layers.defs = defs;

    LAYER_NAMES.forEach((name) => {
      if (name === 'defs') return;
      let g = root.querySelector(':scope > g[data-layer="' + name + '"]');
      if (!g) g = svgEl('g', { 'data-layer': name }, root);
      R.layers[name] = g;
    });
    /* 层级顺序固定(防止 Vue 模板顺序变动) */
    const order = ['grid', 'underlay', 'edges', 'junctions', 'efield', 'particles', 'readings', 'symbol-text', 'overlay'];
    order.forEach((name) => root.appendChild(R.layers[name]));
  }

  /* 网格:userSpaceOnUse pattern,跟随 viewBox 平移缩放,与吸附格点严格对齐 */
  function buildGrid() {
    const defs = R.layers.defs;
    const size = GRID;
    const major = size * 5;
    const pat = svgEl('pattern', {
      id: 'ff-grid', width: major, height: major, patternUnits: 'userSpaceOnUse'
    }, defs);
    let d = '';
    for (let i = 0; i < 5; i++) {
      d += 'M' + (i * size) + ' 0V' + major + 'M0 ' + (i * size) + 'H' + major;
    }
    /* SVG 属性里不能用 var(),网格线用 class 交给 CSS 上色(深浅主题都能跟) */
    svgEl('path', { d, fill: 'none', class: 'ff-grid-minor', 'stroke-width': 1 }, pat);
    svgEl('path', {
      d: 'M0 0V' + major + 'M0 0H' + major,
      fill: 'none', class: 'ff-grid-major', 'stroke-width': 1.2
    }, pat);

    const layer = R.layers.grid;
    layer.innerHTML = '';
    /* 用超大矩形铺满可视世界(视图可平移,取足够大的范围) */
    svgEl('rect', {
      x: -8000, y: -8000, width: 16000, height: 16000,
      fill: 'url(#ff-grid)', 'pointer-events': 'none'
    }, layer);
  }

  function buildDefs() {
    const defs = R.layers.defs;
    defs.innerHTML = '';

    /* 灯泡:白热核 */
    const core = svgEl('radialGradient', { id: 'lamp-core' }, defs);
    svgEl('stop', { offset: '0%', 'stop-color': '#fffdf2', 'stop-opacity': 1 }, core);
    svgEl('stop', { offset: '42%', 'stop-color': '#ffe8a8', 'stop-opacity': 0.96 }, core);
    svgEl('stop', { offset: '72%', 'stop-color': '#ffc95e', 'stop-opacity': 0.55 }, core);
    svgEl('stop', { offset: '100%', 'stop-color': '#ffb347', 'stop-opacity': 0 }, core);

    /* 灯泡:洒在纸面上的暖光(低透明度、大半径) */
    const cast = svgEl('radialGradient', { id: 'lamp-cast' }, defs);
    svgEl('stop', { offset: '0%', 'stop-color': '#ffcf7a', 'stop-opacity': 0.55 }, cast);
    svgEl('stop', { offset: '38%', 'stop-color': '#ffc86e', 'stop-opacity': 0.26 }, cast);
    svgEl('stop', { offset: '72%', 'stop-color': '#ffbe5a', 'stop-opacity': 0.08 }, cast);
    svgEl('stop', { offset: '100%', 'stop-color': '#ffb347', 'stop-opacity': 0 }, cast);

    /* 泛光模糊 */
    const bloom = svgEl('filter', { id: 'lamp-bloom', x: '-160%', y: '-160%', width: '420%', height: '420%' }, defs);
    svgEl('feGaussianBlur', { stdDeviation: 3.2 }, bloom);

    R.gradGroup = svgEl('g', { id: 'potential-grads' }, defs);
  }

  /* ---------- 视图 ---------- */

  function applyView() {
    const r = svg.getBoundingClientRect();
    if (r.width > 1 && r.height > 1) {
      R.view.h = R.view.w * (r.height / r.width);
    }
    svg.setAttribute('viewBox', R.view.x + ' ' + R.view.y + ' ' + R.view.w + ' ' + R.view.h);
  }

  function screenToWorld(clientX, clientY) {
    const r = svg.getBoundingClientRect();
    return {
      x: R.view.x + (clientX - r.left) / r.width * R.view.w,
      y: R.view.y + (clientY - r.top) / r.height * R.view.h
    };
  }

  function zoomAt(clientX, clientY, factor) {
    const r = svg.getBoundingClientRect();
    const w = screenToWorld(clientX, clientY);
    const nw = clamp(R.view.w / factor, 200, 4000);
    const nh = nw * (r.height / r.width || 0.65);
    R.view.x = w.x - (clientX - r.left) / r.width * nw;
    R.view.y = w.y - (clientY - r.top) / r.height * nh;
    R.view.w = nw; R.view.h = nh;
    applyView();
  }

  function panBy(dx, dy) {
    R.view.x -= dx; R.view.y -= dy;
    applyView();
  }

  function setView(x, y, w) {
    R.view.x = x; R.view.y = y;
    R.view.w = clamp(w, 200, 4000);
    applyView();
  }

  function fitView() {
    const m = R.model;
    const r = svg.getBoundingClientRect();
    if (!m || !m.edges.size || r.width < 2) {
      R.view = { x: -60, y: -60, w: 920, h: 640 };
      applyView();
      return;
    }
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    m.edges.forEach((e) => {
      x0 = Math.min(x0, e.a[0], e.b[0]); x1 = Math.max(x1, e.a[0], e.b[0]);
      y0 = Math.min(y0, e.a[1], e.b[1]); y1 = Math.max(y1, e.a[1], e.b[1]);
    });
    const pad = 2.2;
    const w = (x1 - x0 + pad * 2) * G, h = (y1 - y0 + pad * 2) * G;
    const scale = Math.max(w / r.width, h / r.height);
    R.view.w = scale * r.width; R.view.h = scale * r.height;
    R.view.x = ((x0 + x1) / 2) * G - R.view.w / 2;
    R.view.y = ((y0 + y1) / 2) * G - R.view.h / 2;
    applyView();
  }

  /* ---------- 结构渲染 ---------- */

  function syncStructure() {
    const m = R.model;
    if (!m) return;
    const seen = new Set();

    m.edges.forEach((e) => {
      seen.add(e.id);
      const angle = symbols.angleOf(e.a, e.b);
      const mx = w2((e.a[0] + e.b[0]) / 2), my = w2((e.a[1] + e.b[1]) / 2);
      const tr = 'translate(' + mx + ',' + my + ') rotate(' + angle + ')';
      let rec = R.edgeEls.get(e.id);
      if (rec && rec.type === e.type && rec.tr === tr) {
        rec.key = e.key;
        return;
      }
      if (rec) removeEdgeRec(e.id);
      addEdgeGroup(e, angle, tr);
    });

    R.edgeEls.forEach((rec, id) => {
      if (!seen.has(id)) removeEdgeRec(id);
    });

    /* 记录本轮 id 集合,下一轮据此判断哪些是新增边 */
    R.prevIds = seen;
    buildJunctions();
    applySelection();
    applyProbeMarker();
  }

  function removeEdgeRec(id) {
    const rec = R.edgeEls.get(id);
    if (!rec) return;
    rec.group.remove();
    rec.hit.remove();
    Object.keys(rec.text).forEach((k) => rec.text[k].remove());
    R.edgeEls.delete(id);
  }

  function collectHooks(sym) {
    const hooks = {};
    sym.querySelectorAll('[data-hook]').forEach((h) => {
      hooks[h.getAttribute('data-hook')] = h;
    });
    return hooks;
  }

  function addEdgeGroup(e, angle, tr) {
    const sym = symbols.build(e.type, angle, e.props, { text: false });

    const group = svgEl('g', {
      class: 'edge-group',
      transform: tr,
      'data-edge-id': e.id,
      'data-edge-key': e.key
    }, R.layers.edges);
    group.appendChild(sym);

    /* 放置动画:新元件弹入(仅首次加入时) */
    /* 只有"这一轮新出现"的边才播放弹入动画:
       用上一轮的 id 集合做差集,避免每次重绘都闪一下 */
    if (!R.prevIds || !R.prevIds.has(e.id)) {
      group.classList.add('just-placed');
      group.addEventListener('animationend', () => group.classList.remove('just-placed'), { once: true });
    }

    /* 命中区(透明粗线,捕捉指针事件);只传 key,事件时再查当前边,避免 undo 后引用陈旧 */
    const hit = svgEl('line', {
      x1: -G / 2, y1: 0, x2: G / 2, y2: 0,
      class: 'edge-hit', transform: tr
    }, R.layers.edges);

    const text = {};
    /* 字母层:未旋转,锚点在中点 → 任何朝向都光学居中 */
    if (LETTERS[e.type]) {
      const [tx, ty] = localToWorld(e, 0, 0);
      const t = svgEl('text', {
        x: tx.toFixed(2), y: ty.toFixed(2),
        class: 'sym-letter',
        'text-anchor': 'middle',
        'dominant-baseline': 'central'
      }, R.layers['symbol-text']);
      t.textContent = LETTERS[e.type];
      text.letter = t;
    }
    /* 电池正极标记「+」 */
    if (e.type === T.BATTERY) {
      const [px, py] = localToWorld(e, 11.5, -6.5);
      const t = svgEl('text', {
        x: px.toFixed(2), y: py.toFixed(2),
        class: 'sym-sign',
        'text-anchor': 'middle',
        'dominant-baseline': 'central'
      }, R.layers['symbol-text']);
      t.textContent = '+';
      text.sign = t;
    }
    /* 仪表读数 */
    if (e.type === T.AMMETER || e.type === T.VOLTMETER) {
      const [rx, ry] = localToWorld(e, 0, 22);
      const t = svgEl('text', {
        x: rx.toFixed(2), y: ry.toFixed(2),
        class: 'reading-text',
        'text-anchor': 'middle',
        'dominant-baseline': 'central'
      }, R.layers['symbol-text']);
      t.textContent = '—';
      text.reading = t;
    }

    const rec = { group, sym, hit, text, hooks: collectHooks(sym), type: e.type, tr, key: e.key };
    R.edgeEls.set(e.id, rec);
    applyRecSelection(rec);
  }

  /* 结点实心点:度 ≥ 3 的节点(拓扑概念,含断开关/电压表探针) */
  function buildJunctions() {
    const g = R.layers.junctions;
    g.innerHTML = '';
    if (!R.model) return;
    const deg = R.model.nodeDegrees();
    deg.forEach((d, key) => {
      if (d < 3) return;
      const p = key.split(',');
      svgEl('circle', { cx: w2(+p[0]), cy: w2(+p[1]), r: 3, class: 'junction-dot' }, g);
    });
  }

  /* ---------- 解渲染 ---------- */

  let prevLive = false;
  let rampT0 = -1;
  const lampAnims = new Map();   /* edgeId -> {el, target, cur, applied} */

  function syncSolution() {
    const m = R.model, sol = R.sol;
    if (!m || !sol) return;
    R.version++;
    setPhiScale(Math.max(Math.abs(sol.phiMax), Math.abs(sol.phiMin)));
    colorCache.clear();

    R.layers.underlay.innerHTML = '';
    R.layers.efield.innerHTML = '';
    R.layers.readings.innerHTML = '';
    R.gradGroup.innerHTML = '';

    const live = sol.Imax > 1e-3;
    if (live && !prevLive) rampT0 = performance.now();
    if (!live) rampT0 = -1;
    prevLive = live;

    const seenLamps = new Set();
    m.edges.forEach((e) => { if (e.type === T.LAMP) seenLamps.add(e.id); });
    lampAnims.forEach((a, id) => { if (!seenLamps.has(id)) lampAnims.delete(id); });

    /* 电场自适应参考:本电路无源元件的最大压降 */
    let efieldURef = 0.01;
    m.edges.forEach((e) => {
      if (e.type === T.RESISTOR || e.type === T.LAMP || e.type === T.RHEOSTAT || e.type === T.SWITCH) {
        const Ux = solver.edgeU(e, sol);
        if (Ux != null && Math.abs(Ux) > efieldURef) efieldURef = Math.abs(Ux);
      }
    });

    /* 灯泡亮度按绝对功率:P_ref = 3V 额定(9/R)。短路时唯一的灯也必须暗下去 */
    const lampP = new Map();
    m.edges.forEach((e) => {
      if (e.type !== T.LAMP) return;
      const I = sol.edgeI.get(e.id);
      const U = solver.edgeU(e, sol);
      const P = (I == null || U == null) ? 0 : Math.abs(U * I);
      lampP.set(e.id, P / (9 / solver.rOf(e)));
    });

    m.edges.forEach((e) => {
      const rec = R.edgeEls.get(e.id);
      if (!rec) return;
      const I = sol.edgeI.get(e.id);
      const U = solver.edgeU(e, sol);
      const phiA = sol.nodePhi.get(nodeKey(e.a));
      const phiB = sol.nodePhi.get(nodeKey(e.b));

      /* 动态部件 */
      if (e.type === T.SWITCH) symbols.setLever(rec.hooks.lever, !!e.props.closed);
      if (e.type === T.RHEOSTAT) symbols.setWiper(rec.hooks, e.props.wiper);
      if (e.type === T.LAMP) {
        const prev = lampAnims.get(e.id);
        lampAnims.set(e.id, {
          el: rec.hooks.glow,
          target: Math.min(1.2, Math.pow(Math.max(0, lampP.get(e.id) || 0), 0.45)),
          cur: prev ? prev.cur : 0,
          applied: false
        });
      }
      if (e.type === T.MOTOR) {
        /* 转速 ∝ 端电压。若将来求解器给电动机有限电阻,则优先用带符号的
         * 电流(转向随电流反向);当前 solver 把电动机按开路处理,于是退回
         * 端电压驱动 —— 否则新元件在画布上永远是死的。 */
        let drive = 0;
        const r = solver.rOf(e, R.model.wireR);
        if (I != null && Math.abs(I) > 1e-6 && isFinite(r)) {
          drive = Math.sign(I) * Math.abs(I) * r;
        } else if (U != null) {
          drive = U;
        }
        const rpm = clamp(drive * 320, -2600, 2600);
        symbols.setSpin(rec.hooks.rotor, rpm);
      }
      if (e.type === T.BELL) {
        let drive = 0;
        const r = solver.rOf(e, R.model.wireR);
        if (I != null && Math.abs(I) > 1e-6 && isFinite(r)) {
          drive = Math.abs(I) * r;
        } else if (U != null) {
          drive = Math.abs(U);
        }
        symbols.setRing(rec.hooks.bell, clamp(drive / 3, 0, 1));
      }

      /* 仪表读数(字母层正立;画布上显示偏转幅值,带符号值见检查器) */
      if (rec.text.reading) {
        let val;
        if (e.type === T.AMMETER) val = (I == null) ? null : I;
        else val = (phiA == null || phiB == null) ? null : (phiB - phiA);
        rec.text.reading.textContent = val == null ? '—' : fmt(Math.abs(val), e.type === T.AMMETER ? 'A' : 'V');
      }

      /* 电势层:边色带平头、严格节点到节点(不越界);接头由节点圆盘补圆 */
      if (R.opts.potential) {
        const gid = 'eg' + e.id + 'v' + R.version;
        const lg = svgEl('linearGradient', {
          id: gid, gradientUnits: 'userSpaceOnUse',
          x1: w2(e.a[0]), y1: w2(e.a[1]), x2: w2(e.b[0]), y2: w2(e.b[1])
        }, R.gradGroup);
        svgEl('stop', { offset: '0%', 'stop-color': phiColor(phiA) }, lg);
        svgEl('stop', { offset: '100%', 'stop-color': phiColor(phiB) }, lg);
        svgEl('line', {
          x1: w2(e.a[0]), y1: w2(e.a[1]), x2: w2(e.b[0]), y2: w2(e.b[1]),
          stroke: 'url(#' + gid + ')', 'stroke-width': 9, 'stroke-linecap': 'butt'
        }, R.layers.underlay);
      }

      /* 电场箭头(只画无源元件;电池内的静电场方向与电流相反,不画) */
      if (R.opts.efield && (e.type === T.RESISTOR || e.type === T.LAMP || e.type === T.RHEOSTAT || e.type === T.SWITCH)) {
        const Ue = solver.edgeU(e, sol);
        if (Ue != null && Math.abs(Ue) >= 0.01) drawEField(e, Ue, efieldURef);
      }
    });

    /* 电势节点盘 */
    if (R.opts.potential) {
      const deg = m.nodeDegrees();
      deg.forEach((d, key) => {
        const p = key.split(',');
        const phi = sol.nodePhi.get(key);
        svgEl('circle', {
          cx: w2(+p[0]), cy: w2(+p[1]), r: 4.5,
          fill: phiColor(phi), opacity: 0.92
        }, R.layers.underlay);
      });
    }

    /* 电势数值标注(读数层,正立) */
    if (R.opts.phiLabels) {
      sol.nodePhi.forEach((phi, key) => {
        const p = key.split(',');
        const t = svgEl('text', {
          x: w2(+p[0]) + 5, y: w2(+p[1]) - 6, class: 'phi-label'
        }, R.layers.readings);
        t.textContent = phi == null ? '—' : fmt(phi, 'V', 2);
      });
    }

    syncParticles();
    applyProbeMarker();
    applySelection();
  }

  /* 电场箭头:方向 高电势 → 低电势。长度按本电路最大压降自适应 */
  function drawEField(e, U, uRef) {
    const angle = symbols.angleOf(e.a, e.b);
    const frac = clamp(Math.abs(U) / uRef, 0.15, 1);
    const len = 8 + 18 * frac;
    const dir = (U > 0) ? 1 : -1;
    const x0 = -len / 2 * dir, x1 = len / 2 * dir;
    const g = svgEl('g', {
      class: 'efield-arrow',
      transform: 'translate(' + w2((e.a[0] + e.b[0]) / 2) + ',' + w2((e.a[1] + e.b[1]) / 2) + ') rotate(' + angle + ')'
    }, R.layers.efield);
    svgEl('line', { x1: x0, y1: 0, x2: x1 - 6 * dir, y2: 0, 'stroke-width': 1.5 }, g);
    svgEl('polygon', {
      points: x1 + ',' + (-4) + ' ' + x1 + ',' + 4 + ' ' + (x1 - 7.5 * dir) + ',0'
    }, g);
  }

  /* ---------- 粒子与通电动效 ---------- */

  const pools = new Map();   /* edgeId -> {els[], phase[], count, speed, dir, edge} */

  function energizeRamp(now) {
    if (rampT0 < 0) return 1;
    const t = Math.min(1, (now - rampT0) / 180);
    return 1 - Math.pow(1 - t, 2.2);
  }

  function lampsSettled() {
    let ok = true;
    lampAnims.forEach((a) => { if (Math.abs(a.target - a.cur) >= 0.004) ok = false; });
    return ok;
  }

  function syncParticles() {
    const sol = R.sol;
    if (!sol) return;
    const layer = R.layers.particles;
    const Imax = Math.max(sol.Imax, 1e-9);
    const seen = new Set();

    layer.classList.toggle('dimmed', !!R.opts.potential);

    R.model.edges.forEach((e) => {
      const I = sol.edgeI.get(e.id);
      if (!R.opts.particles || I == null || I === 0) return;
      seen.add(e.id);
      const ratio = Math.abs(I) / Imax;
      const speed = 58;
      const dir = (I > 0 ? 1 : -1) * (R.opts.electrons ? -1 : 1);
      const radius = 1.9 + 1.9 * ratio;

      let p = pools.get(e.id);
      if (!p) {
        p = { els: [], phase: [], count: 2 };
        for (let i = 0; i < 2; i++) {
          const c = svgEl('circle', { r: radius, class: 'particle' + (R.opts.electrons ? ' electron' : '') }, layer);
          p.els.push(c);
          p.phase.push(i / 2);
        }
        pools.set(e.id, p);
      }
      p.els.forEach((c) => {
        c.setAttribute('class', 'particle' + (R.opts.electrons ? ' electron' : ''));
        c.setAttribute('r', radius.toFixed(2));
      });
      p.speed = speed;
      p.dir = dir;
      p.edge = e;
    });

    pools.forEach((p, id) => {
      if (!seen.has(id)) {
        p.els.forEach((c) => c.remove());
        pools.delete(id);
      }
    });

    ensureRaf();
  }

  function tick(now) {
    const dt = Math.min(0.05, (now - R.lastT) / 1000);
    R.lastT = now;
    const ramp = energizeRamp(now);

    pools.forEach((p) => {
      const e = p.edge;
      if (!e) return;
      const ax = w2(e.a[0]), ay = w2(e.a[1]), bx = w2(e.b[0]), by = w2(e.b[1]);
      const advance = p.speed * ramp * dt / G;
      for (let i = 0; i < p.count; i++) {
        /* 相位沿电流方向推进,越过端点后从另一端重新进入。
           用带符号的模运算,避免反向时 phase 在 0/1 之间来回跳
           (那会让粒子在两端闪烁)。 */
        p.phase[i] += advance;
        if (p.phase[i] >= 1) p.phase[i] -= 1;
        else if (p.phase[i] < 0) p.phase[i] += 1;
        const t = p.dir > 0 ? p.phase[i] : 1 - p.phase[i];
        p.els[i].setAttribute('cx', lerp(ax, bx, t));
        p.els[i].setAttribute('cy', lerp(ay, by, t));
        /* 端点处淡出淡入,避免粒子瞬移造成闪烁 */
        const edgeFade = Math.min(1, Math.min(t, 1 - t) / 0.12);
        p.els[i].setAttribute('opacity', edgeFade.toFixed(3));
      }
    });

    /* 灯泡亮度向目标平滑逼近(开关闭合渐亮、断路渐灭、滑片连续调光) */
    lampAnims.forEach((a) => {
      const d = a.target - a.cur;
      if (Math.abs(d) < 0.004) {
        if (!a.applied) { symbols.setGlow(a.el, a.cur = a.target); a.applied = true; }
        return;
      }
      a.cur += d * Math.min(1, dt * 7);
      a.applied = false;
      symbols.setGlow(a.el, a.cur);
    });

    if (!R.destroyed && (pools.size || !lampsSettled())) R.raf = requestAnimationFrame(tick);
    else R.raf = null;
  }

  function ensureRaf() {
    if (!R.raf && !R.destroyed && !document.hidden && (pools.size || !lampsSettled())) {
      R.lastT = performance.now();
      R.raf = requestAnimationFrame(tick);
    }
  }

  function onVisibility() {
    if (document.hidden && R.raf) { cancelAnimationFrame(R.raf); R.raf = null; }
    else ensureRaf();
  }
  document.addEventListener('visibilitychange', onVisibility);

  /* ---------- 探针 / 选中 ---------- */

  function applyProbeMarker() {
    const old = R.layers.overlay.querySelector('.probe-marker');
    if (old) old.remove();
    if (!R.probeKey || !R.model) return;
    const e = R.model.edges.get(R.probeKey);
    if (!e) return;
    const mid = edgeMidWorld(e);
    const angle = symbols.angleOf(e.a, e.b);
    const g = svgEl('g', {
      class: 'probe-marker',
      transform: 'translate(' + mid[0] + ',' + mid[1] + ') rotate(' + angle + ')'
    }, R.layers.overlay);
    svgEl('line', { x1: 0, y1: -9, x2: 0, y2: 9, stroke: '#c8451f', 'stroke-width': 2.5 }, g);
    svgEl('circle', { cx: 0, cy: 0, r: 7.5, fill: 'none', stroke: '#c8451f', 'stroke-width': 1.2, 'stroke-dasharray': '3 3' }, g);
  }

  function applyRecSelection(rec) {
    if (!rec) return;
    const isSel = R.selKey != null && rec.key === R.selKey;
    rec.group.classList.toggle('selected', isSel);
    if (rec.hit) rec.hit.classList.toggle('selected', isSel);
  }

  function applySelection() {
    R.edgeEls.forEach((rec) => applyRecSelection(rec));
    /* 选中标记 = 墨色蚂蚁线虚框(绝不用红,避免与电势/电流撞色) */
    const old = R.layers.overlay.querySelector('.sel-marker');
    if (old) old.remove();
    if (R.selKey == null || !R.model) return;
    let edge = null;
    R.model.edges.forEach((e) => { if (e.key === R.selKey) edge = e; });
    if (!edge) return;
    const x1 = w2(edge.a[0]), y1 = w2(edge.a[1]), x2 = w2(edge.b[0]), y2 = w2(edge.b[1]);
    const pad = 11;
    svgEl('rect', {
      class: 'sel-marker',
      x: Math.min(x1, x2) - pad, y: Math.min(y1, y2) - pad,
      width: Math.abs(x2 - x1) + pad * 2, height: Math.abs(y2 - y1) + pad * 2,
      rx: 3
    }, R.layers.overlay);
  }

  /* ---------- 命中测试 ---------- */

  function hitEdge(pt) {
    if (!R.model) return null;
    const gx = Math.round(pt.x / G), gy = Math.round(pt.y / G);
    let best = null, bestD = 15;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let i = 0; i < 4; i++) {
      const key = edgeKey([gx, gy], [gx + dirs[i][0], gy + dirs[i][1]]);
      const e = R.model.edges.get(key);
      if (!e) continue;
      const d = distToEdge(pt, e);
      if (d < bestD) { bestD = d; best = key; }
    }
    return best;
  }

  function gridEdgeAt(pt) {
    const gx = Math.round(pt.x / G), gy = Math.round(pt.y / G);
    let best = null, bestD = 18;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let i = 0; i < 4; i++) {
      const a2 = [gx, gy], b2 = [gx + dirs[i][0], gy + dirs[i][1]];
      const d = distToEdge(pt, { a: a2, b: b2 });
      if (d < bestD) { bestD = d; best = edgeKey(a2, b2); }
    }
    return best;
  }

  function keyEnds(key) {
    const p = key.split('|');
    return [p[0].split(',').map(Number), p[1].split(',').map(Number)];
  }

  function distToEdge(pt, e) {
    const ax = w2(e.a[0]), ay = w2(e.a[1]), bx = w2(e.b[0]), by = w2(e.b[1]);
    const vx = bx - ax, vy = by - ay;
    const t = clamp(((pt.x - ax) * vx + (pt.y - ay) * vy) / (vx * vx + vy * vy), 0, 1);
    const px = ax + vx * t, py = ay + vy * t;
    return Math.hypot(pt.x - px, pt.y - py);
  }

  function nodeAt(pt) {
    if (!R.model) return null;
    const gx = Math.round(pt.x / G), gy = Math.round(pt.y / G);
    const key = gx + ',' + gy;
    const adj = R.model.adjacency();
    if (adj.has(key) && Math.hypot(pt.x - w2(gx), pt.y - w2(gy)) < 10) return [gx, gy];
    return null;
  }

  /* ---------- 生命周期 ---------- */

  ensureLayers();
  buildDefs();
  buildGrid();      /* 必须在 buildDefs 之后:pattern 定义在 defs 里 */
  applyView();

  let ro = null;
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => applyView());
    ro.observe(svg);
  } else {
    window.addEventListener('resize', applyView);
  }

  function destroy() {
    R.destroyed = true;
    if (R.raf) cancelAnimationFrame(R.raf);
    document.removeEventListener('visibilitychange', onVisibility);
    if (ro) ro.disconnect();
    else window.removeEventListener('resize', applyView);
    R.edgeEls.forEach((rec) => {
      if (rec.hooks.rotor && rec.hooks.rotor.__spinRaf) cancelAnimationFrame(rec.hooks.rotor.__spinRaf);
      if (rec.hooks.lever && rec.hooks.lever.__raf) cancelAnimationFrame(rec.hooks.lever.__raf);
    });
    R.edgeEls.clear();
    pools.clear();
    lampAnims.clear();
  }

  /* ---------- 对外接口 ---------- */
  const api = {
    /* 场景根(供交互层放 ghost) */
    overlay: () => R.layers.overlay,
    view: () => R.view,
    opts: () => R.opts,

    setModel(m) { R.model = m; },
    setSolution(sol) { R.sol = sol; },

    syncStructure,
    syncSolution,

    setOpts(opts) {
      Object.assign(R.opts, opts || {});
      if (R.sol) syncSolution();
    },

    select(key) { R.selKey = key; applySelection(); },
    selectedKey() { return R.selKey; },

    probe(key) {
      if (key === undefined) return R.probeKey;
      R.probeKey = key;
      applyProbeMarker();
      return R.probeKey;
    },

    screenToWorld,
    setView,
    zoomAt,
    panBy,
    fitView,
    applyView,
    hitEdge,
    gridEdgeAt,
    keyEnds,
    nodeAt,
    destroy
  };
  active = api;
  return api;
}

/* ---------- 单例兼容层(FF.render 形态) ---------- */
let active = null;

export const render = {
  init(svg) {
    active = makeRenderer(svg);
    return active;
  },
  get current() { return active; },
  overlay() { return active && active.overlay(); },
  view() { return active ? active.view() : { x: 0, y: 0, w: 920, h: 640 }; },
  opts() { return active ? active.opts() : {}; },
  setModel(m) { if (active) active.setModel(m); },
  setSolution(sol) { if (active) active.setSolution(sol); },
  syncStructure() { if (active) active.syncStructure(); },
  syncSolution() { if (active) active.syncSolution(); },
  setOpts(opts) { if (active) active.setOpts(opts); },
  select(key) { if (active) active.select(key); },
  selectedKey() { return active ? active.selectedKey() : null; },
  probe(key) { return active ? active.probe(key) : null; },
  screenToWorld(x, y) { return active ? active.screenToWorld(x, y) : { x: 0, y: 0 }; },
  setView(x, y, w) { if (active) active.setView(x, y, w); },
  zoomAt(x, y, f) { if (active) active.zoomAt(x, y, f); },
  panBy(dx, dy) { if (active) active.panBy(dx, dy); },
  fitView() { if (active) active.fitView(); },
  hitEdge(pt) { return active ? active.hitEdge(pt) : null; },
  gridEdgeAt(pt) { return active ? active.gridEdgeAt(pt) : null; },
  keyEnds(key) { return active ? active.keyEnds(key) : null; },
  nodeAt(pt) { return active ? active.nodeAt(pt) : null; }
};

export { makeRenderer as createRenderer };
