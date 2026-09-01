"use client";

import { useState } from "react";
import { Loader2, Send } from "lucide-react";
import type { PaperDetail, PaperAskResult, PaperSection } from "@/types/dto";
import { matchSection, type SectionTarget } from "@/lib/paper/sectionLocate";

/**
 * 左栏对话交互区：向 AI 提问（原右栏问答块迁入，配合左栏"导航 + 对话"定位）。
 * - 分析完成（done）：问答输入 + 问答记录（带 E1 引用回溯，可跳章节/PDF）+ L2→L3 落库提示
 * - 待分析 / 分析中：占位提示（深入探究后可用）
 */
interface PaperQaBoxProps {
  detail: PaperDetail;
  projectId?: number | null;
  onAsk: (question: string) => Promise<PaperAskResult | null>;
  onLocate?: (target: SectionTarget) => void;
}

export function PaperQaBox({ detail, projectId, onAsk, onLocate }: PaperQaBoxProps) {
  const st = detail.analysis.status;
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [qa, setQa] = useState<{ q: string; answer: string; citations: PaperAskResult["citations"] } | null>(null);

  if (st !== "done") {
    return (
      <div>
        <p className="text-xs text-ink-faint mb-1.5">向 AI 提问</p>
        <p className="text-xs text-ink-faint leading-relaxed">
          {st === "running" ? "AI 分析中，完成后可在此提问…" : "深入探究后即可在此向 AI 提问"}
        </p>
      </div>
    );
  }

  const submit = async () => {
    if (!question.trim() || asking) return;
    setAsking(true);
    try {
      const res = await onAsk(question.trim());
      if (res) setQa({ q: question.trim(), answer: res.answer, citations: res.citations ?? [] });
    } finally {
      setAsking(false);
    }
  };

  const sections: PaperSection[] = detail.sections ?? detail.analysis.sections ?? [];
  const locateCitation = (section: string) => {
    if (!onLocate) return;
    const t = matchSection(section, sections);
    if (t) onLocate(t);
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-ink-faint">向 AI 提问</p>
      {qa && (
        <div className="rounded-lg border border-line bg-paper-warm/50 px-2.5 py-2">
          <p className="text-sm text-ink font-medium mb-1">{qa.q}</p>
          <p className="text-sm text-ink-secondary leading-relaxed">{qa.answer}</p>
          {qa.citations.length > 0 && (
            <div className="flex flex-col gap-1 mt-2">
              {qa.citations.map((c, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => locateCitation(c.section ?? "")}
                  disabled={!onLocate}
                  className="flex gap-2 items-start bg-paper-warm/60 rounded-md px-2 py-1 text-left disabled:cursor-default"
                  style={{ borderLeft: "2px solid rgba(95,207,190,0.5)" }}
                  title={onLocate ? "定位到原文对应章节" : undefined}
                >
                  {c.section ? (
                    <span
                      className="px-1.5 py-0.5 rounded text-xs whitespace-nowrap shrink-0 mt-px"
                      style={{ background: "rgba(120,170,255,0.14)", color: "#9FC4FF" }}
                    >
                      {c.section}
                    </span>
                  ) : null}
                  <span className="text-xs text-ink-secondary leading-relaxed">{c.snippet}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="flex items-center gap-2">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder={projectId ? "问这篇论文一个问题…" : "需要研究项目才能提问"}
          disabled={asking || !projectId}
          className="flex-1 text-sm bg-paper-warm border border-line rounded-md px-2.5 py-1.5 text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent/60"
        />
        <button type="button" onClick={submit} disabled={asking || !projectId || !question.trim()}
          className="btn-secondary text-sm !py-1.5 disabled:opacity-50">
          {asking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
        </button>
      </div>
      <p className="text-xs text-ink-faint">首次提问会将本篇转为正式研究资产（L3）</p>
    </div>
  );
}
