-- ══════════════════════════════════════════════════════════════════════
-- Scholar Funnel · PostgreSQL 迁移 DDL · 18 论文判断（采纳/排除/存疑）
-- 内容：ai_paper_judgments——用户对论文的研究判断沉淀（记忆机制的地基）
--       UNIQUE(project_id, paper_id)：最新判断覆盖旧判断（可逆——反向即恢复）
-- 说明：与 ai_cart（骨架，受限额约束）语义分离——排除/存疑不进骨架、不占配额。
--       adopt 动作不写本表判断状态之外的数据（骨架仍走 cart），仅作记录。
-- ══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ai_paper_judgments (
  id          BIGSERIAL PRIMARY KEY,
  project_id  INTEGER NOT NULL REFERENCES ai_projects(id) ON DELETE CASCADE,
  paper_id    INTEGER NOT NULL REFERENCES ai_papers(id) ON DELETE CASCADE,
  action      VARCHAR(20) NOT NULL,                   -- adopt / exclude / uncertain / none(撤销)
  reason      TEXT,                                   -- 用户给出的理由（对话原话提炼）
  source      VARCHAR(10) NOT NULL DEFAULT 'chat',    -- chat / ui
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP DEFAULT NOW(),
  CONSTRAINT uniq_paper_judgment UNIQUE (project_id, paper_id)
);
CREATE INDEX IF NOT EXISTS idx_paper_judgment_project
  ON ai_paper_judgments (project_id, action);
COMMENT ON TABLE ai_paper_judgments IS '论文研究判断（采纳/排除/存疑；最新覆盖；排除回流检索过滤）';
COMMENT ON COLUMN ai_paper_judgments.action IS 'adopt=采纳 exclude=排除 uncertain=存疑 none=撤销判断';
