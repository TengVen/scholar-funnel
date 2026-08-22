-- ══════════════════════════════════════════════════════════
-- Scholar Funnel · PostgreSQL 迁移 DDL · 05 向量检索支持
-- 内容：ai_papers 增加 embedding 列（论文语义向量）
-- 依赖：00_init.sql 的 pgvector 扩展（CREATE EXTENSION vector）
-- 说明：幂等（列已存在跳过）；HNSW 索引加速 1024 维余弦检索
-- ══════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────
-- ai_papers.embedding：论文语义向量（1024 维 = bge-large-zh-v1.5）
-- 用途：语义去重/聚类（价值点2）、缺口质心补充（价值点3）、
--       本地语义召回（价值点1：query 向量化后余弦近邻）
-- ──────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ai_papers' AND column_name = 'embedding'
  ) THEN
    ALTER TABLE ai_papers ADD COLUMN embedding vector(1024);
  END IF;
END $$;

COMMENT ON COLUMN ai_papers.embedding IS '论文语义向量 1024 维（bge-large-zh-v1.5，title+abstract 生成）';

-- HNSW 索引（余弦相似度检索）
CREATE INDEX IF NOT EXISTS idx_ai_papers_embedding
  ON ai_papers USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
