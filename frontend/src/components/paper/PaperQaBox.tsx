"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Send } from "lucide-react";
import type { PaperDetail, PaperAskResult, PaperSection } from "@/types/dto";
import { matchSection, type SectionTarget } from "@/lib/paper/sectionLocate";

/** 对话轮次：用户提问 / 助手回答（回答可带论文内引用回溯） */
type AskTurn =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; citations: PaperAskResult["citations"] };

type HistoryTurn = { role: "user" | "assistant"; content: string };

/**
 * 左栏对话交互区：向 AI 提问（原右栏问答块迁入，配合左栏"导航 + 对话"定位）。
 * 2026-09-04 升级为「基于本文的连续对话」：
 * - 多轮流（thread 渲染 + 底部常驻输入框，新问答追加、自动滚底）；
 * - 携带最近 10 轮上下文承接追问（history 仅文本，随请求发送）；
 * - 输入框常驻：待分析/分析中可先输入（提交后自动等待）；transient（无 paper_id）/无项目时禁用并引导；
 * - 域策略由后端 prompt 承载（论文内引用 / 论文外标注背景补充）。
 */
interface PaperQaBoxProps {
  detail: PaperDetail;
  projectId?: number | null;
  onAsk: (question: string, history: HistoryTurn[]) => Promise<PaperAskResult | null>;
  onLocate?: (target: SectionTarget) => void;
}

export function PaperQaBox({ detail, projectId, onAsk, onLocate }: PaperQaBoxProps) {
  const st = detail.analysis.status;
  const canAsk = !!detail.paper_id;   // transient（未落库）无法基于本文问答
  const [thread, setThread] = useState<AskTurn[]>([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const streamRef = useRef<HTMLDivElement>(null);
  const loadedPaperRef = useRef<number | null>(null);   // 已装载历史的论文（防分析轮询重建 detail 时重置）

  // 打开详情页 / 切换论文 → 从持久化历史恢复对话流（qa_history 时间升序；transient 无 paper_id 不装）
  useEffect(() => {
    const pid = detail.paper_id ?? null;
    if (pid === null || loadedPaperRef.current === pid) return;
    loadedPaperRef.current = pid;
    const hist = detail.qa_history ?? [];
    setThread(
      hist.flatMap<AskTurn>((h) => [
        { role: "user", content: h.question },
        { role: "assistant", content: h.answer, citations: h.citations ?? [] },
      ]),
    );
    setQuestion("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.paper_id, detail.mode]);

  const inputDisabled = asking || !projectId || !canAsk;

  // 新问答追加后自动滚到底（对话流区）
  useEffect(() => {
    if ((thread.length > 0 || asking) && streamRef.current) {
      streamRef.current.scrollTo({ top: streamRef.current.scrollHeight });
    }
  }, [thread, asking]);

  // 最近 10 轮（仅文本，供后端承接追问）
  const toHistory = (): HistoryTurn[] =>
    thread.slice(-10).map((t) => ({ role: t.role, content: t.content }));

  const submit = async () => {
    const q = question.trim();
    if (!q || inputDisabled) return;
    const userTurn: AskTurn = { role: "user", content: q };
    setThread((prev) => [...prev, userTurn]);
    setQuestion("");
    setAsking(true);
    try {
      const res = await onAsk(q, toHistory());
      if (res) {
        setThread((prev) => [
          ...prev,
          { role: "assistant", content: res.answer, citations: res.citations ?? [] },
        ]);
      } else {
        // 未产出回答（分析准备中/失败已 toast）→ 回滚刚提交的问题，避免流中留未答项
        setThread((prev) => prev.filter((t) => t !== userTurn));
      }
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

  const placeholder = !projectId
    ? "需要研究项目才能提问"
    : !canAsk
      ? "先「深入探究」转为研究论文后可提问"
      : st === "running"
        ? "AI 分析中…可先输入，完成后即回答"
        : "问这篇论文一个问题…";

  const hint = !projectId
    ? "提问前请先选择或创建一个研究项目"
    : !canAsk
      ? "点右侧「深入探究」：落库并生成分析后，即可基于全文连续提问"
      : st === "running"
        ? "AI 分析中…完成后的回答将带原文引用定位，可连续追问"
        : "可连续追问（保留最近 10 轮上下文）；论文外的背景问题也会回答并标注来源";

  return (
    <div className="flex flex-col gap-2 min-h-0">
      <p className="text-xs font-medium text-ink-muted">向 AI 提问</p>

      {/* 对话流（多轮，可滚动） */}
      <div ref={streamRef} className="max-h-[42vh] overflow-y-auto space-y-2 pr-0.5">
        {thread.map((t, i) =>
          t.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[88%] rounded-xl px-2.5 py-1.5 bg-gold/12 text-ink text-sm leading-relaxed">
                {t.content}
              </div>
            </div>
          ) : (
            <div key={i} className="rounded-lg border border-line bg-paper-warm/50 px-2.5 py-2">
              <p className="text-sm text-ink leading-relaxed whitespace-pre-wrap">{t.content}</p>
              {t.citations.length > 0 && (
                <div className="flex flex-col gap-1 mt-2">
                  {t.citations.map((c, ci) => (
                    <button
                      key={ci}
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
          ),
        )}
        {asking && (
          <div className="flex items-center gap-1.5 text-xs text-ink-faint">
            <Loader2 className="w-3 h-3 animate-spin text-accent" />
            AI 正在回答…
          </div>
        )}
      </div>

      {/* 输入行（常驻） */}
      <div className="flex items-center gap-2 shrink-0">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder={placeholder}
          disabled={inputDisabled}
          className="flex-1 text-sm bg-paper-warm border border-line rounded-md px-2.5 py-1.5 text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent/60 disabled:opacity-60"
        />
        <button
          type="button"
          onClick={submit}
          disabled={inputDisabled || !question.trim()}
          className="btn-secondary text-sm !py-1.5 disabled:opacity-50"
          title="发送问题"
        >
          {asking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
        </button>
      </div>
      <p className="text-xs text-ink-faint leading-relaxed shrink-0">{hint}</p>
    </div>
  );
}
