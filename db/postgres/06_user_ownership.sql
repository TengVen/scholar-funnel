-- ══════════════════════════════════════════════════════════
-- Scholar Funnel · PostgreSQL 迁移 DDL · 06 用户归属与角色
-- 内容：
--   1. ai_projects.user_id（项目归属用户，用户隔离基础）
--   2. ai_users.role（guest/user/admin 角色，认证需要）
-- 说明：
--   1. user_id NULL = 系统级未归属数据（第一个 admin 注册时自动认领）
--   2. 幂等（列已存在跳过）
-- ══════════════════════════════════════════════════════════

-- ── 1. ai_projects.user_id ──
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ai_projects' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE ai_projects ADD COLUMN user_id BIGINT REFERENCES ai_users(id) ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN ai_projects.user_id IS '项目归属用户（NULL=系统级未归属，首个 admin 注册时认领）';

CREATE INDEX IF NOT EXISTS idx_ai_projects_user ON ai_projects (user_id);

-- ── 2. ai_users.role（认证角色） ──
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ai_users' AND column_name = 'role'
  ) THEN
    ALTER TABLE ai_users ADD COLUMN role VARCHAR(32) DEFAULT 'user';
  END IF;
END $$;

COMMENT ON COLUMN ai_users.role IS '角色：guest=游客 user=普通用户 admin=管理员';
