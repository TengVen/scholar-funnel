"use client";

import type { PaperSection } from "@/types/dto";

/**
 * 中栏：论文核心内容（摘要 + 分节正文，锚点滚动）
 * transient 态无分节 → 只显示摘要；有分节 → 摘要置顶 + 正文分节。
 */
interface PaperContentPanelProps {
  abstract?: string | null;
  sections?: PaperSection[] | null;
  materialType?: string;       // 摘要 / 全文分节（标注内容依据）
}

export function PaperContentPanel({ abstract, sections, materialType }: PaperContentPanelProps) {
  const hasSections = Array.isArray(sections) && sections.length > 0;

  return (
    <main className="flex-1 min-w-0 px-6 py-5">
      {abstract && (
        <section id="paper-sec-abstract" className="mb-6">
          <h2 className="font-serif text-base font-semibold text-ink mb-2">摘要</h2>
          <p className="text-base text-ink-secondary leading-relaxed whitespace-pre-wrap">{abstract}</p>
        </section>
      )}

      {materialType && (
        <p className="text-xs text-ink-faint mb-4">
          正文依据：{materialType === "全文分节" ? "解析自原文" : "OpenAlex 摘要（未获取到全文）"}
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
