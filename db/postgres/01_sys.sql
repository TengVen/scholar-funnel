-- ══════════════════════════════════════════════════════════
-- Scholar Funnel · PostgreSQL 迁移 DDL · 01 系统级表（sys_*）
-- 内容：schema 版本管理 / 系统配置 / 审计日志 / 安全事件
-- ══════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────
-- sys_schema_versions 数据库 Schema 版本记录
-- 用途：迁移框架记录已执行的 DDL 版本，防止重复执行
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sys_schema_versions (
  id          BIGSERIAL PRIMARY KEY,                    -- 自增主键
  version     VARCHAR(50) NOT NULL UNIQUE,              -- 版本号（如 20260822_001）
  description VARCHAR(255),                             -- 版本描述（本次迁移内容摘要）
  applied_at  TIMESTAMP DEFAULT NOW()                   -- 执行时间
);
COMMENT ON TABLE sys_schema_versions IS '数据库 Schema 版本记录（迁移框架用）';
COMMENT ON COLUMN sys_schema_versions.id IS '自增主键';
COMMENT ON COLUMN sys_schema_versions.version IS '版本号（如 20260822_001）';
COMMENT ON COLUMN sys_schema_versions.description IS '版本描述（本次迁移内容摘要）';
COMMENT ON COLUMN sys_schema_versions.applied_at IS '执行时间';

-- ──────────────────────────────────────────────
-- sys_settings 系统级配置（KV）
-- 用途：全局开关、默认模型、限额等运行时配置，避免改代码重启
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sys_settings (
  id          BIGSERIAL PRIMARY KEY,                    -- 自增主键
  key         VARCHAR(100) NOT NULL UNIQUE,             -- 配置键（如 default_model / max_projects_per_user）
  value       JSONB NOT NULL,                           -- 配置值（JSONB，支持任意类型）
  description VARCHAR(255),                             -- 配置说明
  updated_at  TIMESTAMP DEFAULT NOW()                   -- 更新时间
);
COMMENT ON TABLE sys_settings IS '系统级配置（KV 结构，运行时生效）';
COMMENT ON COLUMN sys_settings.id IS '自增主键';
COMMENT ON COLUMN sys_settings.key IS '配置键（如 default_model）';
COMMENT ON COLUMN sys_settings.value IS '配置值（JSONB 支持任意类型）';
COMMENT ON COLUMN sys_settings.description IS '配置说明';
COMMENT ON COLUMN sys_settings.updated_at IS '更新时间';
-- 幂等创建触发器 trg_sys_settings_updated（避免重复执行报 already exists）
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sys_settings_updated') THEN
    CREATE TRIGGER trg_sys_settings_updated BEFORE UPDATE ON sys_settings
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ──────────────────────────────────────────────
-- sys_audit_logs 审计日志
-- 用途：敏感操作审计（改密/删号/改权限/导出数据），不可删除
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sys_audit_logs (
  id          BIGSERIAL PRIMARY KEY,                    -- 自增主键
  user_id     BIGINT,                                   -- 操作人（系统操作可为空）
  tenant_id   BIGINT,                                   -- 所属租户
  action      VARCHAR(64) NOT NULL,                     -- 操作（password_change / account_delete / role_change）
  entity_type VARCHAR(50),                              -- 操作对象类型（user / conversation / agent）
  entity_id   VARCHAR(64),                              -- 操作对象 ID
  ip_address  VARCHAR(64),                              -- 操作来源 IP
  old_value   JSONB,                                    -- 变更前快照
  new_value   JSONB,                                    -- 变更后快照
  created_at  TIMESTAMP DEFAULT NOW()                   -- 操作时间
);
COMMENT ON TABLE sys_audit_logs IS '审计日志：敏感操作全程留痕';
COMMENT ON COLUMN sys_audit_logs.id IS '自增主键';
COMMENT ON COLUMN sys_audit_logs.user_id IS '操作人（系统操作可为空）';
COMMENT ON COLUMN sys_audit_logs.tenant_id IS '所属租户';
COMMENT ON COLUMN sys_audit_logs.action IS '操作动作（password_change / account_delete 等）';
COMMENT ON COLUMN sys_audit_logs.entity_type IS '操作对象类型（user / conversation / agent）';
COMMENT ON COLUMN sys_audit_logs.entity_id IS '操作对象 ID';
COMMENT ON COLUMN sys_audit_logs.ip_address IS '操作来源 IP';
COMMENT ON COLUMN sys_audit_logs.old_value IS '变更前快照（JSONB）';
COMMENT ON COLUMN sys_audit_logs.new_value IS '变更后快照（JSONB）';
COMMENT ON COLUMN sys_audit_logs.created_at IS '操作时间';
CREATE INDEX IF NOT EXISTS idx_audit_user ON sys_audit_logs (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON sys_audit_logs (entity_type, entity_id);

-- ──────────────────────────────────────────────
-- sys_security_events 安全事件
-- 用途：异常行为告警（暴力破解/异地登录/异常 IP），供风控分析
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sys_security_events (
  id          BIGSERIAL PRIMARY KEY,                    -- 自增主键
  event_type  VARCHAR(50) NOT NULL,                     -- 事件类型（brute_force / geo_anomaly / suspicious_ip）
  user_id     BIGINT,                                   -- 关联用户（可空）
  ip_address  VARCHAR(64),                              -- 事件来源 IP
  severity    SMALLINT DEFAULT 1,                       -- 严重级别（1=低 2=中 3=高）
  detail      JSONB,                                    -- 事件详情（上下文数据）
  created_at  TIMESTAMP DEFAULT NOW()                   -- 事件时间
);
COMMENT ON TABLE sys_security_events IS '安全事件：异常行为告警与风控分析';
COMMENT ON COLUMN sys_security_events.id IS '自增主键';
COMMENT ON COLUMN sys_security_events.event_type IS '事件类型（brute_force / geo_anomaly / suspicious_ip）';
COMMENT ON COLUMN sys_security_events.user_id IS '关联用户（可空）';
COMMENT ON COLUMN sys_security_events.ip_address IS '事件来源 IP';
COMMENT ON COLUMN sys_security_events.severity IS '严重级别（1=低 2=中 3=高）';
COMMENT ON COLUMN sys_security_events.detail IS '事件详情（JSONB）';
COMMENT ON COLUMN sys_security_events.created_at IS '事件时间';
CREATE INDEX IF NOT EXISTS idx_security_type ON sys_security_events (event_type, created_at);
CREATE INDEX IF NOT EXISTS idx_security_user ON sys_security_events (user_id);
