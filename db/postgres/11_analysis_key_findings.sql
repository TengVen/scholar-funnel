-- ════════════════════════════════════════════════
-- Scholar Funnel · PostgreSQL 迁移 DDL · 11 分析结果增补 key_findings
-- 内容：ai_analysis_results 增加 key_findings 列（分支深挖关键发现）
--       原实现仅存于内存结果，刷新/查看已存结果即丢失，本迁移持久化该字段
-- 说明：幂等（IF NOT EXISTS）；全新库由 ORM create_all 自动建列，本文件对其为 no-op
-- ════════════════════════════════════════════════

ALTER TABLE ai_analysis_results ADD COLUMN IF NOT EXISTS key_findings TEXT;
COMMENT ON COLUMN ai_analysis_results.key_findings IS '分支深挖关键发现（LLM 产出，持久化避免刷新丢失）';
