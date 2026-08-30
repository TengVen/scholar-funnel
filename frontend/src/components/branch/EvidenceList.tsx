"use client";

/**
 * 证据引用块 —— 探针/全景结果卡共用
 * 每条 = 章节芯片（蓝色）+ 描述（青色左线引用条）
 */
import type { EvidenceItem } from "@/types/dto";

export function EvidenceList({ evidence }: { evidence: EvidenceItem[] }) {
  if (!evidence || evidence.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5 mt-2">
      {evidence.slice(0, 6).map((ev, i) => (
        <div
          key={i}
          className="flex gap-2 items-start bg-paper-warm/60 rounded-md px-2.5 py-1.5"
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
