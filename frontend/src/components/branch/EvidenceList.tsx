"use client";

/**
 * 证据引用块 —— 探针/全景结果卡共用
 * 每条 = 章节芯片（蓝色）+ 描述（青色左线引用条）
 * onItemClick（可选）：点击条目回调（详情页用于跳转到对应章节/PDF 页）
 */
import type { EvidenceItem } from "@/types/dto";

interface EvidenceListProps {
  evidence: EvidenceItem[];
  onItemClick?: (item: EvidenceItem) => void;
}

export function EvidenceList({ evidence, onItemClick }: EvidenceListProps) {
  if (!evidence || evidence.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5 mt-2">
      {evidence.slice(0, 6).map((ev, i) => (
        <div
          key={i}
          onClick={onItemClick ? () => onItemClick(ev) : undefined}
          className={`flex gap-2 items-start bg-paper-warm/60 rounded-md px-2.5 py-1.5 ${onItemClick ? "cursor-pointer hover:bg-paper-warm" : ""}`}
          style={{ borderLeft: "2px solid rgba(95,207,190,0.5)" }}
        >
          {ev.section ? (
            <span
              className="px-1.5 py-0.5 rounded text-2xs whitespace-nowrap shrink-0 mt-px"
              style={{ background: "rgba(120,170,255,0.14)", color: "#9FC4FF" }}
            >
              {ev.section}
            </span>
          ) : null}
          <span className="text-xs text-ink-secondary leading-relaxed">
            {ev.description}
          </span>
        </div>
      ))}
    </div>
  );
}
