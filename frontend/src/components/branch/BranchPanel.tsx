"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { CSSProperties } from "react";
import {
  Loader2, ChevronDown, ChevronUp, ExternalLink, Crosshair, Wand2, Compass,
  Layers, ArrowRight, Package,
} from "lucide-react";
import {
  startBranchAnalyze, getBranchStatus, getBranchResult, getBranchResults,
  type BranchPaperResult, type CartStatus, type CartItem,
} from "@/lib/api";
import { useBranchStore } from "@/lib/stores/branchStore";

interface BranchPanelProps {
  projectId: number;
  cart: CartStatus | null;
}

// 关键词玻璃徽章配色（与检索页一致）
const KEYWORD_COLORS = [
  { bg: "rgba(94, 205, 196, 0.12)", border: "rgba(94, 205, 196, 0.32)", text: "#8FE3DA" },
  { bg: "rgba(120, 170, 255, 0.12)", border: "rgba(120, 170, 255, 0.32)", text: "#9FC4FF" },
  { bg: "rgba(140, 220, 160, 0.12)", border: "rgba(140, 220, 160, 0.32)", text: "#A9E8BC" },
  { bg: "rgba(180, 160, 240, 0.12)", border: "rgba(180, 160, 240, 0.32)", text: "#C4B4F5" },
  { bg: "rgba(110, 200, 230, 0.12)", border: "rgba(110, 200, 230, 0.32)", text: "#8FD8EC" },
];

const MODES = [
  {
    key: "probe_match", label: "探针匹配",
    desc: "骨架论文是否用了指定技术？",
    icon: Crosshair,
  },
  {
    key: "ai_suggest", label: "AI 推荐",
    desc: "让 AI 自动发现核心技术点",
    icon: Wand2,
  },
  {
    key: "landscape", label: "全景扫描",
    desc: "逐篇拆解方法论全貌",
    icon: Compass,
  },
];

const CONFIDENCE_MAP: Record<string, { label: string; cls: string }> = {
  high: { label: "高度匹配", cls: "bg-emerald-500/15 text-emerald-300" },
  medium: { label: "中等匹配", cls: "bg-amber-500/15 text-amber-300" },
  low: { label: "低度匹配", cls: "bg-orange-500/15 text-orange-300" },
  none: { label: "未匹配", cls: "bg-paper-warm text-ink-muted" },
};

const LEVEL_LABELS: Record<number, string> = {
  1: "PDF 全文", 2: "HTML 全文", 3: "LLM 回忆", 4: "引用上下文", 5: "仅摘要",
};

const CATEGORY_GROUPS = [
  { key: "foundation", label: "奠基理论" },
  { key: "mainstream", label: "主流方法" },
  { key: "frontier", label: "最新前沿" },
];

// 分类专属色（亮色版，与顶部导航珠宝色统一）+ 流光渐变对
const CATEGORY_COLORS: Record<string, { text: string; textBright: string; bar: string; dot: string }> = {
  foundation: { text: "#7BA7FF", textBright: "#A8C6FF", bar: "linear-gradient(90deg,#5B8FF9,#B7D2FF,#5B8FF9)", dot: "rgba(123,167,255,1)" },
  mainstream: { text: "#F0CE6E", textBright: "#FFE9A8", bar: "linear-gradient(90deg,#D6B35A,#FFE9A8,#D6B35A)", dot: "rgba(240,206,110,1)" },
  frontier: { text: "#5FCFBE", textBright: "#A8EADF", bar: "linear-gradient(90deg,#4FAF9F,#A8EADF,#4FAF9F)", dot: "rgba(95,207,190,1)" },
};

// 分组标题：专属色 + 水波流光带 + 单类分析按钮
function GroupHeader({
  cat, label, count, analyzing, probeEmpty, onAnalyze,
}: {
  cat: string; label: string; count: number;
  analyzing: boolean; probeEmpty: boolean;
  onAnalyze: (cat: string) => void;
}) {
  const c = CATEGORY_COLORS[cat] ?? CATEGORY_COLORS.mainstream;
  return (
    <div className="mb-2">
      <div className="flex items-center gap-2">
        <span className="w-1.5 h-3.5 rounded-full shrink-0" style={{ background: c.dot }} />
        <span className="text-[13px] font-medium" style={{ color: c.text }}>
          {label}
        </span>
        <span className="text-[11px] text-gold-light tabular-nums font-medium">
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
            className="relative block rounded-[5px] px-2.5 py-1 text-[11px] font-medium"
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

    let cancelled = false;
    getBranchResults(projectId, mode)
      .then((res) => {
        if (!cancelled && res.total > 0) {
          setResult(projectId, mode, res);
        }
      })
      .catch(() => {
        // 静默失败：没有历史结果是正常情况（还没跑过分析）
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, mode, result, setResult]);

  // ── 启动分析（category 为空=全量，否则单类） ──
  const handleAnalyze = useCallback(async (category = "") => {
    setAnalyzing(projectId, true);
    setAnalyzingCat(category);
    setProgress(projectId, "正在启动分析...");
    // 不清空旧结果：分析期间保留原卡片，新结果返回后合并
    try {
      const { task_id } = await startBranchAnalyze({
        project_id: projectId, mode,
        probe: mode === "probe_match" ? probe : undefined,
        category,
      });
      while (true) {
        await new Promise((r) => setTimeout(r, 2000));
        const status = await getBranchStatus(task_id);
        if (status.status === "done") break;
        if (status.status === "error") throw new Error(status.error || "分析失败");
        const pct = status.total ? ` (${status.current}/${status.total})` : "";
        setProgress(projectId, `${status.detail || "分析中"}${pct}`);
      }
      const res = await getBranchResult(task_id);
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
    } catch (e) {
      alert(`分析失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAnalyzing(projectId, false);
      setAnalyzingCat("");
      setProgress(projectId, "");
    }
  }, [projectId, mode, probe, byMode, setAnalyzing, setProgress, setResult]);

  // 骨架是否为空（cart 为空 or total 为 0）
  const cartEmpty = !cart || cart.total === 0;
  const catCounts = (cat: string) =>
    cart?.items.filter((it) => it.category === cat).length ?? 0;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-line bg-paper-white shrink-0 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-[15px] font-semibold text-ink">分支深挖</h2>

          {/* 分析对象状态条：直接说明"深挖的是骨架" */}
          <div className="flex items-center gap-2 text-[12px]">
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
              <span className="flex items-center gap-1.5 text-[11px] text-ink-faint">
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
            <p className="text-[12.5px] text-ink-secondary">
              骨架为空，分支深挖会逐篇分析骨架论文。先去添加论文吧。
            </p>
            <a
              href="#cart"
              onClick={() => window.dispatchEvent(new CustomEvent("navigate-to-cart"))}
              className="btn-secondary text-[12px] ml-auto flex items-center gap-1"
            >
              去骨架页
              <ArrowRight className="w-3 h-3" />
            </a>
          </div>
        )}

        {/* 模式选择：卡片式，带图标、场景说明、已分析状态 */}
        <div className="grid grid-cols-3 gap-2">
          {MODES.map((m) => {
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
                <span className={`flex items-center gap-1.5 text-[12.5px] font-medium ${active ? "text-gold-light" : "text-ink"}`}>
                  <Icon className="w-3.5 h-3.5" />
                  {m.label}
                  {analyzed && (
                    <span className="ml-auto text-[9.5px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300">
                      ✓ 已分析
                    </span>
                  )}
                </span>
                <span className="block text-[11px] text-ink-muted mt-0.5">{m.desc}</span>
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
              <p className="text-[13px] text-ink-faint">
                添加骨架论文后，即可开始分支深挖
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* 分析中进度条（叠加在顶部，不黑屏） */}
            {analyzing && (
              <div className="mb-3 flex items-center gap-2 text-[12px] text-gold-light
                              bg-accent-light/40 rounded-lg px-4 py-2.5 border border-gold/25">
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                <span className="truncate">
                  {analyzingCat
                    ? `正在深挖「${CATEGORY_GROUPS.find((g) => g.key === analyzingCat)?.label ?? ""}」：${progress || "准备中..."}`
                    : `正在分析：${progress || "准备中..."}`}
                </span>
                <span className="ml-auto text-[11px] text-ink-muted shrink-0">
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
//  - 已分析（result 中有 paper_id）→ 结果卡 BranchSquareCard
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
      <div className="flex items-center gap-2 text-[12px] text-ink-muted bg-paper-warm rounded-lg px-4 py-2.5">
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
                    <BranchSquareCard key={item.paper_id} paper={analyzed} mode={mode} />
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
        <h4 className="font-serif text-[13px] font-semibold text-ink leading-snug flex-1 line-clamp-2">
          {item.title}
        </h4>
        <span className="badge bg-paper-warm text-ink-faint shrink-0 whitespace-nowrap">
          待分析
        </span>
      </div>

      {/* Meta */}
      <div className="flex items-center gap-2 mt-1 text-[11px] text-ink-faint">
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
        <p className="text-[11px] text-gold-light/70 mt-1.5 flex items-center gap-1">
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
              className="px-1.5 py-0.5 rounded-md text-[10px] backdrop-blur-sm"
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
        <span className="text-[10.5px] text-ink-faint flex items-center gap-1">
          <Crosshair className="w-2.5 h-2.5" />
          分析后将显示 方法/匹配/发现
        </span>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
//  方形卡片（紧凑版）
// ══════════════════════════════════════════════════════════

function BranchSquareCard({ paper, mode }: { paper: BranchPaperResult; mode: string }) {
  const [expanded, setExpanded] = useState(false);
  const confidence = CONFIDENCE_MAP[paper.probe_confidence] || CONFIDENCE_MAP.none;
  const levelLabel = LEVEL_LABELS[paper.content_level] || "未知";

  return (
    <div className="card px-4 py-3.5 flex flex-col min-h-[150px]">
      {/* Top row: title + badges */}
      <div className="flex items-start justify-between gap-2">
        <h4 className="font-serif text-[13px] font-semibold text-ink leading-snug flex-1 line-clamp-2">
          {paper.title}
        </h4>
        <div className="flex items-center gap-1.5 shrink-0">
          {mode === "probe_match" && (
            <span className={`badge ${confidence.cls}`}>{confidence.label}</span>
          )}
        </div>
      </div>

      {/* Meta */}
      <div className="flex items-center gap-2 mt-1 text-[11px] text-ink-faint">
        {paper.year && <span>{paper.year}</span>}
        {paper.cited_by_count > 0 && (
          <>
            <span className="text-line">|</span>
            <span>被引 {paper.cited_by_count}</span>
          </>
        )}
        <span className="ml-auto badge bg-paper-warm text-ink-muted px-1.5">
          L{paper.content_level} {levelLabel}
        </span>
      </div>

      {/* Method summary */}
      {paper.method_summary && (
        <p className="mt-2 text-[12px] text-ink-secondary leading-relaxed line-clamp-3 flex-1">
          {paper.method_summary}
        </p>
      )}

      {/* Findings / optimization */}
      {(paper.key_findings || paper.optimization_method) && (
        <div className="mt-1.5 space-y-0.5">
          {paper.key_findings && (
            <p className="text-[11px] text-ink-muted line-clamp-2">
              <span className="text-ink-secondary font-medium">发现：</span>
              {paper.key_findings}
            </p>
          )}
          {paper.optimization_method && (
            <p className="text-[11px] text-ink-muted line-clamp-2">
              <span className="text-ink-secondary font-medium">方法：</span>
              {paper.optimization_method}
            </p>
          )}
        </div>
      )}

      {paper.error && <p className="mt-2 text-[11px] text-red-400">{paper.error}</p>}

      {/* Footer */}
      <div className="flex items-center gap-2 mt-2.5 pt-2.5 border-t border-line-light">
        {paper.doi && (
          <a href={`https://doi.org/${paper.doi}`} target="_blank" rel="noopener noreferrer"
            className="btn-ghost text-[11px]">
            <ExternalLink className="w-2.5 h-2.5 inline mr-0.5" />DOI
          </a>
        )}
        {paper.abstract && (
          <button onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-0.5 text-[11px] text-ink-faint hover:text-ink-muted transition-colors">
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {expanded ? "收起" : "摘要"}
          </button>
        )}
        <div className="flex-1" />
        <span className="text-[10.5px] text-ink-faint">{paper.content_source}</span>
      </div>

      {expanded && paper.abstract && (
        <p className="mt-2 text-[12px] text-ink-secondary leading-relaxed">{paper.abstract}</p>
      )}
    </div>
  );
}
