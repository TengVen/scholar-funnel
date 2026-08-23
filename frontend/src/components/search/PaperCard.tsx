"use client";

import { useState, useRef, useEffect } from "react";
import {
  ExternalLink, Plus, Check, ChevronDown, ChevronUp, Github,
  Calendar, Quote, Target, Sparkles, Loader2,
} from "lucide-react";
import { classifyPaper, type Paper } from "@/lib/api";

interface PaperCardProps {
  paper: Paper;
  onAddToCart: (paperId: number, category?: string, notes?: string) => void;
}

// 关键词玻璃徽章配色：清透冷调，按序循环
const KEYWORD_COLORS = [
  { bg: "rgba(94, 205, 196, 0.12)", border: "rgba(94, 205, 196, 0.32)", text: "#8FE3DA" }, // 淡青
  { bg: "rgba(120, 170, 255, 0.12)", border: "rgba(120, 170, 255, 0.32)", text: "#9FC4FF" }, // 淡蓝
  { bg: "rgba(140, 220, 160, 0.12)", border: "rgba(140, 220, 160, 0.32)", text: "#A9E8BC" }, // 淡绿
  { bg: "rgba(180, 160, 240, 0.12)", border: "rgba(180, 160, 240, 0.32)", text: "#C4B4F5" }, // 淡紫
  { bg: "rgba(110, 200, 230, 0.12)", border: "rgba(110, 200, 230, 0.32)", text: "#8FD8EC" }, // 青蓝
];

// 骨架分类选项
const CART_CATEGORIES = [
  { key: "foundation", label: "奠基理论", desc: "定义核心问题的基础工作" },
  { key: "mainstream", label: "主流方法", desc: "当前主流技术路线" },
  { key: "frontier", label: "最新前沿", desc: "近两年最新进展" },
];

// 手动选择分类时的默认理由
const CATEGORY_NOTES: Record<string, string> = {
  foundation: "手动选择：奠基理论类",
  mainstream: "手动选择：主流方法类",
  frontier: "手动选择：最新前沿类",
};

export function PaperCard({ paper, onAddToCart }: PaperCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [classifying, setClassifying] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭菜单
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // 手动分类：带默认理由；智能分类：带 AI reason
  const handleAdd = (category?: string, notes?: string) => {
    setMenuOpen(false);
    onAddToCart(paper.id, category, notes);
  };

  const handleSmartAdd = async () => {
    if (classifying) return;
    setClassifying(true);
    try {
      const res = await classifyPaper(paper.id);
      setMenuOpen(false);
      // AI 分类：带 AI 返回的理由
      onAddToCart(paper.id, res.category, `AI 分类：${res.reason}`);
    } catch (e) {
      alert(`AI 分类失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setClassifying(false);
    }
  };

  const authors = paper.authors || [];
  const authorDisplay =
    authors.length > 3
      ? `${authors.slice(0, 3).join(", ")} 等 ${authors.length} 人`
      : authors.join(", ");

  const meta: string[] = [];
  if (paper.venue) meta.push(paper.venue);

  return (
    <div className="card px-5 py-4 transition-colors group">
      {/* 头部：左侧（标题+Meta）与右侧指标列独立排版，互不撑高 */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-serif text-[15px] font-semibold leading-snug
                       bg-gradient-to-br from-gold-bright via-gold-light to-gold
                       bg-clip-text text-transparent">
            {paper.title}
          </h3>

          {/* Meta line（含徽章）—— 紧贴标题，不受右侧指标列高度影响 */}
          <div className="flex items-center gap-2 mt-1 text-[12px] text-ink-muted">
            {paper.is_survey && <span className="badge-blue">综述</span>}
            {paper.arxiv_id && (
              <span className="badge bg-violet-500/15 text-violet-300">arXiv</span>
            )}
            {paper.cited_by_count > 100 && <span className="badge-amber">高被引</span>}
            {meta.length > 0 && <span>{meta.join(" · ")}</span>}
            {authorDisplay && (
              <>
                <span className="text-line">|</span>
                <span className="truncate">{authorDisplay}</span>
              </>
            )}
          </div>
        </div>

        {/* 核心指标竖排：年份 / 被引 / 相关度（独立列，不影响左侧排版） */}
        <div className="flex flex-col gap-1.5 shrink-0 pl-3 border-l border-line-light">
          {paper.year && (
            <span className="flex items-center gap-1.5 justify-end text-[12px] text-ink leading-none" title="发布年份">
              <span className="w-3.5 h-3.5 shrink-0 rounded-[4px] bg-[rgba(91,143,249,0.18)] flex items-center justify-center">
                <Calendar className="w-2.5 h-2.5 text-[#5B8FF9]" />
              </span>
              <span className="w-12 text-right font-medium tabular-nums">{paper.year}</span>
            </span>
          )}
          {paper.cited_by_count > 0 && (
            <span className="flex items-center gap-1.5 justify-end text-[12px] text-ink leading-none" title="被引量">
              <span className="w-3.5 h-3.5 shrink-0 rounded-[4px] bg-[rgba(79,175,159,0.18)] flex items-center justify-center">
                <Quote className="w-2.5 h-2.5 text-[#4FAF9F]" />
              </span>
              <span className="w-12 text-right font-medium tabular-nums">{paper.cited_by_count}</span>
            </span>
          )}
          {paper.trunk_score !== null && (
            <span className="flex items-center gap-1.5 justify-end text-[12px] text-ink leading-none" title="相关度">
              <span className="w-3.5 h-3.5 shrink-0 rounded-[4px] bg-[rgba(201,162,75,0.18)] flex items-center justify-center">
                <Target className="w-2.5 h-2.5 text-gold-light" />
              </span>
              <span className="w-12 text-right font-medium tabular-nums text-gold-light">{paper.trunk_score?.toFixed(1)}</span>
            </span>
          )}
        </div>
      </div>

      {/* Keywords —— 玻璃质感徽章，每个关键词不同清透色 */}
      {paper.keywords && paper.keywords.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mt-2">
          {paper.keywords.slice(0, 5).map((kw, i) => {
            const c = KEYWORD_COLORS[i % KEYWORD_COLORS.length];
            return (
              <span
                key={kw}
                className="px-2 py-0.5 rounded-md text-[10.5px] backdrop-blur-sm"
                style={{ background: c.bg, border: `1px solid ${c.border}`, color: c.text }}
              >
                {kw}
              </span>
            );
          })}
        </div>
      )}

      {/* Abstract toggle：展开后"收起"按钮跟随在摘要末尾 */}
      {paper.abstract && (
        <div className="mt-2">
          {!expanded && (
            <button
              onClick={() => setExpanded(true)}
              className="flex items-center gap-1 text-[12px] text-ink-faint hover:text-ink-muted transition-colors"
            >
              <ChevronDown className="w-3 h-3" />
              摘要
            </button>
          )}
          {expanded && (
            <>
              <p className="mt-2 text-[13px] text-ink-secondary leading-relaxed">
                {paper.abstract}
              </p>
              <button
                onClick={() => setExpanded(false)}
                className="flex items-center gap-1 mt-2 text-[12px] text-ink-faint hover:text-ink-muted transition-colors"
              >
                <ChevronUp className="w-3 h-3" />
                收起
              </button>
            </>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-line-light">
        {/* 加入骨架：点击弹出分类菜单 */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => !paper.in_cart && setMenuOpen(!menuOpen)}
            disabled={paper.in_cart}
            className={
              paper.in_cart
                ? "btn-ghost text-success text-[12px] cursor-default"
                : "btn-secondary text-[12px] flex items-center gap-1"
            }
          >
            {paper.in_cart ? (
              <>
                <Check className="w-3 h-3 inline mr-1" />
                已加入
              </>
            ) : (
              <>
                <Plus className="w-3 h-3 inline mr-1" />
                加入骨架
                <ChevronDown className="w-3 h-3" />
              </>
            )}
          </button>

          {/* 分类菜单 */}
          {menuOpen && !paper.in_cart && (
            <div className="absolute left-0 top-full mt-1 w-56 bg-paper-white border border-gold/25 rounded-xl shadow-2xl shadow-black/40 py-1.5 z-20">
              <p className="px-3 pb-1 pt-0.5 text-[10px] text-ink-faint tracking-wide">
                加入为哪一类？
              </p>
              {CART_CATEGORIES.map((cat) => (
                <button
                  key={cat.key}
                  onClick={() => handleAdd(cat.key, CATEGORY_NOTES[cat.key])}
                  className="w-full text-left px-3 py-1.5 hover:bg-paper-warm transition-colors"
                >
                  <span className="block text-[12.5px] text-ink leading-tight">{cat.label}</span>
                  <span className="block text-[10.5px] text-ink-muted">{cat.desc}</span>
                </button>
              ))}
              <div className="my-1 mx-3 border-t border-line-light" />
              <button
                onClick={handleSmartAdd}
                disabled={classifying}
                className="w-full text-left px-3 py-1.5 hover:bg-accent-light/20 transition-colors flex items-center gap-2"
              >
                {classifying ? (
                  <Loader2 className="w-3.5 h-3.5 text-gold-light animate-spin shrink-0" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5 text-gold-light shrink-0" />
                )}
                <span>
                  <span className="block text-[12.5px] text-gold-light leading-tight">
                    {classifying ? "AI 分析中..." : "智能分类"}
                  </span>
                  <span className="block text-[10.5px] text-ink-muted">
                    AI 读摘要推荐分类
                  </span>
                </span>
              </button>
            </div>
          )}
        </div>

        <div className="flex-1" />

        {paper.github_url && (
          <a
            href={paper.github_url}
            target="_blank"
            rel="noopener noreferrer"
            title="查看 GitHub 代码仓库"
            className="btn-ghost text-[12px]"
          >
            <Github className="w-3 h-3 inline mr-0.5" />
            GitHub
          </a>
        )}

        {paper.doi && (
          <a
            href={`https://doi.org/${paper.doi}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost text-[12px]"
          >
            <ExternalLink className="w-3 h-3 inline mr-0.5" />
            DOI
          </a>
        )}
        {paper.arxiv_id && (
          <a
            href={`https://arxiv.org/abs/${paper.arxiv_id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost text-[12px]"
          >
            arXiv
          </a>
        )}
        {paper.title && (
          <a
            href={`https://scholar.google.com/scholar?q=${encodeURIComponent(paper.title.slice(0, 120))}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost text-[12px]"
          >
            Scholar
          </a>
        )}
      </div>
    </div>
  );
}
