-- ══════════════════════════════════════════════════════════
-- Scholar Funnel · PostgreSQL 迁移 DDL · 10 消息关联项目
-- 内容：ai_messages 增加 project_id（检索完成消息关联项目，历史回看可跳转）
-- 说明：幂等（列已存在跳过）
-- ══════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ai_messages' AND column_name = 'project_id'
  ) THEN
    ALTER TABLE ai_messages ADD COLUMN project_id BIGINT;
  END IF;
END $$;

COMMENT ON COLUMN ai_messages.project_id IS '关联项目（检索完成消息 → 可跳转检索页）';
CREATE INDEX IF NOT EXISTS idx_ai_messages_project ON ai_messages (project_id);
