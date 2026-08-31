"use client";

import { useState, useEffect, useRef } from "react";
import { Loader2, Layers, ArrowRight, Package } from "lucide-react";
import {
  startBranchAnalyze, getBranchStatus, getBranchResult, getBranchResults,
} from "@/lib/api/branch";
import type { BranchAnalyzeResponse, CartStatus } from "@/types/dto";
import type { Category } from "@/types/domain";
import { useBranchStore } from "@/stores/branchStore";
import { useTaskPolling } from "@/hooks/useTaskPolling";
import { CATEGORY_GROUPS } from "@/config/categories";
import { BRANCH_MODES } from "@/config/branch";
import { BranchMixedView } from "./BranchMixedView";
import { toast } from "@/lib/toast";

interface BranchPanelProps {
  projectId: number;
  cart: CartStatus | null;
}

/**
 * 分支深挖面板 —— 只负责分析任务的发起/轮询与结果区切换
 *
 * 结果区始终显示三类混合视图（已分析→结果卡，未分析→待分析卡），见 BranchMixedView。
 */
export function BranchPanel({ projectId, cart }: BranchPanelProps) {
  // ── 本地 UI 输入（不需要缓存，切换标签页可重置） ──
  const [mode, setMode] = useState("probe_match");
  const [probe, setProbe] = useState("");
  // 当前正在分析哪个分类（""=全量，用于分析中波纹动画）
  const [analyzingCat, setAnalyzingCat] = useState("");

  // ── 从全局 store 读取分析结果（按 projectId + mode，切换标签页/模式不丢失） ──
  const byMode = useBranchStore((s) => s.resultsByProject[projectId] ?? {});
  const result = byMode[mode] ?? null;
  const analyzing = useBranchStore((s) => s.analyzingByProject[projectId] ?? false);
  const progress = useBranchStore((s) => s.progressByProject[projectId] ?? "");
  const setResult = useBranchStore((s) => s.setResult);
  const setAnalyzing = useBranchStore((s) => s.setAnalyzing);
  const setProgress = useBranchStore((s) => s.setProgress);

  // ── 挂载时回拉后端已持久化的历史结果（刷新页面恢复，按当前模式） ──
  const fetchedRef = useRef<Record<string, boolean>>({});

  useEffect(() => {
    if (result) return;
    const key = `${projectId}:${mode}`;
    if (fetchedRef.current[key]) return;
    fetchedRef.current[key] = true;

    const ac = new AbortController();
    let cancelled = false;
    getBranchResults(projectId, mode, ac.signal)
      .then((res) => {
        if (!cancelled && !ac.signal.aborted && res.total > 0) {
          setResult(projectId, mode, res);
        }
      })
      .catch(() => {
        // 静默失败：没有历史结果是正常情况（还没跑过分析）；取消(abort)也走这里
      });

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [projectId, mode, result, setResult]);

  // ── 启动分析（category 为空=全量，否则单类）──
  // 轮询统一走 useTaskPolling；analyzing/progress 同步到 store
  // 当前分析范围（供 onRun 闭包使用，避免过期捕获）
  const analyzeCatRef = useRef("");
  const { running, run } = useTaskPolling<BranchAnalyzeResponse>({
    onRun: () =>
      startBranchAnalyze({
        project_id: projectId,
        mode,
        probe: mode === "probe_match" ? probe : undefined,
        category: analyzeCatRef.current as Category | "",
      }),
    getStatus: getBranchStatus,
    getResult: getBranchResult,
    onProgress: (status) => {
      const pct = status.total ? ` (${status.current}/${status.total})` : "";
      setProgress(projectId, `${status.detail || "分析中"}${pct}`);
    },
    onResult: (res) => {
      // 合并：单类分析只返回该分类的结果，与 store 中已有的同 mode 结果合并（按 paper_id 去重）
      const oldRes = byMode[mode];
      if (oldRes && oldRes.results.length > 0 && res.results.length > 0) {
        const mergedResults = [...res.results];
        const newIds = new Set(res.results.map((r) => r.paper_id));
        for (const old of oldRes.results) {
          if (!newIds.has(old.paper_id)) {
            mergedResults.push(old);
          }
        }
        setResult(projectId, mode, {
          ...res,
          results: mergedResults,
          total: mergedResults.length,
        });
      } else {
        setResult(projectId, mode, res);
      }
    },
    onError: (e) => {
      toast(`分析失败: ${e instanceof Error ? e.message : String(e)}`, "error");
    },
    intervalMs: 2000,
  });

  // 分析中状态同步到 store（开始置 true，结束清空进度与高亮分类）
  useEffect(() => {
    setAnalyzing(projectId, running);
    if (!running) {
      setAnalyzingCat("");
      setProgress(projectId, "");
    }
  }, [running, projectId, setAnalyzing, setProgress]);

  const handleAnalyze = async (category = "") => {
    analyzeCatRef.current = category;
    setAnalyzingCat(category);
    setProgress(projectId, "正在启动分析...");
    // 不清空旧结果：分析期间保留原卡片，新结果返回后合并
    run();
  };

  // 骨架是否为空（cart 为空 or total 为 0）
  const cartEmpty = !cart || cart.total === 0;
  const catCounts = (cat: string) =>
    cart?.items.filter((it) => it.category === cat).length ?? 0;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-line bg-paper-white shrink-0 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-lg font-semibold text-ink">分支深挖</h2>

          {/* 分析对象状态条：直接说明"深挖的是骨架" */}
          <div className="flex items-center gap-2 text-sm">
            <span className="text-ink-muted flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-gold-light" />
              分析对象：核心骨架
            </span>
            {cartEmpty ? (
              <span className="badge bg-red-500/15 text-red-400">空骨架</span>
            ) : (
              <span className="badge bg-paper-warm text-ink-secondary tabular-nums">
                {cart.total} 篇
              </span>
            )}
            {!cartEmpty && (
              <span className="flex items-center gap-1.5 text-xs text-ink-faint">
                {CATEGORY_GROUPS.map((g, i) => (
                  <span key={g.key}>
                    {i > 0 && "·"}
                    {g.label} {catCounts(g.key)}
                  </span>
                ))}
              </span>
            )}
          </div>
        </div>

        {/* 空骨架引导 */}
        {cartEmpty && (
          <div className="flex items-center gap-3 bg-paper-warm rounded-lg px-4 py-3 border border-gold/15">
            <Package className="w-4 h-4 text-ink-faint shrink-0" />
            <p className="text-sm text-ink-secondary">
              骨架为空，分支深挖会逐篇分析骨架论文。先去添加论文吧。
            </p>
            <a
              href="#cart"
              onClick={() => window.dispatchEvent(new CustomEvent("navigate-to-cart"))}
              className="btn-secondary text-sm ml-auto flex items-center gap-1"
            >
              去骨架页
              <ArrowRight className="w-3 h-3" />
            </a>
          </div>
        )}

        {/* 模式选择：卡片式，带图标、场景说明、已分析状态 */}
        <div className="grid grid-cols-3 gap-2">
          {BRANCH_MODES.map((m) => {
            const Icon = m.icon;
            const active = mode === m.key;
            const modeResult = byMode[m.key];
            const analyzed = !!modeResult && modeResult.total > 0;
            return (
              <button
                key={m.key}
                onClick={() => setMode(m.key)}
                disabled={analyzing}
                className={`rounded-lg px-3 py-2.5 text-left transition-all border ${
                  active
                    ? "bg-accent-light border-gold/40"
                    : "bg-paper-warm border-transparent hover:bg-paper-warm/70"
                }`}
              >
                <span className={`flex items-center gap-1.5 text-sm font-medium ${active ? "text-gold-light" : "text-ink"}`}>
                  <Icon className="w-3.5 h-3.5" />
                  {m.label}
                  {analyzed && (
                    <span className="ml-auto text-[9.5px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300">
                      ✓ 已分析
                    </span>
                  )}
                </span>
                <span className="block text-xs text-ink-muted mt-0.5">{m.desc}</span>
              </button>
            );
          })}
        </div>

        {mode === "probe_match" && (
          <input type="text" value={probe} onChange={(e) => setProbe(e.target.value)}
            placeholder="输入技术探针，如：Transformer、GAN、PDE 约束" className="input" />
        )}
        <button onClick={() => handleAnalyze("")}
          disabled={analyzing || cartEmpty || (mode === "probe_match" && !probe.trim())}
          className="btn-primary">
          {analyzing ? <><Loader2 className="w-3.5 h-3.5 inline mr-1.5 animate-spin" />{progress || "分析中..."}</> : "全量分析"}
        </button>
      </div>

      {/* Result：始终显示三类混合视图（已分析→结果卡，未分析→待分析卡） */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {cartEmpty ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center space-y-2">
              <p className="text-base text-ink-faint">
                添加骨架论文后，即可开始分支深挖
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* 分析中进度条（叠加在顶部，不黑屏） */}
            {analyzing && (
              <div className="mb-3 flex items-center gap-2 text-sm text-gold-light
                              bg-accent-light/40 rounded-lg px-4 py-2.5 border border-gold/25">
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                <span className="truncate">
                  {analyzingCat
                    ? `正在深挖「${CATEGORY_GROUPS.find((g) => g.key === analyzingCat)?.label ?? ""}」：${progress || "准备中..."}`
                    : `正在分析：${progress || "准备中..."}`}
                </span>
                <span className="ml-auto text-xs text-ink-muted shrink-0">
                  完成后将自动更新对应分组
                </span>
              </div>
            )}
            <BranchMixedView
              cart={cart}
              result={result}
              mode={mode}
              analyzing={analyzing}
              analyzingCat={analyzingCat}
              probeEmpty={mode === "probe_match" && !probe.trim()}
              onAnalyze={(cat) => handleAnalyze(cat)}
            />
          </>
        )}
      </div>
    </div>
  );
}
