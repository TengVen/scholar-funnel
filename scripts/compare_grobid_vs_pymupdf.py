"""
compare_grobid_vs_pymupdf.py — GROBID XML(OpenAlex 主源) vs PyMuPDF 启发式(兜底) 同篇对比

流程：
  对 data/pdfs 每篇 PDF：
    1) PyMuPDF 基线：复用 pdf_section_extractor.extract()  → 启发式分节
    2) 用 PDF 标题去 OpenAlex 匹配 work，取 has_content.grobid_xml
    3) 若可用：下载 content_urls.grobid_xml（需 API key）→ 解析 TEI 分节
    4) 并排打印两种结果（分节数 / 标题 / 摘要 / 噪声计数）

API key 来源（任选）：
    - 环境变量 OPENALEX_API_KEY
    - 文件 data/pdfs/.openalex_key （仅一行 key）
依赖：pymupdf（已有）、httpx（已有）、pdf_section_extractor（同目录）
"""
import os
import re
import sys
import json
import glob
import difflib
import xml.etree.ElementTree as ET

import httpx
import gzip

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pdf_section_extractor import extract  # PyMuPDF 启发式基线


def _load_dotenv_key():
    """从项目根目录 .env 读取 OPENALEX_API_KEY（与正式代码一致）。"""
    try:
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        p = os.path.join(root, ".env")
        if os.path.exists(p):
            with open(p, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("OPENALEX_API_KEY="):
                        return line.split("=", 1)[1].strip().strip('"').strip("'")
    except Exception:
        pass
    return None


# API key 优先级：环境变量 > .env（不再硬编码）
OPENALEX_KEY = os.getenv("OPENALEX_API_KEY") or _load_dotenv_key()
PDF_DIR = r"F:\New_Python\paper\data\pdfs"
REPORT = os.path.join(PDF_DIR, "comparison_report.json")

TEI = "{http://www.tei-c.org/ns/1.0}"

NOISE_PHRASES = [
    "Published as a conference paper",
    "Available online at",
    "arXiv:",
    "http://",
    "https://",
    "doi:",
    "all rights reserved",
]


# ----------------------------------------------------------------------------
# API key
# ----------------------------------------------------------------------------
def get_key() -> str | None:
    if OPENALEX_KEY and OPENALEX_KEY != "你刚申请的key":
        return OPENALEX_KEY
    k = os.environ.get("OPENALEX_API_KEY")
    return k.strip() if k else None


# ----------------------------------------------------------------------------
# OpenAlex 匹配
# ----------------------------------------------------------------------------
def find_openalex(title: str):
    """用标题模糊匹配 OpenAlex work，返回 (id, has_grobid_xml, oa_title, score)。"""
    if not title:
        return None, False, None, 0.0
    q = title[:120]
    try:
        r = httpx.get(
            "https://api.openalex.org/works",
            params={"filter": f"title.search:{q}", "per-page": 5},
            timeout=20,
        ).json()
    except Exception:
        return None, False, None, 0.0
    results = r.get("results", [])
    best, bs = None, 0.0
    tl = title.lower()
    for w in results:
        t = (w.get("title") or "").lower()
        sc = difflib.SequenceMatcher(None, t, tl).ratio()
        if sc > bs:
            bs, best = sc, w
    if best and bs >= 0.6:
        hc = best.get("has_content") or {}
        return best.get("id"), bool(hc.get("grobid_xml")), best.get("title"), round(bs, 3)
    return None, False, (best.get("title") if best else None), round(bs, 3)


# ----------------------------------------------------------------------------
# GROBID TEI 解析
# ----------------------------------------------------------------------------
def fetch_grobid(work_id: str, key: str):
    wid = work_id.split("/")[-1]
    url = f"https://content.openalex.org/works/{wid}.grobid-xml"
    last = None
    # 先试 query param，再试 Bearer header
    for i in range(2):
        if i == 0:
            r = httpx.get(url, params={"api_key": key}, timeout=40, follow_redirects=True)
        else:
            r = httpx.get(url, headers={"Authorization": f"Bearer {key}"}, timeout=40, follow_redirects=True)
        if r.status_code == 200:
            data = r.content
            ct = r.headers.get("content-type", "")
            if ct.endswith("gzip") or data[:2] == b"\x1f\x8b":
                data = gzip.decompress(data)
            return parse_tei(data.decode("utf-8", errors="replace"))
        last = r
        if r.status_code != 401:
            r.raise_for_status()
    raise RuntimeError(f"GROBID 下载失败 {last.status_code}: {last.text[:120]}")


def parse_tei(xml_text: str):
    root = ET.fromstring(xml_text)
    # 摘要
    abstract = ""
    abd = root.find(f".//{TEI}profileDesc/{TEI}abstract")
    if abd is not None:
        abstract = " ".join(abd.itertext()).strip()
    # 分节（递归 div/head）
    sections = []
    body = root.find(f".//{TEI}body")

    def walk(div, level):
        head = div.find(f"{TEI}head")
        title = "".join(head.itertext()).strip() if head is not None else ""
        paras = []
        for ch in div:
            if ch.tag == f"{TEI}div":
                continue
            if ch.tag in (f"{TEI}p", f"{TEI}ab", f"{TEI}trailer"):
                txt = " ".join(ch.itertext()).strip()
                if txt:
                    paras.append(txt)
        if title:
            sections.append({"level": level, "title": title, "text": "\n".join(paras)})
        for ch in div:
            if ch.tag == f"{TEI}div":
                walk(ch, level + 1)

    if body is not None:
        for d in body:
            if d.tag == f"{TEI}div":
                walk(d, 1)
    return abstract, sections


# ----------------------------------------------------------------------------
# 工具
# ----------------------------------------------------------------------------
def noise_count(text: str) -> int:
    return sum(text.count(p) for p in NOISE_PHRASES)


def summarize_sections(sections):
    return [{"title": s["title"], "char_len": len(s.get("text", ""))} for s in sections]


# ----------------------------------------------------------------------------
# 主流程
# ----------------------------------------------------------------------------
def main():
    key = get_key()
    if not key:
        print("⚠️ 未找到 OpenAlex API key。请设置环境变量 OPENALEX_API_KEY，")
        print(f"   或写入文件 {KEY_FILE}（仅一行 key）。")
        print("   （PyMuPDF 基线仍会运行，GROBID 对比会跳过）")

    pdfs = sorted(glob.glob(os.path.join(PDF_DIR, "*.pdf")))
    report = []

    for p in pdfs:
        name = os.path.basename(p)
        print("=" * 78)
        print(f"📄 {name}")

        # 1) PyMuPDF 基线
        heur = extract(p)
        h_secs = heur.get("sections", [])
        h_text = "\n".join(s.get("text", "") for s in h_secs)
        h_noise = noise_count(h_text)

        # 2) OpenAlex 匹配
        wid, has_grobid, oa_title, score = find_openalex(heur.get("title"))

        # 3) GROBID
        g_secs, g_abs, g_noise, g_err = None, None, None, None
        if has_grobid and key:
            try:
                g_abs, g_secs = fetch_grobid(wid, key)
                g_text = "\n".join(s.get("text", "") for s in g_secs)
                g_noise = noise_count(g_text)
            except Exception as e:
                g_err = str(e)[:200]
        elif has_grobid and not key:
            g_err = "no_api_key"

        # 输出
        print(f"   PDF 标题 : {heur.get('title')}")
        print(f"   OpenAlex : {wid}  (匹配度 {score}, 标题: {oa_title})")
        print(f"   has_grobid_xml : {has_grobid}")
        print("-" * 78)
        print(f"   [PyMuPDF] 分节 {len([s for s in h_secs if s['title'].lower()!='abstract'])}  "
              f"摘要 {len(heur.get('abstract') or '')}c  噪声 {h_noise} 次")
        for s in h_secs:
            tag = "★" if s["title"].lower() == "abstract" else " "
            print(f"      {tag} L{s['level']} [{len(s.get('text','')):>6}c] {s['title'][:54]}")
        print("-" * 78)
        if g_secs is not None:
            print(f"   [GROBID ] 分节 {len([s for s in g_secs if s['title'].lower()!='abstract'])}  "
                  f"摘要 {len(g_abs or '')}c  噪声 {g_noise} 次")
            for s in g_secs:
                tag = "★" if s["title"].lower() == "abstract" else " "
                print(f"      {tag} L{s['level']} [{len(s.get('text','')):>6}c] {s['title'][:54]}")
        elif has_grobid and not key:
            print("   [GROBID ] 跳过（无 API key）")
        elif g_err:
            print(f"   [GROBID ] 不可用: {g_err}")
        else:
            print("   [GROBID ] 该论文 OpenAlex 无 GROBID XML（走 PyMuPDF 兜底）")

        report.append({
            "file": name,
            "pdf_title": heur.get("title"),
            "openalex_id": wid,
            "openalex_title": oa_title,
            "match_score": score,
            "has_grobid_xml": has_grobid,
            "pymupdf": {
                "section_count": len([s for s in h_secs if s["title"].lower() != "abstract"]),
                "abstract_len": len(heur.get("abstract") or ""),
                "noise": h_noise,
                "sections": summarize_sections(h_secs),
            },
            "grobid": (
                {
                    "available": True,
                    "section_count": len([s for s in g_secs if s["title"].lower() != "abstract"]),
                    "abstract_len": len(g_abs or ""),
                    "noise": g_noise,
                    "sections": summarize_sections(g_secs),
                    "abstract": g_abs,
                    "full_sections": g_secs,
                }
                if g_secs is not None
                else {"available": False, "error": g_err}
            ),
        })

    with open(REPORT, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print("=" * 78)
    print(f"✅ 对比报告已写入: {REPORT}")


if __name__ == "__main__":
    main()
