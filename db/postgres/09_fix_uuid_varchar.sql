-- ══════════════════════════════════════════════════════════
-- Scholar Funnel · PostgreSQL 迁移 DDL · 09 对外 ID 列修复
-- 内容：CHAR(N) → VARCHAR(N)（CHAR 会补尾随空格，导致对外 ID 带空格）
-- 说明：
--   1. 所有对外 ID（uuid/session_id/share_uuid）统一 VARCHAR
--   2. 存量数据 TRIM 尾随空格
--   3. 幂等（列已是 varchar 则跳过）
-- ══════════════════════════════════════════════════════════

-- ai_users.uuid
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='ai_users' AND column_name='uuid'
      AND data_type='character' AND character_maximum_length=32
  ) THEN
    ALTER TABLE ai_users ALTER COLUMN uuid TYPE VARCHAR(32);
    UPDATE ai_users SET uuid = TRIM(uuid);
  END IF;
END $$;

-- ai_user_sessions.session_id
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='ai_user_sessions' AND column_name='session_id'
      AND data_type='character'
  ) THEN
    ALTER TABLE ai_user_sessions ALTER COLUMN session_id TYPE VARCHAR(36);
    UPDATE ai_user_sessions SET session_id = TRIM(session_id);
  END IF;
END $$;

-- ai_agents.uuid
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='ai_agents' AND column_name='uuid'
      AND data_type='character'
  ) THEN
    ALTER TABLE ai_agents ALTER COLUMN uuid TYPE VARCHAR(32);
    UPDATE ai_agents SET uuid = TRIM(uuid);
  END IF;
END $$;

-- ai_conversations.uuid / share_uuid（会话 ID，核心修复）
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='ai_conversations' AND column_name='uuid'
      AND data_type='character'
  ) THEN
    ALTER TABLE ai_conversations ALTER COLUMN uuid TYPE VARCHAR(32);
    UPDATE ai_conversations SET uuid = TRIM(uuid);
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='ai_conversations' AND column_name='share_uuid'
      AND data_type='character'
  ) THEN
    ALTER TABLE ai_conversations ALTER COLUMN share_uuid TYPE VARCHAR(32);
    UPDATE ai_conversations SET share_uuid = TRIM(share_uuid);
  END IF;
END $$;

-- ai_messages.uuid
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='ai_messages' AND column_name='uuid'
      AND data_type='character'
  ) THEN
    ALTER TABLE ai_messages ALTER COLUMN uuid TYPE VARCHAR(32);
    UPDATE ai_messages SET uuid = TRIM(uuid);
  END IF;
END $$;

-- ai_agent_runs.uuid
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='ai_agent_runs' AND column_name='uuid'
      AND data_type='character'
  ) THEN
    ALTER TABLE ai_agent_runs ALTER COLUMN uuid TYPE VARCHAR(32);
    UPDATE ai_agent_runs SET uuid = TRIM(uuid);
  END IF;
END $$;
