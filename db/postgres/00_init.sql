-- ══════════════════════════════════════════════════════════
-- Scholar Funnel · PostgreSQL 迁移 DDL · 00 初始化
-- 内容：pgvector 扩展 / ENUM 类型 / updated_at 触发器函数
-- 命名规范：业务表 ai_* / 系统表 sys_* / 业务 ENUM 统一 ai_* 前缀
-- ══════════════════════════════════════════════════════════

-- ── pgvector 扩展（向量检索核心，1024 维 = bge-large-zh-v1.5） ──
CREATE EXTENSION IF NOT EXISTS vector;

-- ──────────────────────────────────────────────
-- ENUM 类型（业务统一 ai_ 前缀；与 ORM models.py 同步改名）
-- ──────────────────────────────────────────────
DO $$
BEGIN
  -- 论文阶段：主干检索 / 分支深挖 / 网络图谱 / 缺口补充
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ai_paper_stage') THEN
    CREATE TYPE ai_paper_stage AS ENUM ('trunk', 'branch', 'network', 'gap');
  END IF;
  -- 探针匹配置信度
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ai_confidence_level') THEN
    CREATE TYPE ai_confidence_level AS ENUM ('high', 'medium', 'low', 'none');
  END IF;
  -- 骨架分类：奠基 / 主流 / 前沿
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ai_cart_category') THEN
    CREATE TYPE ai_cart_category AS ENUM ('foundation', 'mainstream', 'frontier');
  END IF;
END $$;

-- ──────────────────────────────────────────────
-- updated_at 自动更新触发器函数
-- （PostgreSQL 无 MySQL 的 ON UPDATE NOW()，用触发器模拟）
-- ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
