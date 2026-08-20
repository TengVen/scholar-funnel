"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Loader2, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import {
  startBranchAnalyze, getBranchStatus, getBranchResult, getBranchResults,
  type BranchPaperResult,
} from "@/lib/api";
import { useBranchStore } from "@/lib/stores/branchStore";

interface BranchPanelProps {
  projectId: number;
}

const MODES = [
  { key: "probe_match", label: "探针匹配", desc: "检查骨架论文是否使用了指定技术" },
  { key: "ai_suggest", label: "AI 推荐", desc: "AI 自动推荐技术探针" },
  { key: "landscape", label: "全景扫描", desc: "分析每篇论文的方法论全貌" },
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

export function BranchPanel({ projectId }: BranchPanelProps) {
  // ── 本地 UI 输入（不需要缓存，切换标签页可重置） ──
  const [mode, setMode] = useState("probe_match");
  const [probe, setProbe] = useState("");

  // ── 从全局 store 读取分析结果（切换标签页不丢失） ──
  const result = useBranchStore((s) => s.resultsByProject[projectId] ?? null);
  const analyzing = useBranchStore((s) => s.analyzingByProject[projectId] ?? false);
  const progress = useBranchStore((s) => s.progressByProject[projectId] ?? "");
  const setResult = useBranchStore((s) => s.setResult);
  const setAnalyzing = useBranchStore((s) => s.setAnalyzing);
  const setProgress = useBranchStore((s) => s.setProgress);

  // ── 挂载时回拉后端已持久化的历史结果（刷新页面恢复） ──
  // 用 ref 记录每个 projectId 是否已尝试过回拉，避免"清空结果重跑分析"时
  // result 变 null 导致 effect 重复执行、把旧数据拉回来
  const fetchedRef = useRef<Record<number, boolean>>({});

  useEffect(() => {
    // 若 store 已有该项目的缓存，直接用，不重复请求
    if (result) return;
    // 若已为该 projectId 尝试过回拉（无论成功与否），不再重复
    if (fetchedRef.current[projectId]) return;
    fetchedRef.current[projectId] = true;

    let cancelled = false;
    getBranchResults(projectId)
      .then((res) => {
        // 仅当有数据且组件未卸载时才写入 store
        if (!cancelled && res.total > 0) {
          setResult(projectId, res);
        }
      })
      .catch(() => {
        // 静默失败：没有历史结果是正常情况（还没跑过分析）
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, result, setResult]);

  // ── 启动分析 ──
  const handleAnalyze = useCallback(async () => {
    setAnalyzing(projectId, true);
    setProgress(projectId, "正在启动分析...");
    setResult(projectId, null);
    try {
      const { task_id } = await startBranchAnalyze({
        project_id: projectId, mode,
        probe: mode === "probe_match" ? probe : undefined,
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
      setResult(projectId, res);
    } catch (e) {
      alert(`分析失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAnalyzing(projectId, false);
      setProgress(projectId, "");
    }
  }, [projectId, mode, probe, setAnalyzing, setProgress, setResult]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-6 py-4 border-b border-line bg-paper-white shrink-0 space-y-3">
        <h2 className="font-serif text-[15px] font-semibold text-ink">分支深挖</h2>
        <div className="flex gap-2">
          {MODES.map((m) => (
            <button key={m.key} onClick={() => setMode(m.key)}
              className={`px-3 py-1.5 rounded-md text-[13px] transition-colors ${mode === m.key ? "bg-gradient-to-br from-gold-light to-gold-hover text-[#171614] font-medium" : "bg-paper-warm text-ink-secondary hover:text-ink"}`}>
              {m.label}
            </button>
          ))}
        </div>
        <p className="text-[12px] text-ink-muted">{MODES.find((m) => m.key === mode)?.desc}</p>
        {mode === "probe_match" && (
          <input type="text" value={probe} onChange={(e) => setProbe(e.target.value)}
            placeholder="输入技术探针，如：Transformer、GAN、PDE 约束" className="input" />
        )}
        <button onClick={handleAnalyze} disabled={analyzing || (mode === "probe_match" && !probe.trim())} className="btn-primary">
          {analyzing ? <><Loader2 className="w-3.5 h-3.5 inline mr-1.5 animate-spin" />{progress || "分析中..."}</> : "开始分析"}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {result ? (
          <div className="space-y-3">
            <div className="flex items-center gap-4 text-[12px] text-ink-muted mb-2">
              <span>分析完成 <span className="text-ink font-medium">{result.total}</span> 篇</span>
              {Object.entries(result.level_distribution).map(([k, v]) => (
                <span key={k}>{k} <span className="text-ink-secondary">{v}篇</span></span>
              ))}
            </div>
            {result.results.map((paper) => (
              <BranchPaperCard key={paper.paper_id} paper={paper} mode={mode} />
            ))}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-[13px] text-ink-faint">
              {analyzing ? "正在逐篇分析论文，请耐心等待..." : "选择分析模式，点击开始"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function BranchPaperCard({ paper, mode }: { paper: BranchPaperResult; mode: string }) {
  const [expanded, setExpanded] = useState(false);
  const confidence = CONFIDENCE_MAP[paper.probe_confidence] || CONFIDENCE_MAP.none;
  const levelLabel = LEVEL_LABELS[paper.content_level] || "未知";

  return (
    <div className="card px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-serif text-[14px] font-semibold text-ink leading-snug flex-1">{paper.title}</h3>
        <div className="flex items-center gap-2 shrink-0">
          {mode === "probe_match" && <span className={`badge ${confidence.cls}`}>{confidence.label}</span>}
          <span className="badge bg-paper-warm text-ink-muted">L{paper.content_level} {levelLabel}</span>
        </div>
      </div>
      <div className="flex items-center gap-2 mt-1 text-[12px] text-ink-muted">
        {paper.year && <span>{paper.year}</span>}
        {paper.venue && <><span className="text-line">|</span><span>{paper.venue}</span></>}
        {paper.cited_by_count > 0 && <><span className="text-line">|</span><span>被引 {paper.cited_by_count}</span></>}
      </div>
      {paper.method_summary && <p className="mt-2 text-[13px] text-ink-secondary leading-relaxed">{paper.method_summary}</p>}
      {(paper.key_findings || paper.optimization_method) && (
        <div className="mt-2 space-y-1">
          {paper.key_findings && <p className="text-[12px] text-ink-muted"><span className="text-ink-secondary font-medium">发现：</span>{paper.key_findings}</p>}
          {paper.optimization_method && <p className="text-[12px] text-ink-muted"><span className="text-ink-secondary font-medium">方法：</span>{paper.optimization_method}</p>}
        </div>
      )}
      {paper.error && <p className="mt-2 text-[12px] text-red-400">{paper.error}</p>}
      {paper.abstract && (
        <div className="mt-2">
          <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-1 text-[12px] text-ink-faint hover:text-ink-muted transition-colors">
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {expanded ? "收起" : "摘要"}
          </button>
          {expanded && <p className="mt-2 text-[13px] text-ink-secondary leading-relaxed">{paper.abstract}</p>}
        </div>
      )}
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-line-light">
        {paper.doi && <a href={`https://doi.org/${paper.doi}`} target="_blank" rel="noopener noreferrer" className="btn-ghost text-[12px]"><ExternalLink className="w-3 h-3 inline mr-0.5" />DOI</a>}
        <div className="flex-1" />
        <span className="text-[11px] text-ink-faint">来源：{paper.content_source}</span>
      </div>
    </div>
  );
}
