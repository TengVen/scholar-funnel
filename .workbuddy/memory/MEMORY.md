# 项目长期记忆（MEMORY.md）

## 项目定位
学术文献综述助手「Scholar Funnel」：OpenAlex 实时检索 → 骨架（奠基5/主流10/前沿5）→ 分支深挖 → 引用网络。前端 Next.js（frontend/），后端 FastAPI + MySQL（库名 paper），LLM 走 llm/client.py（deepseek）。

## 核心架构（勿破坏）
- 检索链路：QueryDecomposer（LLM 拆解）→ LexicalRetriever（OpenAlex 召回）→ ResearchReranker（BGE 重排）→ ResearchScorer（评分）→ _save 入库
- `pipeline.py`：`search`（全量，DELETE+重建 trunk）、`gap_search`（缺口补充，**不删数据**，stage=gap）、`title_lookup`（标题直达）
- `paper_stage` 枚举：trunk / branch / network / **gap**；Paper 表含 keywords(JSON)、github_url、recommended_category
- 路由顺序铁律：静态路由（/classify /summarize /export /diagnose）必须放在 `/{paper_id}` 之前
- 环境注意：managed python（3.13）**无项目依赖**（httpx/sqlalchemy 缺失）；独立脚本用 mysql CLI（Windows 输出 GBK，读用 encoding="gbk" errors="replace"，写用 --default-character-set=utf8mb4）

## 产品约定（用户拍板）
1. **入口分工**：检索页=快速模式（直接填直接检），对话页=AI 精细引导（SearchPanel 引导条可跳转）
2. **排序**：多字段联合，**后点优先**（新点字段排最前成主排序），每字段独立 ↑↓ 箭头（三态：选→换向→取消）
3. **加入骨架**：点按钮弹菜单（奠基/主流/前沿 手动三选 + ✨智能分类 AI）；分类理由写入 notes 展示；AI 分错可删除重加
4. **骨架缺口补充**：候选制**不入库**（人把关）；关键词补充（可填约束+**相关度阈值滑块**）/ 标题直达 两模式；结果在检索页"⚡重检索"视图按类别分组展示；已在骨架置灰、已在库零成本复用；无结果自动放宽+空态出口
5. **骨架页**：AI 诊断、生成骨架摘要（综述开场段+复制）、导出 BibTeX、每类"补充"入口
6. **分类判定哲学**：不用英文关键词匹配（跨领域失效）；领域不变+按类别调年份窗口+规则硬指标+AI 领域感知+人工确认
7. **摘要清洗**：所有 OpenAlex 摘要必经 _clean_latex（sources/openalex.py），新数据入库前清洗；存量脏数据用 scripts/backfill_latex.py 回填
8. **视觉规范**：深色纸感主题；关键词徽章=玻璃质感淡青多色循环（KEYWORD_COLORS）；指标区竖排图标（蓝/青绿/金色）；金色=相关度/强调
9. **骨架限额（2026-08-25）**：三类可**项目级手动配额**（奠基/主流/前沿各自 1~30，总和 ≤ 50）；总量=各类之和（无独立总量配置）；存 `ai_projects.limits` JSON（空=默认 5/10/5）；保存超界阻止，已有论文数>新限额允许保存不删数据；后端 cart 校验全走 `get_limits(project_id)`；前端骨架页「配额」按钮编辑

## 技术栈要点
- 前端：React 19 + Tailwind + lucide-react + zustand（stores/）
- **前端分层铁律（2026-08-24 重构后）**：`types/`(纯类型: dto=后端DTO / domain=领域联合) → `config/`(纯静态数据: nav/categories/keywords/chat/search/branch/storage，KEYWORD_COLORS 等唯一来源) → `lib/`(http.ts 唯一传输层 + tokenStore 叶子 + api/ 按领域拆分 8 文件含 funnel) → `hooks/`(useTaskPolling 统一轮询 / useAuth / useAnnouncements / useLocalStorageConfig) → `stores/`(zustand: project/cart/auth/branch/network) → `components/`(只 UI) → `app/page.tsx`(只组装)
- **导航 5 tab**：chat/search/cart/branch/network（**无独立 funnel tab**——产品决策：Agent 不作为对象暴露，见下）
- **Agent 能力定位（2026-08-25 拍板）**：LangGraph 漏斗 = 对话页 chat agent 的 `deep_research` 工具（与 full_search 并列，auto 模式后台跑）。交互=跳转式+持久化：对话发调研意图 → 进行中卡 → 结果卡（统计+「查看检索结果」跳检索页）；骨架候选**只生成不入库**（人跳骨架页手动加）。消息卡存 ai_messages.attachments(JSONB) `{type:"deep_research"|"deep_research_result", thread_id, project_id,...}`，历史加载可恢复/降级。finalize 接口幂等。funnel 路由"仅 step 中断、auto 永不中断"。
- 组件禁止：裸 fetch、localStorage、token 管理、多步编排；复杂编排走 hook/store
- 认证：authStore 编排（login/register/upgrade/logout/init 游客兜底）+ tokenStore；`auth:changed` 事件已废弃（store 订阅替代）；`auth:expired` 由 http.ts 派发、useAuth 监听
- ChatConfig 已按 search/dialog/advanced/llm 分组；localStorage key 不变（scholar_funnel_chat_config），旧扁平数据由 normalizeChatConfig 迁移
- window 事件仅存 3 个：chat:updated / navigate-to-chat / navigate-to-cart
- **数据库实际是 PostgreSQL**（storage/mysql_db.py 文件名误导，内部 psycopg3 + db/postgres/ SQL 迁移，sys_schema_versions 追踪；init_db 先 create_all 再跑迁移 SQL）
- **后端安全基建（2026-08-25）**：utils/ratelimit.py（零依赖内存滑动窗口，登录 10/min、检索/分析 6/min、chat 12/min、默认 120/min，OPTIONS 跳过）+ utils/request_log.py（X-Request-Id + 耗时日志）；均为单进程内存实现
- **日志落库（2026-08-26）**：utils/log.py 的 setup_logger 多挂 DbLogHandler（异步批量写 sys_app_logs：level/logger/message/request_id/detail JSONB，迁移 16_sys_app_logs.sql；handler 自动建表兜底；emit 主线程快照 request_id——contextvar 线程隔离后台线程读不到）；开关 LOG_DB_ENABLED=true、级别 LOG_DB_LEVEL=INFO（.env 可调）；request_log 中间件 set/clear_request_id；与 sys_audit_logs（敏感操作审计）语义不同，后者仍未接入
- **分支分析跨领域重构（2026-08-26，勿回退）**：Prompt 链 = PaperProfile（ai_papers.method_profile JSONB 缓存，仅 title+abstract）→ Landscape（9 维+evidence，发现方法体系）→ ProbeMatch（usage_role 六角色+evidence，语义匹配）；**probe_match 由业务层 `_compute_probe_match` 按 usage_role 统一算**（core/auxiliary/baseline/comparison→True，其余 False），LLM 不再输出 bool；`optimization_method` 为兼容字段回填 `implementation_or_application`（landscape 留空）；ai_suggest 保持旧逻辑（abstract[:2000]）；迁移文件 db/postgres/15_analysis_profile.sql；API 新字段全可选；前端已落地（2026-08-26 下午）：ROLE_MAP 六角色冷调徽章（config/categories.ts）+ EvidenceList/BranchSquareCard/LandscapeCard（components/branch/）+ dto 可选字段；测试 scripts/test_prompt_cross_domain.py（mock LLM 29 项）；**landscape 上下文：_MODE_BUDGETS[landscape]=24000 + _NOISE_SECTION_PATTERNS 过滤 References/preamble 等噪声节（否则 evidence 只来自摘要，2026-08-26 16:0X 修复）**
- **task 归属校验**：branch/network/chat/funnel/search 的 task dict 均存 user_id，status/result 接口 `_assert_task_owner` 校验；funnel thread_id 内嵌 project_id（`funnel-{pid}-{hex}`），/resume /state 经 _project_id_from_thread + get_owned_project 双重校验
- **/trunk 已异步化（2026-08-25）**：POST /trunk 返回 {task_id}，GET /trunk/status、/trunk/result；前端 runTrunkSearch 内部 start→2.5s 轮询→result（调用方语义不变）
- **检索分层策略（2026-08-25，勿回退为旧 strict_mode）**：openalex.search_works(filter_expr=...) 透传；lexical._build_layered_jobs 四路召回（核心 AND 每词 title|abstract OR / 同义词 OR / 辅助弱约束 / 宽松 combined_queries）→ 合并去重 → BGE rerank 语义过滤；**2026-08-26 修复 filter 间 OR 400**：改为 `default.search` 单字段（核心路 `default.search:"A",default.search:"B"` 逗号 AND；同义/辅助路 `default.search:"A"|"B"` 值内 OR，字段前缀仅一次）；filter_term() 对多词短语加引号；降噪由 rerank+score_threshold 把关（pipeline.py:108/135）
- **funnel 后端中断机制（2026-08-25 修复）**：原"条件边→END"非真 interrupt()，resume 从 END 续跑空转 → step 模式卡死。现 run_funnel 显式写 state["interrupted"]；resume_funnel 手动逐节点续跑（intent→trunk、skeleton、probe 各跑一步）；get_funnel_state 判定 = interrupted || stage_status==waiting_confirm；start/resume 均后台线程异步（thread_id 由路由预生成），异常 _persist_error 写 checkpoint
- LLM 客户端（llm/client.py）：timeout 60s + 指数退避重试 3 次（RateLimit/Timeout/5xx）+ LLMError 归一化
- 数据库迁移：storage/mysql_db.py 的 init_db 内迁移函数（migrate_trunk_score / migrate_paper_enrich / migrate_gap_support），重启后端自动执行
- AI 分类/摘要接口：POST /api/cart/classify、POST /api/cart/summarize（均有内存缓存 _classify_cache / _summarize_cache）

## 待办/可选方向
- 骨架全景视图（三栏分布条+类别徽章，纯前端，复用 diagnose 数据）
- 多格式导出（Markdown 综述清单：标题/作者/年份/被引/关键词/DOI/理由/摘要）
- 分支分析结果"图化"（轻量 GraphRAG：把 BranchPanel 分析组装成语义知识图）
- keywords 存量回填：可写脚本遍历旧论文调 OpenAlex 补 concepts
- 前端后续：统一 toast 替换 15 处 alert；NetworkPanel 图表拆 components/network/charts/；补 ESLint+noUnusedLocals（详见 md/frontend-refactor-report-2026-08-24.md §3/§6）
