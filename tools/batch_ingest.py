#!/usr/bin/env python3
"""批量录入上海二模物理卷的电学题。

遍历所有区的物理 PDF,逐页调视觉模型,收集带电路的题目,
用 elkjs 布局并过求解器验证,最后合并成一个 JSON。

用法:
  python3 tools/batch_ingest.py --root "试卷根目录" --out data.json
  python3 tools/batch_ingest.py --root ... --out ... --limit 3   # 先试 3 份
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import ingest_exam as ing   # 复用提取/布局/验证逻辑


def find_pdfs(root):
    out = []
    for dirpath, _, files in os.walk(root):
        for f in files:
            if '物理' not in f or not f.lower().endswith('.pdf'):
                continue
            # 答案/解析卷不含新题,跳过(否则白烧 token)
            if any(w in f for w in ('答案', '解析', '评分标准', '参考答案')):
                continue
            out.append(Path(dirpath) / f)
    return sorted(out)


# 电磁学作图题的关键词:这些不是电路计算题,必须排除
EXCLUDE_WORDS = [
    '磁极', '磁感线', '螺线管', '电磁铁', '通电导体在磁场', '安培力', '右手定则',
    '画出', '标出', '连线', '作图', '括号内'
]


def is_circuit_problem(statement):
    """判断是否为电路计算题(而非电磁学作图/实验描述)。"""
    if not statement:
        return False
    # 必须提到电路元件
    has_elements = any(w in statement for w in ['电阻', '灯泡', '电流表', '电压表', '滑动变阻器', '电源', '开关'])
    if not has_elements:
        return False
    # 排除电磁学作图题
    for w in EXCLUDE_WORDS:
        if w in statement:
            return False
    return True


def region_of(path):
    """从路径里提取区名,如 2025届初三二模【宝山区】 -> 宝山区"""
    import re
    m = re.search(r'【(.+?)】', str(path))
    return m.group(1) if m else ''


_lock = threading.Lock()


def log(*a):
    with _lock:
        print(*a, flush=True)


def process_pdf(pdf, idx, total, args):
    """处理一份 PDF,返回该卷收集到的题目列表。"""
    region = region_of(pdf)
    log(f'[{idx}/{total}] {region} · {pdf.name}')
    found = []
    with tempfile.TemporaryDirectory() as td:
        try:
            imgs = ing.render_pdf(str(pdf), args.pages, args.dpi, td)
        except Exception as e:
            log(f'   {region} 渲染失败: {e}')
            return found
        for img in imgs:
            try:
                raw = ing.call_model(args.api, args.key, args.model, img, args.timeout)
                data = ing.parse_json(raw)
            except Exception as e:
                log(f'   {region} {img.name} 提取失败: {str(e)[:60]}')
                continue

            for p in data.get('problems') or []:
                circuits = p.get('circuits') or []
                if not circuits:
                    continue
                if not is_circuit_problem(p.get('statement')):
                    log(f'   {region} 跳过非电路计算题: {(p.get("statement") or "")[:30]}')
                    continue
                kept = []
                for c in circuits:
                    layout = ing.elk_layout(c)
                    if not layout:
                        continue
                    ok, detail = ing.verify(layout, str(Path(ing.__file__).parent.parent / 'src/core/solver.js'))
                    if not ok:
                        continue
                    try:
                        status = json.loads(detail).get('status')
                    except Exception:
                        status = None
                    if status not in ('normal', 'open'):
                        continue
                    c['grid'] = layout
                    c['status'] = status
                    kept.append(c)
                if kept:
                    p['circuits'] = kept
                    p['source'] = f'2025 上海{region}二模'
                    p['year'] = 2025
                    found.append(p)
                    log(f'   ✓ {region} 第 {p.get("number")} 题 · {len(kept)} 个电路 · {status}')
    return found


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--key', default=os.environ.get('FF_LLM_KEY', ''))
    ap.add_argument('--api', default='https://api.siliconflow.cn/v1/chat/completions')
    ap.add_argument('--model', default='Qwen/Qwen3.5-4B')
    ap.add_argument('--limit', type=int, default=0, help='只处理前 N 份(0=全部)')
    ap.add_argument('--dpi', type=int, default=140)
    ap.add_argument('--timeout', type=int, default=280)
    ap.add_argument('--pages', default=None)
    ap.add_argument('--jobs', type=int, default=1, help='并行处理的试卷数')
    args = ap.parse_args()

    if not args.key:
        sys.exit('缺少 API key: --key 或 FF_LLM_KEY')

    pdfs = find_pdfs(args.root)
    if args.limit:
        pdfs = pdfs[:args.limit]
    print(f'共 {len(pdfs)} 份物理卷')

    collected = []
    if args.jobs > 1:
        with ThreadPoolExecutor(max_workers=args.jobs) as ex:
            futs = {ex.submit(process_pdf, pdf, i, len(pdfs), args): pdf
                    for i, pdf in enumerate(pdfs, 1)}
            for fu in as_completed(futs):
                collected.extend(fu.result())
    else:
        for i, pdf in enumerate(pdfs, 1):
            collected.extend(process_pdf(pdf, i, len(pdfs), args))

    # 去重:同一份卷子可能有多个文件(如普陀两份),按 题号+题干前 40 字 去重
    seen, uniq = set(), []
    for p in collected:
        k = (p.get('number'), (p.get('statement') or '')[:40])
        if k in seen:
            continue
        seen.add(k)
        uniq.append(p)
    collected = uniq

    Path(args.out).write_text(json.dumps(collected, ensure_ascii=False, indent=2))
    print(f'\n完成: {len(collected)} 道带电路的题 → {args.out}')


if __name__ == '__main__':
    main()
