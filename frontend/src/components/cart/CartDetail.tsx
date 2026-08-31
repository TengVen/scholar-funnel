"use client";

import { useEffect, useState } from "react";
import { Download, Loader2, Sparkles, Settings2 } from "lucide-react";
import {
  diagnoseCart,
  exportBibtex,
  summarizeCart,
} from "@/lib/api/cart";
import type { CartStatus, DiagnosisResult } from "@/types/dto";
import type { Category } from "@/types/domain";
import { useProjectStore } from "@/stores/projectStore";
import { CATEGORIES } from "@/config/categories";
import { limitOf, resolveLimits, totalOf } from "@/lib/cart";
import { toast } from "@/lib/toast";
import { CartItemRow } from "./CartItemRow";
import { DiagnosisCard } from "./DiagnosisCard";
import { LimitEditor } from "./LimitEditor";
import { GapFillPanel } from "./GapFillPanel";

interface CartDetailProps {
  projectId: number;
  cart: CartStatus | null;
  onRefresh: () => void;
  onGapSearch: (category: Category, constraint?: string, threshold?: number, mode?: string) => void;
  onTitleLookup: (category: Category, title: string) => void;
  gapSearching?: boolean;
}

/**
 * 核心骨架面板 —— 配额管理、AI 诊断/摘要/导出，以及三类论文的分组展示
 *
 * 配额编辑见 LimitEditor，候选补充见 GapFillPanel，单篇论文行见 CartItemRow。
 */
export function CartDetail({ projectId, cart, onRefresh, onGapSearch, onTitleLookup, gapSearching }: CartDetailProps) {
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagnosis, setDiagnosis] = useState<DiagnosisResult | null>(null);
  const [exporting, setExporting] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [gapOpenCat, setGapOpenCat] = useState<string | null>(null);  // 展开补充输入的类别

  // ── 项目级骨架限额（动态，未加载回退默认） ──
  const limits = useProjectStore((s) => s.limitsByProject[projectId]);
  const loadLimits = useProjectStore((s) => s.loadLimits);
  const saveLimits = useProjectStore((s) => s.saveLimits);
  const [limitOpen, setLimitOpen] = useState(false);

  useEffect(() => {
    if (projectId) loadLimits(projectId);
  }, [projectId, loadLimits]);

  const activeLimits = resolveLimits(limits);
  const totalLimit = totalOf(activeLimits);

  const handleDiagnose = async () => {
    setDiagnosing(true);
    try {
      const res = await diagnoseCart(projectId);
      setDiagnosis(res);
    } catch (e) {
      toast(`诊断失败: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setDiagnosing(false);
    }
  };

  const handleSummarize = async () => {
    setSummarizing(true);
    try {
      const res = await summarizeCart(projectId);
      setSummary(res.summary);
    } catch (e) {
      toast(`生成摘要失败: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setSummarizing(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const text = await exportBibtex(projectId);
      const blob = new Blob([text], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cart_${projectId}.bib`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast(`导出失败: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setExporting(false);
    }
  };

  if (!cart) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-base text-ink-faint">选择项目后显示骨架</p>
      </div>
    );
  }

  const grouped = CATEGORIES.map((cat) => ({
    ...cat,
    limit: limitOf(activeLimits, cat.key),
    items: cart.items.filter((it) => it.category === cat.key),
  }));

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-line bg-paper-white shrink-0 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-lg font-semibold text-ink">
            核心骨架
          </h2>
          <div className="flex items-center gap-2.5">
            <span className="text-sm text-ink-muted tabular-nums">
              {cart.total}/{totalLimit}
            </span>
            <button
              onClick={() => setLimitOpen(true)}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-ink-muted hover:text-ink-secondary border border-line hover:border-line-secondary transition-colors"
              title="调整每类限额"
            >
              <Settings2 className="w-3 h-3" />
              配额
            </button>
          </div>
        </div>

        {/* 配额编辑面板 */}
        {limitOpen && (
          <LimitEditor
            initialLimits={activeLimits}
            items={cart.items}
            onCancel={() => setLimitOpen(false)}
            onSave={async (draft) => {
              await saveLimits(projectId, draft);
              setLimitOpen(false);
            }}
          />
        )}

        <div className="progress-track">
          <div
            className="progress-fill"
            style={{ width: `${Math.min(cart.total / totalLimit, 1) * 100}%` }}
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleDiagnose}
            disabled={diagnosing || cart.total === 0}
            className="btn-secondary text-sm"
          >
            {diagnosing ? (
              <Loader2 className="w-3 h-3 inline mr-1 animate-spin" />
            ) : null}
            AI 诊断
          </button>
          <button
            onClick={handleSummarize}
            disabled={summarizing || cart.total === 0}
            className="btn-secondary text-sm"
          >
            {summarizing ? (
              <Loader2 className="w-3 h-3 inline mr-1 animate-spin" />
            ) : null}
            生成骨架摘要
          </button>
          <button
            onClick={handleExport}
            disabled={exporting || cart.total === 0}
            className="btn-ghost text-sm"
          >
            <Download className="w-3 h-3 inline mr-1" />
            导出 BibTeX
          </button>
        </div>

        {/* Diagnosis result */}
        {diagnosis && (
          <DiagnosisCard diagnosis={diagnosis} />
        )}

        {/* 骨架摘要 */}
        {summary && (
          <div className="bg-paper-warm rounded-lg p-3 text-sm border border-gold/20">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-medium text-gold-light tracking-wide">
                骨架综述开场段
              </span>
              <button
                onClick={() => navigator.clipboard.writeText(summary)}
                className="text-2xs text-ink-faint hover:text-gold-light transition-colors"
              >
                复制
              </button>
            </div>
            <p className="text-ink-secondary leading-relaxed">{summary}</p>
          </div>
        )}
      </div>

      {/* Categories */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {grouped.map((cat) => (
          <div key={cat.key}>
            <div className="flex items-center justify-between mb-2">
              <div>
                <span className="text-base font-medium text-ink">
                  {cat.label}
                </span>
                <span className="text-xs text-ink-faint ml-2">
                  {cat.desc}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-ink-faint tabular-nums">
                  {cat.items.length}/{cat.limit}
                </span>
                {/* 缺口补充检索入口 */}
                <button
                  onClick={() => setGapOpenCat(gapOpenCat === cat.key ? null : cat.key)}
                  disabled={gapSearching}
                  className="btn-ghost text-xs flex items-center gap-1 text-gold-light
                             hover:text-gold transition-colors"
                  title={`补充${cat.label}候选论文`}
                >
                  {gapSearching && gapOpenCat === cat.key ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Sparkles className="w-3 h-3" />
                  )}
                  补充
                </button>
              </div>
            </div>

            {/* 补充输入（可选）：关键词补充 / 语义补充 / 标题直达 */}
            {gapOpenCat === cat.key && (
              <GapFillPanel
                category={cat.key}
                searching={gapSearching ?? false}
                onGapSearch={onGapSearch}
                onTitleLookup={onTitleLookup}
              />
            )}

            <div className="progress-track mb-2">
              <div
                className="progress-fill"
                style={{
                  width: `${Math.min(cat.items.length / cat.limit, 1) * 100}%`,
                }}
              />
            </div>

            {cat.items.length === 0 ? (
              <p className="text-sm text-ink-faint py-3 text-center border border-dashed border-line rounded-lg">
                还可添加 {cat.limit} 篇
              </p>
            ) : (
              <div className="space-y-1">
                {cat.items.map((item) => (
                  <CartItemRow
                    key={item.paper_id}
                    item={item}
                    projectId={projectId}
                    onRefresh={onRefresh}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
