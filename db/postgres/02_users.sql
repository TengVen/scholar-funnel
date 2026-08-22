-- ══════════════════════════════════════════════════════════
-- Scholar Funnel · PostgreSQL 迁移 DDL · 02 用户与认证域
-- 内容：tenants / users / user_credentials / user_security /
--       user_sessions / api_keys / oauth_bindings / login_logs
-- 设计原则：
--   users = 纯粹"这个人是谁"，登录凭据/安全状态/UI 偏好拆分出去
--   登录体系(user_sessions) 与 开放 API(api_keys) 职责分离
-- ══════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────
-- ai_tenants 租户（多租户预留，RBAC 表待真实需求再加）
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_tenants (
  id         BIGSERIAL PRIMARY KEY,                     -- 租户 ID
  name       VARCHAR(128) NOT NULL,                     -- 租户名称（公司/组织名）
  slug       VARCHAR(64) NOT NULL UNIQUE,               -- 唯一标识（URL 友好，如 acme-corp）
  status     SMALLINT DEFAULT 1,                        -- 状态（0=停用 1=正常）
  created_at TIMESTAMP DEFAULT NOW(),                   -- 创建时间
  updated_at TIMESTAMP DEFAULT NOW()                    -- 更新时间
);
COMMENT ON TABLE ai_tenants IS '租户（多租户预留，RBAC 待真实需求再扩展）';
COMMENT ON COLUMN ai_tenants.id IS '租户 ID';
COMMENT ON COLUMN ai_tenants.name IS '租户名称（公司/组织名）';
COMMENT ON COLUMN ai_tenants.slug IS '唯一标识（URL 友好）';
COMMENT ON COLUMN ai_tenants.status IS '状态（0=停用 1=正常）';
COMMENT ON COLUMN ai_tenants.created_at IS '创建时间';
COMMENT ON COLUMN ai_tenants.updated_at IS '更新时间';
CREATE TRIGGER trg_ai_tenants_updated BEFORE UPDATE ON ai_tenants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ──────────────────────────────────────────────
-- ai_users 用户主表（纯净：只回答"这个人是谁"）
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_users (
  id          BIGSERIAL PRIMARY KEY,                    -- 用户 ID（业务层不暴露）
  uuid        CHAR(32) NOT NULL UNIQUE,                 -- 对外用户 ID（usr_ 前缀，防遍历）
  username    VARCHAR(64) NOT NULL UNIQUE,              -- 用户名（支持登录）
  email       VARCHAR(255) UNIQUE,                      -- 邮箱（支持登录 & 找回密码）
  phone       VARCHAR(20) UNIQUE,                       -- 手机号（支持短信登录）
  nickname    VARCHAR(64),                              -- 展示昵称
  avatar_url  VARCHAR(500),                             -- 头像 CDN 地址
  status      SMALLINT DEFAULT 1,                       -- 状态（0=禁用 1=正常 2=待验证 3=锁定）
  tenant_id   BIGINT REFERENCES ai_tenants(id),         -- 主租户（预留；多租户成员关系后续扩展）
  preferences JSONB,                                    -- 用户偏好（主题/语言等，JSONB 不单独建表）
  created_at  TIMESTAMP DEFAULT NOW(),                  -- 注册时间
  updated_at  TIMESTAMP DEFAULT NOW(),                  -- 更新时间
  deleted_at  TIMESTAMP                                 -- 软删除标记
);
COMMENT ON TABLE ai_users IS '用户主表：纯粹的用户身份信息（登录/安全/偏好已拆分）';
COMMENT ON COLUMN ai_users.id IS '用户 ID（业务层不暴露）';
COMMENT ON COLUMN ai_users.uuid IS '对外用户 ID（usr_ 前缀，防遍历）';
COMMENT ON COLUMN ai_users.username IS '用户名（支持登录）';
COMMENT ON COLUMN ai_users.email IS '邮箱（支持登录 & 找回密码）';
COMMENT ON COLUMN ai_users.phone IS '手机号（支持短信登录）';
COMMENT ON COLUMN ai_users.nickname IS '展示昵称';
COMMENT ON COLUMN ai_users.avatar_url IS '头像 CDN 地址';
COMMENT ON COLUMN ai_users.status IS '状态（0=禁用 1=正常 2=待验证 3=锁定）';
COMMENT ON COLUMN ai_users.tenant_id IS '主租户（预留；多租户成员关系后续扩展）';
COMMENT ON COLUMN ai_users.preferences IS '用户偏好设置（主题/语言等 JSONB）';
COMMENT ON COLUMN ai_users.created_at IS '注册时间';
COMMENT ON COLUMN ai_users.updated_at IS '更新时间';
COMMENT ON COLUMN ai_users.deleted_at IS '软删除标记';
CREATE INDEX IF NOT EXISTS idx_ai_users_tenant ON ai_users (tenant_id);
CREATE INDEX IF NOT EXISTS idx_ai_users_deleted ON ai_users (deleted_at);
CREATE TRIGGER trg_ai_users_updated BEFORE UPDATE ON ai_users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ──────────────────────────────────────────────
-- ai_user_credentials 登录凭据
-- 用途：密码哈希与盐（bcrypt/argon2），与用户身份分离
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_user_credentials (
  id            BIGSERIAL PRIMARY KEY,                  -- 自增主键
  user_id       BIGINT NOT NULL UNIQUE REFERENCES ai_users(id) ON DELETE CASCADE, -- 关联用户
  password_hash VARCHAR(255) NOT NULL,                  -- 密码哈希（bcrypt/argon2，禁止明文）
  salt          VARCHAR(64),                            -- 盐值（如使用自定义哈希策略）
  password_set_at TIMESTAMP,                            -- 密码设置/重置时间
  created_at    TIMESTAMP DEFAULT NOW(),                -- 创建时间
  updated_at    TIMESTAMP DEFAULT NOW()                 -- 更新时间
);
COMMENT ON TABLE ai_user_credentials IS '登录凭据：密码哈希与盐（与用户身份分离）';
COMMENT ON COLUMN ai_user_credentials.id IS '自增主键';
COMMENT ON COLUMN ai_user_credentials.user_id IS '关联用户（一对一）';
COMMENT ON COLUMN ai_user_credentials.password_hash IS '密码哈希（bcrypt/argon2，禁止明文）';
COMMENT ON COLUMN ai_user_credentials.salt IS '盐值（如使用自定义哈希策略）';
COMMENT ON COLUMN ai_user_credentials.password_set_at IS '密码设置/重置时间';
COMMENT ON COLUMN ai_user_credentials.created_at IS '创建时间';
COMMENT ON COLUMN ai_user_credentials.updated_at IS '更新时间';
CREATE TRIGGER trg_ai_creds_updated BEFORE UPDATE ON ai_user_credentials
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ──────────────────────────────────────────────
-- ai_user_security 账号安全状态
-- 用途：MFA / 登录失败计数 / 锁定 / 验证时间（防暴力破解）
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_user_security (
  id                BIGSERIAL PRIMARY KEY,              -- 自增主键
  user_id           BIGINT NOT NULL UNIQUE REFERENCES ai_users(id) ON DELETE CASCADE, -- 关联用户
  mfa_enabled       BOOLEAN DEFAULT FALSE,              -- 是否开启多因素认证
  mfa_secret        VARCHAR(64),                        -- MFA 密钥（加密存储，建议 KMS 托管）
  mfa_verified_at   TIMESTAMP,                          -- MFA 启用验证时间
  login_fail_count  INT DEFAULT 0,                      -- 连续登录失败次数
  locked_until      TIMESTAMP,                          -- 账号锁定截止时间
  last_login_at     TIMESTAMP,                          -- 最后登录时间
  last_login_ip     VARCHAR(64),                        -- 最后登录 IP
  email_verified_at TIMESTAMP,                          -- 邮箱验证时间
  phone_verified_at TIMESTAMP,                          -- 手机验证时间
  created_at        TIMESTAMP DEFAULT NOW(),            -- 创建时间
  updated_at        TIMESTAMP DEFAULT NOW()             -- 更新时间
);
COMMENT ON TABLE ai_user_security IS '账号安全状态：MFA/锁定/登录统计（防暴力破解）';
COMMENT ON COLUMN ai_user_security.id IS '自增主键';
COMMENT ON COLUMN ai_user_security.user_id IS '关联用户（一对一）';
COMMENT ON COLUMN ai_user_security.mfa_enabled IS '是否开启多因素认证';
COMMENT ON COLUMN ai_user_security.mfa_secret IS 'MFA 密钥（加密存储，建议 KMS 托管）';
COMMENT ON COLUMN ai_user_security.mfa_verified_at IS 'MFA 启用验证时间';
COMMENT ON COLUMN ai_user_security.login_fail_count IS '连续登录失败次数（防暴力破解）';
COMMENT ON COLUMN ai_user_security.locked_until IS '账号锁定截止时间';
COMMENT ON COLUMN ai_user_security.last_login_at IS '最后登录时间';
COMMENT ON COLUMN ai_user_security.last_login_ip IS '最后登录 IP';
COMMENT ON COLUMN ai_user_security.email_verified_at IS '邮箱验证时间';
COMMENT ON COLUMN ai_user_security.phone_verified_at IS '手机验证时间';
COMMENT ON COLUMN ai_user_security.created_at IS '创建时间';
COMMENT ON COLUMN ai_user_security.updated_at IS '更新时间';
CREATE TRIGGER trg_ai_security_updated BEFORE UPDATE ON ai_user_security
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ──────────────────────────────────────────────
-- ai_user_sessions 登录会话（Access/Refresh 体系）
-- 用途：管理登录态、多端登录、Token 吊销；只存哈希不存原始 Token
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_user_sessions (
  id                 BIGSERIAL PRIMARY KEY,             -- 自增主键
  user_id            BIGINT NOT NULL REFERENCES ai_users(id) ON DELETE CASCADE, -- 关联用户
  session_id         CHAR(36) NOT NULL UNIQUE,          -- 会话唯一标识（对外）
  refresh_token_hash CHAR(64) NOT NULL UNIQUE,          -- Refresh Token SHA-256 哈希
  device_id          VARCHAR(64),                       -- 设备指纹/ID
  device_name        VARCHAR(128),                      -- 设备名称（如 iPhone 15）
  ip_address         VARCHAR(64),                       -- 登录 IP
  user_agent         VARCHAR(500),                      -- 浏览器 UA
  expires_at         TIMESTAMP NOT NULL,                -- 会话过期时间
  revoked_at         TIMESTAMP,                         -- 吊销时间
  created_at         TIMESTAMP DEFAULT NOW()            -- 创建时间
);
COMMENT ON TABLE ai_user_sessions IS '登录会话：Access/Refresh 体系，支持多端登录与吊销';
COMMENT ON COLUMN ai_user_sessions.id IS '自增主键';
COMMENT ON COLUMN ai_user_sessions.user_id IS '关联用户';
COMMENT ON COLUMN ai_user_sessions.session_id IS '会话唯一标识（对外）';
COMMENT ON COLUMN ai_user_sessions.refresh_token_hash IS 'Refresh Token SHA-256 哈希（不存原始 Token）';
COMMENT ON COLUMN ai_user_sessions.device_id IS '设备指纹/ID';
COMMENT ON COLUMN ai_user_sessions.device_name IS '设备名称（如 iPhone 15）';
COMMENT ON COLUMN ai_user_sessions.ip_address IS '登录 IP';
COMMENT ON COLUMN ai_user_sessions.user_agent IS '浏览器 UA';
COMMENT ON COLUMN ai_user_sessions.expires_at IS '会话过期时间';
COMMENT ON COLUMN ai_user_sessions.revoked_at IS '吊销时间';
COMMENT ON COLUMN ai_user_sessions.created_at IS '创建时间';
CREATE INDEX IF NOT EXISTS idx_sessions_user ON ai_user_sessions (user_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_revoked ON ai_user_sessions (revoked_at);

-- ──────────────────────────────────────────────
-- ai_api_keys 开放 API 密钥
-- 用途：第三方/程序化访问（与登录会话分离，支持 scope/过期/吊销）
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_api_keys (
  id           BIGSERIAL PRIMARY KEY,                   -- 自增主键
  user_id      BIGINT NOT NULL REFERENCES ai_users(id) ON DELETE CASCADE, -- 所属用户
  tenant_id    BIGINT REFERENCES ai_tenants(id),        -- 所属租户（可空）
  name         VARCHAR(64) NOT NULL,                    -- 密钥名称（如 "生产环境"）
  key_prefix   VARCHAR(16) NOT NULL,                    -- 密钥前缀（如 sk_live_，用于识别与展示）
  key_hash     CHAR(64) NOT NULL UNIQUE,                -- 完整密钥 SHA-256 哈希
  scopes       JSONB,                                   -- 权限范围（如 ["search:read", "cart:write"]）
  expires_at   TIMESTAMP,                               -- 过期时间（空=永不过期）
  last_used_at TIMESTAMP,                               -- 最后使用时间
  revoked_at   TIMESTAMP,                               -- 吊销时间
  created_at   TIMESTAMP DEFAULT NOW()                  -- 创建时间
);
COMMENT ON TABLE ai_api_keys IS '开放 API 密钥：程序化访问凭据（与登录会话分离）';
COMMENT ON COLUMN ai_api_keys.id IS '自增主键';
COMMENT ON COLUMN ai_api_keys.user_id IS '所属用户';
COMMENT ON COLUMN ai_api_keys.tenant_id IS '所属租户（可空）';
COMMENT ON COLUMN ai_api_keys.name IS '密钥名称（如 生产环境）';
COMMENT ON COLUMN ai_api_keys.key_prefix IS '密钥前缀（如 sk_live_，识别与展示用）';
COMMENT ON COLUMN ai_api_keys.key_hash IS '完整密钥 SHA-256 哈希';
COMMENT ON COLUMN ai_api_keys.scopes IS '权限范围（如 ["search:read"]）';
COMMENT ON COLUMN ai_api_keys.expires_at IS '过期时间（空=永不过期）';
COMMENT ON COLUMN ai_api_keys.last_used_at IS '最后使用时间';
COMMENT ON COLUMN ai_api_keys.revoked_at IS '吊销时间';
COMMENT ON COLUMN ai_api_keys.created_at IS '创建时间';
CREATE INDEX IF NOT EXISTS idx_apikeys_user ON ai_api_keys (user_id);
CREATE INDEX IF NOT EXISTS idx_apikeys_tenant ON ai_api_keys (tenant_id);

-- ──────────────────────────────────────────────
-- ai_oauth_bindings 第三方登录绑定
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_oauth_bindings (
  id                BIGSERIAL PRIMARY KEY,              -- 自增主键
  user_id           BIGINT NOT NULL REFERENCES ai_users(id) ON DELETE CASCADE, -- 关联用户
  provider          VARCHAR(32) NOT NULL,               -- 第三方平台（google/github/wechat/ldap）
  provider_user_id  VARCHAR(255) NOT NULL,              -- 第三方平台用户 ID
  provider_username VARCHAR(255),                       -- 第三方用户名
  provider_email    VARCHAR(255),                       -- 第三方邮箱
  access_token      TEXT,                               -- 第三方 Access Token（AES-256-GCM 加密存储）
  refresh_token     TEXT,                               -- 第三方 Refresh Token（AES-256-GCM 加密存储）
  token_expires_at  TIMESTAMP,                          -- Token 过期时间
  raw_data          JSONB,                              -- 原始用户信息
  created_at        TIMESTAMP DEFAULT NOW(),            -- 绑定时间
  updated_at        TIMESTAMP DEFAULT NOW(),            -- 更新时间
  CONSTRAINT uniq_ai_oauth_provider_user UNIQUE (provider, provider_user_id)
);
COMMENT ON TABLE ai_oauth_bindings IS '第三方登录绑定（Google/GitHub/企业微信等）';
COMMENT ON COLUMN ai_oauth_bindings.id IS '自增主键';
COMMENT ON COLUMN ai_oauth_bindings.user_id IS '关联用户';
COMMENT ON COLUMN ai_oauth_bindings.provider IS '第三方平台（google/github/wechat/ldap）';
COMMENT ON COLUMN ai_oauth_bindings.provider_user_id IS '第三方平台用户 ID';
COMMENT ON COLUMN ai_oauth_bindings.provider_username IS '第三方用户名';
COMMENT ON COLUMN ai_oauth_bindings.provider_email IS '第三方邮箱';
COMMENT ON COLUMN ai_oauth_bindings.access_token IS '第三方 Access Token（AES-256-GCM 加密存储）';
COMMENT ON COLUMN ai_oauth_bindings.refresh_token IS '第三方 Refresh Token（AES-256-GCM 加密存储）';
COMMENT ON COLUMN ai_oauth_bindings.token_expires_at IS 'Token 过期时间';
COMMENT ON COLUMN ai_oauth_bindings.raw_data IS '原始用户信息';
COMMENT ON COLUMN ai_oauth_bindings.created_at IS '绑定时间';
COMMENT ON COLUMN ai_oauth_bindings.updated_at IS '更新时间';
CREATE INDEX IF NOT EXISTS idx_oauth_user ON ai_oauth_bindings (user_id);
CREATE TRIGGER trg_ai_oauth_updated BEFORE UPDATE ON ai_oauth_bindings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ──────────────────────────────────────────────
-- ai_login_logs 登录日志
-- 用途：审计 & 安全分析（异地登录检测）
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_login_logs (
  id                 BIGSERIAL PRIMARY KEY,             -- 自增主键
  user_id            BIGINT NOT NULL REFERENCES ai_users(id) ON DELETE CASCADE, -- 用户 ID
  event_type         VARCHAR(32) NOT NULL,              -- 事件（login/logout/register/password_reset/mfa_verify）
  auth_method        VARCHAR(16) NOT NULL,              -- 认证方式（password/oauth/sms/api_key）
  ip_address         VARCHAR(64) NOT NULL,              -- 登录 IP
  user_agent         VARCHAR(500),                      -- UA 字符串
  device_fingerprint VARCHAR(64),                       -- 设备指纹
  status             SMALLINT NOT NULL,                 -- 结果（1=成功 0=失败）
  fail_reason        VARCHAR(128),                      -- 失败原因
  session_id         CHAR(36),                          -- 关联会话 ID
  created_at         TIMESTAMP DEFAULT NOW()            -- 记录时间
);
COMMENT ON TABLE ai_login_logs IS '登录日志：审计与安全分析（异地登录检测）';
COMMENT ON COLUMN ai_login_logs.id IS '自增主键';
COMMENT ON COLUMN ai_login_logs.user_id IS '用户 ID';
COMMENT ON COLUMN ai_login_logs.event_type IS '事件类型（login/logout/register/password_reset/mfa_verify）';
COMMENT ON COLUMN ai_login_logs.auth_method IS '认证方式（password/oauth/sms/api_key）';
COMMENT ON COLUMN ai_login_logs.ip_address IS '登录 IP';
COMMENT ON COLUMN ai_login_logs.user_agent IS 'UA 字符串';
COMMENT ON COLUMN ai_login_logs.device_fingerprint IS '设备指纹';
COMMENT ON COLUMN ai_login_logs.status IS '结果（1=成功 0=失败）';
COMMENT ON COLUMN ai_login_logs.fail_reason IS '失败原因';
COMMENT ON COLUMN ai_login_logs.session_id IS '关联会话 ID';
COMMENT ON COLUMN ai_login_logs.created_at IS '记录时间';
CREATE INDEX IF NOT EXISTS idx_login_user_event ON ai_login_logs (user_id, event_type, created_at);
CREATE INDEX IF NOT EXISTS idx_login_ip ON ai_login_logs (ip_address);
CREATE INDEX IF NOT EXISTS idx_login_created ON ai_login_logs (created_at);
