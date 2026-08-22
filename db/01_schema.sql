-- ══════════════════════════════════════════════════════════
-- Scholar Funnel · 数据库 Schema（DDL 全量）
-- 说明：
--   1. 所有表结构以本文件为准（新环境直接执行）
--   2. 幂等：全部使用 IF NOT EXISTS，重复执行安全
--   3. 增量变更写 02_migrations.sql（迁移用），不要改本文件历史内容
-- 执行：mysql -u<user> -p <db> < db/01_schema.sql
-- ══════════════════════════════════════════════════════════

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ──────────────────────────────────────────────
-- projects 检索项目
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `projects` (
  `id`          INT NOT NULL AUTO_INCREMENT,
  `name`        VARCHAR(255) NOT NULL,
  `user_query`  TEXT NOT NULL,
  `tech_probe`  TEXT NULL,
  `created_at`  DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- ──────────────────────────────────────────────
-- papers 论文元数据
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `papers` (
  `id`                   INT NOT NULL AUTO_INCREMENT,
  `project_id`           INT NOT NULL,
  `openalex_id`          VARCHAR(50) NOT NULL,
  `title`                TEXT NOT NULL,
  `authors`              JSON NULL,
  `year`                 SMALLINT NULL,
  `venue`                VARCHAR(255) NULL,
  `doi`                  VARCHAR(255) NULL,
  `arxiv_id`             VARCHAR(50) NULL,
  `abstract`             TEXT NULL,
  `cited_by_count`       INT NULL DEFAULT 0,
  `is_survey`            TINYINT(1) NULL DEFAULT 0,
  `stage`                ENUM('trunk','branch','network','gap') NOT NULL DEFAULT 'trunk',
  `trunk_score`          FLOAT NULL,
  `keywords`             JSON NULL,
  `github_url`           VARCHAR(500) NULL,
  `recommended_category` VARCHAR(20) NULL,
  `created_at`           DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `openalex_id` (`openalex_id`),
  KEY `idx_project_stage` (`project_id`, `stage`),
  KEY `idx_cited` (`cited_by_count`),
  CONSTRAINT `papers_ibfk_1` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- ──────────────────────────────────────────────
-- analysis_results 分支深挖分析结果
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `analysis_results` (
  `id`                 INT NOT NULL AUTO_INCREMENT,
  `paper_id`           INT NOT NULL,
  `mode`               VARCHAR(20) NULL,
  `content_level`      TINYINT NOT NULL,
  `content_source`     VARCHAR(30) NULL,
  `method_summary`     TEXT NULL,
  `probe_match`        TINYINT(1) NULL DEFAULT 0,
  `probe_confidence`   ENUM('high','medium','low','none') NULL,
  `key_formulas`       JSON NULL,
  `optimization_method` VARCHAR(255) NULL,
  `analyzed_at`        DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_match` (`probe_match`, `probe_confidence`),
  UNIQUE KEY `uniq_analysis_paper_mode` (`paper_id`, `mode`),
  CONSTRAINT `analysis_results_ibfk_1` FOREIGN KEY (`paper_id`) REFERENCES `papers` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- ──────────────────────────────────────────────
-- citations 引用关系
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `citations` (
  `id`             INT NOT NULL AUTO_INCREMENT,
  `project_id`     INT NOT NULL,
  `source_id`      VARCHAR(50) NOT NULL,
  `target_id`      VARCHAR(50) NOT NULL,
  `is_influential` TINYINT(1) NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_citation` (`project_id`, `source_id`, `target_id`),
  CONSTRAINT `citations_ibfk_1` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- ──────────────────────────────────────────────
-- code_repos 开源代码信息
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `code_repos` (
  `id`           INT NOT NULL AUTO_INCREMENT,
  `paper_id`     INT NOT NULL,
  `github_url`   VARCHAR(500) NULL,
  `stars`        INT NULL DEFAULT 0,
  `language`     VARCHAR(50) NULL,
  `last_updated` VARCHAR(20) NULL,
  `checked_at`   DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `code_repos_ibfk_1` FOREIGN KEY (`paper_id`) REFERENCES `papers` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- ──────────────────────────────────────────────
-- authors 作者信息
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `authors` (
  `id`             INT NOT NULL AUTO_INCREMENT,
  `openalex_id`    VARCHAR(50) NULL,
  `name`           VARCHAR(255) NULL,
  `affiliation`    VARCHAR(500) NULL,
  `h_index`        INT NULL,
  `works_count`    INT NULL,
  `cited_by_count` INT NULL,
  `tracked`        TINYINT(1) NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `openalex_id` (`openalex_id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- ──────────────────────────────────────────────
-- cart 骨架清单
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `cart` (
  `id`         INT NOT NULL AUTO_INCREMENT,
  `project_id` INT NOT NULL,
  `paper_id`   INT NOT NULL,
  `category`   ENUM('foundation','mainstream','frontier') NOT NULL,
  `added_at`   DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  `notes`      TEXT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_cart` (`project_id`, `paper_id`),
  CONSTRAINT `cart_ibfk_1` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE CASCADE,
  CONSTRAINT `cart_ibfk_2` FOREIGN KEY (`paper_id`) REFERENCES `papers` (`id`) ON DELETE RESTRICT
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

SET FOREIGN_KEY_CHECKS = 1;
