"use client";

import { useState } from "react";
import { Loader2, Send } from "lucide-react";
import type { PaperDetail } from "@/types/dto";

/**
 * 左栏对话交互区：向 AI 提问（原右栏问答块迁入，配合左栏"导航 + 对话"定位）。
 * - 分析完成（done）：问答输入 + 问答记录 + L2→L3 落库提示
 * - 待分析 / 分析中：占位提示（深入探究后可用）
 */
interface PaperQaBoxProps {
  detail: PaperDetail;
  projectId?: number | null;
  onAsk: (question: string) => Promise<string | null>;
}

export function PaperQaBox({ detail, projectId, onAsk }: PaperQaBoxProps) {
  const st = detail.analysis.status;
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [qa, setQa] = useState<{ q: string; a: string } | null>(null);

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
      const ans = await onAsk(question.trim());
      if (ans) setQa({ q: question.trim(), a: ans });
    } finally {
      setAsking(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-ink-faint">向 AI 提问</p>
      {qa && (
        <div className="rounded-lg border border-line bg-paper-warm/50 px-2.5 py-2">
          <p className="text-sm text-ink font-medium mb-1">{qa.q}</p>
          <p className="text-sm text-ink-secondary leading-relaxed">{qa.a}</p>
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
