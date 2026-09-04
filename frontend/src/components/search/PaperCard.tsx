"use client";

import { useState } from "react";
import {
  ExternalLink, ChevronDown, ChevronUp, Github,
  Calendar, Quote, Target, BookOpen,
} from "lucide-react";
import type { Paper, PaperRecommendation } from "@/types/dto";
import { KEYWORD_COLORS } from "@/config/keywords";
import { CATEGORY_SECTION, CATEGORY_META } from "@/config/categories";
import { WhyLine } from "./WhyLine";

/**
 * 检索页论文卡（2026-09-03 产品拍板）：主列表与「已推荐」视图共用同一卡片。
 * - 「加入骨架」按钮已取消（骨架概念收敛为推荐标签，操作收敛到详情页）
 * - 主操作 = 「深入研究」：进入论文详情页并触发深入探究（详情页内升 L2，不入三分类）
 * - recommendation（可选）：推荐论文附加信息（分类徽章 + 一句话理由 + 召回依据），
 *   仅「已推荐」视图传入，卡片其余样式与主列表完全一致
 */
interface PaperCardProps {
  paper: Paper;
  onOpenPaper: (paperId: number) => void;
  recommendation?: PaperRecommendation | null;
}

export function PaperCard({ paper, onOpenPaper, recommendation }: PaperCardProps) {
  const [expanded, setExpanded] = useState(false);

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
          <h3 className="font-serif text-lg font-semibold leading-snug
                       bg-gradient-to-br from-gold-bright via-gold-light to-gold
                       bg-clip-text text-transparent">
            {paper.title}
          </h3>

          {/* Meta line（含徽章）—— 紧贴标题，不受右侧指标列高度影响 */}
          <div className="flex items-center gap-2 mt-1 text-sm text-ink-muted">
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
            <span className="flex items-center gap-1.5 justify-end text-sm text-ink leading-none" title="发布年份">
              <span className="w-3.5 h-3.5 shrink-0 rounded-[4px] bg-[rgba(91,143,249,0.18)] flex items-center justify-center">
                <Calendar className="w-2.5 h-2.5 text-aux-blue" />
              </span>
              <span className="w-12 text-right font-medium tabular-nums">{paper.year}</span>
            </span>
          )}
          {paper.cited_by_count > 0 && (
            <span className="flex items-center gap-1.5 justify-end text-sm text-ink leading-none" title="被引量">
              <span className="w-3.5 h-3.5 shrink-0 rounded-[4px] bg-[rgba(79,175,159,0.18)] flex items-center justify-center">
                <Quote className="w-2.5 h-2.5 text-aux-teal" />
              </span>
              <span className="w-12 text-right font-medium tabular-nums">{paper.cited_by_count}</span>
            </span>
          )}
          {paper.trunk_score !== null && (
            <span className="flex items-center gap-1.5 justify-end text-sm text-ink leading-none" title="相关度">
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
                className="px-2 py-0.5 rounded-md text-2xs backdrop-blur-sm"
                style={{ background: c.bg, border: `1px solid ${c.border}`, color: c.text }}
              >
                {kw}
              </span>
            );
          })}
        </div>
      )}

      {/* 推荐信息（仅「已推荐」视图）：分类徽章 + 一句话理由 + 召回依据 */}
      {recommendation && (
        <div className="mt-2 rounded-md px-2.5 py-1.5 bg-gold/[0.06] border border-gold/20">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: CATEGORY_SECTION[recommendation.category]?.dot }} />
            <span className={`text-2xs font-medium ${CATEGORY_SECTION[recommendation.category]?.color ?? "text-ink-muted"}`}>
              {CATEGORY_META[recommendation.category]?.label ?? recommendation.category}
            </span>
          </div>
          {recommendation.one_liner && (
            <p className="text-sm text-ink-secondary leading-relaxed mt-1">{recommendation.one_liner}</p>
          )}
          {recommendation.recall_basis && (
            <p className="text-2xs text-ink-faint leading-relaxed mt-0.5">
              召回依据：{recommendation.recall_basis}
            </p>
          )}
        </div>
      )}

      {/* "为什么是它" —— 召回溯源一行（P0-A：默认可见，点击展开） */}
      {paper.why && <WhyLine why={paper.why} />}

      {/* Abstract toggle：展开后"收起"按钮跟随在摘要末尾 */}
      {paper.abstract && (
        <div className="mt-2">
          {!expanded && (
            <button
              onClick={() => setExpanded(true)}
              className="flex items-center gap-1 text-sm text-ink-faint hover:text-ink-muted transition-colors"
            >
              <ChevronDown className="w-3 h-3" />
              摘要
            </button>
          )}
          {expanded && (
            <>
              <p className="mt-2 text-base text-ink-secondary leading-relaxed">
                {paper.abstract}
              </p>
              <button
                onClick={() => setExpanded(false)}
                className="flex items-center gap-1 mt-2 text-sm text-ink-faint hover:text-ink-muted transition-colors"
              >
                <ChevronUp className="w-3 h-3" />
                收起
              </button>
            </>
          )}
        </div>
      )}

      {/* Actions：深入研究 = 主操作（进详情页深挖，升 L2）；外链保留 */}
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-line-light">
        <button
          type="button"
          onClick={() => onOpenPaper(paper.id)}
          className="btn-secondary text-sm flex items-center gap-1.5"
          title="进入论文详情页并深入研究（升为 L2，不加入分类清单）"
        >
          <BookOpen className="w-3.5 h-3.5 text-gold-light" />
          深入研究
        </button>

        <div className="flex-1" />

        {paper.github_url && (
          <a
            href={paper.github_url}
            target="_blank"
            rel="noopener noreferrer"
            title="查看 GitHub 代码仓库"
            className="btn-ghost text-sm"
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
            className="btn-ghost text-sm"
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
            className="btn-ghost text-sm"
          >
            arXiv
          </a>
        )}
        {paper.title && (
          <a
            href={`https://scholar.google.com/scholar?q=${encodeURIComponent(paper.title.slice(0, 120))}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost text-sm"
          >
            Scholar
          </a>
        )}
      </div>
    </div>
  );
}
