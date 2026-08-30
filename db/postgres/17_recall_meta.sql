-- ══════════════════════════════════════════════════════════════════════
-- Scholar Funnel · PostgreSQL 迁移 DDL · 17 召回溯源（"为什么是它"）
-- 内容：ai_papers 新增 recall_meta JSONB——逐论文召回溯源
--       {routes, matched_terms, source, similarity, rerank_score}
-- 说明：检索时由 pipeline._save 写入；papers 列表接口透出为 why 字段。
--       纯增量标记，不改变任何召回/重排行为。
-- ══════════════════════════════════════════════════════════════════════

ALTER TABLE ai_papers ADD COLUMN IF NOT EXISTS recall_meta JSONB;
COMMENT ON COLUMN ai_papers.recall_meta IS '召回溯源：{routes:[core/synonym/aux/loose], matched_terms:[], source:openalex/semantic, similarity, rerank_score}';
