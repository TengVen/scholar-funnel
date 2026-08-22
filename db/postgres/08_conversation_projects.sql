-- ══════════════════════════════════════════════════════════
-- Scholar Funnel · PostgreSQL 迁移 DDL · 08 会话多项目
-- 内容：ai_conversations 增加 project_ids（历史检索项目列表，多对多回看）
-- 说明：一个会话可发起多轮检索，每轮生成一个项目；
--       project_id=当前活跃项目，project_ids=全部历史项目（JSONB 数组）
-- ══════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ai_conversations' AND column_name = 'project_ids'
  ) THEN
    ALTER TABLE ai_conversations ADD COLUMN project_ids JSONB;
  END IF;
END $$;

COMMENT ON COLUMN ai_conversations.project_ids IS '历史检索项目 id 列表（多轮检索回看用，JSONB 数组）';
