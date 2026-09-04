-- 23_run_maps.sql —— 领域地图快照（T10 地图结构化归纳）
-- 2026-09-04 用户拍板：领域地图 = 业务实体（独立生成生命周期 / 三端复用 / 按需回写）→ 独立表，
-- 而非塞进 ai_messages.attachments（那是"随消息展示的快照"，生命周期不同）。
-- 语义：一次检索 run（结果集）→ 一张领域地图。finalize 同批异步生成；历史 run 按需生成（工作台按钮）。
-- 消费端：对话页 MapCard / 工作台 run 认知结构区块 / 论文详情页左栏地图导航（同一快照三处只读）。

CREATE TABLE IF NOT EXISTS ai_run_maps (
    id         SERIAL PRIMARY KEY,
    run_id     INTEGER NOT NULL REFERENCES ai_search_runs(id) ON DELETE CASCADE,
    project_id INTEGER NOT NULL REFERENCES ai_projects(id) ON DELETE CASCADE,
    topic      VARCHAR(300) NOT NULL DEFAULT '',        -- 归纳主题（冗余，便于列表/回看）
    status     VARCHAR(20) NOT NULL DEFAULT 'generating',  -- generating / done / failed（none=无记录）
    map        JSONB NOT NULL DEFAULT '{}'::jsonb,      -- 归纳快照（schema 见 T10 设计文档 §引擎）
    model      VARCHAR(80),                             -- 生成所用模型（留痕）
    error      TEXT,                                    -- failed 原因（前端可展示"重新生成"）
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT uq_run_maps_run UNIQUE (run_id)
);

CREATE INDEX IF NOT EXISTS idx_run_maps_project ON ai_run_maps (project_id, created_at DESC);
