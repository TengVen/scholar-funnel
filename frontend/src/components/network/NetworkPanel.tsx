"use client";

import { useState, useRef, useEffect } from "react";
import { Loader2, Share2, ArrowRight, Package } from "lucide-react";
import { startNetworkAnalyze, getNetworkStatus, getNetworkResult } from "@/lib/api/network";
import type { NetworkResultResponse, CartStatus } from "@/types/dto";
import { useNetworkStore } from "@/stores/networkStore";
import { useTaskPolling } from "@/hooks/useTaskPolling";
import { CATEGORY_GROUPS } from "@/config/categories";
import { toast } from "@/lib/toast";
import { AnalyzingScene } from "./AnalyzingScene";
import { SkeletonPreviewWall } from "./SkeletonPreviewWall";
import { NetworkChart } from "./NetworkChart";
import { RecommendedPaperCard } from "./RecommendedPaperCard";

interface NetworkPanelProps {
  projectId: number;
  cart: CartStatus | null;
}

/**
 * 网络图谱面板 —— 只负责分析任务的发起/轮询与结果区切换
 *
 * 三态渲染：有结果 → 图表+推荐列表；分析中 → AnalyzingScene；
 * 未分析 → SkeletonPreviewWall。各态子组件见同目录同名文件。
 */
export function NetworkPanel({ projectId, cart }: NetworkPanelProps) {
  // ── 本地 UI 状态（切换标签页可重置） ──
  const [activeTab, setActiveTab] = useState<"backward" | "forward">("backward");
  // 当前查看范围：""=全量，foundation/mainstream/frontier=单类
  const [viewCat, setViewCat] = useState("");
  // 当前正在分析的范围（用于分析中放大动画）
  const [analyzingCat, setAnalyzingCat] = useState("");

  // ── 从全局 store 读取分析结果（按 projectId + category，互不覆盖） ──
  const byCat = useNetworkStore((s) => s.resultsByProject[projectId] ?? {});
  const result = byCat[viewCat] ?? null;
  const analyzing = useNetworkStore((s) => s.analyzingByProject[projectId] ?? false);
  const progress = useNetworkStore((s) => s.progressByProject[projectId] ?? "");
  const setResult = useNetworkStore((s) => s.setResult);
  const setAnalyzing = useNetworkStore((s) => s.setAnalyzing);
  const setProgress = useNetworkStore((s) => s.setProgress);

  // ── 启动分析（category 空=全量，否则单类）──
  // 轮询统一走 useTaskPolling；analyzing/progress 同步到 store
  const analyzeCatRef = useRef("");
  const { running, run } = useTaskPolling<NetworkResultResponse>({
    onRun: () => startNetworkAnalyze(projectId, analyzeCatRef.current),
    getStatus: getNetworkStatus,
    getResult: getNetworkResult,
    onProgress: (status) => {
      setProgress(projectId, status.step ? `${status.step}：${status.detail || "..."}` : "分析中...");
    },
    onResult: (res) => {
      setResult(projectId, analyzeCatRef.current, res);
    },
    onError: (e) => {
      toast(`分析失败: ${e instanceof Error ? e.message : String(e)}`, "error");
    },
    intervalMs: 3000,
  });

  // 分析中状态同步到 store（开始置 true，结束清空进度与高亮分类）
  useEffect(() => {
    setAnalyzing(projectId, running);
    if (!running) {
      setAnalyzingCat("");
      setProgress(projectId, "");
    }
  }, [running, projectId, setAnalyzing, setProgress]);

  const handleAnalyze = (category = "") => {
    analyzeCatRef.current = category;
    setAnalyzingCat(category);
    setProgress(projectId, "正在启动分析...");
    setResult(projectId, category, null);
    run();
  };

  const cartEmpty = !cart || cart.total === 0;
  const catCounts = (cat: string) =>
    cart?.items.filter((it) => it.category === cat).length ?? 0;

  // 各范围是否有结果（用于 ✓已分析 标记）
  const hasResult = (cat: string) => !!byCat[cat] && byCat[cat].stats && !byCat[cat].stats.error;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-6 py-4 border-b border-line bg-paper-white shrink-0 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-lg font-semibold text-ink">网络图谱</h2>
          {/* 分析对象状态条 */}
          <div className="flex items-center gap-2 text-sm">
            <span className="text-ink-muted flex items-center gap-1.5">
              <Share2 className="w-3.5 h-3.5 text-gold-light" />
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

        <p className="text-sm text-ink-muted">基于骨架论文的引用关系，发现遗漏的奠基论文和最新前沿</p>

        {/* 空骨架引导 */}
        {cartEmpty && (
          <div className="flex items-center gap-3 bg-paper-warm rounded-lg px-4 py-3 border border-gold/15">
            <Package className="w-4 h-4 text-ink-faint shrink-0" />
            <p className="text-sm text-ink-secondary">
              骨架为空，网络分析基于骨架论文的引用关系。先去添加论文吧。
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

        {/* 范围选择 + 全量分析 */}
        <div className="flex flex-wrap items-center gap-2">
          {[{ key: "", label: "全部" }, ...CATEGORY_GROUPS].map((g) => (
            <button
              key={g.key || "all"}
              onClick={() => setViewCat(g.key)}
              className={`px-2.5 py-1 rounded-md text-sm transition-colors ${
                viewCat === g.key
                  ? "bg-accent-light text-accent font-medium"
                  : "text-ink-muted hover:text-ink-secondary bg-paper-warm"
              }`}
            >
              {g.label}
              {hasResult(g.key) && (
                <span className="ml-1 text-[9.5px] px-1 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300">
                  ✓
                </span>
              )}
            </button>
          ))}
          <div className="flex-1" />
          <button
            onClick={() => handleAnalyze(viewCat)}
            disabled={analyzing || cartEmpty || (viewCat !== "" && catCounts(viewCat) === 0)}
            className="btn-primary"
          >
            {analyzing
              ? <><Loader2 className="w-3.5 h-3.5 inline mr-1.5 animate-spin" />{progress || "分析中..."}</>
              : viewCat
                ? `分析${CATEGORY_GROUPS.find((g) => g.key === viewCat)?.label ?? ""}`
                : "开始全量网络分析"}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {result ? (
          <div className="space-y-4 px-6 py-4">
            <div className="flex items-center gap-5 text-sm text-ink-muted">
              <span>骨架 <span className="text-ink font-medium">{result.stats.skeleton_count ?? 0}</span></span>
              <span>后向推荐 <span className="text-ink font-medium">{result.stats.backward_count ?? 0}</span></span>
              <span>前向推荐 <span className="text-ink font-medium">{result.stats.forward_count ?? 0}</span></span>
              <span>图谱节点 <span className="text-ink font-medium">{result.stats.graph_nodes ?? 0}</span></span>
            </div>

            {result.graph_nodes.length > 0 && <NetworkChart result={result} />}

            <div className="flex gap-1 border-b border-line">
              <button onClick={() => setActiveTab("backward")}
                className={`px-4 py-2 text-base border-b-2 transition-colors ${activeTab === "backward" ? "border-accent text-accent font-medium" : "border-transparent text-ink-muted hover:text-ink-secondary"}`}>
                后向追溯（{result.backward.length} 篇）
              </button>
              <button onClick={() => setActiveTab("forward")}
                className={`px-4 py-2 text-base border-b-2 transition-colors ${activeTab === "forward" ? "border-accent text-accent font-medium" : "border-transparent text-ink-muted hover:text-ink-secondary"}`}>
                前向追踪（{result.forward.length} 篇）
              </button>
            </div>

            <div className="space-y-2">
              {(activeTab === "backward" ? result.backward : result.forward).map((paper, i) => (
                <RecommendedPaperCard
                  key={paper.openalex_id || i}
                  paper={paper}
                  projectId={projectId}
                  cart={cart}
                />
              ))}
              {(activeTab === "backward" ? result.backward : result.forward).length === 0 && (
                <p className="text-base text-ink-faint py-8 text-center">暂无推荐论文</p>
              )}
            </div>
          </div>
        ) : analyzing ? (
          /* 分析中：被分析的主星放大占主视野 + 轻量解析动画 */
          <AnalyzingScene
            category={analyzingCat}
            cart={cart}
            progress={progress}
          />
        ) : cartEmpty ? (
          <div className="flex items-center justify-center h-full px-6 py-4">
            <p className="text-base text-ink-faint">添加骨架论文后，即可开始网络分析</p>
          </div>
        ) : (
          /* 未分析：三区意境视图（三类独立成团，可单独/全量分析） */
          <SkeletonPreviewWall
            cart={cart}
            analyzing={analyzing}
            onAnalyze={async (cat) => {
              setViewCat(cat);
              await handleAnalyze(cat);
            }}
          />
        )}
      </div>
    </div>
  );
}
