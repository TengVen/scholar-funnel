-- ════════════════════════════════════════════════
-- Scholar Funnel · PostgreSQL 迁移 DDL · 13 系统公告表
-- 内容：ai_announcements（对话页铃铛展示；后台可随时增改）
-- 字段：level(info/warning/danger) + title + content + active + start_at/end_at(时间窗)
-- 说明：幂等（CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS）
-- ════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ai_announcements (
    id          BIGSERIAL PRIMARY KEY,
    level       VARCHAR(16)  NOT NULL DEFAULT 'info',
    title       VARCHAR(255) NOT NULL,
    content     TEXT         NOT NULL,
    active      BOOLEAN      NOT NULL DEFAULT TRUE,
    start_at    TIMESTAMP,
    end_at      TIMESTAMP,
    created_at  TIMESTAMP    NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_announcements_active
    ON ai_announcements (active, created_at DESC);
