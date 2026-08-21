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


def migrate_paper_enrich():
    """为 papers 表添加 keywords / github_url 列（关键词与 GitHub 仓库，如果不存在）"""
    with engine.begin() as conn:
        if not _column_exists("papers", "keywords"):
            conn.execute(text("ALTER TABLE papers ADD COLUMN keywords JSON DEFAULT NULL"))
            logger.info("已迁移：papers.keywords 列")
        if not _column_exists("papers", "github_url"):
            conn.execute(text("ALTER TABLE papers ADD COLUMN github_url VARCHAR(500) DEFAULT NULL"))
            logger.info("已迁移：papers.github_url 列")


def migrate_gap_support():
    """缺口补充检索支持：stage 枚举加 gap + 新增 recommended_category 列"""
    with engine.begin() as conn:
        # 1. recommended_category 列
        if not _column_exists("papers", "recommended_category"):
            conn.execute(text(
                "ALTER TABLE papers ADD COLUMN recommended_category VARCHAR(20) DEFAULT NULL"
            ))
            logger.info("已迁移：papers.recommended_category 列")

        # 2. stage 枚举加 gap 值（MySQL ENUM 需整体重建列）
        try:
            conn.execute(text(
                "ALTER TABLE papers MODIFY COLUMN stage "
                "ENUM('trunk','branch','network','gap') NOT NULL DEFAULT 'trunk'"
            ))
            logger.info("已迁移：papers.stage 枚举增加 gap")
        except Exception as e:
            logger.warning(f"stage 枚举迁移跳过（可能已含 gap）: {e}")


def migrate_branch_mode():
    """分支深挖按模式区分：analysis_results 加 mode 列 + (paper_id, mode) 唯一约束"""
    with engine.begin() as conn:
        # 1. mode 列
        if not _column_exists("analysis_results", "mode"):
            conn.execute(text(
                "ALTER TABLE analysis_results ADD COLUMN mode VARCHAR(20) DEFAULT NULL"
            ))
            logger.info("已迁移：analysis_results.mode 列")

        # 2. 旧数据回填：无 mode 的记录归为 probe_match（最常用模式）
        conn.execute(text(
            "UPDATE analysis_results SET mode='probe_match' WHERE mode IS NULL OR mode=''"
        ))

        # 3. (paper_id, mode) 唯一约束（若不存在）
        try:
            conn.execute(text(
                "ALTER TABLE analysis_results ADD CONSTRAINT uniq_analysis_paper_mode "
                "UNIQUE (paper_id, mode)"
            ))
            logger.info("已迁移：analysis_results (paper_id, mode) 唯一约束")
        except Exception as e:
            logger.warning(f"唯一约束迁移跳过（可能已存在）: {e}")


def init_db():
    """创建所有表（如果不存在），并执行必要迁移"""
    Base.metadata.create_all(engine)
    migrate_trunk_score()
    migrate_paper_enrich()
    migrate_gap_support()
    migrate_branch_mode()
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