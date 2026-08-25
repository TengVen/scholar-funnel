-- ══════════════════════════════════════════════════════════
-- Scholar Funnel · PostgreSQL 迁移 DDL · 14 项目级骨架限额
-- 内容：ai_projects 增加 limits（JSONB）列 —— 项目可自定义奠基/主流/前沿配额
-- 说明：幂等（列已存在跳过）；空/NULL = 使用默认 5/10/5
-- ══════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ai_projects' AND column_name = 'limits'
  ) THEN
    ALTER TABLE ai_projects ADD COLUMN limits JSONB;
  END IF;
END $$;

COMMENT ON COLUMN ai_projects.limits IS '项目级骨架限额 {foundation,mainstream,frontier}（空=默认 5/10/5；单类 1-30，总和≤50）';
