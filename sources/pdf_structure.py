"""
pdf_structure.py — 鲁棒 PDF 分节提取（PyMuPDF 启发式兜底）

把任意学术 PDF 解析成结构化分节：
    { title, abstract, sections:[{level,title,page_start,page_end,char_len,text}] }
    text = 该分节的完整正文（含段落换行）

适用场景：OpenAlex 未提供 GROBID XML 的论文（如 ICLR 2015 NMT）的兜底全文源。
上游（agents/branch.py）调用 extract_pdf_sections(path) 拿到分节后，
按分析模式选节喂给 LLM，替代原先的 full_text[:8000] 硬截断。

抗噪要点（解决 ICLR 等两行标题 + 页眉页脚噪声）：
  1) 编号两行标题合并："2" + "BACKGROUND: ..." -> "2 BACKGROUND: ..."
  2) 数字标题必须明显大于正文（maxsize >= body*1.15），排除脚注/正文
  3) 拒绝伪标题：4 位年份开头、含 http/www/@ 的行
  4) 页眉页脚噪声：跨页重复行(>=50%页) + 短语黑名单 直接丢弃

依赖：pymupdf
"""
import os
import re
import json
from collections import Counter

import pymupdf

# 编号 + 词（"1 Introduction" / "2 BACKGROUND: X" 算）
NUM_WORD_RE = re.compile(r"^\s*\d{1,2}(\.\d{1,2})*\.?\s+[A-Z]")
# 纯编号行（用于合并到下一标题）： "2" / "2.1" / "(2)"
NUM_ONLY_RE = re.compile(r"^\s*\d{1,2}(\.\d{1,2})*\s*$|^\s*\(?\d{1,2}\)?\s*$")
ROMAN_RE = re.compile(r"^\s*[IVXLC]+\.\s+[A-Za-z]")

KEYWORDS = {
    "abstract", "introduction", "related work", "related works", "background",
    "method", "methods", "methodology", "approach", "model", "models",
    "proposed", "architecture", "experiment", "experiments", "evaluation",
    "results", "result", "analysis", "discussion", "conclusion", "conclusions",
    "references", "appendix", "preliminaries", "overview", "acknowledgements",
    "acknowledgments",
}

# 页眉/页脚/水印短语黑名单（命中即丢弃该行）
CHROME_PHRASES = [
    "arxiv:", "published as a conference paper", "available online at",
    "preprint", "doi:", "©", "(c) ", "all rights reserved", "under review",
    "to appear", "camera-ready", "license", "this is a preprint", "not peer-reviewed",
    "corresponding author", "equal contribution", "scholarworks", "repository",
]
CHROME_RE = re.compile(r"(https?://|www\.|\S+@\S+\.\S+|\bcs\.\w+\]|\[cs\.[A-Za-z-]+\])", re.I)
# 4 位年份开头（不可能是章节号）
YEAR_RE = re.compile(r"^\s*\d{4}\b")

GREEK_RE = re.compile(r"[\u0370-\u03FF]")
MATH_CHARS = set("∈∑∏∫√≈→∀∃⊕⊗∂∇≤≥≠±×÷∝∞∅∪∩⊆⇔⇒")


def _is_bold(flags: int) -> bool:
    return bool(flags & 16)


def _looks_math(txt: str) -> bool:
    if any(c in MATH_CHARS for c in txt):
        return True
    if GREEK_RE.search(txt):
        return True
    if "=" in txt and len(txt) < 70:
        return True
    if re.search(r"[=+\u2212\u00d7\u00f7]", txt) and len(txt) < 80:
        return True
    if re.search(r"\(\d+\)\s*$", txt.strip()):
        return True
    return False


def _is_chrome(txt: str) -> bool:
    low = txt.lower()
    if CHROME_RE.search(txt):
        return True
    if any(p in low for p in CHROME_PHRASES):
        return True
    return False


def _page_lines(page):
    """按阅读序返回 (text, maxsize, bold, bbox, in_table, margin)。已两栏重排。"""
    tbls = []
    try:
        for t in page.find_tables().tables:
            tbls.append(t.bbox)
    except Exception:
        tbls = []

    def in_table(rect):
        cx = (rect[0] + rect[2]) / 2
        cy = (rect[1] + rect[3]) / 2
        return any(tb[0] <= cx <= tb[2] and tb[1] <= cy <= tb[3] for tb in tbls)

    blocks = [b for b in page.get_text("dict")["blocks"] if b["type"] == 0]
    blocks.sort(key=lambda b: (round(b["bbox"][1] / 15), b["bbox"][0]))
    margin = min((b["bbox"][0] for b in blocks), default=0)
    out = []
    for b in blocks:
        for ln in b["lines"]:
            txt = "".join(s["text"] for s in ln["spans"]).strip()
            if not txt:
                continue
            maxsize = max((s["size"] for s in ln["spans"]), default=0)
            bold = any(_is_bold(s["flags"]) for s in ln["spans"])
            out.append((txt, maxsize, bold, ln["bbox"], in_table(ln["bbox"]), margin))
    return out


def _chrome_lines(doc):
    """返回应丢弃的页眉/页脚/水印行集合（跨页重复 + 短语黑名单）。"""
    per_page = []
    for page in doc:
        seen = set()
        for (txt, *_rest) in _page_lines(page):
            if len(txt) < 150:
                seen.add(txt)
        per_page.append(seen)
    total = len(per_page)
    if total == 0:
        return set()
    counts = Counter()
    for seen in per_page:
        for t in seen:
            counts[t] += 1
    thr = max(3, int(total * 0.5))
    chrome = set()
    for t, c in counts.items():
        if c >= thr:
            chrome.add(t)
        if _is_chrome(t):
            chrome.add(t)
    return chrome


def _is_heading(txt, maxsize, bold, bbox, in_tbl, margin, body):
    if txt.strip() in ("",):
        return False
    if in_tbl:
        return False
    if _looks_math(txt):
        return False
    if _is_chrome(txt):
        return False
    if YEAR_RE.match(txt):          # 4 位年份开头（如 "2012 and ..."）-> 非标题
        return False
    x0 = bbox[0]
    centered = x0 > margin + 60
    low = txt.lower().strip()

    # 强信号：编号 + 词 / 罗马数字 + 词 / 关键词（须明显大于正文）
    if (NUM_WORD_RE.match(txt) or ROMAN_RE.match(txt)) and maxsize >= body * 1.15:
        return True
    if low in KEYWORDS and maxsize >= body * 1.1:
        return True
    # 纯编号行（"1" / "2.1"）且明显大于正文 -> 作为待合并标题
    if NUM_ONLY_RE.match(txt) and maxsize >= body * 1.15:
        return True
    # 弱信号：大字 / 加粗，但必须非居中、非公式、且是短短语（非整句）
    is_short = 3 <= len(txt) <= 70 and txt.count(" ") <= 8
    if centered:
        return False
    if (maxsize >= body * 1.2 or (bold and maxsize >= body * 1.1)) and is_short:
        if txt.rstrip().endswith("."):
            return False
        return True
    return False


def extract_pdf_sections(path: str) -> dict:
    """
    解析单个 PDF，返回结构化分节。

    Returns:
        {
          "file", "pages", "title", "abstract", "abstract_len",
          "section_count", "sections": [{level,title,page_start,page_end,char_len,text}]
        }
    """
    doc = pymupdf.open(path)
    chrome = _chrome_lines(doc)

    sizes = []
    for page in doc:
        for b in page.get_text("dict")["blocks"]:
            if b["type"] != 0:
                continue
            for ln in b["lines"]:
                for sp in ln["spans"]:
                    if sp["text"].strip():
                        sizes.append(round(sp["size"], 1))
    body = Counter(sizes).most_common(1)[0][0] if sizes else 10.0

    raw = []
    title_buf = []
    title_done = False

    for pno, page in enumerate(doc, start=1):
        for (txt, maxsize, bold, bbox, in_tbl, margin) in _page_lines(page):
            if txt in chrome:           # 页眉/页脚/水印直接丢弃
                continue
            low = txt.lower()
            before_abstract = (pno == 1) and (not title_done)
            if before_abstract and not NUM_WORD_RE.match(txt) and not low.startswith("abstract"):
                if maxsize >= body * 1.3:
                    if title_buf and abs(maxsize - title_buf[-1][1]) <= 0.6:
                        title_buf.append((txt, maxsize))
                    elif not title_buf:
                        title_buf.append((txt, maxsize))
            if low.startswith("abstract"):
                title_done = True
            if before_abstract and not low.startswith("abstract"):
                continue
            if _is_heading(txt, maxsize, bold, bbox, in_tbl, margin, body):
                lvl = txt.count(".") + 1 if re.match(r"^\s*\d", txt) else 1
                raw.append({"kind": "head", "title": txt, "level": lvl,
                            "size": maxsize, "page": pno})
            else:
                raw.append({"kind": "body", "text": txt, "size": maxsize, "page": pno})

    # ---- 合并：编号两行标题 / 多行标题 ----
    merged = []
    for item in raw:
        if item["kind"] == "head":
            title = item["title"].strip()
            # 上一行是纯编号 -> 合并本行作副标题
            if (merged and merged[-1]["kind"] == "head"
                    and NUM_ONLY_RE.match(merged[-1]["title"].strip())
                    and not merged[-1].get("subtitle_merged")):
                merged[-1]["title"] = f"{merged[-1]['title'].strip()} {title}"
                merged[-1]["level"] = (merged[-1]["title"].count(".")
                                       + 1 if re.match(r"^\s*\d", merged[-1]["title"]) else 1)
                merged[-1]["subtitle_merged"] = True
                continue
            # 多行标题（同字号连续短标题）
            if (merged and merged[-1]["kind"] == "head"
                    and len(merged[-1].get("text", "")) == 0
                    and len(merged[-1]["title"]) < 50
                    and abs(merged[-1].get("size", 10) - item["size"]) < 0.6
                    and not merged[-1].get("subtitle_merged")):
                merged[-1]["title"] = f"{merged[-1]['title']} {title}"
                continue
            merged.append({**item, "text": "", "subtitle_merged": False,
                           "page_end": item["page"]})
        else:
            txt = item["text"]
            # 上一 head 是纯编号，本行是标题级字号/短标题/含冒号 -> 当作副标题合并
            if (merged and merged[-1]["kind"] == "head"
                    and NUM_ONLY_RE.match(merged[-1]["title"].strip())
                    and not merged[-1].get("subtitle_merged")):
                if (item["size"] >= body * 1.12
                        or (len(txt) <= 60 and txt.count(" ") <= 6)
                        or ":" in txt):
                    merged[-1]["title"] = f"{merged[-1]['title'].strip()} {txt.strip()}"
                    merged[-1]["subtitle_merged"] = True
                    continue
            if merged and merged[-1]["kind"] == "head":
                merged[-1]["text"] = merged[-1].get("text", "") + txt + "\n"
                merged[-1]["page_end"] = item["page"]
            else:
                merged.append({"kind": "head", "title": "(preamble)", "level": 0,
                               "text": txt + "\n", "page": item["page"],
                               "page_end": item["page"], "size": item["size"],
                               "subtitle_merged": False})
    for it in merged:
        it.setdefault("page_end", it["page"])

    # ---- 丢弃：孤立编号 / 垃圾标题 / 页眉残留 ----
    clean = []
    for it in merged:
        if it["kind"] != "head":
            continue
        t = it["title"].strip()
        if NUM_ONLY_RE.match(t):           # 孤立编号（未合并到副标题）
            continue
        core = re.sub(r"^\d{1,2}(\.\d{1,2})*\.?\s+", "", t).strip().lower()
        is_junk = (
            not re.match(r"^\s*\d", t)
            and core not in KEYWORDS
            and " " not in core
            and len(core) < 25
            and len(it.get("text", "").strip()) == 0
        )
        if is_junk:
            continue
        if _is_chrome(t):
            continue
        clean.append({
            "level": it["level"], "title": t,
            "page_start": it["page"], "page_end": it["page_end"],
            "char_len": len(it.get("text", "")),
            "text": it.get("text", ""),
        })

    title = " ".join(t for t, _ in title_buf) if title_buf else None
    abstract = None
    for it in clean:
        if it["title"].lower() == "abstract":
            abstract = it["text"]
            break

    doc.close()
    return {
        "file": os.path.basename(path),
        "pages": _count(path),
        "title": title,
        "abstract_len": len(abstract) if abstract else 0,
        "abstract": abstract,
        "section_count": len([c for c in clean if c["title"].lower() != "abstract"]),
        "sections": clean,
    }


def _count(path: str) -> int:
    try:
        return len(pymupdf.open(path))
    except Exception:
        return 0
