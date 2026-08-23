"""
PostgreSQL 数据库连接与基础操作

Schema 管理策略：
- 表结构 DDL 统一放在 db/postgres/ 目录（00_init → 01_sys → 02_users → 03_agents → 04_core）
- init_db() 启动时按顺序执行 db/postgres/*.sql，全部幂等安全
- 驱动：psycopg3（支持多语句执行 + pgvector 类型）
"""
import os

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from contextlib import contextmanager

from utils.config import settings
from utils.log import setup_logger
from storage.models import Base

logger = setup_logger("storage")

# db/postgres/ 目录下按文件名排序的 SQL 文件（00_init → 01_sys → ... → 04_core）
_SQL_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "db", "postgres",
)


# ── 引擎 & Session 工厂（全局单例）──
engine = create_engine(
    settings.postgres_url,
    echo=False,                 # 调试时改为 True 可看到 SQL 日志
    pool_pre_ping=True,         # 自动检测断连
    pool_size=5,
    max_overflow=10,
)

SessionFactory = sessionmaker(bind=engine, expire_on_commit=False)


def _execute_sql_file(path: str):
    """执行单个 SQL 文件（psycopg3 原生支持多语句与 DO 块）"""
    with open(path, encoding="utf-8") as f:
        sql = f.read()
    stripped = sql.strip()
    if not stripped:
        return
    # 用 psycopg3 独立连接执行（SQLAlchemy engine 不支持多语句原生透传）
    import psycopg
    conninfo = settings.postgres_url.replace(
        "postgresql+psycopg://", "postgresql://", 1
    )
    with psycopg.connect(conninfo) as conn:
        conn.execute(sql)
    logger.info(f"已执行 SQL 文件: {os.path.basename(path)}")


# 基础文件：轻量幂等（扩展/系统表），每次执行开销极小，不走版本追踪
_BASE_SQL_FILES = ("00_init.sql", "01_sys.sql")


def _record_version(conn, fname: str, file_hash: str, description: str = ""):
    """记录迁移版本（version=文件名，内容哈希变更时自动重放）"""
    conn.execute(
        """
        INSERT INTO sys_schema_versions (version, description, file_hash, applied_at)
        VALUES (%s, %s, %s, NOW())
        ON CONFLICT (version) DO UPDATE
          SET file_hash = EXCLUDED.file_hash,
              description = EXCLUDED.description,
              applied_at = NOW()
        """,
        (fname, description or fname, file_hash),
    )


def _sql_description(path: str) -> str:
    """从 SQL 文件头注释提取描述（`-- 内容：xxx`）"""
    try:
        with open(path, encoding="utf-8") as f:
            for line in f.read().splitlines()[:10]:
                line = line.strip()
                if line.startswith("-- ") and ("内容" in line or "作用" in line):
                    return line[3:].strip()[:120]
    except OSError:
        pass
    return ""


def init_db():
    """
    初始化数据库（幂等 + 版本追踪）：
    - 00/01 基础文件每次执行（轻量幂等：扩展/系统表）
    - 02+ 业务迁移按 sys_schema_versions 追踪：未执行过 或 内容哈希变化 → 执行并记录
    - 已执行且未修改的文件启动时直接跳过（零 DDL 开销）
    """
    import hashlib
    import psycopg

    # SQLAlchemy 建表（确保 ORM 元数据与库结构一致；已有表自动跳过）
    Base.metadata.create_all(engine)

    if not os.path.isdir(_SQL_DIR):
        return

    sql_files = sorted(
        f for f in os.listdir(_SQL_DIR) if f.endswith(".sql")
    )
    conninfo = settings.postgres_url.replace(
        "postgresql+psycopg://", "postgresql://", 1
    )

    with psycopg.connect(conninfo) as conn:
        for fname in sql_files:
            path = os.path.join(_SQL_DIR, fname)

            # 基础文件：无条件执行（幂等且快）
            if fname in _BASE_SQL_FILES:
                try:
                    _execute_sql_file(path)
                except Exception as e:
                    logger.error(f"SQL 文件执行失败 {fname}: {e}")
                continue

            # 版本追踪：读内容哈希，与已记录对比
            with open(path, encoding="utf-8") as f:
                content = f.read()
            file_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()

            prev = conn.execute(
                "SELECT file_hash FROM sys_schema_versions WHERE version = %s",
                (fname,),
            ).fetchone()
            if prev and prev[0] == file_hash:
                continue  # 已执行且未修改 → 跳过

            # 新文件 或 内容变更 → 执行并记录
            try:
                _execute_sql_file(path)
                _record_version(conn, fname, file_hash, _sql_description(path))
            except Exception as e:
                logger.error(f"SQL 文件执行失败 {fname}: {e}")

    logger.info("数据库表初始化完成")


def drop_db():
    """删除所有表（危险操作，仅开发调试用）"""
    Base.metadata.drop_all(engine)
    logger.warning("所有表已删除")


@contextmanager
def get_session() -> Session:
    """
    获取数据库 Session 的上下文管理器
    用法：
        with get_session() as session:
            session.add(paper)
            session.commit()
    """
    session = SessionFactory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
