/**
 * 全部 localStorage key 常量 —— 纯数据，禁止业务实现
 *
 * 只保存 key，不负责真正的存取（存取在 tokenStore / hooks 中）。
 */
export const STORAGE_KEYS = {
  /** 访问令牌 */
  accessToken: "sf_access_token",
  /** 刷新令牌 */
  refreshToken: "sf_refresh_token",
  /** 对话页配置 */
  chatConfig: "scholar_funnel_chat_config",
  /** 公告已读 id 集合 */
  announcementRead: "scholar_funnel_read_anns",
  /** 网络分析结果持久化（zustand persist） */
  networkResults: "scholar-funnel-network",
} as const;
