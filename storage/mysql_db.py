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


def init_db():
    """创建所有表（如果不存在），并执行 db/postgres/*.sql 幂等初始化"""
    # SQLAlchemy 建表（确保 ORM 元数据与库结构一致；已有表自动跳过）
    Base.metadata.create_all(engine)
    # 按序执行 db/postgres/*.sql（00 扩展/ENUM/函数 → 01 系统表 → 02 用户 → 03 Agent → 04 业务）
    if os.path.isdir(_SQL_DIR):
        for fname in sorted(os.listdir(_SQL_DIR)):
            if fname.endswith(".sql"):
                try:
                    _execute_sql_file(os.path.join(_SQL_DIR, fname))
                except Exception as e:
                    # 单个文件失败不阻塞启动（记录日志，人工介入）
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
