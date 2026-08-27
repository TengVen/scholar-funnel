-- ══════════════════════════════════════════════════════════════════════
-- Scholar Funnel · PostgreSQL 迁移 DDL · 16 应用运行日志落库
-- 内容：sys_app_logs 通用运行日志表（控制台日志异步落库）
--       level/logger/message/request_id/detail(JSONB)
-- 说明：与 sys_audit_logs（敏感操作审计）语义不同——本表存运行日志输出
-- 幂等（IF NOT EXISTS）；由 utils/log.py 的 DbLogHandler 异步批量写入
-- ══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS sys_app_logs (
  id          BIGSERIAL PRIMARY KEY,                    -- 自增主键
  level       VARCHAR(10) NOT NULL,                     -- 日志级别（INFO/WARNING/ERROR/DEBUG）
  logger      VARCHAR(64) NOT NULL DEFAULT '',          -- logger 名称（模块名）
  message     TEXT NOT NULL,                            -- 日志消息（含 X-Request-Id 等）
  request_id  VARCHAR(40),                              -- 关联请求 ID（中间件注入，可为空）
  detail      JSONB,                                    -- 扩展详情（异常 traceback 等）
  created_at  TIMESTAMP DEFAULT NOW()                   -- 记录时间
);
COMMENT ON TABLE sys_app_logs IS '应用运行日志（控制台输出异步落库，DbLogHandler 写入）';
COMMENT ON COLUMN sys_app_logs.id IS '自增主键';
COMMENT ON COLUMN sys_app_logs.level IS '日志级别';
COMMENT ON COLUMN sys_app_logs.logger IS 'logger 名称（模块名）';
COMMENT ON COLUMN sys_app_logs.message IS '日志消息';
COMMENT ON COLUMN sys_app_logs.request_id IS '关联请求 ID（request_log 中间件注入，可为空）';
COMMENT ON COLUMN sys_app_logs.detail IS '扩展详情（异常 traceback 等）';
COMMENT ON COLUMN sys_app_logs.created_at IS '记录时间';

CREATE INDEX IF NOT EXISTS idx_app_logs_level ON sys_app_logs (level, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_logs_logger ON sys_app_logs (logger, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_logs_request ON sys_app_logs (request_id);
