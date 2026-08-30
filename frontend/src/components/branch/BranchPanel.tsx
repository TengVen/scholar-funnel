"use client";

import { useState, useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import {
  Loader2, Crosshair,
  Layers, ArrowRight, Package,
} from "lucide-react";
import {
  startBranchAnalyze, getBranchStatus, getBranchResult, getBranchResults,
} from "@/lib/api/branch";
import type { BranchPaperResult, BranchAnalyzeResponse, CartStatus, CartItem } from "@/types/dto";
import type { Category } from "@/types/domain";
import { useBranchStore } from "@/stores/branchStore";
import { useTaskPolling } from "@/hooks/useTaskPolling";
import { KEYWORD_COLORS } from "@/config/keywords";
import { CATEGORY_COLORS, CATEGORY_GROUPS } from "@/config/categories";
import { BRANCH_MODES } from "@/config/branch";
import { BranchSquareCard } from "./BranchSquareCard";
import { LandscapeCard } from "./LandscapeCard";
import { toast } from "@/lib/toast";

interface BranchPanelProps {
  projectId: number;
  cart: CartStatus | null;
}

// 分组标题：专属色 + 水波流光带 + 单类分析按钮
function GroupHeader({
  cat, label, count, analyzing, probeEmpty, onAnalyze,
}: {
  cat: string; label: string; count: number;
  analyzing: boolean; probeEmpty: boolean;
  onAnalyze: (cat: string) => void;
}) {
  const c = CATEGORY_COLORS[cat as Category] ?? CATEGORY_COLORS.mainstream;
  return (
    <div className="mb-2">
      <div className="flex items-center gap-2">
        <span className="w-1.5 h-3.5 rounded-full shrink-0" style={{ background: c.dot }} />
        <span className="text-base font-medium" style={{ color: c.text }}>
          {label}
        </span>
        <span className="text-xs text-gold-light tabular-nums font-medium">
          {count} 篇
        </span>
        {/* 单类分析：与标题同风格 + 鎏金边框 360° 环绕（按钮保持原样） */}
        <button
          onClick={() => onAnalyze(cat)}
          disabled={analyzing || count === 0 || probeEmpty}
          className="relative rounded-md overflow-hidden shrink-0
                     disabled:opacity-40 disabled:cursor-not-allowed disabled:[&_.gold-border-rotator]:hidden"
          title={`对「${label}」按当前模式分析`}
        >
          {/* 旋转的鎏金 conic 渐变 */}
          <span
            className="gold-border-rotator absolute"
            style={{
              inset: -30,
              background:
                "conic-gradient(from 0deg, transparent 0deg, transparent 300deg, #F0CE6E 340deg, #FFE9A8 360deg)",
            }}
          />
          {/* 内容层（遮住中间，只露边框） */}
          <span
            className="relative block rounded-[5px] px-2.5 py-1 text-xs font-medium"
            style={{ color: c.textBright, background: "#1e1b17" }}
          >
            单类分析
          </span>
        </button>
      </div>
      {/* 水波流光带（亮色） */}
      <div
        className="flow-bar h-[3px] rounded-full mt-1.5"
        style={{
          backgroundImage: c.bar,
          opacity: 0.85,
          boxShadow: `0 0 8px ${c.dot}55`,
        }}
      />
    </div>
  );
}

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

// ══════════════════════════════════════════════════════════
//  三类混合视图：始终展示全部三类
//  - 已分析（result 中有 paper_id）→ 结果卡（landscape 用 LandscapeCard，其余用 BranchSquareCard）
//  - 未分析 → 待分析卡 SkeletonPreviewCard
//  - 该组正在分析 → 整组鎏金涟漪波纹 + 半透明降级其他组
// ══════════════════════════════════════════════════════════

function BranchMixedView({
  cart, result, mode, analyzing, analyzingCat, probeEmpty, onAnalyze,
}: {
  cart: CartStatus;
  result: { results: BranchPaperResult[] } | null;
  mode: string;
  analyzing: boolean;
  analyzingCat: string;
  probeEmpty: boolean;
  onAnalyze: (cat: string) => void;
}) {
  // 已分析论文的 paper_id → 结果 映射
  const analyzedMap = new Map<number, BranchPaperResult>();
  result?.results.forEach((p) => analyzedMap.set(p.paper_id, p));

  return (
    <div className="space-y-5">
      {/* 提示条 */}
      <div className="flex items-center gap-2 text-sm text-ink-muted bg-paper-warm rounded-lg px-4 py-2.5">
        <Layers className="w-3.5 h-3.5 text-gold-light shrink-0" />
        <span>
          {result && result.results.length > 0
            ? `已深挖 ${result.results.length} 篇，未分析的分类仍显示待分析卡片`
            : `当前为骨架中的 ${cart.total} 篇论文，选择上方模式点击「全量分析」，或点分类旁的「单类分析」只深挖那一类`}
        </span>
      </div>

      {CATEGORY_GROUPS.map(({ key, label }) => {
        const items = cart.items.filter((it) => it.category === key);
        if (items.length === 0) return null;
        const isAnalyzing = analyzing && analyzingCat === key;
        const c = CATEGORY_COLORS[key] ?? CATEGORY_COLORS.mainstream;
        return (
          <div
            key={key}
            className={`relative rounded-xl transition-opacity ${isAnalyzing ? "" : analyzing ? "opacity-60" : ""}`}
            style={isAnalyzing ? ({ "--ripple-color": `${c.dot}88` } as CSSProperties) : undefined}
          >
            {/* 分析中：鎏金涟漪波纹（三层扩散） */}
            {isAnalyzing && (
              <>
                <span className="ripple-ring absolute inset-0 rounded-xl pointer-events-none" />
                <span className="ripple-ring-2 absolute inset-0 rounded-xl pointer-events-none" />
                <span className="ripple-ring-3 absolute inset-0 rounded-xl pointer-events-none" />
              </>
            )}
            {/* 分析中：组容器鎏金亮边 */}
            <div
              className={isAnalyzing ? "rounded-xl border border-gold/60 bg-accent-light/20 -m-px" : ""}
              style={isAnalyzing ? { boxShadow: `0 0 16px ${c.dot}33` } : undefined}
            />
            <div className="relative">
              <GroupHeader
                cat={key} label={label} count={items.length}
                analyzing={isAnalyzing} probeEmpty={probeEmpty} onAnalyze={onAnalyze}
              />
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-2.5">
                {items.map((item) => {
                  const analyzed = analyzedMap.get(item.paper_id);
                  return analyzed ? (
                    mode === "landscape" ? (
                      <LandscapeCard key={item.paper_id} paper={analyzed} />
                    ) : (
                      <BranchSquareCard key={item.paper_id} paper={analyzed} mode={mode} />
                    )
                  ) : (
                    <SkeletonPreviewCard key={item.paper_id} item={item} />
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ══════════════════════════════════════════════════════════
//  待分析卡片（未分析论文的占位卡片）
// ══════════════════════════════════════════════════════════

function SkeletonPreviewCard({ item }: { item: CartItem }) {
  const authors = (item.authors || []).slice(0, 3).join(", ");

  return (
    <div className="rounded-lg px-4 py-3.5 flex flex-col min-h-[130px]
                    border border-dashed border-line bg-paper-white/40">
      {/* Title + 待分析徽章 */}
      <div className="flex items-start justify-between gap-2">
        <h4 className="font-serif text-base font-semibold text-ink leading-snug flex-1 line-clamp-2">
          {item.title}
        </h4>
        <span className="badge bg-paper-warm text-ink-faint shrink-0 whitespace-nowrap">
          待分析
        </span>
      </div>

      {/* Meta */}
      <div className="flex items-center gap-2 mt-1 text-xs text-ink-faint">
        {item.year && <span>{item.year}</span>}
        {item.cited_by_count > 0 && (
          <>
            <span className="text-line">|</span>
            <span>被引 {item.cited_by_count}</span>
          </>
        )}
        {item.venue && (
          <>
            <span className="text-line">|</span>
            <span className="truncate">{item.venue}</span>
          </>
        )}
        {authors && (
          <>
            <span className="text-line">|</span>
            <span className="truncate">{authors}</span>
          </>
        )}
      </div>

      {/* 分类理由 */}
      {item.notes && (
        <p className="text-xs text-gold-light/70 mt-1.5 flex items-center gap-1">
          <span className="w-1 h-1 rounded-full bg-gold shrink-0" />
          {item.notes}
        </p>
      )}

      {/* 关键词 */}
      {item.keywords && item.keywords.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 mt-1.5">
          {item.keywords.slice(0, 4).map((kw, i) => (
            <span
              key={kw}
              className="px-1.5 py-0.5 rounded-md text-2xs backdrop-blur-sm"
              style={{
                background: KEYWORD_COLORS[i % KEYWORD_COLORS.length].bg,
                border: `1px solid ${KEYWORD_COLORS[i % KEYWORD_COLORS.length].border}`,
                color: KEYWORD_COLORS[i % KEYWORD_COLORS.length].text,
              }}
            >
              {kw}
            </span>
          ))}
        </div>
      )}

      <div className="flex-1" />

      {/* Footer 提示 */}
      <div className="flex items-center gap-2 mt-2.5 pt-2.5 border-t border-line-light">
        <span className="text-2xs text-ink-faint flex items-center gap-1">
          <Crosshair className="w-2.5 h-2.5" />
          分析后将显示 方法/匹配/发现
        </span>
      </div>
    </div>
  );
}
