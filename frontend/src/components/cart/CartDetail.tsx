"use client";

import { useEffect, useState } from "react";
import {
  Download,
  Loader2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Trash2,
  ArrowLeftRight,
  Github,
  Sparkles,
  Settings2,
  Check,
} from "lucide-react";
import {
  diagnoseCart,
  exportBibtex,
  summarizeCart,
} from "@/lib/api/cart";
import type { CartStatus, CartItem, DiagnosisResult, ProjectLimits } from "@/types/dto";
import { useCartStore } from "@/stores/cartStore";
import { useProjectStore } from "@/stores/projectStore";
import { CATEGORIES } from "@/config/categories";
import { toast } from "@/lib/toast";
import { KEYWORD_COLORS } from "@/config/keywords";
import type { Category } from "@/types/domain";

interface CartDetailProps {
  projectId: number;
  cart: CartStatus | null;
  onRefresh: () => void;
  onGapSearch: (category: Category, constraint?: string, threshold?: number, mode?: string) => void;
  onTitleLookup: (category: Category, title: string) => void;
  gapSearching?: boolean;
}

export function CartDetail({ projectId, cart, onRefresh, onGapSearch, onTitleLookup, gapSearching }: CartDetailProps) {
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagnosis, setDiagnosis] = useState<DiagnosisResult | null>(null);
  const [exporting, setExporting] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [gapOpenCat, setGapOpenCat] = useState<string | null>(null);  // 展开补充输入的类别
  const [gapConstraint, setGapConstraint] = useState("");
  const [gapMode, setGapMode] = useState<"search" | "title" | "semantic">("search");  // 补充输入模式
  const [gapThreshold, setGapThreshold] = useState(0.35);  // 相关度阈值（关键词补充模式）

  // ── 项目级骨架限额（动态，未加载回退默认） ──
  const limits = useProjectStore((s) => s.limitsByProject[projectId]);
  const loadLimits = useProjectStore((s) => s.loadLimits);
  const saveLimits = useProjectStore((s) => s.saveLimits);
  const [limitOpen, setLimitOpen] = useState(false);
  const [limitDraft, setLimitDraft] = useState<ProjectLimits | null>(null);
  const [limitSaving, setLimitSaving] = useState(false);

  useEffect(() => {
    if (projectId) loadLimits(projectId);
  }, [projectId, loadLimits]);

  const defaultLimits = (): ProjectLimits => ({
    foundation: CATEGORIES.find((c) => c.key === "foundation")?.limit ?? 5,
    mainstream: CATEGORIES.find((c) => c.key === "mainstream")?.limit ?? 10,
    frontier: CATEGORIES.find((c) => c.key === "frontier")?.limit ?? 5,
  });
  const activeLimits = limits ?? defaultLimits();
  const totalLimit = Object.values(activeLimits).reduce((a, b) => a + b, 0);
  const limOf = (cat: Category) => activeLimits[cat] ?? defaultLimits()[cat];

  const handleOpenLimitEditor = () => {
    setLimitDraft({ ...activeLimits });
    setLimitOpen(true);
  };

  const handleSaveLimits = async () => {
    if (!limitDraft) return;
    const vals = Object.values(limitDraft);
    if (vals.some((v) => v < 1 || v > 30)) {
      toast("每类限额需在 1~30 之间", "warning");
      return;
    }
    if (vals.reduce((a, b) => a + b, 0) > 50) {
      toast("三类总和不能超过 50 篇", "warning");
      return;
    }
    setLimitSaving(true);
    try {
      await saveLimits(projectId, limitDraft);
      setLimitOpen(false);
    } catch (e) {
      toast(`保存失败: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setLimitSaving(false);
    }
  };

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
    limit: limOf(cat.key),
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
              onClick={handleOpenLimitEditor}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-ink-muted hover:text-ink-secondary border border-line hover:border-line-secondary transition-colors"
              title="调整每类限额"
            >
              <Settings2 className="w-3 h-3" />
              配额
            </button>
          </div>
        </div>

        {/* 配额编辑面板 */}
        {limitOpen && limitDraft && (
          <div className="rounded-lg border border-line bg-paper-warm/60 p-3 space-y-2">
            <p className="text-xs text-ink-muted">每类限额（1-30，总和 ≤ 50）</p>
            <div className="grid grid-cols-3 gap-2">
              {CATEGORIES.map((cat) => {
                const current = cart.items.filter((it) => it.category === cat.key).length;
                return (
                  <div key={cat.key} className="rounded-md border border-line bg-paper-white px-2.5 py-2">
                    <p className="text-xs text-ink-muted mb-1">{cat.label}</p>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        min={1}
                        max={30}
                        value={limitDraft[cat.key]}
                        onChange={(e) =>
                          setLimitDraft((d) => d && { ...d, [cat.key]: Number(e.target.value) || 1 })
                        }
                        className="input !py-1 w-14 text-center text-sm tabular-nums"
                      />
                      <span className="text-2xs text-ink-faint">当前 {current} 篇</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center justify-between pt-1">
              <span className="text-xs text-ink-faint">
                总量上限：{Object.values(limitDraft).reduce((a, b) => a + b, 0)} / 50
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setLimitOpen(false)}
                  className="px-2.5 py-1 rounded-md text-xs text-ink-muted hover:text-ink border border-line"
                >
                  取消
                </button>
                <button
                  onClick={handleSaveLimits}
                  disabled={limitSaving}
                  className="btn-primary text-xs flex items-center gap-1"
                >
                  {limitSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                  保存配额
                </button>
              </div>
            </div>
          </div>
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
                  onClick={() => {
                    setGapOpenCat(gapOpenCat === cat.key ? null : cat.key);
                    setGapConstraint("");
                  }}
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

            {/* 补充输入（可选）：关键词约束 或 标题直达 */}
            {gapOpenCat === cat.key && (
              <div className="mb-2 bg-paper-warm rounded-lg p-2.5">
                {/* 模式切换 */}
                <div className="flex items-center gap-1 mb-2">
                  <button
                    onClick={() => { setGapMode("search"); setGapConstraint(""); }}
                    className={`px-2 py-0.5 rounded text-xs transition-colors ${
                      gapMode === "search"
                        ? "bg-accent-light text-accent font-medium"
                        : "text-ink-faint hover:text-ink-muted"
                    }`}
                  >
                    关键词补充
                  </button>
                  <button
                    onClick={() => { setGapMode("title"); setGapConstraint(""); }}
                    className={`px-2 py-0.5 rounded text-xs transition-colors ${
                      gapMode === "title"
                        ? "bg-accent-light text-accent font-medium"
                        : "text-ink-faint hover:text-ink-muted"
                    }`}
                  >
                    标题直达
                  </button>
                  <button
                    onClick={() => { setGapMode("semantic"); }}
                    className={`px-2 py-0.5 rounded text-xs transition-colors ${
                      gapMode === "semantic"
                        ? "bg-accent-light text-accent font-medium"
                        : "text-ink-faint hover:text-ink-muted"
                    }`}
                    title="基于该类骨架论文的向量质心，在已入库论文中找语义最相近的候选"
                  >
                    语义补充
                  </button>
                </div>

                {gapMode === "search" ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={gapConstraint}
                        onChange={(e) => setGapConstraint(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !gapSearching) {
                            onGapSearch(cat.key, gapConstraint.trim(), gapThreshold);
                          }
                        }}
                        placeholder={`可选：补充约束，如"重点关注变分方法"`}
                        className="input flex-1 !py-1.5 !text-sm"
                        autoFocus
                      />
                      <button
                        onClick={() => onGapSearch(cat.key, gapConstraint.trim(), gapThreshold)}
                        disabled={gapSearching}
                        className="btn-secondary text-sm whitespace-nowrap"
                      >
                        {gapSearching ? "检索中..." : "开始补充"}
                      </button>
                    </div>
                    {/* 相关度阈值滑块 */}
                    <div className="flex items-center gap-2 text-xs text-ink-muted">
                      <span className="whitespace-nowrap">相关度阈值</span>
                      <input
                        type="range"
                        min={0}
                        max={0.8}
                        step={0.05}
                        value={gapThreshold}
                        onChange={(e) => setGapThreshold(Number(e.target.value))}
                        className="flex-1 accent-gold"
                      />
                      <span className="text-gold-light tabular-nums w-9 text-right">
                        {gapThreshold.toFixed(2)}
                      </span>
                      <span className="whitespace-nowrap text-ink-faint">
                        越高越精准，越低越多候选
                      </span>
                    </div>
                  </div>
                ) : gapMode === "semantic" ? (
                  /* 语义补充：基于骨架质心，一键执行（无需输入） */
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-ink-muted flex-1">
                      基于该类骨架论文的向量质心，从已入库论文中找语义最相近的候选（无 LLM 调用，秒级）
                    </span>
                    <button
                      onClick={() => onGapSearch(cat.key, "", 0.35, "semantic")}
                      disabled={gapSearching}
                      className="btn-secondary text-sm whitespace-nowrap"
                    >
                      {gapSearching ? "分析中..." : "语义补充"}
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={gapConstraint}
                      onChange={(e) => setGapConstraint(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !gapSearching) {
                          onTitleLookup(cat.key, gapConstraint.trim());
                        }
                      }}
                      placeholder={`输入论文标题，如"Mask-Aware Transformer"`}
                      className="input flex-1 !py-1.5 !text-sm"
                      autoFocus
                    />
                    <button
                      onClick={() => onTitleLookup(cat.key, gapConstraint.trim())}
                      disabled={gapSearching || !gapConstraint.trim()}
                      className="btn-secondary text-sm whitespace-nowrap"
                    >
                      {gapSearching ? "查找中..." : "直达"}
                    </button>
                  </div>
                )}
              </div>
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

  // 骨架变更走 cartStore（内部调 API + 自动重载 cart）
  const removeItem = useCartStore((s) => s.removeItem);
  const switchCategory = useCartStore((s) => s.switchCategory);

  const handleRemove = async () => {
    setRemoving(true);
    try {
      await removeItem(projectId, item.paper_id);
      onRefresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setRemoving(false);
    }
  };

  const handleSwitchCategory = async (newCat: string) => {
    setSwitching(true);
    try {
      await switchCategory(projectId, item.paper_id, newCat);
      setShowCategoryMenu(false);
      onRefresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setSwitching(false);
    }
  };

  return (
    <div className="card px-4 py-3 group">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-base font-serif text-ink leading-snug line-clamp-2">
            {item.title}
          </p>
          <p className="text-xs text-ink-faint mt-0.5">
            {item.year}
            {item.cited_by_count > 0 && ` · 被引 ${item.cited_by_count}`}
            {item.venue && ` · ${item.venue}`}
          </p>
          {/* 分类理由（notes） */}
          {item.notes && (
            <p className="text-xs text-gold-light/80 mt-0.5 flex items-center gap-1">
              <span className="w-1 h-1 rounded-full bg-gold shrink-0" />
              {item.notes}
            </p>
          )}

          {/* 关键词（玻璃徽章） */}
          {item.keywords && item.keywords.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 mt-1.5">
              {item.keywords.slice(0, 5).map((kw, i) => {
                const c = KEYWORD_COLORS[i % KEYWORD_COLORS.length];
                return (
                  <span
                    key={kw}
                    className="px-1.5 py-0.5 rounded-md text-2xs backdrop-blur-sm"
                    style={{ background: c.bg, border: `1px solid ${c.border}`, color: c.text }}
                  >
                    {kw}
                  </span>
                );
              })}
            </div>
          )}
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
                    className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${
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

      {/* Abstract toggle：展开后"收起"按钮跟随在摘要末尾 */}
      {item.abstract && (
        <div className="mt-1">
          {!expanded && (
            <button
              onClick={() => setExpanded(true)}
              className="flex items-center gap-1 text-xs text-ink-faint hover:text-ink-muted transition-colors"
            >
              <ChevronDown className="w-3 h-3" />
              摘要
            </button>
          )}
          {expanded && (
            <>
              <p className="mt-1 text-sm text-ink-secondary leading-relaxed">
                {item.abstract}
              </p>
              <button
                onClick={() => setExpanded(false)}
                className="flex items-center gap-1 mt-1.5 text-xs text-ink-faint hover:text-ink-muted transition-colors"
              >
                <ChevronUp className="w-3 h-3" />
                收起
              </button>
            </>
          )}
        </div>
      )}

      {/* Links */}
      <div className="flex items-center gap-2 mt-2">
        {item.github_url && (
          <a
            href={item.github_url}
            target="_blank"
            rel="noopener noreferrer"
            title="查看 GitHub 代码仓库"
            className="text-xs text-ink-faint hover:text-accent transition-colors"
          >
            <Github className="w-2.5 h-2.5 inline mr-0.5" />
            GitHub
          </a>
        )}
        {item.doi && (
          <a
            href={`https://doi.org/${item.doi}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-ink-faint hover:text-accent transition-colors"
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
    <div className="bg-paper-warm rounded-lg p-3 text-sm space-y-2">
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
