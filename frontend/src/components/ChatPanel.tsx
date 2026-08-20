"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Loader2 } from "lucide-react";
import {
  sendChatMessage,
  startChatSearch,
  getChatSearchStatus,
  getChatSearchResult,
  type ChatMessage,
  type SearchResult,
} from "@/lib/api";

interface ChatPanelProps {
  onProjectCreated: (projectId: number) => void;
}

export function ChatPanel({ onProjectCreated }: ChatPanelProps) {
  const [conversationId] = useState(() =>
    Date.now().toString(36) + Math.random().toString(36).slice(2),
  );
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        '你好！我是 Scholar Funnel，可以帮你快速检索学术文献。\n\n你想研究什么方向？随便说，比如：\n"风力发电预测"\n"对比 Transformer 和 CNN 在图像修复中的效果"\n"知识蒸馏在推荐系统中的应用"',
    },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [stage, setStage] = useState("greeting");
  const [confirmedParams, setConfirmedParams] = useState<Record<string, unknown>>({});
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;

    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setSending(true);

    try {
      const res = await sendChatMessage(conversationId, text);

      if (res.stage === "searching" && res.params?.user_query) {
        setConfirmedParams(res.params);
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "好的，正在为你检索文献..." },
        ]);
        await doSearch(res.params);
      } else if (res.reply) {
        setMessages((prev) => [...prev, { role: "assistant", content: res.reply }]);
        setStage(res.stage);
        if (Object.keys(res.params).length > 0) {
          setConfirmedParams(res.params);
        }
      }
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `抱歉，出了点问题：${e instanceof Error ? e.message : String(e)}` },
      ]);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const doSearch = async (params: Record<string, unknown>) => {
    setSearching(true);
    setSearchResult(null);
    try {
      const { task_id } = await startChatSearch(conversationId, params);

      while (true) {
        await new Promise((r) => setTimeout(r, 3000));
        const status = await getChatSearchStatus(task_id);
        if (status.status === "done") break;
        if (status.status === "error") throw new Error(status.error || "search failed");
      }

      const res = await getChatSearchResult(task_id);
      setSearchResult(res.result);
      onProjectCreated(res.project_id);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `检索完成！共找到 ${res.result.new_saved} 篇新论文，其中综述 ${res.result.survey_count} 篇。\n\n你可以在左侧切换到"检索"页面查看详情，或继续和我对话调整检索方向。`,
        },
      ]);
      setStage("greeting");
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `检索失败：${e instanceof Error ? e.message : String(e)}。你可以修改需求后重试。` },
      ]);
    } finally {
      setSearching(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const placeholder = stage === "confirming"
    ? '说"开始"执行检索，或修改需求...'
    : "告诉我你想研究什么...";

  const userQuery = confirmedParams.user_query as string | undefined;
  const yearFrom = confirmedParams.year_from as number | undefined;
  const yearTo = confirmedParams.year_to as number | undefined;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-lg px-4 py-3 text-[13px] leading-relaxed whitespace-pre-wrap ${msg.role === "user" ? "bg-gradient-to-br from-gold-light to-gold-hover text-[#171614]" : "card"}`}>
              {msg.content}
            </div>
          </div>
        ))}

        {searching && (
          <div className="flex justify-start">
            <div className="card px-4 py-3 flex items-center gap-2 text-[13px] text-ink-muted">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              正在检索文献，请稍候...
            </div>
          </div>
        )}

        {searchResult && (
          <div className="card px-5 py-4 bg-accent-light/30 border-accent/20">
            <p className="text-[13px] text-ink-secondary font-medium mb-2">检索结果</p>
            <div className="flex items-center gap-4 text-[12px] text-ink-muted">
              <span>召回 <span className="text-ink font-medium">{searchResult.total_found}</span></span>
              <span>重排 <span className="text-ink font-medium">{searchResult.after_rerank}</span></span>
              <span>新增 <span className="text-ink font-medium">{searchResult.new_saved}</span></span>
              {searchResult.survey_count > 0 && (
                <span>综述 <span className="text-accent font-medium">{searchResult.survey_count}</span></span>
              )}
            </div>
            {searchResult.expanded_queries?.length > 0 && (
              <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                {searchResult.expanded_queries.slice(0, 5).map((q, i) => (
                  <span key={i} className="badge-blue">{q}</span>
                ))}
              </div>
            )}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="border-t border-line bg-paper-white px-6 py-3 shrink-0">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="input flex-1"
            disabled={sending || searching}
          />
          <button
            onClick={handleSend}
            disabled={sending || searching || !input.trim()}
            className="btn-primary px-4"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
        {stage === "confirming" && userQuery && (
          <div className="mt-2 flex items-center gap-3 text-[11px] text-ink-faint">
            <span>方向：<span className="text-ink-secondary">{userQuery.slice(0, 40)}</span></span>
            {yearFrom && <span>年份：{yearFrom}-{yearTo}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
