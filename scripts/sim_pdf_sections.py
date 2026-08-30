"""
sim_pdf_sections.py — PDF 结构解析模拟（验证"按标题分节" + "图表标题提取"）

只做结构探测，不抽取公式图像、不调用任何外部模型。
依赖：pymupdf（已装）。输入用上一轮已下载的 PDF。
"""
import re
import statistics
from collections import Counter

import pymupdf

PDF_PATH = r"F:\New_Python\paper\data\pdfs\f61d6947467ccd3aa5af24db320235dd-Paper.pdf"

# 标题判定：编号式 (1. / 2.1) 或 全大写短行
HEADING_RE = re.compile(r"^\s*(\d+(\.\d+)*)\s+[A-Z]")


def detect_sections(path):
    doc = pymupdf.open(path)
    # 1) 先统计全文字号，求正文基准字号（众数）
    all_sizes = []
    for page in doc:
        for b in page.get_text("dict")["blocks"]:
            if b["type"] != 0:
                continue
            for line in b["lines"]:
                for span in line["spans"]:
                    if span["text"].strip():
                        all_sizes.append(round(span["size"], 1))
    body_size = Counter(all_sizes).most_common(1)[0][0]
    print(f"[基准字号] body={body_size}  (全文字号种类: {sorted(set(all_sizes))[:12]})")

    # 2) 逐页逐行探测标题
    headings = []
    for pno, page in enumerate(doc, start=1):
        for b in page.get_text("dict")["blocks"]:
            if b["type"] != 0:
                continue
            for line in b["lines"]:
                txt = "".join(s["text"] for s in line["spans"]).strip()
                if not txt:
                    continue
                max_size = max((s["size"] for s in line["spans"]), default=0)
                is_big = max_size >= body_size * 1.12
                is_numbered = bool(HEADING_RE.match(txt))
                is_allcaps = len(txt) <= 60 and txt == txt.upper() and any(c.isalpha() for c in txt)
                if is_numbered or (is_big and len(txt) < 80) or is_allcaps:
                    headings.append((pno, round(max_size, 1), txt))
    doc.close()
    return headings


def detect_captions(path):
    doc = pymupdf.open(path)
    caps = []
    for pno, page in enumerate(doc, start=1):
        for line in page.get_text().splitlines():
            s = line.strip()
            if re.match(r"(?i)^(figure|fig\.?|table|algorithm)\s*\d+", s):
                caps.append((pno, s))
    doc.close()
    return caps


if __name__ == "__main__":
    print("=" * 64)
    print("一、按标题分节探测（heading detection）")
    print("=" * 64)
    for pno, size, txt in detect_sections(PDF_PATH):
        print(f"  p{pno:>2}  size={size:<5}  {txt[:70]}")

    print("\n" + "=" * 64)
    print("二、图表/表格标题提取（caption extraction, 纯文本）")
    print("=" * 64)
    caps = detect_captions(PDF_PATH)
    for pno, s in caps:
        print(f"  p{pno:>2}  {s[:80]}")
    print(f"\n  共检测到 {len(caps)} 个图表/表格标题")
