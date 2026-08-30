-- ══════════════════════════════════════════════════════════════════════
-- Scholar Funnel · PostgreSQL 迁移 DDL · 19 候选阶段（L1"加入研究"落库）
-- 内容：ai_paper_stage 枚举新增 candidate —— 用户从 L1 回答来源主动"加入研究"
--       的论文落此阶段（项目候选，非骨架资产；不被 trunk 重建回收）
-- ══════════════════════════════════════════════════════════════════════

ALTER TYPE ai_paper_stage ADD VALUE IF NOT EXISTS 'candidate';
COMMENT ON COLUMN ai_papers.stage IS '论文阶段: trunk/branch/network/gap/candidate（candidate=用户从回答来源主动纳入的项目候选）';
