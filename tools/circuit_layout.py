#!/usr/bin/env python3
"""逻辑连接图 → FieldFlow 网格边元组,用 schemdraw 做布局。

schemdraw 是专业电路图库,负责元件定位与正交走线;
本模块把它的浮点坐标吸附到整数网格,输出可直接喂给 FieldFlow 求解器。

用法(被 ingest_exam.py 调用):
  from circuit_layout import layout_circuit
  edges = layout_circuit(circuit_dict)
"""
import math

import schemdraw
import schemdraw.elements as elm

# FieldFlow 元件类型 → schemdraw 元件
ELEMENT = {
    'battery': elm.Battery,
    'switch': elm.Switch,
    'resistor': elm.Resistor,
    'lamp': elm.Lamp,
    'rheostat': elm.Potentiometer,
    'ammeter': elm.MeterA,
    'voltmeter': elm.MeterV,
    'wire': elm.Line,
}

# schemdraw 默认元件长度约 3 个单位;我们的网格是整数格点,
# 所以一个元件 ≈ 3 格,连线可以逐格铺。
GRID_PER_UNIT = 1.0


def _snap(v, step=1.0):
    return int(round(v / step)) * step


def _to_grid(pt):
    return (int(round(pt.x)), int(round(-pt.y)))   # y 轴翻转(schemdraw 向上为正)


def _walk(a, b):
    """两点之间的逐格正交路径(先横后竖)。"""
    pts = [a]
    cur = list(a)
    while cur[0] != b[0]:
        cur = [cur[0] + (1 if b[0] > cur[0] else -1), cur[1]]
        pts.append(tuple(cur))
    while cur[1] != b[1]:
        cur = [cur[0], cur[1] + (1 if b[1] > cur[1] else -1)]
        pts.append(tuple(cur))
    return pts


def _props_for(t, comp):
    p = {}
    label = (comp.get('label') or '').lower()
    if t == 'battery':
        p['V'] = 3
    elif t in ('resistor', 'lamp'):
        p['R'] = 10
    elif t == 'rheostat':
        p['Rmax'] = 50
        p['wiper'] = 0.5
    elif t == 'switch':
        p['closed'] = False
    return p


def layout_circuit(circuit, max_elements=24):
    """把逻辑连接图排成网格边。

    circuit: {'components': [{'id','type','label'}], 'connections': [{'from','to'}]}
    返回 [type, x1, y1, x2, y2, props] 或 None。
    """
    comps = circuit.get('components') or []
    conns = circuit.get('connections') or []
    if not comps or not conns or len(comps) > max_elements:
        return None

    by_id = {c['id']: c for c in comps}
    norm = {}
    for c in comps:
        raw = (c.get('type') or '').strip().lower()
        aliases = {
            '电源': 'battery', '电池': 'battery', '开关': 'switch', '电键': 'switch',
            '电阻': 'resistor', '定值电阻': 'resistor', '灯泡': 'lamp', '小灯泡': 'lamp',
            '滑动变阻器': 'rheostat', '变阻器': 'rheostat', '电流表': 'ammeter',
            '电压表': 'voltmeter', '导线': 'wire',
        }
        norm[c['id']] = aliases.get(raw, raw)

    # 邻接
    adj = {cid: [] for cid in by_id}
    for k in conns:
        a, b = k.get('from'), k.get('to')
        if a in adj and b in adj and a != b:
            adj[a].append(b)
            adj[b].append(a)

    bat = next((cid for cid in by_id if norm[cid] == 'battery'), None)
    if not bat:
        return None

    # ---- 用 schemdraw 画一遍,拿它的坐标 ----
    d = schemdraw.Drawing(show=False)
    d.config(unit=3.0)

    placed = {}          # cid -> (element 对象, 起点格, 终点格)
    visited = {bat}

    try:
        el = ELEMENT[norm[bat]]()
        d += el.up()
        placed[bat] = (el, _to_grid(el.start), _to_grid(el.end))

        # BFS:沿邻接逐层放置
        queue = [bat]
        while queue:
            cur = queue.pop(0)
            for nb in adj[cur]:
                if nb in visited:
                    continue
                t = norm.get(nb, 'wire')
                cls = ELEMENT.get(t, elm.Line)
                # 方向策略:沿当前元件末端继续向右/向下
                ce = placed[cur][0]
                el = cls()
                if t == 'voltmeter':
                    d += el.down().label(by_id[nb].get('label', ''))
                else:
                    d += el.right().label(by_id[nb].get('label', ''))
                placed[nb] = (el, _to_grid(el.start), _to_grid(el.end))
                visited.add(nb)
                queue.append(nb)
    except Exception:
        return None

    # ---- schemdraw 坐标 → 网格边 ----
    edges = []
    used = set()

    def add(t, a, b):
        if a == b:
            return
        key = (min(a, b), max(a, b))
        if key in used:
            return
        used.add(key)
        edges.append([t, a[0], a[1], b[0], b[1], _props_for(t, {})])

    for cid, (el, a, b) in placed.items():
        t = norm.get(cid, 'wire')
        # 元件本体:从起点到终点(可能跨多格,逐格铺,元件放第一格)
        pts = _walk(a, b)
        if len(pts) < 2:
            continue
        add(t, pts[0], pts[1])
        for i in range(1, len(pts) - 1):
            add('wire', pts[i], pts[i + 1])

    # ---- 补连接:未在同一路径上的连接用导线绕行 ----
    for k in conns:
        u, v = k.get('from'), k.get('to')
        if u not in placed or v not in placed:
            continue
        a = placed[u][2]
        b = placed[v][1]
        if a == b:
            continue
        pts = _walk(a, b)
        for i in range(len(pts) - 1):
            add('wire', pts[i], pts[i + 1])

    return edges or None
