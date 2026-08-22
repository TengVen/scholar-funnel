"""
MySQL 数据库连接与基础操作

Schema 管理策略：
- 表结构 DDL 统一放在 db/ 目录（01_schema.sql 全量建表 / 02_migrations.sql 增量迁移）
- init_db() 启动时按顺序执行 db/*.sql，幂等安全
"""
import os

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, Session
from contextlib import contextmanager

from utils.config import settings
from utils.log import setup_logger
from storage.models import Base

logger = setup_logger("storage")

# db/ 目录下按文件名排序的 SQL 文件（01_schema → 02_migrations → ...）
_SQL_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "db"
)


# ── 引擎 & Session 工厂（全局单例）──
engine = create_engine(
    settings.mysql_url,
    echo=False,                 # 调试时改为 True 可看到 SQL 日志
    pool_pre_ping=True,         # 自动检测断连
    pool_size=5,
    max_overflow=10,
)

SessionFactory = sessionmaker(bind=engine)


def _execute_sql_file(path: str):
    """执行单个 SQL 文件（支持多语句）"""
    with open(path, encoding="utf-8") as f:
        sql = f.read()
    # 跳过纯注释/空内容
    stripped = sql.strip()
    if not stripped:
        return
    with engine.begin() as conn:
        for statement in conn.connection.driver_connection.cursor().execute(sql):
            pass  # 依次消费结果集，避免 pending result
    logger.info(f"已执行 SQL 文件: {os.path.basename(path)}")


def init_db():
    """创建所有表（如果不存在），并执行增量迁移"""
    # SQLAlchemy 建表（确保 ORM 元数据与库结构一致）
    Base.metadata.create_all(engine)
    # 按序执行 db/*.sql（01 全量 schema 幂等建表，02+ 增量迁移）
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