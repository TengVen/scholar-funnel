-- ══════════════════════════════════════════════════════════
-- Scholar Funnel · PostgreSQL 迁移 DDL · 04 检索业务核心表
-- 内容：projects / papers / analysis_results / citations /
--       code_repos / authors / cart（全部 ai_ 前缀 + 全字段注释）
-- 说明：外键 ON DELETE CASCADE；cart.paper_id 保留 RESTRICT
--       （骨架引用的论文不可被删除）
-- ══════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────
-- ai_projects 检索项目
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_projects (
  id          BIGSERIAL PRIMARY KEY,                    -- 项目 ID
  name        VARCHAR(255) NOT NULL,                    -- 项目名称
  user_query  TEXT NOT NULL,                            -- 用户检索需求（原始描述）
  tech_probe  TEXT,                                     -- 技术探针（可选，聚焦技术点）
  created_at  TIMESTAMP DEFAULT NOW(),                  -- 创建时间
  updated_at  TIMESTAMP DEFAULT NOW()                   -- 更新时间
);
COMMENT ON TABLE ai_projects IS '检索项目：一次文献调研的容器';
COMMENT ON COLUMN ai_projects.id IS '项目 ID';
COMMENT ON COLUMN ai_projects.name IS '项目名称';
COMMENT ON COLUMN ai_projects.user_query IS '用户检索需求（原始描述）';
COMMENT ON COLUMN ai_projects.tech_probe IS '技术探针（可选，聚焦技术点）';
COMMENT ON COLUMN ai_projects.created_at IS '创建时间';
COMMENT ON COLUMN ai_projects.updated_at IS '更新时间';
-- 幂等创建触发器 trg_ai_projects_updated（避免重复执行报 already exists）
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ai_projects_updated') THEN
    CREATE TRIGGER trg_ai_projects_updated BEFORE UPDATE ON ai_projects
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ──────────────────────────────────────────────
-- ai_papers 论文元数据
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_papers (
  id                   BIGSERIAL PRIMARY KEY,           -- 论文 ID
  project_id           BIGINT NOT NULL REFERENCES ai_projects(id) ON DELETE CASCADE, -- 所属项目
  openalex_id          VARCHAR(50) NOT NULL UNIQUE,     -- OpenAlex 唯一 ID
  title                TEXT NOT NULL,                   -- 论文标题
  authors              JSONB,                           -- 作者列表（JSON 数组）
  year                 SMALLINT,                        -- 发表年份
  venue                VARCHAR(255),                    -- 发表期刊/会议
  doi                  VARCHAR(255),                    -- DOI
  arxiv_id             VARCHAR(50),                     -- arXiv ID
  abstract             TEXT,                            -- 摘要
  cited_by_count       INT DEFAULT 0,                   -- 被引量
  is_survey            BOOLEAN DEFAULT FALSE,           -- 是否综述
  stage                ai_paper_stage NOT NULL DEFAULT 'trunk', -- 阶段（trunk/branch/network/gap）
  trunk_score          FLOAT,                           -- 主干检索最终评分（排序用）
  keywords             JSONB,                           -- 关键词/概念标签
  github_url           VARCHAR(500),                    -- 关联 GitHub 仓库
  recommended_category VARCHAR(20),                     -- 缺口推荐类别（foundation/mainstream/frontier）
  created_at           TIMESTAMP DEFAULT NOW()          -- 入库时间
);
COMMENT ON TABLE ai_papers IS '论文元数据（OpenAlex 来源）';
COMMENT ON COLUMN ai_papers.id IS '论文 ID';
COMMENT ON COLUMN ai_papers.project_id IS '所属项目';
COMMENT ON COLUMN ai_papers.openalex_id IS 'OpenAlex 唯一 ID';
COMMENT ON COLUMN ai_papers.title IS '论文标题';
COMMENT ON COLUMN ai_papers.authors IS '作者列表（JSON 数组）';
COMMENT ON COLUMN ai_papers.year IS '发表年份';
COMMENT ON COLUMN ai_papers.venue IS '发表期刊/会议';
COMMENT ON COLUMN ai_papers.doi IS 'DOI';
COMMENT ON COLUMN ai_papers.arxiv_id IS 'arXiv ID';
COMMENT ON COLUMN ai_papers.abstract IS '摘要';
COMMENT ON COLUMN ai_papers.cited_by_count IS '被引量';
COMMENT ON COLUMN ai_papers.is_survey IS '是否综述';
COMMENT ON COLUMN ai_papers.stage IS '阶段（trunk=主干 branch=分支 network=网络 gap=缺口）';
COMMENT ON COLUMN ai_papers.trunk_score IS '主干检索最终评分（排序用）';
COMMENT ON COLUMN ai_papers.keywords IS '关键词/概念标签';
COMMENT ON COLUMN ai_papers.github_url IS '关联 GitHub 仓库';
COMMENT ON COLUMN ai_papers.recommended_category IS '缺口推荐类别（foundation/mainstream/frontier）';
COMMENT ON COLUMN ai_papers.created_at IS '入库时间';
CREATE INDEX IF NOT EXISTS idx_ai_papers_project_stage ON ai_papers (project_id, stage);
CREATE INDEX IF NOT EXISTS idx_ai_papers_cited ON ai_papers (cited_by_count);

-- ──────────────────────────────────────────────
-- ai_analysis_results 分支深挖分析结果
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_analysis_results (
  id                  BIGSERIAL PRIMARY KEY,            -- 自增 ID
  paper_id            BIGINT NOT NULL REFERENCES ai_papers(id) ON DELETE CASCADE, -- 分析论文
  mode                VARCHAR(20),                      -- 分析模式（probe_match/ai_suggest/landscape）
  content_level       SMALLINT NOT NULL,                -- 内容层级（L1-L4）
  content_source      VARCHAR(30),                      -- 内容来源（method/optimization/...）
  method_summary      TEXT,                             -- 方法总结
  probe_match         BOOLEAN DEFAULT FALSE,            -- 是否匹配技术探针
  probe_confidence    ai_confidence_level,              -- 匹配置信度
  key_formulas        JSONB,                            -- 关键公式
  optimization_method VARCHAR(255),                     -- 优化方法
  analyzed_at         TIMESTAMP DEFAULT NOW(),          -- 分析时间
  CONSTRAINT uniq_ai_analysis_paper_mode UNIQUE (paper_id, mode)
);
COMMENT ON TABLE ai_analysis_results IS '分支深挖分析结果（按论文+模式唯一）';
COMMENT ON COLUMN ai_analysis_results.id IS '自增 ID';
COMMENT ON COLUMN ai_analysis_results.paper_id IS '分析论文';
COMMENT ON COLUMN ai_analysis_results.mode IS '分析模式（probe_match/ai_suggest/landscape）';
COMMENT ON COLUMN ai_analysis_results.content_level IS '内容层级（L1-L4）';
COMMENT ON COLUMN ai_analysis_results.content_source IS '内容来源（method/optimization 等）';
COMMENT ON COLUMN ai_analysis_results.method_summary IS '方法总结';
COMMENT ON COLUMN ai_analysis_results.probe_match IS '是否匹配技术探针';
COMMENT ON COLUMN ai_analysis_results.probe_confidence IS '匹配置信度';
COMMENT ON COLUMN ai_analysis_results.key_formulas IS '关键公式';
COMMENT ON COLUMN ai_analysis_results.optimization_method IS '优化方法';
COMMENT ON COLUMN ai_analysis_results.analyzed_at IS '分析时间';
CREATE INDEX IF NOT EXISTS idx_ai_analysis_match ON ai_analysis_results (probe_match, probe_confidence);

-- ──────────────────────────────────────────────
-- ai_citations 引用关系
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_citations (
  id             BIGSERIAL PRIMARY KEY,                 -- 自增 ID
  project_id     BIGINT NOT NULL REFERENCES ai_projects(id) ON DELETE CASCADE, -- 所属项目
  source_id      VARCHAR(50) NOT NULL,                  -- 引用方 OpenAlex ID
  target_id      VARCHAR(50) NOT NULL,                  -- 被引方 OpenAlex ID
  is_influential BOOLEAN DEFAULT FALSE,                 -- 是否高影响力引用
  CONSTRAINT uniq_ai_citation UNIQUE (project_id, source_id, target_id)
);
COMMENT ON TABLE ai_citations IS '论文引用关系（网络图谱数据源）';
COMMENT ON COLUMN ai_citations.id IS '自增 ID';
COMMENT ON COLUMN ai_citations.project_id IS '所属项目';
COMMENT ON COLUMN ai_citations.source_id IS '引用方 OpenAlex ID';
COMMENT ON COLUMN ai_citations.target_id IS '被引方 OpenAlex ID';
COMMENT ON COLUMN ai_citations.is_influential IS '是否高影响力引用';

-- ──────────────────────────────────────────────
-- ai_code_repos 开源代码信息
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_code_repos (
  id           BIGSERIAL PRIMARY KEY,                   -- 自增 ID
  paper_id     BIGINT NOT NULL REFERENCES ai_papers(id) ON DELETE CASCADE, -- 关联论文
  github_url   VARCHAR(500),                            -- GitHub 仓库地址
  stars        INT DEFAULT 0,                           -- Star 数
  language     VARCHAR(50),                             -- 主要语言
  last_updated VARCHAR(20),                             -- 仓库最后更新时间
  checked_at   TIMESTAMP DEFAULT NOW()                  -- 检查时间
);
COMMENT ON TABLE ai_code_repos IS '论文关联的开源代码仓库（代码溯源）';
COMMENT ON COLUMN ai_code_repos.id IS '自增 ID';
COMMENT ON COLUMN ai_code_repos.paper_id IS '关联论文';
COMMENT ON COLUMN ai_code_repos.github_url IS 'GitHub 仓库地址';
COMMENT ON COLUMN ai_code_repos.stars IS 'Star 数';
COMMENT ON COLUMN ai_code_repos.language IS '主要语言';
COMMENT ON COLUMN ai_code_repos.last_updated IS '仓库最后更新时间';
COMMENT ON COLUMN ai_code_repos.checked_at IS '检查时间';

-- ──────────────────────────────────────────────
-- ai_authors 作者信息
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_authors (
  id             BIGSERIAL PRIMARY KEY,                 -- 自增 ID
  openalex_id    VARCHAR(50) UNIQUE,                    -- OpenAlex 作者 ID
  name           VARCHAR(255),                          -- 作者姓名
  affiliation    VARCHAR(500),                          -- 所属机构
  h_index        INT,                                   -- H 指数
  works_count    INT,                                   -- 作品数
  cited_by_count INT,                                   -- 被引量
  tracked        BOOLEAN DEFAULT FALSE                  -- 是否被追踪
);
COMMENT ON TABLE ai_authors IS '作者信息（OpenAlex 来源）';
COMMENT ON COLUMN ai_authors.id IS '自增 ID';
COMMENT ON COLUMN ai_authors.openalex_id IS 'OpenAlex 作者 ID';
COMMENT ON COLUMN ai_authors.name IS '作者姓名';
COMMENT ON COLUMN ai_authors.affiliation IS '所属机构';
COMMENT ON COLUMN ai_authors.h_index IS 'H 指数';
COMMENT ON COLUMN ai_authors.works_count IS '作品数';
COMMENT ON COLUMN ai_authors.cited_by_count IS '被引量';
COMMENT ON COLUMN ai_authors.tracked IS '是否被追踪';

-- ──────────────────────────────────────────────
-- ai_cart 骨架清单（用户精选论文）
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_cart (
  id         BIGSERIAL PRIMARY KEY,                     -- 自增 ID
  project_id BIGINT NOT NULL REFERENCES ai_projects(id) ON DELETE CASCADE, -- 所属项目
  paper_id   BIGINT NOT NULL REFERENCES ai_papers(id) ON DELETE RESTRICT,  -- 论文（被引用不可删）
  category   ai_cart_category NOT NULL,                 -- 分类（foundation/mainstream/frontier）
  added_at   TIMESTAMP DEFAULT NOW(),                   -- 加入时间
  notes      TEXT,                                      -- 加入理由/备注
  CONSTRAINT uniq_ai_cart UNIQUE (project_id, paper_id)
);
COMMENT ON TABLE ai_cart IS '骨架清单：用户精选的论文（奠基/主流/前沿三级）';
COMMENT ON COLUMN ai_cart.id IS '自增 ID';
COMMENT ON COLUMN ai_cart.project_id IS '所属项目';
COMMENT ON COLUMN ai_cart.paper_id IS '论文（外键 RESTRICT：被骨架引用不可删）';
COMMENT ON COLUMN ai_cart.category IS '分类（foundation=奠基 mainstream=主流 frontier=前沿）';
COMMENT ON COLUMN ai_cart.added_at IS '加入时间';
COMMENT ON COLUMN ai_cart.notes IS '加入理由/备注';
