-- ══════════════════════════════════════════════════════════════════════
-- Scholar Funnel · PostgreSQL 迁移 DDL · 15 分支分析跨领域增强
-- 内容：
--   ai_analysis_results 增加 usage_role / implementation_or_application /
--     probe_relation / research_question / methodology_type / method_category /
--     method_components(JSONB) / research_design / key_innovation /
--     limitations / evidence(JSONB)
--   ai_papers 增加 method_profile(JSONB) （PaperProfile 缓存）
-- 说明：幂等（IF NOT EXISTS）；全新库由 ORM create_all 自动建列，本文件对其为 no-op
-- ══════════════════════════════════════════════════════════════════════

ALTER TABLE ai_analysis_results ADD COLUMN IF NOT EXISTS usage_role VARCHAR(20);
ALTER TABLE ai_analysis_results ADD COLUMN IF NOT EXISTS implementation_or_application TEXT;
ALTER TABLE ai_analysis_results ADD COLUMN IF NOT EXISTS probe_relation TEXT;
ALTER TABLE ai_analysis_results ADD COLUMN IF NOT EXISTS research_question TEXT;
ALTER TABLE ai_analysis_results ADD COLUMN IF NOT EXISTS methodology_type VARCHAR(100);
ALTER TABLE ai_analysis_results ADD COLUMN IF NOT EXISTS method_category VARCHAR(100);
ALTER TABLE ai_analysis_results ADD COLUMN IF NOT EXISTS method_components JSONB;
ALTER TABLE ai_analysis_results ADD COLUMN IF NOT EXISTS research_design TEXT;
ALTER TABLE ai_analysis_results ADD COLUMN IF NOT EXISTS key_innovation TEXT;
ALTER TABLE ai_analysis_results ADD COLUMN IF NOT EXISTS limitations TEXT;
ALTER TABLE ai_analysis_results ADD COLUMN IF NOT EXISTS evidence JSONB;

ALTER TABLE ai_papers ADD COLUMN IF NOT EXISTS method_profile JSONB;
