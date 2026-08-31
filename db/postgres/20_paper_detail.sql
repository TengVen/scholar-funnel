-- ══════════════════════════════════════════════════════════════════════
-- Scholar Funnel · PostgreSQL 迁移 DDL · 20 论文详情页（分节 + 单篇问答）
-- 内容：① ai_papers.sections JSONB——全文分节（[{heading, content}]），详情页中栏正文
--       ② ai_paper_questions——详情页单篇问答记录（四问之四落地详情页）
-- ══════════════════════════════════════════════════════════════════════

ALTER TABLE ai_papers ADD COLUMN IF NOT EXISTS sections JSONB;
COMMENT ON COLUMN ai_papers.sections IS '全文分节（[{heading, content}]），详情页中栏正文；无全文时为空';

ALTER TABLE ai_papers ADD COLUMN IF NOT EXISTS paper_analysis JSONB;
COMMENT ON COLUMN ai_papers.paper_analysis IS '论文深度分析落库（六区块：summary/quick_understand/core_contributions/method_framework/experiments/relation_to_research/research_context）；存在即 Research Asset（L3）';

CREATE TABLE IF NOT EXISTS ai_paper_questions (
  id          BIGSERIAL PRIMARY KEY,
  project_id  INTEGER NOT NULL REFERENCES ai_projects(id) ON DELETE CASCADE,
  paper_id    INTEGER NOT NULL REFERENCES ai_papers(id) ON DELETE CASCADE,
  question    TEXT NOT NULL,
  answer      TEXT NOT NULL,
  citations   JSONB,                              -- [{section, snippet}] 原文引用回溯
  created_at  TIMESTAMP DEFAULT NOW(),
  CONSTRAINT uniq_paper_question UNIQUE (paper_id, question)
);
CREATE INDEX IF NOT EXISTS idx_paper_question_paper
  ON ai_paper_questions (paper_id, created_at);
COMMENT ON TABLE ai_paper_questions IS '详情页单篇问答（基于分节/摘要，答案带原文引用回溯）';
