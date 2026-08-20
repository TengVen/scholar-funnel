"use client";

import { useState } from "react";
import {
  Download,
  Loader2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Trash2,
  ArrowLeftRight,
} from "lucide-react";
import {
  diagnoseCart,
  exportBibtex,
  removeFromCart,
  changeCategory,
  type CartStatus,
  type CartItem,
} from "@/lib/api";

interface CartDetailProps {
  projectId: number;
  cart: CartStatus | null;
  onRefresh: () => void;
}

const CATEGORIES = [
  { key: "foundation", label: "奠基理论", limit: 5, desc: "定义核心问题的基础工作" },
  { key: "mainstream", label: "主流方法", limit: 10, desc: "当前领域的主流技术路线" },
  { key: "frontier", label: "最新前沿", limit: 5, desc: "近2年的最新进展" },
];

export function CartDetail({ projectId, cart, onRefresh }: CartDetailProps) {
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagnosis, setDiagnosis] = useState<{
    verdict: string;
    counts: Record<string, number>;
    total: number;
    issues: string[];
    suggestions: string[];
  } | null>(null);
  const [exporting, setExporting] = useState(false);

  const handleDiagnose = async () => {
    setDiagnosing(true);
    try {
      const res = await diagnoseCart(projectId);
      setDiagnosis(res);
    } catch (e) {
      alert(`诊断失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDiagnosing(false);
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
      alert(`导出失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExporting(false);
    }
  };

  if (!cart) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-[13px] text-ink-faint">选择项目后显示骨架</p>
      </div>
    );
  }

  const grouped = CATEGORIES.map((cat) => ({
    ...cat,
    items: cart.items.filter((it) => it.category === cat.key),
  }));

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-line bg-paper-white shrink-0 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-[15px] font-semibold text-ink">
            核心骨架
          </h2>
          <span className="text-[12px] text-ink-muted tabular-nums">
            {cart.total}/20
          </span>
        </div>

        <div className="progress-track">
          <div
            className="progress-fill"
            style={{ width: `${Math.min(cart.total / 20, 1) * 100}%` }}
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleDiagnose}
            disabled={diagnosing || cart.total === 0}
            className="btn-secondary text-[12px]"
          >
            {diagnosing ? (
              <Loader2 className="w-3 h-3 inline mr-1 animate-spin" />
            ) : null}
            AI 诊断
          </button>
          <button
            onClick={handleExport}
            disabled={exporting || cart.total === 0}
            className="btn-ghost text-[12px]"
          >
            <Download className="w-3 h-3 inline mr-1" />
            导出 BibTeX
          </button>
        </div>

        {/* Diagnosis result */}
        {diagnosis && (
          <DiagnosisCard diagnosis={diagnosis} />
        )}
      </div>

      {/* Categories */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {grouped.map((cat) => (
          <div key={cat.key}>
            <div className="flex items-center justify-between mb-2">
              <div>
                <span className="text-[13px] font-medium text-ink">
                  {cat.label}
                </span>
                <span className="text-[11px] text-ink-faint ml-2">
                  {cat.desc}
                </span>
              </div>
              <span className="text-[11px] text-ink-faint tabular-nums">
                {cat.items.length}/{cat.limit}
              </span>
            </div>

            <div className="progress-track mb-2">
              <div
                className="progress-fill"
                style={{
                  width: `${Math.min(cat.items.length / cat.limit, 1) * 100}%`,
                }}
              />
            </div>

            {cat.items.length === 0 ? (
              <p className="text-[12px] text-ink-faint py-3 text-center border border-dashed border-line rounded-lg">
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

function CartItemRow({
  item,
  projectId,
  onRefresh,
}: {
  item: CartItem;
  projectId: number;
  onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [showCategoryMenu, setShowCategoryMenu] = useState(false);

  const handleRemove = async () => {
    setRemoving(true);
    try {
      await removeFromCart(projectId, item.paper_id);
      onRefresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setRemoving(false);
    }
  };

  const handleSwitchCategory = async (newCat: string) => {
    setSwitching(true);
    try {
      await changeCategory(projectId, item.paper_id, newCat);
      setShowCategoryMenu(false);
      onRefresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setSwitching(false);
    }
  };

  return (
    <div className="card px-4 py-3 group">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-serif text-ink leading-snug line-clamp-2">
            {item.title}
          </p>
          <p className="text-[11px] text-ink-faint mt-0.5">
            {item.year}
            {item.cited_by_count > 0 && ` · 被引 ${item.cited_by_count}`}
            {item.venue && ` · ${item.venue}`}
          </p>
        </div>

        <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          {/* Switch category */}
          <div className="relative">
            <button
              onClick={() => setShowCategoryMenu(!showCategoryMenu)}
              disabled={switching}
              className="p-1 rounded hover:bg-paper-warm text-ink-faint hover:text-ink-muted transition-colors"
              title="切换分类"
            >
              <ArrowLeftRight className="w-3 h-3" />
            </button>
            {showCategoryMenu && (
              <div className="absolute right-0 top-full mt-1 bg-paper-white border border-line rounded-md shadow-sm z-10 py-1 min-w-[100px]">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat.key}
                    onClick={() => handleSwitchCategory(cat.key)}
                    disabled={cat.key === item.category}
                    className={`w-full text-left px-3 py-1.5 text-[12px] transition-colors ${
                      cat.key === item.category
                        ? "text-accent bg-accent-light"
                        : "text-ink-secondary hover:bg-paper-warm"
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Remove */}
          <button
            onClick={handleRemove}
            disabled={removing}
            className="p-1 rounded hover:bg-red-500/15 text-ink-faint hover:text-red-400 transition-colors"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Abstract toggle */}
      {item.abstract && (
        <div className="mt-1">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-[11px] text-ink-faint hover:text-ink-muted transition-colors"
          >
            {expanded ? (
              <ChevronUp className="w-3 h-3" />
            ) : (
              <ChevronDown className="w-3 h-3" />
            )}
            {expanded ? "收起" : "摘要"}
          </button>
          {expanded && (
            <p className="mt-1 text-[12px] text-ink-secondary leading-relaxed">
              {item.abstract?.slice(0, 500)}
            </p>
          )}
        </div>
      )}

      {/* Links */}
      <div className="flex items-center gap-2 mt-2">
        {item.doi && (
          <a
            href={`https://doi.org/${item.doi}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-ink-faint hover:text-accent transition-colors"
          >
            <ExternalLink className="w-2.5 h-2.5 inline mr-0.5" />
            DOI
          </a>
        )}
      </div>
    </div>
  );
}

function DiagnosisCard({
  diagnosis,
}: {
  diagnosis: {
    verdict: string;
    issues: string[];
    suggestions: string[];
  };
}) {
  const verdictLabel = {
    overall: { text: "结构良好", cls: "badge-green" },
    biased: { text: "分布不均", cls: "badge-amber" },
    insufficient: { text: "数量不足", cls: "bg-red-500/15 text-red-400 badge" },
  }[diagnosis.verdict] || { text: diagnosis.verdict, cls: "badge" };

  return (
    <div className="bg-paper-warm rounded-lg p-3 text-[12px] space-y-2">
      <div className="flex items-center gap-2">
        <span className={verdictLabel.cls}>{verdictLabel.text}</span>
      </div>

      {diagnosis.issues.length > 0 && (
        <div className="space-y-0.5">
          {diagnosis.issues.map((issue, i) => (
            <p key={i} className="text-ink-muted">
              · {issue}
            </p>
          ))}
        </div>
      )}

      {diagnosis.suggestions.length > 0 && (
        <div className="space-y-0.5">
          {diagnosis.suggestions.map((s, i) => (
            <p key={i} className="text-ink-secondary">
              → {s}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
