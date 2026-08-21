/**
 * 网络分析结果 store
 *
 * 解决：切换标签页时 NetworkPanel 被卸载，内部 useState 结果丢失的问题。
 *
 * 与 branchStore 的差异：
 * 后端目前没有 network 结果的持久化接口（只有内存 task），
 * 所以这里用 persist 中间件缓存到 localStorage，刷新页面也能恢复。
 *
 * 按 (projectId, category) 缓存：全量（""）与单类（foundation/mainstream/frontier）
 * 结果独立，互不覆盖——可先全量分析，再对某类单独分析。
 */
"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { NetworkResultResponse } from "@/lib/api";

interface NetworkStore {
  /** 网络分析结果（按 projectId + category 缓存） */
  resultsByProject: Record<number, Record<string, NetworkResultResponse>>;
  /** 当前项目是否正在分析中 */
  analyzingByProject: Record<number, boolean>;
  /** 最近一次轮询的进度信息 */
  progressByProject: Record<number, string>;

  /** 设置某项目某分类的结果（传 null 表示清除） */
  setResult: (
    projectId: number,
    category: string,
    result: NetworkResultResponse | null,
  ) => void;
  /** 设置某项目的分析中状态 */
  setAnalyzing: (projectId: number, analyzing: boolean) => void;
  /** 设置某项目的进度文本 */
  setProgress: (projectId: number, progress: string) => void;
  /** 清空某项目的全部状态 */
  clearProject: (projectId: number) => void;
}

export const useNetworkStore = create<NetworkStore>()(
  persist(
    (set) => ({
      resultsByProject: {},
      analyzingByProject: {},
      progressByProject: {},

      setResult: (projectId, category, result) =>
        set((state) => {
          const resultsByProject = { ...state.resultsByProject };
          const byCat = { ...(resultsByProject[projectId] || {}) };
          if (result === null) {
            delete byCat[category];
          } else {
            byCat[category] = result;
          }
          if (Object.keys(byCat).length === 0) {
            delete resultsByProject[projectId];
          } else {
            resultsByProject[projectId] = byCat;
          }
          return { resultsByProject };
        }),

      setAnalyzing: (projectId, analyzing) =>
        set((state) => ({
          analyzingByProject: {
            ...state.analyzingByProject,
            [projectId]: analyzing,
          },
        })),

      setProgress: (projectId, progress) =>
        set((state) => ({
          progressByProject: {
            ...state.progressByProject,
            [projectId]: progress,
          },
        })),

      clearProject: (projectId) =>
        set((state) => {
          const resultsByProject = { ...state.resultsByProject };
          const analyzingByProject = { ...state.analyzingByProject };
          const progressByProject = { ...state.progressByProject };
          delete resultsByProject[projectId];
          delete analyzingByProject[projectId];
          delete progressByProject[projectId];
          return { resultsByProject, analyzingByProject, progressByProject };
        }),
    }),
    {
      name: "scholar-funnel-network", // localStorage key
      storage: createJSONStorage(() => localStorage),
      // 只持久化结果，不持久化"正在分析"这类瞬时状态
      partialize: (state) => ({
        resultsByProject: state.resultsByProject,
      }),
    },
  ),
);
