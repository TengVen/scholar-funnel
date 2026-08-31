"use client";

import type { RefObject } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import type { ChatMessage } from "@/types/dto";
import { EXEC_STAGES } from "@/config/chat";
import { MarkdownBody } from "./MarkdownBody";
import { L1SourcesCard } from "./L1SourcesCard";
import { L2StructureCard } from "./L2StructureCard";
import { ResearchResultCard } from "./ResearchResultCard";
import { DeepResearchRunningCard } from "./DeepResearchRunningCard";

/**
 * 对话态消息流：按 attachments.type 分发到对应的结果卡，无附件则渲染普通气泡
 *
 * 尾部三个附加块：执行中占位（轮换文案）、检索中提示、滚动锚点。
 */
export function MessageList({
  messages, onCancelDeepResearch, onOpenProject, pendingIdx, searching, messagesEndRef,
}: {
  messages: ChatMessage[];
  onCancelDeepResearch: () => void;
  onOpenProject: (projectId: number) => void;
  pendingIdx: number | null;
  searching: boolean;
  messagesEndRef: RefObject<HTMLDivElement>;
}) {
  return (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      <div className="max-w-4xl mx-auto space-y-4">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            {msg.attachments?.type === "deep_research_result" ? (
              <ResearchResultCard att={msg.attachments} projectId={msg.project_id ?? null} />
            ) : msg.attachments?.type === "deep_research" ? (
              <DeepResearchRunningCard att={msg.attachments} onCancel={onCancelDeepResearch} />
            ) : msg.attachments?.type === "l1_sources" ? (
              <L1SourcesCard content={msg.content} sources={msg.attachments.sources} projectId={msg.project_id ?? null} />
            ) : msg.attachments?.type === "l2_structure" ? (
              <L2StructureCard
                content={msg.content}
                structure={msg.attachments.cognitive_structure}
                projectId={msg.project_id ?? null}
              />
            ) : (
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 text-base leading-relaxed ${
                  msg.role === "user"
                    ? "bg-gradient-to-br from-gold-light to-gold-hover text-[#171614] whitespace-pre-wrap"
                    : "card"
                }`}
              >
                {msg.role === "user" ? (
                  msg.content
                ) : (
                  <MarkdownBody content={msg.content} />
                )}
                {msg.project_id && (
                  <button
                    onClick={() => onOpenProject(msg.project_id!)}
                    className="mt-2.5 flex items-center gap-1.5 btn-secondary text-sm !py-1.5"
                  >
                    <ExternalLink className="w-3 h-3" />
                    查看项目「{msg.project_name || `#${msg.project_id}`}」
                  </button>
                )}
              </div>
            )}
          </div>
        ))}

        {pendingIdx !== null && (
          <div className="flex justify-start">
            <div className="card px-4 py-3 flex items-center gap-2.5 text-base text-ink-muted">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-gold-light shrink-0" />
              <span>{EXEC_STAGES[pendingIdx]}</span>
            </div>
          </div>
        )}

        {searching && (
          <div className="flex justify-start">
            <div className="card px-4 py-3 flex items-center gap-2 text-base text-ink-muted">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              正在检索文献，请稍候...
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}
