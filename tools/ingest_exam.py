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
连接关系要写出每条支路,能判断串并联。看不清就标注在 notes 里,不要编造。

**只提取电路计算题**。以下类型请跳过,不要放进 problems:
- 电磁铁、通电螺线管、磁极判断、磁感线方向(这些不是电路计算)
- 纯实验操作描述题(没有可解的电路)
- 画图题、连线题(只要求补线,没有已知参数)
- 光学、热学、力学题

如果一页里没有电路计算题,输出 {"problems": []}。宁可少收,不要收错。"""


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

# 布局统一走 elkjs(tools/circuit-layout.mjs),不再维护手写布局。
# 旧的 Python 手写版本会产出跨格边(违反网格不变量),已删除。

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
        edges = data[0]['edges'] if data else None
        if not edges:
            return None
        # 网格不变量:每条边必须连接相邻格点(跨格边会让求解器抛异常)
        for e in edges:
            if abs(e[1] - e[3]) + abs(e[2] - e[4]) != 1:
                return None
        return edges
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
