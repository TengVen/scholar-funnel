# CODEBASE_AUDIT — Scholar Funnel 代码现状地图

> 审计日期：2026-08-31
> 审计范围：全项目（backend 运行时代码 + frontend/src + scripts + db + 配置）
> 审计性质：**只读**。本次未修改任何一行代码。
> 前置说明：本文只陈述事实与有把握的判断，不含重构方案（方案见后续 `REFACTOR_PLAN.md`）。所有结论均附 `路径:行号` 证据；把握不足的条目显式标注「待确认」。

---

## 0. 基线数据

| 项 | 数值 |
|---|---|
| 后端运行时 py 文件 | 66 个 / 13,039 行 |
| 后端 scripts/ | 12 个 / 1,672 行 |
| 前端 src（.ts/.tsx） | 67 个 / 9,324 行 |
| 前端 CSS | globals.css 283 行 |
| API 路由模块 | 12 个（api/main.py:50-61 注册） |
| Pydantic 模型 | api/schemas.py 34 个 ＋ router 内联 13 个（分布在 6 个文件） |
| 数据库 | **PostgreSQL + pgvector**（迁移文件 21 个，db/postgres/） |
| 前端框架 | Next.js 14.2 App Router + React 18.3 + TS 5.4（strict: true） |
| git 状态 | 工作区干净，HEAD = `30c8d37 新增论文详情页-系统变更关键节点` |

**关键元事实（容易被文件名误导，务必记住）：**
- `storage/mysql_db.py` 名为 mysql，**实际内部是 psycopg3 + PostgreSQL**（见 db/postgres/ 迁移目录）。这是历史遗留文件名，不是 MySQL 代码。
- `frontend/src/app/paper/[id]`、`[openalex_id]` 是 **Next.js 动态路由**，方括号为框架强制命名，**不属于待清理的异常命名**。

---

## 1. 当前目录结构

### 1.1 后端（项目根）

```
api/                     FastAPI 层
├── main.py              应用装配、CORS、限流中间件、路由注册（66 行）
├── schemas.py           34 个 Pydantic 模型（384 行）
└── routers/             12 个路由模块
    ├── auth.py  projects.py  papers.py  search.py  cart.py
    ├── branch.py  network.py  chat.py  funnel.py
    └── settings.py  admin.py  announcements.py

agents/                   业务编排层（"Agent"语义混乱，见 §3 P1-1）
├── branch.py             898 行 — 分支深挖（最大文件）
├── chat_agent.py         657 行 — 对话 agent + 工具集
├── network.py            405 行 — 引用网络
├── paper_analysis.py     219 行 — 论文深度分析
├── structure.py           90 行 — L2 认知结构
├── search.py              25 行 — 兼容壳（**疑似无引用**）
└── funnel/               LangGraph 漏斗（intent→trunk→skeleton→probe）
    ├── graph.py (650)  state.py  intent_agent.py
    ├── skeleton_agent.py  probe_agent.py  tools.py

retrieval/                检索核心链路
├── pipeline.py           647 行 — TrunkSearchEngine（主编排）
├── lexical.py            181 行 — 四路召回
├── reranker.py           203 行 — BGE 重排
├── scorer.py              42 行 — 评分
├── embedding.py          135 行 — 向量化
├── decomposer.py          80 行 — Query 拆解
├── intent.py              41 行
└── __init__.py            7 行 — **import 即实例化副作用**（见 §3 P2-4）

sources/                  外部数据源
├── openalex.py           642 行 — OpenAlex 主源 + PDF/XML 兜底链
├── pdf_structure.py      321 行 — PDF 分节
├── pdf_cache.py           78 行 — PDF 落盘缓存
└── tei_parse.py           69 行 — GROBID TEI 解析

storage/                  **命名与职责严重不符的目录**（见 §3 P1-2）
├── models.py             400 行 — 19 张表 ORM
├── mysql_db.py           169 行 — 实为 PostgreSQL 连接 + 迁移执行
├── cart.py               515 行 — 骨架清单（含 LLM 调用）
├── vector_store.py       317 行 — pgvector 语义检索
├── papers.py              61 行
└── judgments.py          129 行 — 人工判断（排除/采纳）

llm/client.py             212 行 — LLM 唯一封装
prompt/                   11 个文件 — Prompt 模板
utils/                     7 个文件 — config / auth / log / ratelimit / request_log / task_guard / api_post
```

### 1.2 前端（frontend/src）

```
app/
├── page.tsx              523 行 — **上帝页面**（5 tab 路由 + 全量 store 编排）
├── layout.tsx  globals.css(283)
└── paper/[id]/page.tsx  paper/openalex/[openalex_id]/page.tsx

components/               8 个业务子目录，24 个组件
├── branch/(4)  cart/(2)  chat/(7)  common/(2)  layout/(1)
├── network/(1)  paper/(6)  search/(5)
config/                   8 个纯静态数据文件（nav/categories/keywords/chat/search/branch/storage）
hooks/                    4 个（useTaskPolling / useAuth / useAnnouncements / useLocalStorageConfig）
lib/
├── http.ts               120 行 — 唯一传输层（**纪律良好**）
├── api/                  8 个领域 API 文件
├── chart/networkChart.ts 122 行
└── auth.ts  tokenStore.ts  toast.ts  utils.ts
stores/                   5 个 zustand（project/cart/auth/branch/network）
types/                    dto.ts(667) / domain.ts / api.ts
```

### 1.3 数据、脚本与文档

| 目录 | 现状 |
|---|---|
| `db/postgres/` | 21 个迁移 SQL + MIGRATION.md（**当前有效**） |
| `db/mysql_legacy/` | 01_schema.sql / 02_migrations.sql — MySQL 时代残留 |
| `db/public.sql` | **3.6 MB 一次性全量 dump**，混入仓库 |
| `db/agent_user_management_schema.md` | 12.8 KB 设计文档 |
| `scripts/` | 12 个脚本，混杂 4 类职责（见 §3 P2-6） |
| `md/` | 20 篇历史文档，含 4 篇历史审计报告 |
| `apiTest/` | 13 个 json + 2 个 bin + safetensors，游离在仓库 |

---

## 2. 模块职责地图

### 2.1 后端模块

| 模块 | 当前职责 | 被谁调用 | 职责越界 |
|---|---|---|---|
| `api/main.py` | 应用装配、中间件、路由注册 | 入口 | 否 ✅ |
| `api/schemas.py` | 34 个 Pydantic 模型 | 5 个 router | 否，但**不完整**（另 13 个散落 router） ⚠️ |
| `api/routers/*` | 参数接收 + 调用 service | main.py | **是** — 见下 |
| `agents/*` | 业务编排 | router | **是** — 见下 |
| `agents/funnel/*` | LangGraph 漏斗 | chat_agent / router/funnel | 否 ✅ |
| `retrieval/*` | 检索核心链路 | pipeline / chat_agent / router | 否 ✅（分层最干净的区域） |
| `sources/*` | 外部数据源 | 6 个模块 | 轻微（openalex.py 自带 .env 加载）⚠️ |
| `storage/*` | 数据访问 | 全仓 | **严重** — 见下 |
| `llm/client.py` | LLM 唯一封装 | 12 处 | 否 ✅（唯一来源，无绕过） |
| `prompt/*` | Prompt 模板 | 对应 agent | 否 ✅ |
| `utils/*` | 基础设施 | 全仓 | 否 ✅（职责清晰，无万能文件） |

**越界详情：**

1. **`storage/cart.py` 越界依赖 LLM 与 Prompt**
   - `storage/cart.py:11` `from llm import client as llm`
   - `storage/cart.py:12` `from prompt.cart import CLASSIFY_PROMPT, DIAGNOSE_PROMPT`
   - `storage/cart.py:363` / `431` 直接 `llm.chat_json(...)` 调模型
   - 数据访问层反向依赖业务/AI 层；且该文件 515 行里同时装了「限额校验（26-58）、CRUD（74-317）、AI 分类（318-381）、AI 诊断（382-458）、BibTeX 导出（459-496）」**5 类职责**。

2. **Router 内嵌业务逻辑**
   - `api/routers/papers.py:448 _answer_question` — 论文问答的 LLM 编排（40 行）
   - `api/routers/papers.py:59 list_papers` — 123 行的列表查询 + 排序 + 过滤逻辑
   - `api/routers/cart.py:29 _rule_fallback` — AI 分类的规则兜底实现
   - `api/routers/chat.py:373 _generate_summary` — 摘要生成
   - `api/routers/chat.py:251 finalize_deep_research` — 122 行

3. **Router 内嵌异步任务脚手架（4 套各自实现）**
   - `api/routers/branch.py:27` `_tasks: dict[str, dict] = {}`
   - `api/routers/network.py:30` `_tasks: dict[str, dict] = {}`
   - `api/routers/search.py:31` `_trunk_tasks: dict[str, dict] = {}`
   - `api/routers/funnel.py` 走 DB checkpoint（第四套机制）

### 2.2 前端模块

| 模块 | 当前职责 | 评价 |
|---|---|---|
| `lib/http.ts` | 唯一传输层（refresh / 401 / 错误归一化） | ✅ 纪律极好，**全仓 0 处绕过** |
| `lib/api/*` | 按领域拆分 8 文件 | ✅ 基本合理，2 处归属错误（见 §3 P3-2） |
| `types/dto.ts` | 后端 DTO 映射 | ✅ 边界清晰 |
| `types/domain.ts` | 领域联合类型 | ✅ |
| `types/api.ts` | 仅 `ApiEnvelope<T>` 1 个导出 | ⚠️ 27 行文件装 1 个接口 |
| `config/*` | 纯静态数据 | ✅ 已是单一来源（注释明确记录曾 ×2/×3 散落） |
| `hooks/*` | 4 个，均为真 hook | ✅ 无工具函数伪装 |
| `stores/*` | 5 个 zustand | ✅ 无重复状态持有（**待确认**，见 §7） |
| `components/*` | 8 个业务域 | ⚠️ 见 §3 P1-4 / P2-3 |
| `app/page.tsx` | 523 行上帝页面 | ⚠️ 见 §3 P1-3 |

---

## 3. 问题清单

### P0 — 可能影响运行/功能

> **本次审计未发现 P0 级缺陷。**
> 已核查的高危项结论：
> - 循环依赖：**无**（逐条核验 `agents.search` / `agents.funnel.graph` / `storage.vector_store` / `utils.task_guard` 的疑似自引用均为 sed 误报）
> - 跨层反向依赖：仅 `storage/cart.py → llm/prompt` 一处，且为单向，不构成环
> - 路由顺序：`papers.py:488 /{paper_id}` 位于 `/transient`(257) `/pdf`(286) `/explore`(304) 之后 ✅；`cart.py:264 /{paper_id}` 位于 `/export/bibtex`(243) `/diagnose`(256) 之后 ✅
> - 运行时 `print()`：**0 处**（全部集中在 scripts/）
> - 裸 `except:` / `except Exception:` 在运行时代码：**未发现异常使用**
> - 前端 `any`：**0 处**；`localStorage` 仅 3 处且均在 hook/tokenStore 内

### P1 — 严重结构问题

**P1-1 `/agents/` 目录名与内容语义不符（历史遗留 + 新代码混杂）**
`agents/` 下 7 个模块里有 6 个**不是 agent**，而是普通 service：
- `agents/branch.py`（分支分析 service）、`agents/network.py`（引用网络 service）、`agents/paper_analysis.py`（论文分析 service）、`agents/structure.py`（认知结构 service）、`agents/search.py`（转发壳）、`agents/funnel/tools.py`（工具函数）
- 只有 `agents/chat_agent.py` 与 `agents/funnel/*`（LangGraph）是真 agent
→ 开发者按目录名找「Agent 在哪」会找错地方，**直接违反任务书第十八条第 6 点**。

**P1-2 `/storage/` 目录名与三层严重不符**
- 文件名 `mysql_db.py` 实为 PostgreSQL（历史遗留）
- `storage/cart.py` 内含 LLM 调用与 5 类职责（见 §2.1）
- `storage/vector_store.py` 含语义检索算法（embedding 召回、去重），并非纯数据访问
→ 违反任务书第十八条第 5 点「数据库访问在哪里」。

**P1-3 前端 `app/page.tsx` 是上帝页面（523 行）**
`app/page.tsx:30-52` 单个组件订阅了 projectStore 的 **18 个字段**，同时承担：
tab 路由状态、项目/会话 store 编排、5 个业务面板的 props 组装、toast 调用。
→ 违反 AGENTS.md 第 5 节「组件职责单一 / 状态与业务逻辑分离」。

**P1-4 后端 router 层 4 套重复的异步任务脚手架**
`branch.py` / `network.py` / `search.py` 各自实现「内存 dict + threading.Thread + status 端点 + result 端点 + owner 校验」，`funnel.py` 另走 DB checkpoint。
新增一个异步接口需要复制 5 个函数。

### P2 — 可维护性问题

**P2-1 项目归属校验 4 处实现**
| 实现 | 位置 | 行为 |
|---|---|---|
| A | `utils/auth.py:126 get_owned_project` | 权威实现 |
| B | `api/routers/projects.py:32 _get_owned_project` | 重复实现，**已核实与 A 行为完全一致**（同为 `session.get` + 404「项目不存在」）；唯一差异是 A 用函数内延迟 import 规避循环依赖 |
| C | `search.py:22` / `branch.py:18` / `network.py:21` `_check` | 三份**逐字符相同**：设 mailto + 调 A |

**P2-2 task 归属校验 3 处逐字符相同**
`branch.py:115` / `network.py:106` / `chat.py:156` `_assert_task_owner` — 函数体完全一致（4 行）。

**P2-3 Pydantic 模型分散在 2 处**
`api/schemas.py`（34 个）＋ 6 个 router 内联 13 个：
`admin.py:24,28,32`、`announcements.py:25`、`auth.py:32,38,43,47,215`、`funnel.py:34,62`、`projects.py:16`、`settings.py:18`
→ 找「某接口的请求体定义」需先猜它在哪个文件。

**P2-4 `retrieval/__init__.py` 存在 import 副作用**
`retrieval/__init__.py:5` `from retrieval.pipeline import TrunkSearchEngine`
→ 任何 `import retrieval.xxx` 都会连带加载 pipeline 及其全部依赖（LLM/embedding/vector_store）。放大冷启动与循环依赖风险。

**P2-5 骨架类别限额存在 4 处定义（语义各不相同，见 §4 详析）**
`storage/cart.py:17`、`agents/funnel/tools.py:122`、`config/categories.ts:11`、`config/categories.ts` 的 `limit` 被 `CartDetail.tsx:63-65` 当默认值。

**P2-6 `scripts/` 混杂 4 类职责，无 `tests/` 目录**
| 类别 | 文件 |
|---|---|
| 一次性迁移/回填 | `migrate_mysql_to_pg.py`、`backfill_latex.py` |
| 调试/对比实验 | `compare_grobid_vs_pymupdf.py`(274)、`sim_pdf_pipeline.py`、`sim_pdf_sections.py`、`pdf_section_extractor.py`、`verify_embedding.py` |
| 测试（无框架，脚本式） | `test_integration.py`、`test_lexical_filters.py`、`test_log_db.py`、`test_prompt_cross_domain.py`(296) |
| 压测 | `smoke_load.py`(359) |

**P2-7 数据库物料混入仓库**
- `db/public.sql` 3.6 MB 一次性 dump
- `db/mysql_legacy/`（2 个文件）MySQL 时代残留，项目已迁 PG
- `apiTest/` 13 个 json + 2 个 bin + 1 个 safetensors 游离

**P2-8 前端超大组件（>300 行）与内联复杂计算**
| 文件 | 行数 | 内联非 JSX 计算 |
|---|---|---|
| `components/cart/CartDetail.tsx` | 708 | 限额计算、分组、BibTeX、AI 分类回调 |
| `components/chat/ChatPanel.tsx` | 672 | SSE/轮询、消息卡编排、深研状态机 |
| `components/network/NetworkPanel.tsx` | 655 | echarts option 组装 + 19 处 `style={{}}` |
| `components/branch/BranchPanel.tsx` | 499 | 分支状态机 + 进度编排 |
| `components/paper/PaperDetailPage.tsx` | 345 | 三栏工作台编排 |
| `components/chat/ChatConfigBar.tsx` | 340 | 表单状态 |

**P2-9 无统一 Loading / 空态组件**
`animate-spin` 出现 **23 处**，散落在 12 个文件；加载/空态文案各写各的。

**P2-10 前端 lint 工具链不可用**
`frontend/package.json` 声明 `"lint": "next lint"` 且已安装 eslint 8.57 + eslint-config-next，
但 `frontend/` 下**不存在任何 eslint 配置文件**（`.eslintrc*` / `eslint.config.*` 均无）。
→ `npm run lint` 会进入交互式初始化，CI 中必然失败。任务书第十六条要求每阶段跑 lint，**当前无法满足**。

**P2-11 `.env.example` 严重过期（新环境起不来）**
| 项 | `.env.example` | `utils/config.py` 实际读取 |
|---|---|---|
| 数据库 | `MYSQL_URL` ❌ | `POSTGRES_URL`（config.py:37） |
| LLM | LLM_PROVIDER / LLM_API_KEY / JWT_SECRET ✅ | 同 |
| OpenAlex | **缺失** | `OPENALEX_API_KEY`（openalex.py:58） |
| SiliconFlow（4 项） | **缺失** | config.py:61-70 |
| GITHUB_TOKEN | **缺失** | config.py:79 |
| OPENALEX_EMAIL | **缺失** | openalex.py:18 |

**P2-12 `.env` 加载存在 2 套实现**
- `utils/config.py:9` `load_dotenv(PROJECT_ROOT / ".env")`（python-dotenv）
- `sources/openalex.py:37 _load_dotenv()` 手写逐行解析（注释称「不依赖 python-dotenv」），`:57` 模块导入即执行
→ 两次加载同一文件，解析规则不一致（手写版不支持多行值/变量展开）。

### P3 — 命名 / 格式问题

**P3-1 异常命名**
- 全仓扫描 `temp / test2 / new_ / _new / old / backup / final / copy / demo / 副本`：**唯一命中是 `.claude/skills/` 下的第三方文件**，业务代码 0 命中 ✅
- 方括号命名仅 `app/paper/[id]`、`app/paper/openalex/[openalex_id]` — **框架强制，合规** ✅

**P3-2 前端 API 领域归属错误（2 处）**
- `lib/api/settings.ts:26 getAnnouncements()` — 公告 API 放在 settings 域
- `lib/api/funnel.ts:11,22` — 在 API 文件里定义 `FunnelStartPayload` / `FunnelResumePayload` interface，类型应归 `types/dto.ts`

**P3-3 前端样式 token 越界**
27 处 tailwind 任意值散落 15 个文件，top：
`ChatConfigBar.tsx`(5) `ChatPanel.tsx`(4) `NetworkPanel.tsx`(3) `BranchPanel.tsx`(3) `ToastContainer.tsx`(2) `AuthModal.tsx`(2)
其中 `config/categories.ts:20-21` 硬编码颜色 `text-[#B5D4F4]` / `text-[#9FE1CB]`，
**与「不存在 blue/cyan 语义变量、颜色走 token」的视觉基线冲突**，且绕过 tailwind config。
全局 `style={{}}` 共 48 处，top：`NetworkPanel.tsx`(19) `LandscapeCard.tsx`(7) `BranchPanel.tsx`(6)。

**P3-4 `types/api.ts` 仅 1 个导出**
27 行的文件只装 `ApiEnvelope<T>`（api.ts:25），与 dto/domain 三足鼎立但实际失衡。

**P3-5 `md/` 20 篇历史文档无权威标注**
含 4 篇历史审计：`backend-audit-2026-08-21.md`、`frontend-audit-2026-08-23.md`、`frontend-refactor-report-2026-08-24.md`、`production-audit-2026-08-25.md`，
与 `产品原则-2026-08-29.md`、`功能映射盘点-2026-08-29.md` 并存，**未标注哪些仍为权威**。

---

## 4. 重复代码清单

### 4.1 项目归属校验（4 处）

```
校验项目归属
├── A. utils/auth.py:126        get_owned_project(session, project_id, user)   ← 权威
├── B. api/routers/projects.py:32  _get_owned_project(...)                     ← 重复实现
└── C. search.py:22 / branch.py:18 / network.py:21  _check(...) ×3   ← 逐字符相同，内部调 A
```
**已核实 A 与 B 行为完全一致 → 建议保留 A（权威），B 改为直接复用 A；C 三份合并为一份置于 `utils/auth.py`。改动为零风险。**

### 4.2 task 归属校验（3 处，逐字符相同）

```
_assert_task_owner(task, user) → 403
├── api/routers/branch.py:115
├── api/routers/network.py:106
└── api/routers/chat.py:156
```
**行为完全一致 → 建议合并到 utils/task_guard.py（该文件已承担 task 相关基础设施）。**

### 4.3 异步任务脚手架（4 套）

```
内存 dict + Thread + status + result + owner
├── search.py:31  _trunk_tasks + :34 _run_trunk_task + :47 _start_trunk
├── branch.py:27  _tasks       + :54 _run_task      + :81 _start_branch
├── network.py:30 _tasks       + :60 _run_task      + :77 _start_network
└── funnel.py    DB checkpoint（机制不同，**不应强行合并**）
```
**前三套结构同构、业务不同 → 建议抽「task 运行时」基础设施，保留各业务 `_run_*` 差异。第四套机制本质不同（DB 持久化 + 可中断续跑），必须保留独立实现。**

### 4.4 骨架类别限额（4 处定义，语义不同 —— **不可盲目合并**）

| # | 位置 | 值 | 语义 |
|---|---|---|---|
| 1 | `storage/cart.py:17` DEFAULT_LIMITS | 5/10/5 | 骨架**入库硬限额**的默认值（项目可覆盖），配套 `CATEGORY_LIMIT_MAX=30`(:22) `TOTAL_LIMIT_MAX=50`(:23) |
| 2 | `agents/funnel/tools.py:122` CATEGORY_LIMITS | 5/10/5 | 漏斗**推荐阶段候选数量**，供 `skeleton_agent.py:101,109,117,201` 使用 |
| 3 | `config/categories.ts:11` CATEGORIES.limit | 5/10/5 | 前端展示默认值 |
| 4 | `CartDetail.tsx:63-65` | `CATEGORIES...limit ?? 5/10/5` | 配额编辑器的兜底默认值 |

**判断：#1 与 #2 语义不同（入库限额 vs 推荐候选数），数值巧合相同。任务书第十条明确禁止「因代码看起来相似就强行合并」→ 建议仅在命名上区分（如 `CART_LIMITS` / `RECOMMEND_BUDGET`），不动数值、不动逻辑。**
**#3/#4 是前端默认值，运行时以服务端 `limits` 优先（`CartPanel.tsx:29`、`CartDetail.tsx:66` 均为 `limits ?? fallback`）→ 行为正确，仅需收敛兜底写法。**

### 4.5 分类中文标签（3 处）

```
foundation→奠基理论 / mainstream→主流方法 / frontier→最新前沿
├── agents/funnel/tools.py:116  CATEGORY_LABELS（+ :129 get_category_label）
├── storage/cart.py:514         _cat_label（内联字典）
└── config/categories.ts:11,25,32  CATEGORIES / CATEGORY_META / CATEGORY_GROUPS（前端）
```
**后端两处值完全一致 → 可合并（统一到 `agents/funnel/tools.py` 或更中性的常量模块）。前端一份为独立栈，不合并。**
注：`config/categories.ts` 头部注释已自述「此前 CATEGORIES ×2、CATEGORY_COLORS ×2、CATEGORY_GROUPS ×2、KEYWORD_COLORS ×3 散落复制」——**前端侧同类问题已于 2026-08-24 治理过一轮，当前已收敛；后端侧尚未治理。**

### 4.6 作者列表格式化（5 处，**行为不一致**）

```
截断前 3 位
├── A. BranchPanel.tsx:423   (item.authors||[]).slice(0,3).join(", ")      ← 无"等 N 人"
├── B. GapPanel.tsx:159      (c.authors||[]).slice(0,3).join(", ")         ← 无"等 N 人"
├── C. NetworkPanel.tsx:580  `${a.slice(0,3).join(", ")} 等 ${a.length} 人`  ← 有"等 N 人"
├── D. PaperCard.tsx:67      `${a.slice(0,3).join(", ")} 等 ${a.length} 人`  ← 有"等 N 人"
└── E. PaperDetailPage.tsx:233  detail.authors?.join(", ")                 ← 不截断
```
**A/B 与 C/D 行为不同（是否追加「等 N 人」），E 又是第三种语义。按任务书第十条，只能先合并行为一致的子集（A+B 一组，C+D 一组），E 保持独立。合并时必须保留差异，禁止统一成一种。**

### 4.7 `.env` 加载（2 套）— 见 P2-12

### 4.8 疑似无引用代码（标记 `suspected_unused`，**不下删除结论**）

| 对象 | 证据 | 说明 |
|---|---|---|
| `agents/search.py` | 全仓 grep 无任何模块 `from agents.search import`；仅其自身 docstring(:3) 提及兼容用途 | 文件明确自述为「兼容壳子」，但确无调用方。**删除需人工确认无外部脚本/历史依赖** |
| `db/mysql_legacy/` | 项目已迁 PG，无代码引用 | 历史归档，建议归档而非删除 |
| `db/public.sql` | 3.6 MB dump，无代码引用 | 疑似一次性导出产物 |
| `apiTest/` | 无代码引用 | 用途待确认 |

---

## 5. 高风险区域（默认最小改动）

| 区域 | 文件 | 风险点 | 建议改动级别 |
|---|---|---|---|
| **检索链路** | `retrieval/pipeline.py`(647)、`lexical.py`(181)、`reranker.py`(203)、`scorer.py`(42) | 分层召回 + BGE 重排 + 评分，牵一发动全身 | **仅文件级移动，内部零改动** |
| **LLM 调用** | `llm/client.py`(212) | 12 处调用方，含重试/退避/超时策略 | **不改动** |
| **对话 Agent** | `agents/chat_agent.py`(657) | 工具集 + 多轮编排 + L1/L2/L3 分级 | **不改动** |
| **漏斗 Graph** | `agents/funnel/graph.py`(650) | LangGraph 中断/续跑机制脆弱（历史 bug 区） | **不改动** |
| **数据库与迁移** | `storage/mysql_db.py`、`db/postgres/*` | 迁移按 `sys_schema_versions` 追踪，顺序敏感 | **仅重命名文件需全仓同步，谨慎** |
| **鉴权** | `utils/auth.py`(136) | JWT + 项目归属，安全敏感 | **不改动逻辑**（可去重调用方） |
| **限流/日志** | `utils/ratelimit.py`、`utils/log.py` | 内存滑动窗口 + 异步落库 | **不改动** |
| **SSE/流式** | 前端 `ChatPanel.tsx`、`lib/http.ts` | 流式响应 + token refresh 竞态 | **不改动** |
| **论文详情页** | `components/paper/*`(6 文件)、`api/routers/papers.py`(525) | 一期新改造，任务书明确「不修改论文详情页已有功能」 | **不改动** |
| **PDF 获取链** | `sources/pdf_cache.py`、`pdf_structure.py`、`tei_parse.py` | 多源兜底链（GROBID→PDF→HTML） | **不改动** |
| **前端传输层** | `lib/http.ts` | 唯一传输层，牵动全部请求 | **不改动** |

---

## 6. 配置 / 日志 / 工具链现状

### 6.1 配置

| 来源 | 状态 |
|---|---|
| `utils/config.py` Settings（dataclass，单例 `settings`） | ✅ 唯一权威定义，含 `__post_init__` 强校验（provider 合法性 / LLM_API_KEY / JWT_SECRET） |
| `os.getenv` 散落 | ⚠️ 运行时代码 2 处越界：`sources/openalex.py:18`（OPENALEX_EMAIL）、`:58`（OPENALEX_API_KEY）；其余 20+ 处集中在 `utils/config.py` ✅ |
| `.env` | 10 个键，键名与 config.py 对齐 |
| `.env.example` | ❌ 过期严重（见 P2-11） |
| 前端环境变量 | `.env.local.example` 仅注释掉的 `NEXT_PUBLIC_API_URL`；**src 中 0 处引用 `NEXT_PUBLIC`** —— 实际走 `next.config.js:3-9` rewrites 代理（`/api/*` → `http://localhost:8000/api/*`）。→ 前端环境变量实际只有一个可选键，无重复来源 ✅ |
| 后端地址硬编码 | ⚠️ `next.config.js:7` 硬编码 `http://localhost:8000`，且 `.env.local.example` 提供的 `NEXT_PUBLIC_API_URL` **实际未被任何代码读取**。→ 存在「配置项声明了但无效」的假配置（P3） |

### 6.2 日志

| 项 | 状态 |
|---|---|
| `print()` 在运行时代码 | **0 处** ✅ |
| `console.*` 在前端 | **2 处**，均为合理错误路径：`app/page.tsx:133 console.error(e)`、`NetworkPanel.tsx:524 console.error("echarts 渲染失败，图谱降级", e)` ✅ 建议保留 |
| `utils/log.py` setup_logger + DbLogHandler | 分级落库（LOG_DB_ENABLED / LOG_DB_LEVEL），`DbLogHandler` 类 118 行 |
| 分级使用 | ✅ 未见混用 |
| `alert()` 前端 | **0 处** ✅（已由 `lib/toast.ts` 统一） |
| TODO / FIXME / HACK | 运行时代码 **0 处** ✅ |

### 6.3 工具链

| 项 | 状态 |
|---|---|
| 前端 lint | ❌ **不可用**（有依赖无配置，P2-10） |
| 前端 build / typecheck | `next build`、`tsc --noEmit`（strict: true）可用 |
| 前端 test | ❌ **不存在**（package.json 无 test script，无测试文件） |
| 后端 pytest | ❌ **不存在**（无 tests/ 目录、无 pytest 配置；`scripts/test_*.py` 为脚本式手动验证） |
| 后端 lint / type check | ❌ 无配置 |
| 包管理器 | ⚠️ `package-lock.json`(280KB) 与 `pnpm-lock.yaml`(127KB) **并存** |

---

## 7. 待确认项（不擅自决定）

1. `storage/cart.py` 的 515 行是否允许拆分为「限额/CRUD」与「AI 分类/诊断/BibTeX」两个模块？拆分是否触及任务书「不改业务逻辑」红线？（拆分本身不改逻辑，但需确认拆分边界）
2. ~~`get_owned_project` 与 `_get_owned_project` 行为是否一致？~~ → **已核实：完全一致，可安全合并**（见 §4.1）
3. `agents/search.py` 是否有仓库外的调用方（外部脚本、历史运维流程）？
4. `db/mysql_legacy/`、`db/public.sql`、`apiTest/` 是否可归档到仓库外？
5. 前端 5 个 zustand store 之间是否存在同一状态的重复持有？（需逐个 store 读代码确认，本轮只做了导入面扫描）
6. `frontend/src/app/page.tsx` 拆解后，5 个 tab 面板的 props 契约是否保持不变？
7. 是否允许新增 `frontend/.eslintrc.json` + `tests/` 目录？（属工程基建，非业务功能，但会新增文件）
8. 前端是否要引入 `features/` 目录？当前 `components/` 已按 8 个业务域划分，与任务书建议的 `features/` 结构**功能等价**，迁移成本 vs 收益需权衡。

---

## 8. 审计结论

**做得好的部分（不要动）：**
- 分层最干净的区域：`retrieval/`（检索链路）、`llm/`（LLM 唯一封装）、`prompt/`
- 前端纪律显著优于后端：`any` 0 处、`alert` 0 处、裸 `fetch` 0 处、`localStorage` 收敛在 3 处、`config/` 已是纯静态单一来源、`http.ts` 传输层零绕过
- 安全基建完备：限流、request_id、日志落库、JWT 强校验（`utils/config.py:__post_init__`）
- 无循环依赖、无 P0 缺陷、无运行时 print、无 TODO 堆积

**主要债务集中在后端，且高度集中在 3 个目录：**
1. `agents/` — 名不副实（6/7 不是 agent）
2. `storage/` — 名不副实（实为 PG；cart.py 越界调 LLM；vector_store 含算法）
3. `api/routers/` — 4 套重复任务脚手架 + 3 份相同校验 + 13 个内联模型 + 5 处业务逻辑

**前端债务主要是「体积」而非「结构」：** 目录划分与分层约定基本正确，问题是 `app/page.tsx` 上帝页面、6 个超大组件、23 处重复 Loading、27 处样式 token 越界。

**工程基建缺口（会阻碍后续每阶段验证）：** 前端 lint 不可用、前后端均无测试框架、`.env.example` 失效、双 lockfile。
