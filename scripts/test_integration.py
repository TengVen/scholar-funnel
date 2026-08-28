"""
test_integration.py — 验证 _fetch_full_text 结构化全文链路（不依赖前端/DB 逻辑）
覆盖：
  1) GROBID XML 主源（Transformer, W2626778328）
  2) PDF 落盘 + 按论文名重命名（显式调用 download_pdf）
  3) PyMuPDF 分节兜底（本地 3 个 PDF）
  4) select_context_for_mode 选节输出
"""
import os
import sys

ROOT = r"F:\New_Python\paper"
sys.path.insert(0, ROOT)

from sources import openalex as oa
from sources import pdf_structure
from sources import tei_parse
import agents.branch as branch


def main():
    print("=" * 70)
    print("1) GROBID XML 主源：Transformer (W2626778328)")
    paper = oa.get_work_by_id("W2626778328")
    print(f"   has_grobid_xml={paper.has_grobid_xml}  grobid_url={'有' if paper.grobid_xml_url else '无'}")
    xml = oa.fetch_grobid_xml("W2626778328", paper=paper)
    print(f"   XML 下载: {'成功' if xml else '失败'}  (长度 {len(xml) if xml else 0})")
    if xml:
        g_abs, g_secs = tei_parse.parse_tei(xml)
        print(f"   摘要 {len(g_abs)}c | 分节 {len(g_secs)} 个")
        for s in g_secs[:6]:
            print(f"     L{s['level']} {s['title'][:55]}  [{len(s['text'])}c]")

    print("=" * 70)
    print("2) _fetch_full_text 走 GROBID 路径")
    sft = branch._fetch_full_text(
        openalex_id="W2626778328",
        title="Attention Is All You Need",
        abstract="",
    )
    print(f"   source={sft.source} level={sft.level} sections={len(sft.sections)}")
    ctx = branch.select_context_for_mode(sft, branch.MODE_LANDSCAPE, {"abstract": "", "title": "x"})
    print(f"   select_context(landscape) 输出 {len(ctx)} 字符")
    ctx_p = branch.select_context_for_mode(sft, branch.MODE_PROBE, {"abstract": "", "title": "x"})
    print(f"   select_context(probe)      输出 {len(ctx_p)} 字符")

    print("=" * 70)
    print("3) PDF 落盘 + 按论文名重命名（download_pdf 显式）")
    path = oa.download_pdf("W2626778328", "Attention Is All You Need", paper=paper)
    print(f"   落盘路径: {path}")
    if path:
        print(f"   文件名 = {os.path.basename(path)}  (符合<论文标题>.pdf)")
        res = pdf_structure.extract_pdf_sections(path)
        print(f"   分节 {res['section_count']} 个 | 摘要 {res['abstract_len']}c")

    print("=" * 70)
    print("4) 本地 PDF 分节兜底（PyMuPDF 启发式）")
    for f in ["transformer.pdf", "NEURAL MACHINE TRANSLATION.pdf"]:
        p = os.path.join(ROOT, "data", "pdfs", f)
        if not os.path.exists(p):
            continue
        r = pdf_structure.extract_pdf_sections(p)
        print(f"   {f}: 分节 {r['section_count']} | 摘要 {r['abstract_len']}c | "
              f"标题示例: {[s['title'][:30] for s in r['sections'][:4]]}")

    print("=" * 70)
    print("✅ 集成测试完成")


if __name__ == "__main__":
    main()
