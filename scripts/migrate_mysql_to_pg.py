"""
MySQL → PostgreSQL 数据迁移脚本（Windows 无 pgloader 替代方案）

迁移 7 张核心业务表（旧表名 → 新 ai_ 前缀表名）：
  projects → ai_projects
  papers   → ai_papers
  analysis_results → ai_analysis_results
  citations → ai_citations
  code_repos → ai_code_repos
  authors  → ai_authors
  cart     → ai_cart

特点：
- 保留原 id（数据一致），迁移后重置 PG 序列
- JSON 列直接透传（MySQL JSON → PG JSONB 兼容）
- 按外键顺序迁移（projects → papers → 关联表 → cart）
- 幂等：目标表已有数据时跳过（不重复插入）
"""
import sys

from sqlalchemy import create_engine, text, inspect

MYSQL_URL = "mysql+pymysql://root:123456@localhost:3306/paper"
PG_URL = "postgresql+psycopg://postgres:123456@localhost:5432/agent"

# 迁移顺序：外键依赖在前
TABLES = [
    "projects", "papers", "analysis_results",
    "citations", "code_repos", "authors", "cart",
]
TARGET_MAP = {
    "projects": "ai_projects",
    "papers": "ai_papers",
    "analysis_results": "ai_analysis_results",
    "citations": "ai_citations",
    "code_repos": "ai_code_repos",
    "authors": "ai_authors",
    "cart": "ai_cart",
}


def get_columns(engine, table: str) -> list[str]:
    """获取表的列名（按顺序）"""
    insp = inspect(engine)
    return [c["name"] for c in insp.get_columns(table)]


# MySQL TINYINT(1) → PG BOOLEAN 的列（需要 0/1 → false/true）
BOOL_COLS = {
    "papers": {"is_survey"},
    "analysis_results": {"probe_match"},
    "citations": {"is_influential"},
    "authors": {"tracked"},
}


def to_pg_value(table: str, col: str, value):
    """MySQL 值 → PG 值（处理布尔/类型差异）"""
    if value is None:
        return None
    if col in BOOL_COLS.get(table, set()):
        return bool(value)  # 0/1 → False/True
    return value


def migrate():
    src = create_engine(MYSQL_URL)
    dst = create_engine(PG_URL)

    total_rows = 0
    with src.connect() as sc, dst.begin() as dc:
        for table in TABLES:
            target = TARGET_MAP[table]
            cols = get_columns(src, table)
            # 目标表列名（过滤不存在的列——新表可能少列）
            tcols = get_columns(dst, target)
            use_cols = [c for c in cols if c in tcols]

            col_list = ", ".join(use_cols)
            placeholders = ", ".join([f":{c}" for c in use_cols])

            # 目标表是否已有数据
            cnt = dc.execute(text(f"SELECT COUNT(*) FROM {target}")).scalar()
            if cnt and cnt > 0:
                print(f"⏭️  {target} 已有 {cnt} 行，跳过")
                continue

            # 读 MySQL
            rows = sc.execute(text(f"SELECT {col_list} FROM {table}")).mappings().all()
            if not rows:
                print(f"➖ {table} → {target}: 0 行（空表）")
                continue

            # 批量写入 PG
            for i in range(0, len(rows), 500):
                batch = rows[i:i + 500]
                for row in batch:
                    data = {
                        c: to_pg_value(table, c, row[c]) for c in use_cols
                    }
                    dc.execute(
                        text(f"INSERT INTO {target} ({col_list}) VALUES ({placeholders})"),
                        data,
                    )
            print(f"✅ {table} → {target}: {len(rows)} 行")

            # 重置序列（保留原 id 后，自增从 max(id)+1 继续）
            dc.execute(text(
                f"SELECT setval(pg_get_serial_sequence('{target}', 'id'), "
                f"(SELECT COALESCE(MAX(id), 1) FROM {target}))"
            ))
            total_rows += len(rows)

    print(f"\n🎉 迁移完成，共 {total_rows} 行")


if __name__ == "__main__":
    # 允许命令行覆盖连接串
    if len(sys.argv) > 1:
        MYSQL_URL = sys.argv[1]
    if len(sys.argv) > 2:
        PG_URL = sys.argv[2]
    migrate()
