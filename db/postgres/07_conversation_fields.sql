-- ══════════════════════════════════════════════════════════
-- Scholar Funnel · PostgreSQL 迁移 DDL · 07 会话落库字段
-- 内容：ai_conversations 增加 stage / params / project_id
-- 说明：chat.py 从内存 dict 迁移到 ai_conversations 表所需
-- ══════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ai_conversations' AND column_name = 'stage'
  ) THEN
    ALTER TABLE ai_conversations ADD COLUMN stage VARCHAR(20) DEFAULT 'greeting';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ai_conversations' AND column_name = 'params'
  ) THEN
    ALTER TABLE ai_conversations ADD COLUMN params JSONB;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ai_conversations' AND column_name = 'project_id'
  ) THEN
    ALTER TABLE ai_conversations ADD COLUMN project_id BIGINT;
  END IF;
END $$;

COMMENT ON COLUMN ai_conversations.stage IS '对话阶段（greeting/confirming/searching）';
COMMENT ON COLUMN ai_conversations.params IS '检索参数（JSONB：user_query/tech_probe/year_from 等）';
COMMENT ON COLUMN ai_conversations.project_id IS '关联检索项目（对话确认后创建）';
