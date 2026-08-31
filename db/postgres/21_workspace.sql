-- 21_workspace.sql —— 2-page IA 工作台数据层
-- 1) ai_search_runs：检索记录表（工作台"检索记录"视图 + 认知收敛检测数据源，一表两用）
CREATE TABLE IF NOT EXISTS ai_search_runs (
    id BIGSERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES ai_projects(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES ai_users(id),
    run_type VARCHAR(20) NOT NULL DEFAULT 'trunk',   -- trunk 全量 / gap 缺口补充 / semantic 语义 / local 本地库
    query TEXT,                                       -- user_query
    tech_probe TEXT,
    user_constraint TEXT,                             -- gap 附加约束
    target_category VARCHAR(20),                      -- gap 类别
    top_k INTEGER,
    score_threshold NUMERIC(4,2),
    total_found INTEGER NOT NULL DEFAULT 0,           -- 召回数
    saved_count INTEGER NOT NULL DEFAULT 0,           -- 入库/候选数
    covered_ratio NUMERIC(4,2),                       -- 覆盖率（already_in_db 占比，0-1；收敛检测用）
    created_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_search_runs_project ON ai_search_runs(project_id, created_at);

-- 2) ai_papers.explored_at：深入探究标记（explore 触发即写：L1→L2 跃迁 / L2 预热 / L3）
ALTER TABLE ai_papers ADD COLUMN IF NOT EXISTS explored_at TIMESTAMP;
