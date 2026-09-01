"use client";

import type { PaperSection } from "@/types/dto";

/**
 * 中栏：论文核心内容（摘要 + 分节正文，锚点滚动）
 * transient 态无分节 → 只显示摘要；有分节 → 摘要置顶 + 正文分节。
 *
 * 摘要来源标注（2026-09-01）：
 * - 原文摘要（OpenAlex/PDF 回填）
 * - ai_tldr：Semantic Scholar AI 生成概要（数据源均无原文摘要时的兜底，非原文，明确标注）
 *
 * 材料状态四态文案：
 * - 全文分节 → "解析自原文"
 * - 摘要     → "OpenAlex 摘要"
 * - AI 概要  → "AI 生成概要（Semantic Scholar）"
 * - 无材料   → 明确告知数据源未收录 + 引导上传 PDF
 */
interface PaperContentPanelProps {
  abstract?: string | null;
  abstractSource?: string;          // "" 原文 / ai_tldr
  sections?: PaperSection[] | null;
  materialType?: string;            // 全文分节 / 摘要 / AI 概要 / 无材料
  landingUrl?: string | null;       // 出版商落地页（无摘要时提供"去出版商看原文"兜底）
}

export function PaperContentPanel({ abstract, abstractSource = "", sections, materialType, landingUrl }: PaperContentPanelProps) {
  const hasSections = Array.isArray(sections) && sections.length > 0;
  const isAiTldr = abstractSource === "ai_tldr";

  return (
    <main className="flex-1 min-w-0 px-6 py-5">
      {abstract ? (
        <section id="paper-sec-abstract" className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <h2 className="font-serif text-base font-semibold text-ink">摘要</h2>
            {isAiTldr && (
              <span className="text-xs px-1.5 py-0.5 rounded-full border border-status-running/30 text-status-running bg-status-running/10 whitespace-nowrap">
                AI 生成概要 · 非原文
              </span>
            )}
          </div>
          <p className="text-base text-ink-secondary leading-relaxed whitespace-pre-wrap">{abstract}</p>
          {isAiTldr && (
            <p className="text-xs text-ink-faint mt-1.5">
              原文摘要未被 OpenAlex/Crossref 收录，以上为 Semantic Scholar AI 生成的论文概要；
              {landingUrl && (
                <a href={landingUrl} target="_blank" rel="noreferrer"
                  className="text-accent hover:underline ml-0.5">
                  前往出版商页面查看原文 ↗
                </a>
              )}
            </p>
          )}
        </section>
      ) : (
        <section className="mb-6">
          <h2 className="font-serif text-base font-semibold text-ink mb-2">摘要</h2>
          <div className="text-sm text-ink-faint leading-relaxed space-y-2">
            <p>
              该论文无摘要信息（OpenAlex / Crossref 均未收录）。
              {landingUrl && (
                <a href={landingUrl} target="_blank" rel="noreferrer"
                  className="text-accent hover:underline ml-1">
                  前往出版商页面查看原文 ↗
                </a>
              )}
            </p>
            <p>可上传本地 PDF 补全全文，系统将自动提取摘要并升级为全文级分析。</p>
          </div>
        </section>
      )}

      {materialType && (
        <p className="text-xs text-ink-faint mb-4">
          {materialType === "全文分节"
            ? "正文依据：解析自原文"
            : materialType === "摘要"
              ? "正文依据：OpenAlex 摘要"
              : materialType === "AI 概要"
                ? "正文依据：AI 生成概要（Semantic Scholar）"
                : "正文依据：暂无材料（无摘要无全文）"}
        </p>
      )}

      {hasSections ? (
        <div className="space-y-6">
          {sections.map((s, i) => (
            <section key={`${s.heading}-${i}`} id={`paper-sec-${i + 1}`}>
              <h2 className="font-serif text-base font-semibold text-ink mb-2">{s.heading}</h2>
              <div className="text-base text-ink-secondary leading-relaxed whitespace-pre-wrap">{s.content}</div>
            </section>
          ))}
        </div>
      ) : (
        <p className="text-sm text-ink-faint">暂未获取到正文分节，可尝试「深入探究」或上传 PDF。</p>
      )}
    </main>
  );
}
