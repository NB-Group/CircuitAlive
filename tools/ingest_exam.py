#!/usr/bin/env python3
"""FieldFlow 真题录入管线

PDF 扫描件 → 页面图片 → 多模态模型提取题面与电路逻辑图 → 网格布局 → 求解器验证 → 题库 JSON

用法:
  python3 tools/ingest_exam.py --pdf 试卷.pdf --out out.json [--pages 3-5] [--api ...]

模型端点可用 --api 覆盖(默认 SiliconFlow),本地部署时:
  --api http://127.0.0.1:8000/v1/chat/completions --model Qwen/Qwen3.5-4B

设计要点:
  - 模型只负责"看懂图",输出逻辑连接图(components + connections)。
  - 网格坐标布局由本脚本的确定性算法完成(模型不擅长整数格点)。
  - 每个电路都过 solver 验证;验证失败就丢弃并记录,绝不产出坏数据。
"""
import argparse
import base64
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

TOOLS_DIR = Path(__file__).parent
LAYOUT_SCRIPT = TOOLS_DIR / 'circuit-layout.mjs'

# 元件类型 → FieldFlow 的 T.* 字符串
TYPE_MAP = {
    'battery': 'battery', '电源': 'battery', '电池': 'battery',
    'switch': 'switch', '开关': 'switch', '电键': 'switch',
    'resistor': 'resistor', '电阻': 'resistor', '定值电阻': 'resistor',
    'lamp': 'lamp', '灯泡': 'lamp', '小灯泡': 'lamp',
    'rheostat': 'rheostat', '滑动变阻器': 'rheostat', '变阻器': 'rheostat',
    'ammeter': 'ammeter', '电流表': 'ammeter',
    'voltmeter': 'voltmeter', '电压表': 'voltmeter',
    'wire': 'wire', '导线': 'wire',
}

EXTRACT_PROMPT = """这是一张初中物理试卷页面。请完成两件事:

1. 找出页面中所有电路图,把每个电路图的连接关系写成 JSON。
2. 提取与电学有关的题目文字(题干、选项、小问)。

严格输出 JSON,不要 markdown 代码块,不要解释:
{
  "problems": [
    {
      "number": "18",
      "statement": "题干原文(含小问)",
      "circuits": [
        {
          "figure_label": "图8",
          "components": [
            {"id": "battery1", "type": "battery", "label": "电源"},
            {"id": "lamp1", "type": "lamp", "label": "L1"}
          ],
          "connections": [
            {"from": "battery1", "to": "switch1"},
            {"from": "switch1", "to": "lamp1"}
          ],
          "topology": "series 或 parallel 或 mixed",
          "notes": "电流表测干路 等"
        }
      ]
    }
  ]
}

元件 type 只能取: battery, switch, resistor, lamp, rheostat, ammeter, voltmeter, wire。
连接关系要写出每条支路,能判断串并联。看不清就标注在 notes 里,不要编造。"""


def render_pdf(pdf_path, pages, dpi, outdir):
    """PDF 页面 → PNG。pages 形如 '3-5' 或 '3'。"""
    args = ['pdftoppm', '-png', '-r', str(dpi)]
    if pages:
        a, _, b = pages.partition('-')
        args += ['-f', a, '-l', b or a]
    prefix = os.path.join(outdir, 'page')
    subprocess.run(args + [pdf_path, prefix], check=True)
    return sorted(Path(outdir).glob('page-*.png'))


def call_model(api, key, model, image_path, timeout):
    b64 = base64.b64encode(Path(image_path).read_bytes()).decode()
    payload = {
        'model': model,
        'messages': [{'role': 'user', 'content': [
            {'type': 'text', 'text': EXTRACT_PROMPT},
            {'type': 'image_url', 'image_url': {'url': f'data:image/png;base64,{b64}'}},
        ]}],
        'max_tokens': 2000,
        'temperature': 0,
    }
    req = urllib.request.Request(
        api,
        data=json.dumps(payload).encode(),
        headers={'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        res = json.load(r)
    return res['choices'][0]['message']['content']


def parse_json(text):
    """模型可能包 markdown 代码块,宽松提取第一个 JSON 对象。"""
    text = text.strip()
    text = re.sub(r'^```(?:json)?\s*', '', text)
    text = re.sub(r'\s*```$', '', text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find('{')
        end = text.rfind('}')
        if start >= 0 and end > start:
            return json.loads(text[start:end + 1])
        raise


# ---------- 逻辑图 → 网格布局 ----------

def layout_circuit(circuit):
    """逻辑连接图 → 网格边元组。

    真正的电路布局算法,分三步,与模型能力无关:

    1. 建图:元件是节点,连接是边;电源作为根。
    2. 用 Tarjan 求桥(bridge)与双连通分量(BCC)。
       桥 = 串联链上的边;同一个 BCC 内的边 = 一个并联块。
    3. 从电源出发沿桥链布局,遇到 BCC 就把各条支路并排铺开,
       块的两端落在同一对列上;最后正交走线补导线。

    返回 [type, x1, y1, x2, y2, props],失败返回 None。
    """
    comps = circuit.get('components') or []
    conns = circuit.get('connections') or []
    if not comps or not conns:
        return None

    by_id = {c['id']: c for c in comps}
    norm = {}
    for c in comps:
        raw = (c.get('type') or '').strip()
        norm[c['id']] = TYPE_MAP.get(raw.lower()) or TYPE_MAP.get(raw) or 'wire'

    adj = {cid: {} for cid in by_id}
    for k in conns:
        a, b = k.get('from'), k.get('to')
        if a in adj and b in adj and a != b:
            adj[a][b] = True
            adj[b][a] = True

    bat = next((cid for cid in by_id if norm[cid] == 'battery'), None)
    if not bat:
        return None

    props = {
        'battery': {'V': 3}, 'switch': {'closed': False},
        'resistor': {'R': 10}, 'lamp': {'R': 10},
        'rheostat': {'Rmax': 50, 'wiper': 0.5},
        'ammeter': {}, 'voltmeter': {}, 'wire': {},
    }

    nodes = [cid for cid in by_id if norm[cid] != 'voltmeter']
    n = len(nodes)
    if n < 2:
        return None
    idx = {cid: i for i, cid in enumerate(nodes)}

    # ---------- 2. Tarjan:桥与双连通分量 ----------
    disc = [-1] * n
    low = [0] * n
    timer = [0]
    stack = []
    bccs = []          # 每个 BCC:边列表 [(u, v)]
    bridges = set()

    def tarjan(u, parent):
        disc[u] = low[u] = timer[0]
        timer[0] += 1
        for v in adj[nodes[u]]:
            vi = idx.get(v)
            if vi is None:
                continue
            if disc[vi] == -1:
                stack.append((u, vi))
                tarjan(vi, u)
                low[u] = min(low[u], low[vi])
                if low[vi] > disc[u]:
                    bridges.add((min(u, vi), max(u, vi)))
                    # 弹出这个 BCC
                    comp = []
                    while stack:
                        e = stack.pop()
                        comp.append(e)
                        if e == (u, vi):
                            break
                    if comp:
                        bccs.append(comp)
            elif vi != parent and disc[vi] < disc[u]:
                stack.append((u, vi))
                low[u] = min(low[u], disc[vi])

    for i in range(n):
        if disc[i] == -1:
            tarjan(i, -1)
    if stack:
        bccs.append(stack[:])

    # ---------- 3. 布局 ----------
    # 用"列 x 行 y"的网格。每个元件占一格;列间距 2,行间距 2。
    # 主轴(串联链)沿 x 增长;并联块内支路沿 y 并排。
    pos = {}
    edges = []
    used = set()
    next_col = [0]
    occupied = {}       # (x,y) -> cid

    def put(cid, x, y):
        pos[cid] = (x, y)
        occupied[(x, y)] = cid

    def add_edge(t, a, b):
        a = (a[0], a[1]); b = (b[0], b[1])
        if a == b:
            return
        key = (min(a, b), max(a, b))
        if key in used:
            return
        used.add(key)
        edges.append([t, a[0], a[1], b[0], b[1], dict(props.get(t, {}))])

    def wire_path(p, q):
        """正交逐格路径。"""
        pts = [p]
        cur = list(p)
        while cur[0] != q[0]:
            cur = [cur[0] + (1 if q[0] > cur[0] else -1), cur[1]]
            pts.append(tuple(cur))
        while cur[1] != q[1]:
            cur = [cur[0], cur[1] + (1 if q[1] > cur[1] else -1)]
            pts.append(tuple(cur))
        return pts

    # 每个 BCC 的边集合,便于判断某条边是否在并联块里
    bcc_of = {}
    for bi, comp in enumerate(bccs):
        for (u, v) in comp:
            bcc_of[(min(u, v), max(u, v))] = bi

    # 从电源开始 BFS,沿"块"推进
    # 块内所有节点共用一个"起列"和一个"止列"
    placed = set()
    put(bat, 0, 0)
    placed.add(bat)
    frontier = [(bat, 0, 0)]   # (cid, col, row)

    while frontier:
        cur, cx, cy = frontier.pop(0)
        for nb in sorted(adj[cur]):
            if nb in placed or norm[nb] == 'voltmeter':
                continue
            ui, vi = idx[cur], idx[nb]
            key = (min(ui, vi), max(ui, vi))
            b = bcc_of.get(key)

            if key in bridges:
                # 串联:直接放在右边一列
                x, y = cx + 2, cy
                put(nb, x, y)
                placed.add(nb)
                add_edge(norm[nb], pos[cur], (x, y))
                frontier.append((nb, x, y))
            elif b is not None:
                # 并联块:找出块内所有节点,并排铺开
                block_nodes = set()
                for (u, v) in bccs[b]:
                    block_nodes.add(nodes[u]); block_nodes.add(nodes[v])
                block_nodes -= placed
                block_nodes.discard(cur)
                # 支路数 = 块内除公共端外的节点数
                branches = sorted(block_nodes, key=lambda c: (norm[c], c))
                x0 = cx + 2
                for i, cid in enumerate(branches):
                    y = cy + i * 2
                    put(cid, x0, y)
                    placed.add(cid)
                # 从当前节点连到每条支路(横向)
                for cid in branches:
                    add_edge(norm[cid], pos[cur], pos[cid])
                # 支路末端汇合:加一条竖直汇流线
                if branches:
                    ys = [pos[c][1] for c in branches]
                    xr = x0 + 1
                    for y in range(min(ys), max(ys) + 1):
                        add_edge('wire', (xr, y), (xr, y + 1)) if y < max(ys) else None
                    for cid in branches:
                        add_edge('wire', pos[cid], (xr, pos[cid][1]))
                # 继续从每条支路推进
                for cid in branches:
                    frontier.append((cid, x0, pos[cid][1]))
            else:
                # 兜底:普通连接
                x, y = cx + 2, cy
                if (x, y) in occupied:
                    y += 2
                put(nb, x, y)
                placed.add(nb)
                add_edge(norm[nb], pos[cur], (x, y))
                frontier.append((nb, x, y))

    # 没被访问到的元件(不连通)丢弃
    # ---------- 4. 电压表:并联挂到被测元件旁 ----------
    for cid in by_id:
        if norm[cid] != 'voltmeter':
            continue
        nbs = [nb for nb in adj[cid] if nb in pos]
        if len(nbs) < 2:
            continue
        a, b = nbs[0], nbs[1]
        pa, pb = pos[a], pos[b]
        y = max(pa[1], pb[1]) + 2
        path = wire_path(pa, (pa[0], y)) + wire_path((pa[0], y), (pb[0], y))[1:] + wire_path((pb[0], y), pb)[1:]
        mid = len(path) // 2
        for i in range(len(path) - 1):
            add_edge('voltmeter' if i == mid else 'wire', path[i], path[i + 1])

    return edges or None


def elk_layout(circuit):
    """用 elkjs(通过 node 脚本)做自动布局。"""
    try:
        proc = subprocess.run(
            ['node', str(LAYOUT_SCRIPT)],
            input=json.dumps(circuit),
            capture_output=True, text=True, timeout=60,
        )
        if proc.returncode != 0:
            return None
        data = json.loads(proc.stdout)
        return data[0]['edges'] if data else None
    except Exception:
        return None


def verify(circuit_edges, node_bin):
    """把电路交给 Node 求解器验证。返回 (ok, detail)。"""
    abs_solver = os.path.abspath(node_bin)
    script = f"""
import {{ solver }} from 'file://{abs_solver}';
const edges = {json.dumps(circuit_edges)}.map(([t,x1,y1,x2,y2,p]) => ({{
  id: Math.floor(Math.random()*1e9), a:[x1,y1], b:[x2,y2], type:t, props:p||{{}}
}}));
const s = solver.solve(edges, {{ wireR: 0 }});
console.log(JSON.stringify({{ status: s.status, Imax: s.Imax }}));
"""
    with tempfile.NamedTemporaryFile('w', suffix='.mjs', delete=False) as f:
        f.write(script)
        path = f.name
    try:
        out = subprocess.run(['node', path], capture_output=True, text=True, timeout=20)
        if out.returncode != 0:
            return False, out.stderr[:200]
        return True, out.stdout.strip()
    finally:
        os.unlink(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pdf', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--pages', default=None, help='如 3-5')
    ap.add_argument('--dpi', type=int, default=150)
    ap.add_argument('--api', default='https://api.siliconflow.cn/v1/chat/completions')
    ap.add_argument('--key', default=os.environ.get('FF_LLM_KEY', ''))
    ap.add_argument('--model', default='Qwen/Qwen3.5-4B')
    ap.add_argument('--timeout', type=int, default=280)
    ap.add_argument('--solver-path', default=str(Path(__file__).parent.parent / 'src/core/solver.js'))
    args = ap.parse_args()

    if not args.key:
        sys.exit('缺少 API key: --key 或环境变量 FF_LLM_KEY')

    with tempfile.TemporaryDirectory() as td:
        imgs = render_pdf(args.pdf, args.pages, args.dpi, td)
        print(f'渲染 {len(imgs)} 页')
        results = []
        for img in imgs:
            print(f'  处理 {img.name} ...', end='', flush=True)
            try:
                raw = call_model(args.api, args.key, args.model, img, args.timeout)
                data = parse_json(raw)
            except Exception as e:
                print(f' 失败: {e}')
                results.append({'page': img.name, 'error': str(e)})
                continue

            probs = data.get('problems') or []
            print(f' {len(probs)} 题')
            for p in probs:
                for c in (p.get('circuits') or []):
                    layout = elk_layout(c)
                    if layout:
                        ok, detail = verify(layout, args.solver_path)
                        c['grid'] = layout
                        c['verified'] = ok
                        c['verify_detail'] = detail
                    else:
                        c['grid'] = None
                        c['verified'] = False
                        c['verify_detail'] = 'layout failed'
            results.append({'page': img.name, 'problems': probs})

    Path(args.out).write_text(json.dumps(results, ensure_ascii=False, indent=2))
    ok_circuits = sum(
        1 for r in results for p in (r.get('problems') or [])
        for c in (p.get('circuits') or []) if c.get('verified')
    )
    total_circuits = sum(
        1 for r in results for p in (r.get('problems') or [])
        for c in (p.get('circuits') or [])
    )
    print(f'\n完成: {args.out}')
    print(f'电路布局+验证通过 {ok_circuits}/{total_circuits}')


if __name__ == '__main__':
    main()
