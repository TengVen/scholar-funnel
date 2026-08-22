-- ══════════════════════════════════════════════════════════
-- Scholar Funnel · PostgreSQL 迁移 DDL · 03 Agent 与会话域
-- 内容：agents / agent_versions / conversations / messages /
--       agent_runs / agent_steps
-- 核心设计（Agent 平台 vs 普通聊天）：
--   Message = 用户看到的内容
--   Agent Run = 一次 Agent 执行过程（可观测/可调试/可重试）
--   Agent Step = Run 内每个步骤（intent/decompose/retrieval/llm...）
--   system_prompt / model 下沉到 agent_versions / agent_runs
-- 向量（1024 维 = bge-large-zh-v1.5）：
--   conversations.memory_embedding 会话语义（语义召回历史会话）
--   agent_steps.output_embedding 步骤输出语义（RAG 记忆检索）
-- ══════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────
-- ai_agents Agent 定义（一类 Agent，如 Research Agent）
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_agents (
  id          BIGSERIAL PRIMARY KEY,                    -- Agent ID
  uuid        CHAR(32) NOT NULL UNIQUE,                 -- 对外 Agent ID
  name        VARCHAR(128) NOT NULL,                    -- Agent 名称（如 Research Agent）
  description TEXT,                                     -- 功能描述
  tenant_id   BIGINT REFERENCES ai_tenants(id),         -- 所属租户（可空=平台级）
  status      SMALLINT DEFAULT 1,                       -- 状态（0=停用 1=启用）
  created_at  TIMESTAMP DEFAULT NOW(),                  -- 创建时间
  updated_at  TIMESTAMP DEFAULT NOW()                   -- 更新时间
);
COMMENT ON TABLE ai_agents IS 'Agent 定义（一类 Agent 的元信息）';
COMMENT ON COLUMN ai_agents.id IS 'Agent ID';
COMMENT ON COLUMN ai_agents.uuid IS '对外 Agent ID';
COMMENT ON COLUMN ai_agents.name IS 'Agent 名称（如 Research Agent）';
COMMENT ON COLUMN ai_agents.description IS '功能描述';
COMMENT ON COLUMN ai_agents.tenant_id IS '所属租户（可空=平台级）';
COMMENT ON COLUMN ai_agents.status IS '状态（0=停用 1=启用）';
COMMENT ON COLUMN ai_agents.created_at IS '创建时间';
COMMENT ON COLUMN ai_agents.updated_at IS '更新时间';
CREATE TRIGGER trg_ai_agents_updated BEFORE UPDATE ON ai_agents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ──────────────────────────────────────────────
-- ai_agent_versions Agent 版本（不可变快照）
-- 用途：system_prompt/model/配置版本化——升级 Agent 不影响旧会话
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_agent_versions (
  id            BIGSERIAL PRIMARY KEY,                  -- 版本 ID
  agent_id      BIGINT NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE, -- 所属 Agent
  version       INT NOT NULL,                           -- 版本号（自增）
  system_prompt TEXT,                                   -- 系统提示词（不可变快照）
  model         VARCHAR(64),                            -- 默认模型
  provider      VARCHAR(32),                            -- 模型提供商（deepseek/openai/...）
  config        JSONB,                                  -- 版本配置（temperature/max_tokens/工具列表等）
  status        SMALLINT DEFAULT 0,                     -- 状态（0=草稿 1=已发布 2=已下线）
  created_at    TIMESTAMP DEFAULT NOW(),                -- 创建时间
  CONSTRAINT uniq_ai_agent_version UNIQUE (agent_id, version)
);
COMMENT ON TABLE ai_agent_versions IS 'Agent 版本：system_prompt/模型配置不可变快照（升级不影响旧会话）';
COMMENT ON COLUMN ai_agent_versions.id IS '版本 ID';
COMMENT ON COLUMN ai_agent_versions.agent_id IS '所属 Agent';
COMMENT ON COLUMN ai_agent_versions.version IS '版本号（自增）';
COMMENT ON COLUMN ai_agent_versions.system_prompt IS '系统提示词（不可变快照）';
COMMENT ON COLUMN ai_agent_versions.model IS '默认模型';
COMMENT ON COLUMN ai_agent_versions.provider IS '模型提供商（deepseek/openai 等）';
COMMENT ON COLUMN ai_agent_versions.config IS '版本配置（temperature/max_tokens/工具列表等）';
COMMENT ON COLUMN ai_agent_versions.status IS '状态（0=草稿 1=已发布 2=已下线）';
COMMENT ON COLUMN ai_agent_versions.created_at IS '创建时间';

-- ──────────────────────────────────────────────
-- ai_conversations 会话（Agent 核心）
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_conversations (
  id                 BIGSERIAL PRIMARY KEY,             -- 自增 ID
  uuid               CHAR(32) NOT NULL UNIQUE,          -- 对外会话 ID
  user_id            BIGINT NOT NULL REFERENCES ai_users(id) ON DELETE CASCADE, -- 所属用户
  tenant_id          BIGINT REFERENCES ai_tenants(id),  -- 所属租户（可空）
  title              VARCHAR(255),                      -- 会话标题（可 AI 自动生成）
  agent_id           BIGINT REFERENCES ai_agents(id),   -- 关联 Agent（升级不影响历史会话）
  agent_version_id   BIGINT REFERENCES ai_agent_versions(id), -- 关联 Agent 版本（运行时快照）
  status             SMALLINT DEFAULT 1,                -- 状态（0=归档 1=活跃 2=已删除）
  message_count      INT DEFAULT 0,                     -- 消息总数（缓存，减少 COUNT）
  token_usage_total  BIGINT DEFAULT 0,                  -- 累计 Token 消耗
  cost_total         DECIMAL(18,6) DEFAULT 0,           -- 累计费用
  is_pinned          BOOLEAN DEFAULT FALSE,             -- 是否置顶
  is_shared          BOOLEAN DEFAULT FALSE,             -- 是否开启分享
  share_uuid         CHAR(32) UNIQUE,                   -- 分享链接 UUID
  share_password     CHAR(64),                          -- 分享密码哈希
  share_expires_at   TIMESTAMP,                         -- 分享过期时间
  last_message_at    TIMESTAMP,                         -- 最后一条消息时间（排序用）
  created_at         TIMESTAMP DEFAULT NOW(),           -- 创建时间
  updated_at         TIMESTAMP DEFAULT NOW(),           -- 更新时间
  deleted_at         TIMESTAMP,                         -- 软删除
  memory_embedding   vector(1024)                       -- 会话级语义向量（标题+摘要生成，语义召回历史会话）
);
COMMENT ON TABLE ai_conversations IS '会话：Agent 每一次对话的容器（只关联 Agent 版本，不存 prompt/model）';
COMMENT ON COLUMN ai_conversations.id IS '自增 ID';
COMMENT ON COLUMN ai_conversations.uuid IS '对外会话 ID';
COMMENT ON COLUMN ai_conversations.user_id IS '所属用户';
COMMENT ON COLUMN ai_conversations.tenant_id IS '所属租户（可空）';
COMMENT ON COLUMN ai_conversations.title IS '会话标题（可 AI 自动生成）';
COMMENT ON COLUMN ai_conversations.agent_id IS '关联 Agent（升级不影响历史会话）';
COMMENT ON COLUMN ai_conversations.agent_version_id IS '关联 Agent 版本（运行时快照）';
COMMENT ON COLUMN ai_conversations.status IS '状态（0=归档 1=活跃 2=已删除）';
COMMENT ON COLUMN ai_conversations.message_count IS '消息总数（缓存，减少 COUNT 查询）';
COMMENT ON COLUMN ai_conversations.token_usage_total IS '累计 Token 消耗';
COMMENT ON COLUMN ai_conversations.cost_total IS '累计费用';
COMMENT ON COLUMN ai_conversations.is_pinned IS '是否置顶';
COMMENT ON COLUMN ai_conversations.is_shared IS '是否开启分享';
COMMENT ON COLUMN ai_conversations.share_uuid IS '分享链接 UUID';
COMMENT ON COLUMN ai_conversations.share_password IS '分享密码哈希';
COMMENT ON COLUMN ai_conversations.share_expires_at IS '分享过期时间';
COMMENT ON COLUMN ai_conversations.last_message_at IS '最后一条消息时间（排序用）';
COMMENT ON COLUMN ai_conversations.created_at IS '创建时间';
COMMENT ON COLUMN ai_conversations.updated_at IS '更新时间';
COMMENT ON COLUMN ai_conversations.deleted_at IS '软删除标记';
COMMENT ON COLUMN ai_conversations.memory_embedding IS '会话级语义向量 1024 维（语义召回历史会话）';
CREATE INDEX IF NOT EXISTS idx_ai_conv_user_status ON ai_conversations (user_id, status, last_message_at);
CREATE INDEX IF NOT EXISTS idx_ai_conv_tenant ON ai_conversations (tenant_id);
CREATE INDEX IF NOT EXISTS idx_ai_conv_agent ON ai_conversations (agent_id);
CREATE INDEX IF NOT EXISTS idx_ai_conv_deleted ON ai_conversations (deleted_at);
CREATE INDEX IF NOT EXISTS idx_ai_conv_share ON ai_conversations (share_uuid);
CREATE TRIGGER trg_ai_conversations_updated BEFORE UPDATE ON ai_conversations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ──────────────────────────────────────────────
-- ai_messages 消息（瘦身版：只存用户看到的内容）
-- 工具调用/Token/耗时已移入 agent_runs / agent_steps
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_messages (
  id               BIGSERIAL PRIMARY KEY,               -- 自增 ID
  uuid             CHAR(32) NOT NULL UNIQUE,            -- 对外消息 ID
  conversation_id  BIGINT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE, -- 所属会话
  user_id          BIGINT NOT NULL REFERENCES ai_users(id) ON DELETE CASCADE, -- 发送者用户
  parent_id        BIGINT REFERENCES ai_messages(id),   -- 父消息 ID（支持分支对话）
  role             VARCHAR(16) NOT NULL,                -- 角色（system/user/assistant/tool）
  content          TEXT,                                -- 消息内容（文本/Markdown）
  content_type     VARCHAR(16) DEFAULT 'text',          -- 内容类型（text/image/file/mixed）
  attachments      JSONB,                               -- 附件列表（URL/类型/大小）
  feedback         SMALLINT,                            -- 用户反馈（1=点赞 2=点踩）
  feedback_comment TEXT,                                -- 反馈备注
  is_error         BOOLEAN DEFAULT FALSE,               -- 是否错误消息
  error_code       VARCHAR(32),                         -- 错误码
  error_detail     TEXT,                                -- 错误详情
  created_at       TIMESTAMP DEFAULT NOW(),             -- 发送时间
  updated_at       TIMESTAMP DEFAULT NOW()              -- 更新时间
);
COMMENT ON TABLE ai_messages IS '消息：用户看到的对话内容（工具调用/Token/耗时已移入 run/step）';
COMMENT ON COLUMN ai_messages.id IS '自增 ID';
COMMENT ON COLUMN ai_messages.uuid IS '对外消息 ID';
COMMENT ON COLUMN ai_messages.conversation_id IS '所属会话';
COMMENT ON COLUMN ai_messages.user_id IS '发送者用户（AI 消息也关联创建者）';
COMMENT ON COLUMN ai_messages.parent_id IS '父消息 ID（支持分支对话）';
COMMENT ON COLUMN ai_messages.role IS '角色（system/user/assistant/tool）';
COMMENT ON COLUMN ai_messages.content IS '消息内容（文本/Markdown）';
COMMENT ON COLUMN ai_messages.content_type IS '内容类型（text/image/file/mixed）';
COMMENT ON COLUMN ai_messages.attachments IS '附件列表（URL/类型/大小）';
COMMENT ON COLUMN ai_messages.feedback IS '用户反馈（1=点赞 2=点踩）';
COMMENT ON COLUMN ai_messages.feedback_comment IS '反馈备注';
COMMENT ON COLUMN ai_messages.is_error IS '是否错误消息';
COMMENT ON COLUMN ai_messages.error_code IS '错误码';
COMMENT ON COLUMN ai_messages.error_detail IS '错误详情';
COMMENT ON COLUMN ai_messages.created_at IS '发送时间';
COMMENT ON COLUMN ai_messages.updated_at IS '更新时间';
CREATE INDEX IF NOT EXISTS idx_ai_msg_conv ON ai_messages (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_msg_user ON ai_messages (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_msg_parent ON ai_messages (parent_id);
CREATE TRIGGER trg_ai_messages_updated BEFORE UPDATE ON ai_messages
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ──────────────────────────────────────────────
-- ai_agent_runs Agent 执行记录（Run）
-- 用途：回答"为什么卡住/为什么慢/哪个 Agent 最耗 Token"；
--       统一承载 chat/branch/network 后台任务（替代内存 dict）
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_agent_runs (
  id               BIGSERIAL PRIMARY KEY,               -- 自增 ID
  uuid             CHAR(32) NOT NULL UNIQUE,            -- 对外 Run ID
  conversation_id  BIGINT REFERENCES ai_conversations(id) ON DELETE CASCADE, -- 所属会话
  message_id       BIGINT REFERENCES ai_messages(id),   -- 触发 Run 的消息
  agent_id         BIGINT REFERENCES ai_agents(id),     -- 执行 Agent
  agent_version_id BIGINT REFERENCES ai_agent_versions(id), -- Agent 版本快照
  run_type         VARCHAR(32) DEFAULT 'chat',          -- 类型（chat/trunk_search/gap_search/branch/network）
  status           VARCHAR(16) NOT NULL DEFAULT 'queued', -- 状态（queued/running/waiting/completed/failed/cancelled/timeout）
  idempotency_key  VARCHAR(100) UNIQUE,                 -- 幂等键（防重复提交）
  model            VARCHAR(64),                         -- 最终模型（多模型编排时记录主模型）
  provider         VARCHAR(32),                         -- 模型提供商
  input_tokens     INT DEFAULT 0,                       -- 输入 Token
  output_tokens    INT DEFAULT 0,                       -- 输出 Token
  total_tokens     INT DEFAULT 0,                       -- 总 Token
  latency_ms       INT,                                 -- 总耗时（毫秒）
  started_at       TIMESTAMP,                           -- 开始时间
  completed_at     TIMESTAMP,                           -- 完成时间
  error_code       VARCHAR(32),                         -- 错误码
  error_message    TEXT,                                -- 错误信息
  metadata         JSONB,                               -- 附加元数据（探针/分类/范围等）
  created_at       TIMESTAMP DEFAULT NOW()              -- 创建时间
);
COMMENT ON TABLE ai_agent_runs IS 'Agent 执行记录：一次用户请求的完整执行过程（可观测/可重试）';
COMMENT ON COLUMN ai_agent_runs.id IS '自增 ID';
COMMENT ON COLUMN ai_agent_runs.uuid IS '对外 Run ID';
COMMENT ON COLUMN ai_agent_runs.conversation_id IS '所属会话';
COMMENT ON COLUMN ai_agent_runs.message_id IS '触发 Run 的消息';
COMMENT ON COLUMN ai_agent_runs.agent_id IS '执行 Agent';
COMMENT ON COLUMN ai_agent_runs.agent_version_id IS 'Agent 版本快照';
COMMENT ON COLUMN ai_agent_runs.run_type IS '类型（chat/trunk_search/gap_search/branch/network）';
COMMENT ON COLUMN ai_agent_runs.status IS '状态（queued/running/waiting/completed/failed/cancelled/timeout）';
COMMENT ON COLUMN ai_agent_runs.idempotency_key IS '幂等键（防重复提交，UNIQUE）';
COMMENT ON COLUMN ai_agent_runs.model IS '主模型（多模型编排时记录最终模型）';
COMMENT ON COLUMN ai_agent_runs.provider IS '模型提供商';
COMMENT ON COLUMN ai_agent_runs.input_tokens IS '输入 Token';
COMMENT ON COLUMN ai_agent_runs.output_tokens IS '输出 Token';
COMMENT ON COLUMN ai_agent_runs.total_tokens IS '总 Token';
COMMENT ON COLUMN ai_agent_runs.latency_ms IS '总耗时（毫秒）';
COMMENT ON COLUMN ai_agent_runs.started_at IS '开始时间';
COMMENT ON COLUMN ai_agent_runs.completed_at IS '完成时间';
COMMENT ON COLUMN ai_agent_runs.error_code IS '错误码';
COMMENT ON COLUMN ai_agent_runs.error_message IS '错误信息';
COMMENT ON COLUMN ai_agent_runs.metadata IS '附加元数据（探针/分类/范围等）';
COMMENT ON COLUMN ai_agent_runs.created_at IS '创建时间';
CREATE INDEX IF NOT EXISTS idx_ai_runs_conv ON ai_agent_runs (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_runs_status ON ai_agent_runs (status, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_runs_user ON ai_agent_runs (agent_id, started_at);

-- ──────────────────────────────────────────────
-- ai_agent_steps Run 内步骤（Step）
-- 用途：Agent 可观测/调试——intent → decompose → retrieval → rerank → llm
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_agent_steps (
  id            BIGSERIAL PRIMARY KEY,                  -- 自增 ID
  run_id        BIGINT NOT NULL REFERENCES ai_agent_runs(id) ON DELETE CASCADE, -- 所属 Run
  step_index    INT NOT NULL,                           -- 步骤序号（1 起）
  step_type     VARCHAR(32) NOT NULL,                   -- 步骤类型（intent/decompose/retrieval/rerank/skeleton/probe/llm/tool）
  step_name     VARCHAR(64),                            -- 步骤名称（人类可读，如 "OpenAlex 召回"）
  input         JSONB,                                  -- 步骤输入（查询/参数，脱敏后）
  output        JSONB,                                  -- 步骤输出（结果摘要，不存全量）
  output_embedding vector(1024),                        -- 步骤输出语义向量（记忆检索用，可空）
  status        VARCHAR(16) NOT NULL DEFAULT 'running', -- 状态（running/completed/failed/skipped）
  model         VARCHAR(64),                            -- 该步骤使用的模型
  provider      VARCHAR(32),                            -- 该步骤模型提供商
  input_tokens  INT DEFAULT 0,                          -- 该步骤输入 Token
  output_tokens INT DEFAULT 0,                          -- 该步骤输出 Token
  latency_ms    INT,                                    -- 该步骤耗时（毫秒）
  started_at    TIMESTAMP,                              -- 开始时间
  completed_at  TIMESTAMP,                              -- 完成时间
  error_code    VARCHAR(32),                            -- 错误码
  error_message TEXT,                                   -- 错误信息
  metadata      JSONB                                   -- 附加元数据（检索数量/分数分布等）
);
COMMENT ON TABLE ai_agent_steps IS 'Agent 步骤：Run 内每个执行步骤（可观测/调试/重试）';
COMMENT ON COLUMN ai_agent_steps.id IS '自增 ID';
COMMENT ON COLUMN ai_agent_steps.run_id IS '所属 Run';
COMMENT ON COLUMN ai_agent_steps.step_index IS '步骤序号（1 起）';
COMMENT ON COLUMN ai_agent_steps.step_type IS '步骤类型（intent/decompose/retrieval/rerank/skeleton/probe/llm/tool）';
COMMENT ON COLUMN ai_agent_steps.step_name IS '步骤名称（人类可读，如 OpenAlex 召回）';
COMMENT ON COLUMN ai_agent_steps.input IS '步骤输入（脱敏后）';
COMMENT ON COLUMN ai_agent_steps.output IS '步骤输出摘要（不存全量）';
COMMENT ON COLUMN ai_agent_steps.output_embedding IS '步骤输出语义向量 1024 维（记忆检索，可空）';
COMMENT ON COLUMN ai_agent_steps.status IS '状态（running/completed/failed/skipped）';
COMMENT ON COLUMN ai_agent_steps.model IS '该步骤使用的模型';
COMMENT ON COLUMN ai_agent_steps.provider IS '该步骤模型提供商';
COMMENT ON COLUMN ai_agent_steps.input_tokens IS '该步骤输入 Token';
COMMENT ON COLUMN ai_agent_steps.output_tokens IS '该步骤输出 Token';
COMMENT ON COLUMN ai_agent_steps.latency_ms IS '该步骤耗时（毫秒）';
COMMENT ON COLUMN ai_agent_steps.started_at IS '开始时间';
COMMENT ON COLUMN ai_agent_steps.completed_at IS '完成时间';
COMMENT ON COLUMN ai_agent_steps.error_code IS '错误码';
COMMENT ON COLUMN ai_agent_steps.error_message IS '错误信息';
COMMENT ON COLUMN ai_agent_steps.metadata IS '附加元数据（检索数量/分数分布等）';
CREATE INDEX IF NOT EXISTS idx_ai_steps_run ON ai_agent_steps (run_id, step_index);
CREATE INDEX IF NOT EXISTS idx_ai_steps_type ON ai_agent_steps (step_type, started_at);
-- HNSW 向量索引（步骤输出记忆检索）
CREATE INDEX IF NOT EXISTS idx_ai_steps_embedding
  ON ai_agent_steps USING hnsw (output_embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
