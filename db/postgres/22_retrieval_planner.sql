-- 22_retrieval_planner.sql —— P1 数据模型（Retrieval Planner 架构地基）
-- 1) ai_search_runs 补约束快照 + 模式/状态字段（每次检索完整输入 + 决策 + 结果状态，可回放可审计）
ALTER TABLE ai_search_runs ADD COLUMN IF NOT EXISTS mode VARCHAR(20);          -- 检索模式: full / incremental / local_filter / hybrid
ALTER TABLE ai_search_runs ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'done';  -- done / partial / failed / rate_limited
ALTER TABLE ai_search_runs ADD COLUMN IF NOT EXISTS error TEXT;                -- 错误摘要（失败/降级时留痕，前端可见）
ALTER TABLE ai_search_runs ADD COLUMN IF NOT EXISTS plan_reason TEXT;          -- Planner 决策说明（"为什么这次这么搜"）
ALTER TABLE ai_search_runs ADD COLUMN IF NOT EXISTS year_from INTEGER;         -- 约束快照：年份窗口
ALTER TABLE ai_search_runs ADD COLUMN IF NOT EXISTS year_to INTEGER;
ALTER TABLE ai_search_runs ADD COLUMN IF NOT EXISTS methodology TEXT;          -- 约束快照：方法论偏好
ALTER TABLE ai_search_runs ADD COLUMN IF NOT EXISTS paper_type VARCHAR(20);    -- 约束快照：论文类型 all/survey/original

-- 2) ai_paper_runs：论文 ↔ 检索记录 多对多（Search Run = 独立资产快照；论文跨 Run 共享不重复入库）
CREATE TABLE IF NOT EXISTS ai_paper_runs (
    id BIGSERIAL PRIMARY KEY,
    paper_id INTEGER NOT NULL REFERENCES ai_papers(id) ON DELETE CASCADE,
    search_run_id INTEGER NOT NULL REFERENCES ai_search_runs(id) ON DELETE CASCADE,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT uq_paper_run UNIQUE (paper_id, search_run_id)
);
CREATE INDEX IF NOT EXISTS idx_paper_runs_run ON ai_paper_runs(search_run_id);
CREATE INDEX IF NOT EXISTS idx_paper_runs_paper ON ai_paper_runs(paper_id);
