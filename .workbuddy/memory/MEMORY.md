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

## 技术栈要点
- 前端：React 19 + Tailwind + lucide-react；PaperList 导出 SortSpec 类型
- 数据库迁移：storage/mysql_db.py 的 init_db 内迁移函数（migrate_trunk_score / migrate_paper_enrich / migrate_gap_support），重启后端自动执行
- AI 分类/摘要接口：POST /api/cart/classify、POST /api/cart/summarize（均有内存缓存 _classify_cache / _summarize_cache）

## 待办/可选方向
- 骨架全景视图（三栏分布条+类别徽章，纯前端，复用 diagnose 数据）
- 多格式导出（Markdown 综述清单：标题/作者/年份/被引/关键词/DOI/理由/摘要）
- 分支分析结果"图化"（轻量 GraphRAG：把 BranchPanel 分析组装成语义知识图）
- keywords 存量回填：可写脚本遍历旧论文调 OpenAlex 补 concepts
