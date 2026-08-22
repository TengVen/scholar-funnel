# 生产级多用户高并发 Agent 项目 — 用户管理表设计

> 适用于支持多租户、高并发、长会话的 AI Agent 平台。

---

## 1. 用户主表 `users`

| 字段名 | 类型 | 约束 | 说明 |
|--------|------|------|------|
| `id` | `BIGINT UNSIGNED` | PK, AUTO_INCREMENT | 用户唯一标识，业务层不暴露 |
| `uuid` | `CHAR(32)` | UNIQUE, NOT NULL | 对外用户 ID（如 `usr_xxxxxxxx`），防遍历 |
| `username` | `VARCHAR(64)` | UNIQUE, NOT NULL | 用户名，支持登录 |
| `email` | `VARCHAR(255)` | UNIQUE, NULL | 邮箱，支持登录 & 找回密码 |
| `phone` | `VARCHAR(20)` | UNIQUE, NULL | 手机号，支持短信登录 |
| `password_hash` | `VARCHAR(255)` | NOT NULL | bcrypt/argon2 哈希，禁止明文存储 |
| `salt` | `VARCHAR(64)` | NULL | 独立盐值（如使用自定义哈希策略） |
| `nickname` | `VARCHAR(64)` | NULL | 展示昵称 |
| `avatar_url` | `VARCHAR(500)` | NULL | 头像 CDN 地址 |
| `status` | `TINYINT` | DEFAULT 1 | `0=禁用 1=正常 2=待验证 3=锁定` |
| `role` | `VARCHAR(32)` | DEFAULT 'user' | `user / admin / super_admin` |
| `tenant_id` | `BIGINT UNSIGNED` | INDEX, NULL | 多租户隔离字段 |
| `last_login_at` | `DATETIME` | NULL | 最后登录时间 |
| `last_login_ip` | `VARCHAR(64)` | NULL | 最后登录 IP |
| `login_fail_count` | `INT` | DEFAULT 0 | 连续登录失败次数（防暴力破解） |
| `locked_until` | `DATETIME` | NULL | 账号锁定截止时间 |
| `email_verified_at` | `DATETIME` | NULL | 邮箱验证时间 |
| `phone_verified_at` | `DATETIME` | NULL | 手机验证时间 |
| `mfa_enabled` | `BOOLEAN` | DEFAULT FALSE | 是否开启多因素认证 |
| `mfa_secret` | `VARCHAR(64)` | NULL | MFA 密钥（加密存储） |
| `preferences` | `JSON` | NULL | 用户偏好设置（主题、语言等） |
| `created_at` | `DATETIME` | DEFAULT NOW() | 注册时间 |
| `updated_at` | `DATETIME` | ON UPDATE NOW() | 更新时间 |
| `deleted_at` | `DATETIME` | NULL, INDEX | 软删除标记 |

**索引建议：**
```sql
PRIMARY KEY (`id`),
UNIQUE KEY `uk_uuid` (`uuid`),
UNIQUE KEY `uk_username` (`username`),
UNIQUE KEY `uk_email` (`email`),
UNIQUE KEY `uk_phone` (`phone`),
KEY `idx_tenant_status` (`tenant_id`, `status`),
KEY `idx_deleted_at` (`deleted_at`)
```

---

## 2. 认证与令牌表 `auth_tokens`

> 管理 Access Token / Refresh Token，支持多端登录、Token 吊销。

| 字段名 | 类型 | 约束 | 说明 |
|--------|------|------|------|
| `id` | `BIGINT UNSIGNED` | PK, AUTO_INCREMENT | 自增 ID |
| `user_id` | `BIGINT UNSIGNED` | FK → users.id, NOT NULL | 关联用户 |
| `token_type` | `VARCHAR(16)` | NOT NULL | `access` / `refresh` / `api_key` |
| `token_hash` | `CHAR(64)` | UNIQUE, NOT NULL | Token SHA-256 哈希（不存原始 Token） |
| `jti` | `CHAR(36)` | UNIQUE, NULL | JWT ID，用于唯一标识和吊销 |
| `device_id` | `VARCHAR(64)` | NULL | 设备指纹/ID |
| `device_name` | `VARCHAR(128)` | NULL | 设备名称（如 "iPhone 15"） |
| `ip_address` | `VARCHAR(64)` | NULL | 签发 IP |
| `user_agent` | `VARCHAR(500)` | NULL | 浏览器 UA |
| `expires_at` | `DATETIME` | NOT NULL | 过期时间 |
| `revoked_at` | `DATETIME` | NULL | 吊销时间 |
| `created_at` | `DATETIME` | DEFAULT NOW() | 签发时间 |

**索引建议：**
```sql
PRIMARY KEY (`id`),
UNIQUE KEY `uk_token_hash` (`token_hash`),
UNIQUE KEY `uk_jti` (`jti`),
KEY `idx_user_type` (`user_id`, `token_type`),
KEY `idx_expires` (`expires_at`),
KEY `idx_revoked` (`revoked_at`)
```

---

## 3. 会话表 `conversations`（Agent 核心）

> Agent 的每一次对话会话，支持多轮对话、会话归档、分享。

| 字段名 | 类型 | 约束 | 说明 |
|--------|------|------|------|
| `id` | `BIGINT UNSIGNED` | PK, AUTO_INCREMENT | 自增 ID |
| `uuid` | `CHAR(32)` | UNIQUE, NOT NULL | 对外会话 ID |
| `user_id` | `BIGINT UNSIGNED` | FK → users.id, NOT NULL | 所属用户 |
| `tenant_id` | `BIGINT UNSIGNED` | INDEX, NULL | 多租户隔离 |
| `title` | `VARCHAR(255)` | NULL | 会话标题（可 AI 自动生成） |
| `model` | `VARCHAR(64)` | NOT NULL | 使用的模型（如 `gpt-4o`） |
| `system_prompt` | `TEXT` | NULL | 该会话的系统提示词 |
| `agent_id` | `BIGINT UNSIGNED` | FK, NULL | 关联的 Agent 配置 ID |
| `status` | `TINYINT` | DEFAULT 1 | `0=归档 1=活跃 2=已删除` |
| `message_count` | `INT UNSIGNED` | DEFAULT 0 | 消息总数（缓存，减少 COUNT 查询） |
| `token_usage_total` | `BIGINT UNSIGNED` | DEFAULT 0 | 累计 Token 消耗 |
| `cost_total` | `DECIMAL(18,6)` | DEFAULT 0.000000 | 累计费用（美元/人民币） |
| `is_pinned` | `BOOLEAN` | DEFAULT FALSE | 是否置顶 |
| `is_shared` | `BOOLEAN` | DEFAULT FALSE | 是否开启分享 |
| `share_uuid` | `CHAR(32)` | UNIQUE, NULL | 分享链接 UUID |
| `share_password` | `CHAR(64)` | NULL | 分享密码哈希 |
| `share_expires_at` | `DATETIME` | NULL | 分享过期时间 |
| `last_message_at` | `DATETIME` | INDEX, NULL | 最后一条消息时间（排序用） |
| `created_at` | `DATETIME` | DEFAULT NOW() | 创建时间 |
| `updated_at` | `DATETIME` | ON UPDATE NOW() | 更新时间 |
| `deleted_at` | `DATETIME` | NULL, INDEX | 软删除 |

**索引建议：**
```sql
PRIMARY KEY (`id`),
UNIQUE KEY `uk_uuid` (`uuid`),
UNIQUE KEY `uk_share_uuid` (`share_uuid`),
KEY `idx_user_status_lastmsg` (`user_id`, `status`, `last_message_at`),
KEY `idx_tenant` (`tenant_id`),
KEY `idx_agent` (`agent_id`),
KEY `idx_deleted_at` (`deleted_at`)
```

---

## 4. 消息表 `messages`

> 会话内的单条消息，支持用户/AI/工具调用。

| 字段名 | 类型 | 约束 | 说明 |
|--------|------|------|------|
| `id` | `BIGINT UNSIGNED` | PK, AUTO_INCREMENT | 自增 ID |
| `uuid` | `CHAR(32)` | UNIQUE, NOT NULL | 对外消息 ID |
| `conversation_id` | `BIGINT UNSIGNED` | FK → conversations.id, NOT NULL | 所属会话 |
| `user_id` | `BIGINT UNSIGNED` | FK → users.id, NOT NULL | 发送者用户（AI 消息也关联创建者） |
| `parent_id` | `BIGINT UNSIGNED` | FK → messages.id, NULL | 父消息 ID（支持分支对话） |
| `role` | `VARCHAR(16)` | NOT NULL | `system` / `user` / `assistant` / `tool` |
| `content` | `LONGTEXT` | NULL | 消息内容（文本/Markdown） |
| `content_type` | `VARCHAR(16)` | DEFAULT 'text' | `text` / `image` / `file` / `mixed` |
| `attachments` | `JSON` | NULL | 附件列表（URL、类型、大小） |
| `model` | `VARCHAR(64)` | NULL | 生成该消息的模型 |
| `prompt_tokens` | `INT UNSIGNED` | DEFAULT 0 | 输入 Token 数 |
| `completion_tokens` | `INT UNSIGNED` | DEFAULT 0 | 输出 Token 数 |
| `total_tokens` | `INT UNSIGNED` | DEFAULT 0 | 总 Token 数 |
| `latency_ms` | `INT UNSIGNED` | DEFAULT 0 | 响应延迟（毫秒） |
| `finish_reason` | `VARCHAR(16)` | NULL | `stop` / `length` / `error` |
| `tool_calls` | `JSON` | NULL | 工具调用记录（Agent 核心） |
| `tool_results` | `JSON` | NULL | 工具执行结果 |
| `feedback` | `TINYINT` | NULL | `1=点赞 2=点踩` |
| `feedback_comment` | `TEXT` | NULL | 反馈备注 |
| `is_error` | `BOOLEAN` | DEFAULT FALSE | 是否为错误消息 |
| `error_code` | `VARCHAR(32)` | NULL | 错误码 |
| `error_detail` | `TEXT` | NULL | 错误详情 |
| `created_at` | `DATETIME` | DEFAULT NOW() | 发送时间 |
| `updated_at` | `DATETIME` | ON UPDATE NOW() | 更新时间 |

**索引建议：**
```sql
PRIMARY KEY (`id`),
UNIQUE KEY `uk_uuid` (`uuid`),
KEY `idx_conversation_created` (`conversation_id`, `created_at`),
KEY `idx_user_created` (`user_id`, `created_at`),
KEY `idx_parent` (`parent_id`)
```

> **高并发优化：** 消息表数据量极大，建议按 `user_id` 或 `created_at` 分表/分区。

---

## 5. 登录日志表 `login_logs`

> 审计 & 安全分析，支持异地登录检测。

| 字段名 | 类型 | 约束 | 说明 |
|--------|------|------|------|
| `id` | `BIGINT UNSIGNED` | PK, AUTO_INCREMENT | 自增 ID |
| `user_id` | `BIGINT UNSIGNED` | FK → users.id, NOT NULL | 用户 ID |
| `event_type` | `VARCHAR(32)` | NOT NULL | `login` / `logout` / `register` / `password_reset` / `mfa_verify` |
| `auth_method` | `VARCHAR(16)` | NOT NULL | `password` / `oauth` / `sms` / `api_key` |
| `ip_address` | `VARCHAR(64)` | NOT NULL | 登录 IP |
| `ip_geo` | `VARCHAR(255)` | NULL | IP 地理位置（JSON） |
| `user_agent` | `VARCHAR(500)` | NULL | UA 字符串 |
| `device_fingerprint` | `VARCHAR(64)` | NULL | 设备指纹 |
| `status` | `TINYINT` | NOT NULL | `1=成功 0=失败` |
| `fail_reason` | `VARCHAR(128)` | NULL | 失败原因 |
| `token_jti` | `CHAR(36)` | NULL | 关联的 Token JTI |
| `created_at` | `DATETIME` | DEFAULT NOW() | 记录时间 |

**索引建议：**
```sql
PRIMARY KEY (`id`),
KEY `idx_user_event` (`user_id`, `event_type`, `created_at`),
KEY `idx_ip` (`ip_address`),
KEY `idx_created` (`created_at`)
```

> **高并发优化：** 写入密集型，建议使用 ClickHouse / 日志型数据库，或异步写入。

---

## 6. OAuth 绑定表 `oauth_bindings`

> 支持第三方登录（Google/GitHub/企业微信等）。

| 字段名 | 类型 | 约束 | 说明 |
|--------|------|------|------|
| `id` | `BIGINT UNSIGNED` | PK, AUTO_INCREMENT | 自增 ID |
| `user_id` | `BIGINT UNSIGNED` | FK → users.id, NOT NULL | 关联用户 |
| `provider` | `VARCHAR(32)` | NOT NULL | `google` / `github` / `wechat` / `ldap` |
| `provider_user_id` | `VARCHAR(255)` | NOT NULL | 第三方平台用户 ID |
| `provider_username` | `VARCHAR(255)` | NULL | 第三方用户名 |
| `provider_email` | `VARCHAR(255)` | NULL | 第三方邮箱 |
| `access_token` | `TEXT` | NULL | 第三方 Access Token（加密存储） |
| `refresh_token` | `TEXT` | NULL | 第三方 Refresh Token（加密存储） |
| `token_expires_at` | `DATETIME` | NULL | Token 过期时间 |
| `raw_data` | `JSON` | NULL | 原始用户信息 |
| `created_at` | `DATETIME` | DEFAULT NOW() | 绑定时间 |
| `updated_at` | `DATETIME` | ON UPDATE NOW() | 更新时间 |

**索引建议：**
```sql
PRIMARY KEY (`id`),
UNIQUE KEY `uk_provider_user` (`provider`, `provider_user_id`),
KEY `idx_user` (`user_id`)
```

---

## 7. 缓存层设计（Redis）

| Key 模式 | 类型 | TTL | 说明 |
|----------|------|-----|------|
| `user:session:{token_hash}` | Hash / String | 2h | 登录态缓存，存 `user_id`, `role`, `tenant_id` |
| `user:profile:{user_id}` | Hash | 1h | 用户基础信息缓存 |
| `user:rate_limit:{user_id}` | String / ZSet | 1min | 限流计数（如 60 req/min） |
| `conv:list:{user_id}` | Sorted Set | 10min | 用户会话列表（按 `last_message_at` 排序） |
| `conv:context:{conversation_id}` | List / JSON | 24h | 会话上下文缓存（最近 N 条消息） |
| `conv:lock:{conversation_id}` | String | 30s | 分布式锁，防止并发消息重复提交 |
| `agent:config:{agent_id}` | Hash | 1h | Agent 配置缓存 |
| `mfa:code:{user_id}` | String | 5min | MFA 验证码临时存储 |
| `login:fail:{ip}` | String | 15min | IP 登录失败计数，防暴力破解 |
| `captcha:{uuid}` | String | 5min | 图形验证码缓存 |

---

## 8. 高并发架构建议

### 8.1 数据库层
- **读写分离：** 查询走从库，写入走主库。
- **分表策略：** `messages` 按 `user_id % 128` 或按时间月份分表；`login_logs` 独立日志库。
- **连接池：** HikariCP / PgBouncer，连接数 = `(core_count * 2) + effective_spindle_count`。
- **索引优化：** 避免过多索引，写入频繁的表减少二级索引。

### 8.2 缓存层
- **多级缓存：** L1（Caffeine 本地缓存，1min）→ L2（Redis 集群，1h）。
- **缓存穿透/击穿：** 布隆过滤器 + 互斥锁。
- **会话状态：** JWT Stateless 为主，黑名单模式存 Redis（吊销 Token）。

### 8.3 限流与熔断
- **用户级限流：** 基于 Redis 滑动窗口，免费用户 20 req/min，付费用户 100 req/min。
- **IP 级限流：** 防止恶意注册/爬虫。
- **Agent 调用限流：** 对接 LLM API 时加熔断器（如 Resilience4j）。

### 8.4 安全
- **密码策略：** Argon2id / bcrypt，cost ≥ 10。
- **敏感字段加密：** `mfa_secret`、`access_token` 使用 AES-256-GCM 加密存储。
- **SQL 注入：** 全参数化查询，ORM 框架。
- **审计日志：** 所有敏感操作（改密、删号、改权限）必须记录。

---

## 9. ER 关系简图

```
users (1) ──────< (N) auth_tokens
    │
    ├──────< (N) oauth_bindings
    │
    ├──────< (N) conversations ──────< (N) messages
    │                                      │
    │                                      └── parent_id (自关联)
    │
    └──────< (N) login_logs
```

---

> 以上设计可根据实际业务规模调整字段粒度。初期可合并部分表，数据量增长后按上述方案拆分。
