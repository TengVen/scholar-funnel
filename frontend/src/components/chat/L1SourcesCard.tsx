"use client";

import type { L1Source } from "@/types/dto";
import { PaperNavRow } from "./PaperNavRow";

/**
 * L1 来源卡（L1Renderer）：论文 = 当前回答的外部来源。
 * 来源可点击进入详情页（transient 模式），"加入研究/深入探究"操作收敛到详情页。
 */
interface L1SourcesCardProps {
  content: string;               // 答案文字（含编号引用）
  sources: L1Source[];
  projectId?: number | null;
}

export function L1SourcesCard({ content, sources, projectId }: L1SourcesCardProps) {
  return (
    <div className="card max-w-[85%] w-full px-4 py-3">
      <div className="text-base leading-relaxed text-ink-secondary whitespace-pre-wrap">{content}</div>
      {sources.length > 0 && (
        <div className="mt-3 border-t border-line pt-3">
          <p className="text-sm text-ink-muted mb-2">来源 {sources.length} 篇</p>
          <div className="space-y-1">
            {sources.map((s, i) => (
              <PaperNavRow
                key={`${s.openalex_id ?? s.doi ?? s.title}-${i}`}
                title={`[${i + 1}] ${s.title}`}
                meta={[s.year ? String(s.year) : "", s.venue ?? ""]}
                reason={s.reason}
                href={s.openalex_id
                  ? `/paper/openalex/${s.openalex_id}${projectId ? `?project_id=${projectId}` : ""}`
                  : "#"}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
