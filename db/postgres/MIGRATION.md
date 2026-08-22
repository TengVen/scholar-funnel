# MySQL → PostgreSQL 全量迁移方案（v2 · Agent 平台化）

> 目标：业务数据全量迁到 PostgreSQL + pgvector（1024 维），
> 同时把架构从"用户系统"升级为"Agent 平台"（Run/Step 可观测模型）。
> 状态：DDL 已就绪（db/postgres/），迁移执行与代码切换待确认后动工。

---

## 1. 表前缀规范

| 前缀 | 含义 | 表 |
|------|------|-----|
| `sys_` | 系统级（框架/运维） | schema_versions / settings / audit_logs / security_events |
| `ai_`  | 业务级 | tenants / users / user_credentials / user_security / user_sessions / api_keys / oauth_bindings / login_logs / agents / agent_versions / conversations / messages / agent_runs / agent_steps / projects / papers / analysis_results / citations / code_repos / authors / cart |

## 2. 文件清单（按执行顺序）

| 文件 | 内容 |
|------|------|
| `00_init.sql` | pgvector / ENUM（ai_paper_stage / ai_confidence_level / ai_cart_category）/ updated_at 触发器函数 |
| `01_sys.sql` | 系统表：schema_versions / settings / audit_logs / security_events |
| `02_users.sql` | 用户域：tenants / users（纯净）/ user_credentials / user_security / user_sessions / api_keys / oauth_bindings / login_logs |
| `03_agents.sql` | Agent 域：agents / agent_versions / conversations（+向量）/ messages / agent_runs / agent_steps（+向量） |
| `04_core.sql` | 检索业务：projects / papers / analysis_results / citations / code_repos / authors / cart |

## 3. 核心设计说明

### 3.1 用户域拆分（users = 纯粹"这个人是谁"）
```
ai_users            身份：id/uuid/username/email/phone/nickname/avatar/status/tenant_id/preferences
ai_user_credentials 登录凭据：password_hash/salt
ai_user_security    安全状态：MFA/锁定/失败计数/登录统计
ai_user_sessions    登录会话（Access/Refresh 体系，独立）
ai_api_keys         开放 API（与登录会话分离，scope/过期/吊销）
```
- `user_preferences` **不单独建表**（users.preferences JSONB 足够）
- RBAC（roles/permissions/tenant_members）**延后**：等真实多租户需求再加，目前只留 tenant_id

### 3.2 Agent 可观测模型（评审核心）
```
ai_conversations → ai_messages → ai_agent_runs → ai_agent_steps
```
- **Message = 用户看到的内容**（已瘦身：无 tool_calls/token/latency）
- **Run = 一次 Agent 执行**：status/token/耗时/model/error/idempotency_key——统一承载 chat/branch/network 后台任务（替代内存 dict）
- **Step = Run 内每步**：intent/decompose/retrieval/rerank/llm，含每步 token/耗时/输出
- **tool_calls 不单独建表**（放 agent_steps.output JSONB，step 粒度已够）

### 3.3 版本化（升级不影响旧会话）
- `ai_agents` + `ai_agent_versions`：system_prompt/model/provider/config 落版本（不可变快照）
- `ai_conversations` 只存 `agent_id + agent_version_id`
- `ai_agent_runs` / `ai_agent_steps` 记录实际使用的 model/provider（多模型编排）

### 3.4 向量设计（1024 维 = bge-large-zh-v1.5）
| 列 | 位置 | 用途 |
|----|------|------|
| `memory_embedding` | conversations | 会话级语义（语义召回历史会话） |
| `output_embedding` | agent_steps | 步骤输出语义（Agent 长期记忆 RAG） |
- HNSW 索引（m=16, ef_construction=64, cosine）

### 3.5 系统表
- `sys_schema_versions`：迁移版本记录（防重复执行）
- `sys_settings`：运行时 KV 配置
- `sys_audit_logs` / `sys_security_events`：审计 + 风控

## 4. 迁移步骤

```bash
# Step 1: 建 PG 库 + 执行 DDL（按序）
createdb paper
psql -d paper -f db/postgres/00_init.sql
psql -d paper -f db/postgres/01_sys.sql
psql -d paper -f db/postgres/02_users.sql
psql -d paper -f db/postgres/03_agents.sql
psql -d paper -f db/postgres/04_core.sql

# Step 2: pgloader 数据迁移（MySQL 旧表 → PG 新表）
pgloader \
  mysql://root:123456@localhost:3306/paper \
  postgresql://postgres:123456@localhost:5432/paper
```

### pgloader 注意事项

| MySQL → PG | 处理方式 |
|---|---|
| `projects/papers/...` → `ai_projects/ai_papers/...` | 表名映射：pgloader 用 `ALTER SCHEMA` 或命令文件 `RENAME` |
| `BIGINT UNSIGNED` → `BIGINT` | 自动转换 |
| `JSON` → `JSONB` | 需 cast（pgloader 默认 json，后改 jsonb） |
| `DATETIME ON UPDATE` | DDL 已建 trigger，无需迁移 |
| ENUM → 新 ENUM 类型 | pgloader 按 VARCHAR 迁入 → 需 cast 或后处理 |

## 5. 代码切换点（迁移后执行）

| 文件 | 改动 |
|------|------|
| `utils/config.py` | `mysql_url` → `postgres_url`（`postgresql+psycopg2://...`） |
| `requirements.txt` | `pymysql` → `psycopg2-binary` |
| `storage/mysql_db.py` | 连接串 + `init_db()` 改为执行 `db/postgres/*.sql` |
| `storage/models.py` | 表名加 `ai_` 前缀 + Enum name 改 `ai_*`（对齐 DDL） |
| `db/mysql_legacy/` | MySQL 版 DDL 归档（历史保留，不再执行） |
| `api/routers/chat.py` | 内存 `_conversations` → `ai_conversations` 表（修 P2-9） |
| `api/routers/branch.py` / `network.py` | 内存 `_tasks` → `ai_agent_runs` 统一任务模型 |
| `agents/funnel/graph.py` | `MemorySaver` → `PostgresSaver`（langgraph-checkpoint-postgres） |

## 6. 验证清单

```sql
-- 表数量（4 系统 + 8 用户 + 6 Agent + 7 业务 = 25 张）
SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';

-- 数据量对比（与 MySQL 一致）
SELECT (SELECT count(*) FROM ai_projects) AS projects,
       (SELECT count(*) FROM ai_papers)   AS papers,
       (SELECT count(*) FROM ai_cart)     AS cart;

-- pgvector 就绪
SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';

-- 向量检索冒烟测试
SELECT id, content FROM ai_conversations
ORDER BY memory_embedding <=> '[0.1,...]'::vector LIMIT 5;
```

## 7. 风险与回滚

- **风险**：pgloader 表名映射 + ENUM/JSONB 类型转换需校验；数据量小（千级论文），分钟级完成
- **回滚**：PG 迁移后 MySQL 库保留只读，稳定后下线——天然双保险
- **表名变更**：`projects` → `ai_projects` 等，pgloader 命令文件里显式映射
