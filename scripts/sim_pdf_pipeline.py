"""
sim_pdf_pipeline.py — PDF 全文获取流程模拟（独立原型，不改动项目代码）

复刻 Scholar Funnel 分支分析未来要加的 PDF 分支链路：
    download(url)  →  存到 data/pdfs  →  extract_text(pdf)  →  截断供 LLM 上下文

仅用于验证「OpenAlex OA 链接直接是 PDF」场景下的可行性。
运行环境：D:\Anaconda\envs\paper（已含 pymupdf 1.28.2、httpx）
"""

import os
import time

import httpx
import pymupdf  # PyMuPDF（fitz 的官方新名）

# ---------- 配置（与项目现有约束对齐） ----------
PDF_DIR = r"F:\New_Python\paper\data\pdfs"
SAMPLE_URL = (
    "https://proceedings.neurips.cc/paper_files/paper/2017/"
    "file/f61d6947467ccd3aa5af24db320235dd-Paper.pdf"
)
HEADERS = {"User-Agent": "Mozilla/5.0 (ScholarFunnel pdf-sim)"}
DOWNLOAD_TIMEOUT = 30   # 秒，匹配 fetch_full_text_html 的 20s 量级
PARSE_TIMEOUT = 15      # 秒，解析超时就降级
LLM_CONTEXT_LIMIT = 8000  # 沿用 branch.py 的 full_text[:8000]


# ---------- 1. 下载 ----------
def download_pdf(url: str, save_dir: str = PDF_DIR) -> str:
    """流式下载 PDF 到 save_dir，返回本地路径。"""
    os.makedirs(save_dir, exist_ok=True)
    fname = url.rsplit("/", 1)[-1]
    if not fname.lower().endswith(".pdf"):
        fname = "paper.pdf"
    path = os.path.join(save_dir, fname)

    with httpx.stream(
        "GET", url, follow_redirects=True, headers=HEADERS, timeout=DOWNLOAD_TIMEOUT
    ) as r:
        r.raise_for_status()
        # 顺手校验 content-type，非 PDF 直接判失败（对齐 fetch_full_text_html 的校验风格）
        ctype = r.headers.get("content-type", "").lower()
        if "pdf" not in ctype and not fname.lower().endswith(".pdf"):
            raise ValueError(f"非 PDF 响应: content-type={ctype}")
        with open(path, "wb") as f:
            for chunk in r.iter_bytes(8192):
                f.write(chunk)
    return path


# ---------- 2. 提取（带两栏重排） ----------
def extract_text(pdf_path: str):
    """
    用 PyMuFDA 提取全文。论文 PDF 常见两栏，用 blocks 坐标做近似阅读序重排：
        主排序 = y 波段（同高度归一组），次排序 = x0（左→右）
    返回 (pages[文本列表], full_text)。
    """
    doc = pymupdf.open(pdf_path)
    pages = []
    for page in doc:
        raw_blocks = page.get_text("blocks")  # (x0,y0,x1,y1,text,block_no,block_type)
        # 只取文本块（block_type==0），过滤空文本
        text_blocks = [b for b in raw_blocks if b[6] == 0 and b[4].strip()]
        # 两栏重排：按 y 波段分组、组内按 x0 左→右
        text_blocks.sort(key=lambda b: (round(b[1] / 15), b[0]))
        pages.append("\n".join(b[4] for b in text_blocks))
    doc.close()
    full = "\n\n".join(pages)
    return pages, full


# ---------- 3. 主流程 ----------
def main(url: str = SAMPLE_URL):
    t0 = time.time()
    print(f"[1/3] 下载 PDF:\n      {url}")
    path = download_pdf(url)
    size_kb = os.path.getsize(path) / 1024
    print(f"      ✓ 已保存: {path}  ({size_kb:.0f} KB)\n")

    print("[2/3] 提取文本 (PyMuPDF + 两栏重排)...")
    pages, full = extract_text(path)
    print(f"      ✓ 页数={len(pages)}  全文字符数={len(full)}\n")

    print("[3/3] 截断供 LLM 上下文 (前 %d 字符)" % LLM_CONTEXT_LIMIT)
    ctx = full[:LLM_CONTEXT_LIMIT]
    print(f"      实际喂给 LLM 的字符数={len(ctx)}  (其余 {max(0,len(full)-len(ctx))} 字符被截断)\n")

    print("=" * 60)
    print("前 1200 字符预览：")
    print("=" * 60)
    print(full[:1200])

    print("\n" + "=" * 60)
    print(f"总耗时 {time.time()-t0:.1f}s")
    return path


if __name__ == "__main__":
    # 允许命令行传 URL：python sim_pdf_pipeline.py <pdf_url>
    import sys
    url = sys.argv[1] if len(sys.argv) > 1 else SAMPLE_URL
    main(url)
