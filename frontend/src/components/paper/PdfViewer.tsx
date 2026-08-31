"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, FileText, Loader2, ZoomIn, ZoomOut } from "lucide-react";
import * as pdfjsLib from "pdfjs-dist";

// worker 走 public 静态路径（复制自 node_modules/pdfjs-dist/build/pdf.worker.min.mjs）。
// 不用 `?url` 导入：其对 .mjs 返回模块对象而非字符串，pdfjs 的 workerSrc 类型校验会失败。
pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

interface PageSize { w: number; h: number }

/**
 * 论文 PDF 查看器（pdf.js 多页连续渲染，阅读器式滚动浏览）
 *
 * 核心机制：
 * - 文档加载后预取全部页尺寸 → 竖排占位（布局稳定，滚动位置正确）
 * - 页面懒渲染：首屏前 3 页立即出图，后续页每帧渐进渲染 2 页（<50 页论文全量渲染不卡）
 * - 跳转 = 目标页滚动定位（scrollIntoView，滚动式无闪烁）；连续跳转天然支持
 * - 缩放 = 重绘已激活页，并锚定当前可见页（滚动位置不漂移）
 *
 * blobUrl 由调用方提供（带 token 拉取，鉴权不进 URL）；fallbackUrl 为解析失败的外链兜底。
 */
interface PdfViewerProps {
  blobUrl: string;
  page?: number;                  // 外部跳页请求（1-based；内部翻页不回写外部）
  fallbackUrl?: string | null;
}

export function PdfViewer({ blobUrl, page, fallbackUrl }: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const loadingTaskRef = useRef<pdfjsLib.PDFDocumentLoadingTask | null>(null);
  const visiblePageRef = useRef(1);           // 滚动跟踪的当前可见页（缩放锚定用）

  const [docReady, setDocReady] = useState(false);
  const [numPages, setNumPages] = useState(0);
  const [sizes, setSizes] = useState<PageSize[]>([]);   // 1-based index → 页面尺寸（@scale=1）
  const [scale, setScale] = useState(1);
  const [activePages, setActivePages] = useState<Set<number>>(new Set());  // 已激活（渲染）的页
  const [visiblePage, setVisiblePage] = useState(1);    // 工具栏页码指示
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── 加载文档 + 预取全部页尺寸 ──
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setDocReady(false);
    setActivePages(new Set());
    const load = async () => {
      try {
        loadingTaskRef.current?.destroy();
        const task = pdfjsLib.getDocument({ url: blobUrl });
        loadingTaskRef.current = task;
        const doc = await task.promise;
        if (!alive) {
          doc.destroy();
          return;
        }
        pdfDocRef.current?.destroy();
        pdfDocRef.current = doc;
        // 预取尺寸（getViewport 轻量，不渲染画布）
        const dims: PageSize[] = [];
        for (let n = 1; n <= doc.numPages; n++) {
          const p = await doc.getPage(n);
          const v = p.getViewport({ scale: 1 });
          dims[n - 1] = { w: v.width, h: v.height };
        }
        if (!alive) return;
        setNumPages(doc.numPages);
        setSizes(dims);
        setDocReady(true);
        // 首屏激活前 3 页
        setActivePages(new Set([1, 2, 3].filter((n) => n <= doc.numPages)));
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    };
    void load();
    return () => {
      alive = false;
      loadingTaskRef.current?.destroy();
      loadingTaskRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blobUrl]);

  // ── 渐进渲染：文档就绪后每帧激活 2 页，直到全部渲染 ──
  // 注意：页码递增必须在 setState 的 updater 之外（React StrictMode 会双调用 updater，
  // 若在其中递增闭包变量会导致每帧跳过页码、部分页永远不激活 → 空白页）
  useEffect(() => {
    if (!docReady) return;
    let next = 4; // 首屏已激活 1-3
    const timer = setInterval(() => {
      if (next > numPages) {
        clearInterval(timer);
        return;
      }
      const batch: number[] = [];
      for (let k = 0; k < 2 && next <= numPages; k++, next++) batch.push(next);
      setActivePages((prev) => {
        const s = new Set(prev);
        for (const n of batch) s.add(n);
        return s;
      });
    }, 60);
    return () => clearInterval(timer);
  }, [docReady, numPages]);

  // ── 外部跳页：立即激活目标页并滚动定位 ──
  useEffect(() => {
    if (!page || page < 1 || page > numPages || !docReady) return;
    setActivePages((prev) => (prev.has(page) ? prev : new Set(prev).add(page)));
    requestAnimationFrame(() => {
      document.getElementById(`pdf-page-${page}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [page, numPages, docReady]);

  // ── 缩放：重绘已激活页（子组件按 scale 重渲染），并锚定当前可见页防漂移 ──
  useEffect(() => {
    if (!docReady) return;
    const anchor = visiblePageRef.current;
    requestAnimationFrame(() => {
      document.getElementById(`pdf-page-${anchor}`)?.scrollIntoView({ behavior: "auto", block: "start" });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale, docReady]);

  // ── 滚动跟踪：更新可见页（工具栏页码） ──
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const mid = el.scrollTop + el.clientHeight / 2;
    let best = visiblePageRef.current;
    for (let n = 1; n <= numPages; n++) {
      const node = document.getElementById(`pdf-page-${n}`);
      if (!node) continue;
      const top = node.offsetTop;
      if (top <= mid) best = n;
      else break;
    }
    visiblePageRef.current = best;
    setVisiblePage(best);
  }, [numPages]);

  const goTo = (n: number) => {
    const clamped = Math.min(Math.max(1, n), numPages || 1);
    setActivePages((prev) => (prev.has(clamped) ? prev : new Set(prev).add(clamped)));
    requestAnimationFrame(() => {
      document.getElementById(`pdf-page-${clamped}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  // 卸载释放
  useEffect(() => {
    return () => {
      pdfDocRef.current?.destroy();
      pdfDocRef.current = null;
    };
  }, []);

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-paper-warm/40">
      {/* 工具栏 */}
      {numPages > 0 && (
        <div className="shrink-0 flex items-center justify-center gap-3 border-b border-line px-3 py-1.5 text-xs text-ink-muted">
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setScale((s) => Math.max(0.5, +(s - 0.2).toFixed(1)))}
              title="缩小" className="p-1 rounded hover:bg-accent-light/10 text-ink-muted hover:text-ink">
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="w-11 text-center tabular-nums">{Math.round(scale * 100)}%</span>
            <button type="button" onClick={() => setScale((s) => Math.min(3, +(s + 0.2).toFixed(1)))}
              title="放大" className="p-1 rounded hover:bg-accent-light/10 text-ink-muted hover:text-ink">
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => goTo(visiblePage - 1)} disabled={visiblePage <= 1}
              title="上一页" className="p-1 rounded hover:bg-accent-light/10 text-ink-muted hover:text-ink disabled:opacity-30">
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="tabular-nums">{visiblePage} / {numPages}</span>
            <button type="button" onClick={() => goTo(visiblePage + 1)} disabled={visiblePage >= numPages}
              title="下一页" className="p-1 rounded hover:bg-accent-light/10 text-ink-muted hover:text-ink disabled:opacity-30">
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* 页面区（多页竖排，可滚动浏览） */}
      <div ref={containerRef} onScroll={handleScroll} className="flex-1 min-h-0 overflow-auto px-6 py-4">
        {error ? (
          <div className="flex flex-col items-center justify-center gap-2 text-sm text-ink-faint py-16">
            <FileText className="w-6 h-6" />
            <p>PDF 解析失败：{error}</p>
            {fallbackUrl && (
              <a href={fallbackUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                前往 arXiv 查看原文 ↗
              </a>
            )}
          </div>
        ) : loading || !docReady ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-5 h-5 animate-spin text-accent" />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4">
            {sizes.map((sz, i) => {
              const n = i + 1;
              return (
                <div key={n} id={`pdf-page-${n}`} className="w-fit">
                  <PdfPageCanvas
                    doc={pdfDocRef.current}
                    pageNo={n}
                    scale={scale}
                    size={sz}
                    active={activePages.has(n)}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/** 单页画布：active 时渲染（缩放变化自动重绘），未激活显示占位（尺寸已知，布局稳定） */
function PdfPageCanvas({ doc, pageNo, scale, size, active }: {
  doc: pdfjsLib.PDFDocumentProxy | null;
  pageNo: number;
  scale: number;
  size: PageSize;
  active: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const taskRef = useRef<pdfjsLib.RenderTask | null>(null);

  useEffect(() => {
    if (!active || !doc) return;
    let cancelled = false;
    (async () => {
      try {
        const pdfPage = await doc.getPage(pageNo);
        if (cancelled) return;
        const dpr = window.devicePixelRatio || 1;
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = Math.floor(size.w * scale * dpr);
        canvas.height = Math.floor(size.h * scale * dpr);
        canvas.style.width = `${Math.floor(size.w * scale)}px`;
        canvas.style.height = `${Math.floor(size.h * scale)}px`;
        const viewport = pdfPage.getViewport({ scale: scale * dpr });
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        taskRef.current?.cancel();
        const task = pdfPage.render({ canvasContext: ctx, viewport });
        taskRef.current = task;
        await task.promise;
      } catch {
        /* 取消或页面无效 */
      }
    })();
    return () => {
      cancelled = true;
      taskRef.current?.cancel();
    };
  }, [active, doc, pageNo, scale, size]);

  return (
    <canvas
      ref={canvasRef}
      className="bg-paper-warm rounded-sm shadow-lg"
      style={{ width: Math.floor(size.w * scale), height: Math.floor(size.h * scale) }}
    />
  );
}
