-- ══════════════════════════════════════════════════════════
-- Scholar Funnel · 数据库增量迁移
-- 说明：
--   1. 针对"已存在旧库"的升级迁移，全部幂等（可重复执行）
--   2. MySQL 8.0 不支持 ADD COLUMN IF NOT EXISTS，用 information_schema
--      动态判断 + PREPARE/EXECUTE 实现幂等
--   3. 新环境只需执行 01_schema.sql，本文件可跳过
-- ══════════════════════════════════════════════════════════

SET NAMES utf8mb4;

-- ──────────────────────────────────────────────
-- M1. papers.trunk_score（主干检索评分）
-- ──────────────────────────────────────────────
SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'papers' AND COLUMN_NAME = 'trunk_score');
SET @sql := IF(@exist = 0, 'ALTER TABLE papers ADD COLUMN trunk_score FLOAT NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ──────────────────────────────────────────────
-- M2. papers.keywords / github_url（关键词与 GitHub 仓库）
-- ──────────────────────────────────────────────
SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'papers' AND COLUMN_NAME = 'keywords');
SET @sql := IF(@exist = 0, 'ALTER TABLE papers ADD COLUMN keywords JSON NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'papers' AND COLUMN_NAME = 'github_url');
SET @sql := IF(@exist = 0, 'ALTER TABLE papers ADD COLUMN github_url VARCHAR(500) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ──────────────────────────────────────────────
-- M3. papers.recommended_category（缺口检索推荐类别）
-- ──────────────────────────────────────────────
SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'papers' AND COLUMN_NAME = 'recommended_category');
SET @sql := IF(@exist = 0, 'ALTER TABLE papers ADD COLUMN recommended_category VARCHAR(20) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ──────────────────────────────────────────────
-- M4. papers.stage 枚举加 gap（幂等 MODIFY，重复执行无害）
-- ──────────────────────────────────────────────
ALTER TABLE papers
  MODIFY COLUMN stage ENUM('trunk','branch','network','gap') NOT NULL DEFAULT 'trunk';

-- ──────────────────────────────────────────────
-- M5. analysis_results.mode + 回填 + (paper_id, mode) 唯一约束
-- ──────────────────────────────────────────────
SET @exist := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'analysis_results' AND COLUMN_NAME = 'mode');
SET @sql := IF(@exist = 0, 'ALTER TABLE analysis_results ADD COLUMN mode VARCHAR(20) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 旧数据回填（幂等）
UPDATE analysis_results SET mode = 'probe_match' WHERE mode IS NULL OR mode = '';

-- 唯一约束（先检查是否存在）
SET @exist := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'analysis_results'
    AND CONSTRAINT_NAME = 'uniq_analysis_paper_mode' AND CONSTRAINT_TYPE = 'UNIQUE');
SET @sql := IF(@exist = 0,
  'ALTER TABLE analysis_results ADD CONSTRAINT uniq_analysis_paper_mode UNIQUE (paper_id, mode)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
