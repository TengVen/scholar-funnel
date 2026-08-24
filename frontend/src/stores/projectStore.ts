/**
 * 项目与会话全局状态（zustand）
 *
 * 从 page.tsx 迁移：projects / activeProject / conversations /
 * activeConversationId / lastConvForProject / chatOpenConvId / chatNewSignal。
 */
import { create } from "zustand";
import { listProjects, createProject as apiCreateProject } from "@/lib/api/projects";
import { listConversations } from "@/lib/api/chat";
import type { ConversationSummary, Project } from "@/types/dto";

interface ProjectStore {
  projects: Project[];
  activeProject: Project | null;
  conversations: ConversationSummary[];
  activeConversationId: string | null;
  /** 每个项目最后使用的会话（切对话页时按项目恢复；-1 = 无项目时） */
  lastConvForProject: Record<number, string>;
  /** 待打开的历史会话（左侧点击，指令优先） */
  chatOpenConvId: string | null;
  /** 新对话信号（每次 +1 触发 ChatPanel 重置） */
  chatNewSignal: number;

  loadProjects: () => Promise<void>;
  loadConversations: () => Promise<void>;
  /** 创建项目：置顶 + 设为当前（错误向上抛，由调用方提示） */
  createProject: (query: string, techProbe: string) => Promise<Project>;
  /** 点项目 → 设为当前 + 清会话高亮 */
  selectProject: (p: Project) => void;
  setActiveProject: (p: Project | null) => void;
  /** 点会话 → 记录待打开 id + 高亮 */
  selectConversation: (cid: string) => void;
  /** 新对话 → 清指令 + 触发重置信号 */
  newConversation: () => void;
  setChatOpenConvId: (id: string | null) => void;
  setActiveConversationId: (id: string | null) => void;
  /** 记录当前项目最后使用的会话 */
  rememberLastConversation: (cid: string | null, pid: number | null) => void;
  /** 认证变化：清当前项目/会话（避免跨用户残留） */
  resetSession: () => void;
}

export const useProjectStore = create<ProjectStore>((set) => ({
  projects: [],
  activeProject: null,
  conversations: [],
  activeConversationId: null,
  lastConvForProject: {},
  chatOpenConvId: null,
  chatNewSignal: 0,

  loadProjects: async () => {
    try {
      set({ projects: await listProjects() });
    } catch {
      /* 静默 */
    }
  },

  loadConversations: async () => {
    try {
      set({ conversations: await listConversations() });
    } catch {
      /* 静默 */
    }
  },

  createProject: async (query, techProbe) => {
    const p = await apiCreateProject(query.slice(0, 80), query, techProbe);
    set((s) => ({ projects: [p, ...s.projects], activeProject: p }));
    return p;
  },

  selectProject: (p) => set({ activeProject: p, activeConversationId: null }),

  setActiveProject: (p) => set({ activeProject: p }),

  selectConversation: (cid) => set({ chatOpenConvId: cid, activeConversationId: cid }),

  newConversation: () =>
    set((s) => ({
      chatOpenConvId: null,
      activeConversationId: null,
      chatNewSignal: s.chatNewSignal + 1,
    })),

  setChatOpenConvId: (id) => set({ chatOpenConvId: id }),

  setActiveConversationId: (id) => set({ activeConversationId: id }),

  rememberLastConversation: (cid, pid) => {
    if (!cid) return;
    set((s) => ({ lastConvForProject: { ...s.lastConvForProject, [pid ?? -1]: cid } }));
  },

  resetSession: () => set({ activeProject: null, activeConversationId: null }),
}));
