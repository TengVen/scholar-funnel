"use client";

import { Loader2, Sparkles } from "lucide-react";
import type { DeepResearchAttachments } from "@/types/dto";

/**
 * 深度调研运行卡（进行中 / 已结束 / 可取消）
 */
export function DeepResearchRunningCard({
  att,
  onCancel,
}: {
  att: DeepResearchAttachments;
  onCancel: () => void;
}) {
  const ended = att.status === "ended";
  return (
    <div className="max-w-[85%] w-[400px] rounded-2xl card bg-paper-chrome px-4 py-3">
      <div className="flex items-center gap-2">
        {!ended ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-status-running" />
        ) : (
          <Sparkles className="w-3.5 h-3.5 text-ink-faint" />
        )}
        <p className="text-base text-ink">
          {ended ? "深度调研已结束（结果见下方卡片，或重新发起）" : "深度调研进行中…"}
        </p>
      </div>
      {!ended && (
        <>
          <p className="text-xs text-ink-faint mt-1.5 leading-relaxed">
            意图解析 → 主干检索 → 候选归纳 → 探针推导，完成后在此展示结果
          </p>
          <button
            onClick={onCancel}
            className="mt-2 flex items-center gap-1.5 text-xs text-ink-muted
                       hover:text-ink border border-line rounded-md px-2.5 py-1
                       transition-colors"
          >
            取消研究
          </button>
        </>
      )}
    </div>
  );
}
