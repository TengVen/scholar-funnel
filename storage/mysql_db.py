"""
MySQL 数据库连接与基础操作
"""
from sqlalchemy import create_engine, text, inspect
from sqlalchemy.orm import sessionmaker, Session
from contextlib import contextmanager

from utils.config import settings
from utils.log import setup_logger
from storage.models import Base

logger = setup_logger("storage")


# ── 引擎 & Session 工厂（全局单例）──
engine = create_engine(
    settings.mysql_url,
    echo=False,                 # 调试时改为 True 可看到 SQL 日志
    pool_pre_ping=True,         # 自动检测断连
    pool_size=5,
    max_overflow=10,
)

SessionFactory = sessionmaker(bind=engine)


def _column_exists(table_name: str, column_name: str) -> bool:
    """检查表中是否已存在某列"""
    inspector = inspect(engine)
    if not inspector.has_table(table_name):
        return False
    columns = [c["name"] for c in inspector.get_columns(table_name)]
    return column_name in columns


def migrate_trunk_score():
    """为 papers 表添加 trunk_score 列（如果不存在）"""
    if _column_exists("papers", "trunk_score"):
        return
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE papers ADD COLUMN trunk_score FLOAT DEFAULT NULL"))
    logger.info("已迁移：papers.trunk_score 列")


def init_db():
    """创建所有表（如果不存在），并执行必要迁移"""
    Base.metadata.create_all(engine)
    migrate_trunk_score()
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