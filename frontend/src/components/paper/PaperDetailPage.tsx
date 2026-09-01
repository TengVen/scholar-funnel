"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, BookOpen, ExternalLink, FileText, Loader2, Sparkles } from "lucide-react";
import type { PaperDetail, PaperAskResult, PaperSection } from "@/types/dto";
import { getPaperDetail, getTransientPaper, explorePaper, exploreOpenalexPaper, getPaperAnalysis, askPaper, fetchPdfBlob, uploadPaperPdf } from "@/lib/api/papers";
import { toast } from "@/lib/toast";
import { useLocalStorageConfig } from "@/hooks/useLocalStorageConfig";
import { sectionAnchor, matchSection, type SectionTarget } from "@/lib/paper/sectionLocate";
import { ResizablePanel } from "./ResizablePanel";
import { TocSidebar } from "./TocSidebar";
import { PaperQaBox } from "./PaperQaBox";
import { PaperContentPanel } from "./PaperContentPanel";
import { PaperAbstractBar } from "./PaperAbstractBar";
import { AiResearchPanel } from "./AiResearchPanel";
import { AnalysisUpgradeBanner } from "./AnalysisUpgradeBanner";
import { PdfViewer } from "./PdfViewer";
import { PaperUploadBar } from "./PaperUploadBar";

/** 详情页三栏布局偏好（宽度 + 折叠状态，持久化到 localStorage） */
interface PaperLayout {
  leftW: number;
  leftCollapsed: boolean;
  rightW: number;
  rightCollapsed: boolean;
}
const DEFAULT_LAYOUT: PaperLayout = { leftW: 280, leftCollapsed: false, rightW: 320, rightCollapsed: false };
function migrateLayout(raw: unknown): PaperLayout {
  const src = (raw ?? {}) as Record<string, unknown>;
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  return {
    leftW: num(src.leftW, DEFAULT_LAYOUT.leftW),
    leftCollapsed: src.leftCollapsed === true,
    rightW: num(src.rightW, DEFAULT_LAYOUT.rightW),
    rightCollapsed: src.rightCollapsed === true,
  };
}

/**
 * 论文详情页（三栏工作台 + 三态：Transient / Candidate / Research Asset）。
 * 统一页面：L1-L3 均可进入，右侧 AI 研究助手按分析就绪度渲染。
 * - L1（transient）：手动点"深入探究"→ 落库转 L2（autoExplore=false）
 * - L2（认知结构节点）：点开即自动预热（autoExplore=true，结果进缓存，问答时落库）
 * - L3（研究资产）：点开即自动预热 + 分析完成直接落库（autoExplore + persistAnalysis）
 */
interface PaperDetailPageProps {
  paperId?: number;          // 项目论文（DB）
  openalexId?: string;       // transient（OpenAlex 实时）
  projectId?: number | null; // 当前研究项目（深入探究/问答需要）
  autoExplore?: boolean;     // L2/L3：点开详情页无分析时自动触发深入探究
  persistAnalysis?: boolean; // L3：分析完成直接写 paper_analysis（无需问答）
  onBack?: () => void;       // 单返回（无双出口的调用方）
  onBackChat?: () => void;   // 返回对话历史
  onBackSearch?: () => void; // 返回检索页
}

export function PaperDetailPage({ paperId, openalexId, projectId, autoExplore = false, persistAnalysis = false, onBack, onBackChat, onBackSearch }: PaperDetailPageProps) {
  const [detail, setDetail] = useState<PaperDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [exploring, setExploring] = useState(false);
  const [pdfPage, setPdfPage] = useState(0);     // PDF 定位页码（证据锚点/目录跳转，#page=N）
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [upgrading, setUpgrading] = useState(false); // 摘要级分析 → 全文级重算中
  const [uploading, setUploading] = useState(false); // PDF 上传中
  const pdfBlobUrlRef = useRef<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 左右栏宽度/折叠偏好（持久化，防 hydration 崩溃：首屏用 fallback）
  const [layout, setLayout] = useLocalStorageConfig<PaperLayout>("scholar_funnel_paper_layout", DEFAULT_LAYOUT, migrateLayout);

  // 加载详情（项目论文或 transient）
  useEffect(() => {
    let alive = true;
    setLoading(true);
    const load = async () => {
      try {
        const d = paperId && projectId
          ? await getPaperDetail(paperId, projectId)
          : await getTransientPaper(openalexId ?? "", projectId);
        if (!alive) return;
        setDetail(d);
        if (autoExplore && d.paper_id && projectId && d.analysis.status === "none") {
          // L2/L3 点开即预热：无分析则自动深入探究（L3 完成后直接落库），静默不打扰
          void runExplore(d.paper_id, projectId, persistAnalysis, true);
        } else if (d.analysis.status === "running" && projectId && d.paper_id) {
          startPolling(d.paper_id, projectId);
        }
      } catch (e) {
        toast(`加载论文失败: ${e instanceof Error ? e.message : String(e)}`, "error");
      } finally {
        if (alive) setLoading(false);
      }
    };
    load();
    return () => { alive = false; stopPolling(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paperId, openalexId, projectId, autoExplore, persistAnalysis]);

  // 论文切换或卸载 → 复位 PDF 页码并释放 blob URL
  useEffect(() => {
    return () => {
      setPdfPage(0);
      if (pdfBlobUrlRef.current) {
        URL.revokeObjectURL(pdfBlobUrlRef.current);
        pdfBlobUrlRef.current = null;
      }
    };
  }, [openalexId]);

  // PDF 可用（arXiv）→ 中栏即 PDF：带 token 拉取 blob（iframe 无法携带 Authorization header，故 blob 中转）；
  // 同一论文 blob 缓存复用，切论文重新拉取
  useEffect(() => {
    if (!detail?.pdf_available || !detail?.openalex_id || pdfBlobUrl || pdfLoading) return;
    let alive = true;
    setPdfLoading(true);
    setPdfError(null);
    fetchPdfBlob(detail.openalex_id)
      .then((blob) => {
        if (!alive) return;
        const url = URL.createObjectURL(blob);
        pdfBlobUrlRef.current = url;
        setPdfBlobUrl(url);
      })
      .catch((e) => {
        if (alive) setPdfError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (alive) setPdfLoading(false);
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.pdf_available, detail?.openalex_id, pdfBlobUrl]);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  /** 静默重新拉取详情（轮询遇失败态时恢复真实状态，不闪 loading） */
  const reloadDetail = async () => {
    try {
      const d = paperId && projectId
        ? await getPaperDetail(paperId, projectId)
        : await getTransientPaper(openalexId ?? "", projectId);
      setDetail(d);
    } catch {
      /* 保持现状 */
    }
  };

  const startPolling = (pid: number, proj: number) => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const st = await getPaperAnalysis(pid, proj);
        setDetail((prev) => (prev ? { ...prev, analysis: st } : prev));
        if (st.status === "done") {
          stopPolling();
        } else if (st.status === "none") {
          // 分析任务失败（error）→ 保留旧结果并恢复真实状态
          stopPolling();
          toast("分析失败，已保留原分析结果", "error");
          void reloadDetail();
        }
      } catch {
        stopPolling();
      }
    }, 2500);
  };

  /** 项目论文（有 paper_id）深入探究；silent=自动预热（L2/L3 点开即分析）时不弹 toast */
  const runExplore = async (pid: number, proj: number, persist: boolean, silent = false) => {
    if (exploring) return;
    setExploring(true);
    try {
      await explorePaper(pid, proj, persist);
      if (!silent) toast("已纳入研究候选，AI 分析进行中…", "info");
      setDetail((prev) => (prev ? { ...prev, analysis: { ...prev.analysis, status: "running" } } : prev));
      startPolling(pid, proj);
    } catch (e) {
      toast(`深入探究失败: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setExploring(false);
    }
  };

  /** transient 论文（无 paper_id）深入探究：落库 candidate 转 L2 → 拿到 paper_id 后轮询 */
  const runExploreTransient = async () => {
    if (!openalexId || !projectId || exploring) return;
    setExploring(true);
    try {
      const res = await exploreOpenalexPaper(projectId, openalexId, persistAnalysis);
      toast("已纳入研究候选，AI 分析进行中…", "info");
      setDetail((prev) => (prev ? { ...prev, paper_id: res.paper_id, analysis: { ...prev.analysis, status: "running" } } : prev));
      startPolling(res.paper_id, projectId);
    } catch (e) {
      toast(`深入探究失败: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setExploring(false);
    }
  };

  const handleExplore = () => {
    if (!projectId || exploring) return;
    if (detail?.paper_id) {
      void runExplore(detail.paper_id, projectId, persistAnalysis);
    } else {
      void runExploreTransient();
    }
  };

  const handleAsk = async (question: string): Promise<PaperAskResult | null> => {
    if (!detail?.paper_id || !projectId) return null;
    try {
      const res = await askPaper(detail.paper_id, projectId, question);
      if (res.answer === "分析准备中，请稍后再问") {
        toast("分析准备中，请稍后再问", "info");
        startPolling(detail.paper_id, projectId);
        return null;
      }
      return res;
    } catch (e) {
      toast(`提问失败: ${e instanceof Error ? e.message : String(e)}`, "error");
      return null;
    }
  };

  /** 锚点跳转：PDF 可用 → 定位 PDF 页码（iframe key 变化强制重载，支持连续跳转）；否则正文分节滚动 */
  const handleLocate = (target: SectionTarget) => {
    if (detail?.pdf_available && target.page > 0) {
      setPdfPage(target.page);
    } else {
      document.getElementById(sectionAnchor(target.index))?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  /** 摘要级分析 → 全文级重算：复用 explore（done 态再触发即重算，pdf_cache 命中已下载的 PDF） */
  const handleUpgrade = async () => {
    if (!detail?.paper_id || !projectId || upgrading) return;
    setUpgrading(true);
    try {
      await explorePaper(detail.paper_id, projectId, persistAnalysis);
      setDetail((prev) => (prev ? { ...prev, analysis: { ...prev.analysis, status: "running" } } : prev));
      startPolling(detail.paper_id, projectId);
    } catch (e) {
      toast(`重新分析失败: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setUpgrading(false);
    }
  };

  /** 上传 PDF 补全全文：落盘 → 刷新详情（pdf_available 变 true，中栏自动切 PDF）→ 自动触发全文重算 */
  const handleUpload = async (file: File) => {
    if (!detail?.paper_id || !projectId || uploading) return;
    setUploading(true);
    try {
      const res = await uploadPaperPdf(detail.paper_id, projectId, file);
      toast("PDF 已上传，正在基于全文重新分析…", "info");
      await reloadDetail(); // pdf_available → true → showPdf 自动切换中栏
      if (res.task_id) {
        startPolling(detail.paper_id, projectId);
      }
    } catch (e) {
      toast(`上传失败: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-5 h-5 animate-spin text-accent" />
      </div>
    );
  }
  if (!detail) {
    return <p className="text-center text-sm text-ink-faint py-20">论文不存在</p>;
  }

  const sections: PaperSection[] | null =
    detail.sections ?? detail.analysis.sections ?? null;
  const headings = (sections ?? []).map((s) => s.heading);
  // 中栏模式：PDF 可用（arXiv）直接展示 PDF，正文分节视图仅作无 PDF 时的回退
  const showPdf = !!detail.pdf_available;
  // B 方案：摘要级分析 + PDF 已加载成功 → 显示"重新深入分析"提示条
  const upgradeReady =
    detail.analysis.status === "done" &&
    detail.analysis.material_type !== "全文分节" &&
    showPdf &&
    !!pdfBlobUrl;

  /** 目录跳转：目录项（Abstract/章节名/References）→ 章节匹配 → PDF 页码或正文锚点 */
  const handleJump = (label: string) => {
    const t = matchSection(label, sections ?? []);
    if (t) handleLocate(t);
  };

  return (
    <div className="flex flex-col h-screen">
      {/* 顶栏 */}
      <header className="flex items-center gap-4 border-b border-line px-4 py-3 shrink-0">
        {onBackChat && onBackSearch ? (
          /* 双出口：返回对话历史 / 返回检索页 */
          <div className="flex items-center gap-1.5 shrink-0">
            <button type="button" onClick={onBackChat}
              className="flex items-center gap-1 text-sm text-ink-muted hover:text-ink transition-colors">
              <ArrowLeft className="w-4 h-4" /> 对话
            </button>
            <button type="button" onClick={onBackSearch}
              className="flex items-center gap-1 text-sm text-ink-muted hover:text-ink transition-colors">
              <ArrowLeft className="w-4 h-4" /> 检索
            </button>
          </div>
        ) : (
          <button type="button" onClick={onBack} className="flex items-center gap-1 text-sm text-ink-muted hover:text-ink transition-colors">
            <ArrowLeft className="w-4 h-4" /> 返回
          </button>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="font-serif text-lg font-semibold text-ink truncate">{detail.title}</h1>
            <StatusBadge analysis={detail.analysis} />
          </div>
          <p className="text-sm text-ink-faint truncate">
            {[detail.authors?.join(", "), detail.year, detail.venue, detail.doi && `DOI ${detail.doi.slice(0, 24)}`]
              .filter(Boolean).join(" · ") || "暂无元数据"}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {detail.pdf_available ? (
            detail.oa_landing_url && (
              <a href={detail.oa_landing_url} target="_blank" rel="noreferrer"
                title="在 arXiv 打开"
                className="flex items-center gap-1 text-xs text-ink-faint hover:text-ink transition-colors">
                arXiv <ExternalLink className="w-3 h-3" />
              </a>
            )
          ) : detail.oa_landing_url ? (
            <a href={detail.oa_landing_url} target="_blank" rel="noreferrer"
              className="btn-secondary text-sm !py-1.5">
              <ExternalLink className="w-3.5 h-3.5" /> 原文
            </a>
          ) : null}
        </div>
      </header>

      {/* 三栏（PDF 视图保留左栏：目录仍在、对话可继续提问） */}
      <div className="flex flex-1 min-h-0">
        <ResizablePanel
          side="left"
          width={layout.leftW}
          collapsed={layout.leftCollapsed}
          minWidth={200}
          maxWidth={360}
          onResize={(w) => setLayout({ ...layout, leftW: w })}
          onToggle={() => setLayout({ ...layout, leftCollapsed: !layout.leftCollapsed })}
          header={<><BookOpen className="w-4 h-4 text-accent" /> 论文导航</>}
        >
          <div className="flex flex-col h-full">
            <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3">
              <TocSidebar hasSections={!!sections?.length} headings={headings} onJump={handleJump} />
            </div>
            <div className="shrink-0 border-t border-line px-3 py-3">
              <PaperQaBox detail={detail} projectId={projectId} onAsk={handleAsk} onLocate={handleLocate} />
            </div>
          </div>
        </ResizablePanel>

        {showPdf ? (
          <main className="flex-1 min-w-0 flex flex-col">
            {pdfError ? (
              /* PDF 获取失败：错误提示 + arXiv 兜底 + 完整摘要回退（保证最基础的可读内容） */
              <div className="flex-1 min-h-0 overflow-y-auto">
                <div className="flex items-center gap-2 px-4 py-2 bg-status-running/10 border-b border-status-running/20 text-xs text-status-running">
                  <FileText className="w-3.5 h-3.5 shrink-0" />
                  <span className="flex-1">PDF 获取失败：{pdfError}</span>
                  {detail.oa_landing_url && (
                    <a href={detail.oa_landing_url} target="_blank" rel="noreferrer"
                      className="text-accent hover:underline shrink-0">
                      前往 arXiv 查看原文 ↗
                    </a>
                  )}
                </div>
                {detail.abstract ? (
                  <section className="px-6 py-5">
                    <h2 className="font-serif text-base font-semibold text-ink mb-2">摘要</h2>
                    <p className="text-base text-ink-secondary leading-relaxed whitespace-pre-wrap">{detail.abstract}</p>
                  </section>
                ) : (
                  <div className="flex-1 flex items-center justify-center text-sm text-ink-faint px-6 py-10">
                    该论文暂无摘要信息，可尝试「深入探究」获取分析
                  </div>
                )}
              </div>
            ) : pdfBlobUrl ? (
              <>
                <PaperAbstractBar abstract={detail.abstract} abstractSource={detail.abstract_source} />
                <PdfViewer
                  blobUrl={pdfBlobUrl}
                  page={pdfPage > 0 ? pdfPage : undefined}
                  fallbackUrl={detail.oa_landing_url}
                />
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-accent" />
              </div>
            )}
          </main>
        ) : (
          <div className="flex-1 min-w-0 flex flex-col">
            {detail.paper_id && <PaperUploadBar uploading={uploading} onUpload={handleUpload} />}
            <PaperContentPanel
              abstract={detail.abstract}
              abstractSource={detail.abstract_source}
              sections={sections}
              materialType={detail.analysis.material_type}
              landingUrl={detail.oa_landing_url}
            />
          </div>
        )}

        <ResizablePanel
          side="right"
          width={layout.rightW}
          collapsed={layout.rightCollapsed}
          minWidth={240}
          maxWidth={480}
          onResize={(w) => setLayout({ ...layout, rightW: w })}
          onToggle={() => setLayout({ ...layout, rightCollapsed: !layout.rightCollapsed })}
          header={<><Sparkles className="w-4 h-4 text-accent" /> AI 研究助手</>}
        >
          <div className="flex flex-col h-full">
            {upgradeReady && <AnalysisUpgradeBanner upgrading={upgrading} onUpgrade={handleUpgrade} />}
            <AiResearchPanel detail={detail} projectId={projectId} exploring={exploring} onExplore={handleExplore} onLocate={handleLocate} />
          </div>
        </ResizablePanel>
      </div>
    </div>
  );
}

function StatusBadge({ analysis }: { analysis: PaperDetail["analysis"] }) {
  const map = {
    none: { label: "待分析", cls: "text-ink-faint border-line" },
    running: { label: "分析中", cls: "text-status-running border-status-running/30" },
    done: { label: "已完成分析", cls: "text-gold-light border-gold/30" },
  } as const;
  const m = map[analysis.status] ?? map.none;
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border ${m.cls} shrink-0`}>{m.label}</span>
  );
}
