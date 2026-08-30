"use client";

import { useState } from "react";
import { BookOpen, Loader2 } from "lucide-react";
import type { L1Source } from "@/types/dto";
import { joinProject } from "@/lib/api/papers";
import { toast } from "@/lib/toast";

/**
 * L1 来源卡（L1Renderer）：论文 = 当前回答的外部来源。
 * 文案与链路（2026-08-30 拍板）："加入研究"= 用户主动把来源纳入当前研究
 * （论文来源 → 加入研究 → 成为项目候选），不进骨架。
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
          <div className="space-y-2">
            {sources.map((s, i) => (
              <SourceRow key={`${s.openalex_id ?? s.doi ?? s.title}-${i}`} source={s} index={i + 1} projectId={projectId} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SourceRow({ source, index, projectId }: { source: L1Source; index: number; projectId?: number | null }) {
  const [joining, setJoining] = useState(false);
  const [joined, setJoined] = useState(false);

  const handleJoin = async () => {
    if (!source.openalex_id || !projectId) {
      toast("需要先建立研究项目才能加入研究（先发起一次检索）", "info");
      return;
    }
    setJoining(true);
    try {
      await joinProject(projectId, source.openalex_id);
      setJoined(true);
      toast(`《${source.title.slice(0, 30)}》已纳入当前研究`, "success");
    } catch (e) {
      toast(`加入研究失败: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setJoining(false);
    }
  };

  const meta = [source.year, source.venue].filter(Boolean).join(" · ");
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-base text-ink leading-snug">
          <span className="text-ink-faint">[{index}]</span> {source.title}
        </p>
        {meta && <p className="text-sm text-ink-faint mt-0.5">{meta}{source.doi ? ` · DOI ${source.doi.slice(0, 24)}` : ""}</p>}
        {source.reason && <p className="text-sm text-ink-muted mt-1">{source.reason}</p>}
      </div>
      <button
        type="button"
        onClick={handleJoin}
        disabled={joining || joined}
        className="btn-secondary text-xs !py-1.5 shrink-0 disabled:opacity-60"
      >
        {joining ? <Loader2 className="w-3 h-3 animate-spin" /> : joined ? "已纳入研究" : "加入研究"}
        {!joining && !joined && <BookOpen className="w-3 h-3" />}
      </button>
    </div>
  );
}
