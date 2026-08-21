"""
独立回填：清洗 papers 表 LaTeX 摘要（无需项目依赖）
通过 mysql CLI 读取/写入，避免依赖 httpx/sqlalchemy
"""
import re
import subprocess

MYSQL = ["mysql", "-uroot", "-p123456", "-N", "-B"]


def clean_latex(text: str) -> str:
    text = re.sub(r"\\[a-zA-Z]+\{([^{}]*)\}", r"\1", text)
    text = re.sub(r"\\[a-zA-Z]+", " ", text)
    text = re.sub(r"\$\$(.+?)\$\$", r"\1", text, flags=re.DOTALL)
    text = re.sub(r"\$(.+?)\$", r"\1", text, flags=re.DOTALL)
    text = re.sub(r"\\left|\\right", "", text)
    text = text.replace("{", "").replace("}", "")
    text = re.sub(r"\s+", " ", text).strip()
    return text


def main():
    # 1. 读取脏数据（含反斜杠 或 美元符号 的摘要）
    # Windows 下 mysql CLI 输出为 GBK，用 gbk 解码并容忍坏字节
    out = subprocess.run(
        MYSQL + ["-e",
                 "SELECT id, abstract FROM paper.papers "
                 "WHERE abstract LIKE '%\\\\%' OR abstract LIKE '%$%';"],
        capture_output=True, text=True, encoding="gbk", errors="replace",
    ).stdout

    rows = []
    for line in out.strip().splitlines():
        if "\t" not in line:
            continue
        pid, abstract = line.split("\t", 1)
        rows.append((int(pid), abstract))

    if not rows:
        print("没有发现脏数据")
        return

    print(f"扫描到 {len(rows)} 篇含反斜杠/美元符的论文")

    # 2. 清洗并生成 UPDATE 语句
    updates = []
    updated = 0
    for pid, abstract in rows:
        cleaned = clean_latex(abstract)
        if cleaned != abstract:
            escaped = cleaned.replace("'", "''").replace("\\", "\\\\")
            updates.append(f"UPDATE paper.papers SET abstract='{escaped}' WHERE id={pid};")
            updated += 1
            print(f"  id={pid}: 已清洗 ({len(abstract)} -> {len(cleaned)} 字符)")

    if not updates:
        print("所有扫描到的行内容无变化（可能不含 LaTeX 标记）")
        return

    # 3. 执行更新（写入用 UTF-8，避免 GBK 破坏摘要中的 Unicode 字符）
    sql = "\n".join(updates)
    r = subprocess.run(
        MYSQL + ["--default-character-set=utf8mb4", "-e", sql],
        capture_output=True, text=True, encoding="gbk", errors="replace",
    )
    if r.returncode != 0:
        print("执行失败:", r.stderr[:500])
    else:
        print(f"\n✓ 更新完成，共 {updated} 篇")


if __name__ == "__main__":
    main()
