"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Loader2, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import {
  startNetworkAnalyze, getNetworkStatus, getNetworkResult,
  type RecommendedPaper,
  type NetworkResultResponse,
} from "@/lib/api";
import { useNetworkStore } from "@/lib/stores/networkStore";

interface NetworkPanelProps {
  projectId: number;
  cartPaperIds: Set<number>;
  onAddToCart: (paperId: number) => void;
}

export function NetworkPanel({ projectId, cartPaperIds, onAddToCart }: NetworkPanelProps) {
  // ── 本地 UI 状态（切换标签页可重置） ──
  const [activeTab, setActiveTab] = useState<"backward" | "forward">("backward");

  // ── 从全局 store 读取分析结果（切换标签页不丢失，persist 保证刷新也不丢） ──
  const result = useNetworkStore((s) => s.resultsByProject[projectId] ?? null);
  const analyzing = useNetworkStore((s) => s.analyzingByProject[projectId] ?? false);
  const progress = useNetworkStore((s) => s.progressByProject[projectId] ?? "");
  const setResult = useNetworkStore((s) => s.setResult);
  const setAnalyzing = useNetworkStore((s) => s.setAnalyzing);
  const setProgress = useNetworkStore((s) => s.setProgress);

  // ── 启动分析 ──
  const handleAnalyze = useCallback(async () => {
    setAnalyzing(projectId, true);
    setProgress(projectId, "正在启动分析...");
    setResult(projectId, null);
    try {
      const { task_id } = await startNetworkAnalyze(projectId);
      while (true) {
        await new Promise((r) => setTimeout(r, 3000));
        const status = await getNetworkStatus(task_id);
        if (status.status === "done") break;
        if (status.status === "error") throw new Error(status.error || "分析失败");
        setProgress(projectId, status.step ? `${status.step}：${status.detail || "..."}` : "分析中...");
      }
      const res = await getNetworkResult(task_id);
      setResult(projectId, res);
    } catch (e) {
      alert(`分析失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAnalyzing(projectId, false);
      setProgress(projectId, "");
    }
  }, [projectId, setAnalyzing, setProgress, setResult]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-6 py-4 border-b border-line bg-paper-white shrink-0 space-y-3">
        <h2 className="font-serif text-[15px] font-semibold text-ink">网络图谱</h2>
        <p className="text-[12px] text-ink-muted">基于骨架论文的引用关系，发现遗漏的奠基论文和最新前沿</p>
        <button onClick={handleAnalyze} disabled={analyzing} className="btn-primary">
          {analyzing ? <><Loader2 className="w-3.5 h-3.5 inline mr-1.5 animate-spin" />{progress || "分析中..."}</> : "开始网络分析"}
        </button>
        {result && (
          <span className="inline-block text-[11px] text-ink-faint">
            上次分析已缓存{result.graph_nodes.length > 0 && `（${result.graph_nodes.length} 个节点）`}，重新分析会覆盖
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {result ? (
          <div className="space-y-4">
            <div className="flex items-center gap-5 text-[12px] text-ink-muted">
              <span>骨架 <span className="text-ink font-medium">{result.stats.skeleton_count ?? 0}</span></span>
              <span>后向推荐 <span className="text-ink font-medium">{result.stats.backward_count ?? 0}</span></span>
              <span>前向推荐 <span className="text-ink font-medium">{result.stats.forward_count ?? 0}</span></span>
              <span>图谱节点 <span className="text-ink font-medium">{result.stats.graph_nodes ?? 0}</span></span>
            </div>

            {result.graph_nodes.length > 0 && <NetworkChart result={result} />}

            <div className="flex gap-1 border-b border-line">
              <button onClick={() => setActiveTab("backward")}
                className={`px-4 py-2 text-[13px] border-b-2 transition-colors ${activeTab === "backward" ? "border-accent text-accent font-medium" : "border-transparent text-ink-muted hover:text-ink-secondary"}`}>
                后向追溯（{result.backward.length} 篇）
              </button>
              <button onClick={() => setActiveTab("forward")}
                className={`px-4 py-2 text-[13px] border-b-2 transition-colors ${activeTab === "forward" ? "border-accent text-accent font-medium" : "border-transparent text-ink-muted hover:text-ink-secondary"}`}>
                前向追踪（{result.forward.length} 篇）
              </button>
            </div>

            <div className="space-y-2">
              {(activeTab === "backward" ? result.backward : result.forward).map((paper, i) => (
                <RecommendedPaperCard key={paper.openalex_id || i} paper={paper} />
              ))}
              {(activeTab === "backward" ? result.backward : result.forward).length === 0 && (
                <p className="text-[13px] text-ink-faint py-8 text-center">暂无推荐论文</p>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-[13px] text-ink-faint">
              {analyzing ? "正在分析引用网络，请耐心等待..." : "点击开始网络分析，发现遗漏论文"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function NetworkChart({ result }: { result: NetworkResultResponse }) {
  const chartRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<{ dispose: () => void } | null>(null);

  useEffect(() => {
    if (!chartRef.current) return;
    const init = async () => {
      const echarts = await import("echarts");
      if (instanceRef.current) instanceRef.current.dispose();
      const chart = echarts.init(chartRef.current!);
      instanceRef.current = chart;

      const categories = [
        { name: "骨架论文", itemStyle: { color: "#c9a24b" } },
        { name: "后向推荐", itemStyle: { color: "#e0b56a" } },
        { name: "前向推荐", itemStyle: { color: "#7fc79e" } },
      ];
      const catMap: Record<string, number> = { foundation: 0, mainstream: 0, frontier: 0, skeleton: 0, backward: 1, forward: 2 };

      chart.setOption({
        backgroundColor: "transparent",
        tooltip: {
          backgroundColor: "#171614",
          borderColor: "#2a2620",
          textStyle: { color: "#f0ece4", fontSize: 12 },
          formatter: (p: { name: string; value?: number }) => `${p.name}${p.value ? ` (${p.value})` : ""}`,
        },
        legend: { data: ["骨架论文", "后向推荐", "前向推荐"], top: 10, textStyle: { color: "#8f8a80", fontSize: 12 } },
        series: [{
          type: "graph", layout: "force", roam: true,
          label: { show: true, fontSize: 10, position: "right", color: "#b8b0a4" },
          edgeSymbol: ["", "arrow"], edgeSymbolSize: [0, 8],
          lineStyle: { color: "#3a332a", opacity: 0.7 },
          force: { repulsion: 200, gravity: 0.1, edgeLength: [50, 150], layoutAnimation: true },
          data: result.graph_nodes.map((n) => ({
            id: n.id, name: n.label, symbolSize: n.size,
            category: catMap[n.category] ?? 0, value: n.year,
            itemStyle: { color: categories[catMap[n.category] ?? 0].itemStyle.color },
          })),
          links: result.graph_edges.map((e) => ({ source: e.source_id, target: e.target_id })),
          categories: [{ name: "骨架论文" }, { name: "后向推荐" }, { name: "前向推荐" }],
          emphasis: { focus: "adjacency", lineStyle: { width: 4 } },
        }],
      });
      const onResize = () => chart.resize();
      window.addEventListener("resize", onResize);
      return () => window.removeEventListener("resize", onResize);
    };
    init();
    return () => { if (instanceRef.current) instanceRef.current.dispose(); };
  }, [result]);

  return <div ref={chartRef} className="w-full border border-line rounded-lg bg-paper-white" style={{ height: 400 }} />;
}

function RecommendedPaperCard({ paper }: { paper: RecommendedPaper }) {
  const [expanded, setExpanded] = useState(false);
  const authors = paper.authors.length > 3
    ? `${paper.authors.slice(0, 3).join(", ")} 等 ${paper.authors.length} 人`
    : paper.authors.join(", ");

  return (
    <div className="card px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-serif text-[14px] font-semibold text-ink leading-snug flex-1">{paper.title}</h3>
        {paper.reason && <span className="badge-blue shrink-0">{paper.reason}</span>}
      </div>
      <div className="flex items-center gap-2 mt-1 text-[12px] text-ink-muted">
        {paper.year > 0 && <span>{paper.year}</span>}
        {paper.venue && <><span className="text-line">|</span><span>{paper.venue}</span></>}
        {paper.cited_by_count > 0 && <><span className="text-line">|</span><span>被引 {paper.cited_by_count}</span></>}
        {paper.cited_by_n > 0 && <><span className="text-line">|</span><span>共引 {paper.cited_by_n}</span></>}
        {paper.citing_n > 0 && <><span className="text-line">|</span><span>引用 {paper.citing_n}</span></>}
        {authors && <><span className="text-line">|</span><span className="truncate">{authors}</span></>}
      </div>
      {paper.abstract && (
        <div className="mt-2">
          <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-1 text-[12px] text-ink-faint hover:text-ink-muted transition-colors">
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {expanded ? "收起" : "摘要"}
          </button>
          {expanded && <p className="mt-2 text-[13px] text-ink-secondary leading-relaxed">{paper.abstract.slice(0, 500)}</p>}
        </div>
      )}
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-line-light">
        {paper.doi && <a href={`https://doi.org/${paper.doi}`} target="_blank" rel="noopener noreferrer" className="btn-ghost text-[12px]"><ExternalLink className="w-3 h-3 inline mr-0.5" />DOI</a>}
        {paper.title && <a href={`https://scholar.google.com/scholar?q=${encodeURIComponent(paper.title.slice(0, 120))}`} target="_blank" rel="noopener noreferrer" className="btn-ghost text-[12px]">Scholar</a>}
        <div className="flex-1" />
        <span className="badge bg-paper-warm text-ink-muted text-[11px]">{paper.source === "backward" ? "后向" : "前向"}</span>
      </div>
    </div>
  );
}
