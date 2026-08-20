/**
 * 分支深挖结果 store
 *
 * 解决：切换标签页时 BranchPanel 被卸载，内部 useState 结果丢失的问题。
 *
 * 策略（双保险）：
 * 1. 内存态：result 提升到全局 store，组件卸载再挂载数据不丢（解决切换标签页）
 * 2. 后端回拉：组件挂载时若 store 为空，调 getBranchResults 拉取后端已持久化的历史
 *    （解决刷新页面后恢复）
 */
"use client";

import { create } from "zustand";
import type { BranchAnalyzeResponse } from "@/lib/api";

interface BranchStore {
  /** 分支分析结果（按 projectId 缓存，切项目不串数据） */
  resultsByProject: Record<number, BranchAnalyzeResponse>;
  /** 当前项目是否正在分析中 */
  analyzingByProject: Record<number, boolean>;
  /** 最近一次轮询的进度信息 */
  progressByProject: Record<number, string>;

  /** 设置某项目的结果（传 null 表示清除） */
  setResult: (projectId: number, result: BranchAnalyzeResponse | null) => void;
  /** 设置某项目的分析中状态 */
  setAnalyzing: (projectId: number, analyzing: boolean) => void;
  /** 设置某项目的进度文本 */
  setProgress: (projectId: number, progress: string) => void;
  /** 清空某项目的全部状态（如删除项目时） */
  clearProject: (projectId: number) => void;
}

export const useBranchStore = create<BranchStore>((set) => ({
  resultsByProject: {},
  analyzingByProject: {},
  progressByProject: {},

  setResult: (projectId, result) =>
    set((state) => {
      const resultsByProject = { ...state.resultsByProject };
      if (result === null) {
        delete resultsByProject[projectId];
      } else {
        resultsByProject[projectId] = result;
      }
      return { resultsByProject };
    }),

  setAnalyzing: (projectId, analyzing) =>
    set((state) => ({
      analyzingByProject: { ...state.analyzingByProject, [projectId]: analyzing },
    })),

  setProgress: (projectId, progress) =>
    set((state) => ({
      progressByProject: { ...state.progressByProject, [projectId]: progress },
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
}));
