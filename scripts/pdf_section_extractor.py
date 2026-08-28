r"""
pdf_section_extractor.py — 批量 PDF 分节提取（实验/验证用）

逻辑已迁入正式代码 sources/pdf_structure.py::extract_pdf_sections，
本脚本仅做薄封装：遍历 data/pdfs/*.pdf，输出 section_report.json + 控制台摘要。

用法：往 F:\New_Python\paper\data\pdfs 丢 PDF，然后运行本脚本。
依赖：pymupdf（已装）
"""
import os
import glob
import json

# 复用正式代码（sources/pdf_structure.py）里的鲁棒分节逻辑，保持单一来源
try:
    from sources.pdf_structure import extract_pdf_sections as extract
except Exception:  # 兜底：直接作为脚本运行时也能 import
    import sys
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
    from sources.pdf_structure import extract_pdf_sections as extract

PDF_DIR = r"F:\New_Python\paper\data\pdfs"
REPORT = os.path.join(PDF_DIR, "section_report.json")


def main():
    pdfs = sorted(glob.glob(os.path.join(PDF_DIR, "*.pdf")))
    pdfs = [p for p in pdfs if os.path.basename(p) != "section_report.json"]
    if not pdfs:
        print("data/pdfs 下没有 PDF，放几个进来再跑。")
        return
    report = []
    for p in pdfs:
        try:
            r = extract(p)
        except Exception as e:
            r = {"file": os.path.basename(p), "error": str(e)[:200]}
        report.append(r)
        print("=" * 72)
        print(f"📄 {r.get('file')}  ({r.get('pages')} 页)")
        if r.get("title"):
            print(f"   标题: {r['title'][:90]}")
        print(f"   分节数: {r.get('section_count')}   摘要字符: {r.get('abstract_len')}")
        for s in r.get("sections", []):
            star = "★" if s["title"].lower() == "abstract" else " "
            preview = (s.get("text", "") or "").replace("\n", " ")[:55]
            print(f"   {star} L{s['level']}  p{s['page_start']}-{s['page_end']}  [{s['char_len']:>6}c]  {s['title'][:42]}")
            if preview:
                print(f"        └ {preview}…")
    with open(REPORT, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print("\n" + "=" * 72)
    print(f"共处理 {len(report)} 个 PDF → 报告: {REPORT}")


if __name__ == "__main__":
    main()
