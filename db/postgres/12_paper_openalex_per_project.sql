-- ════════════════════════════════════════════════
-- Scholar Funnel · PostgreSQL 迁移 DDL · 12 论文 openalex_id 改为 per-project 复合唯一
-- 内容：删除 ai_papers.openalex_id 单列全局唯一约束，
--       改为 (openalex_id, project_id) 复合唯一
-- 解决：跨项目检索命中同一篇 OA 论文时，被他项目"认领"导致在当前项目结果里被静默丢弃
-- 说明：幂等（DO 块按存在性判断，兼容任意自动命名的历史约束名）
-- ════════════════════════════════════════════════

DO $$
DECLARE
  con RECORD;
BEGIN
  -- 删除旧的「单列 openalex_id 唯一」约束（PostgreSQL 自动命名通常为 ai_papers_openalex_id_key）
  FOR con IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
    WHERE t.relname = 'ai_papers'
      AND c.contype = 'u'                 -- unique 约束
      AND array_length(c.conkey, 1) = 1   -- 仅含单列
      AND a.attname = 'openalex_id'
  LOOP
    EXECUTE format('ALTER TABLE ai_papers DROP CONSTRAINT %I', con.conname);
  END LOOP;

  -- 新增 (openalex_id, project_id) 复合唯一（幂等）
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'ai_papers' AND c.conname = 'uniq_paper_openalex_project'
  ) THEN
    ALTER TABLE ai_papers ADD CONSTRAINT uniq_paper_openalex_project UNIQUE (openalex_id, project_id);
  END IF;
END $$;
