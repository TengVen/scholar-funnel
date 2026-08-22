"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Loader2, Sparkles, ArrowUp, ExternalLink } from "lucide-react";
import {
  sendChatMessage,
  getChatSearchStatus,
  finalizeSearchSummary,
  type ChatMessage,
} from "@/lib/api";
import {
  ChatConfigBar,
  loadConfig,
  DEFAULT_CONFIG,
  type ChatConfig,
} from "./ChatConfigBar";

interface ChatPanelProps {
  onProjectCreated: (projectId: number) => void;
  onOpenProject: (projectId: number) => void;   // 查看项目 → 检索页
}

const SUGGESTIONS = [
  "风力发电功率预测",
  "Transformer 与 CNN 在图像修复中的效果对比",
  "知识蒸馏在推荐系统中的应用",
  "多智能体协作推理的研究现状",
];

export function ChatPanel({ onProjectCreated, onOpenProject }: ChatPanelProps) {
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
  const [config, setConfig] = useState<ChatConfig>(() => loadConfig());

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const hasConversation = messages.some((m) => m.role === "user");

  // 配置持久化
  const handleConfigChange = (cfg: ChatConfig) => {
    setConfig(cfg);
    try {
      localStorage.setItem("scholar_funnel_chat_config", JSON.stringify(cfg));
    } catch {
      /* ignore */
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    if (hasConversation) scrollToBottom();
  }, [messages, hasConversation]);

  const handleSend = async (textOverride?: string) => {
    const text = (textOverride ?? input).trim();
    if (!text || sending) return;

    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setSending(true);

    try {
      const llmConfig: Record<string, string> = {};
      if (config.llm.api_key) llmConfig.api_key = config.llm.api_key;
      if (config.llm.base_url) llmConfig.base_url = config.llm.base_url;
      if (config.llm.model) llmConfig.model = config.llm.model;

      const res = await sendChatMessage(conversationId, text, {
        ...(Object.keys(llmConfig).length > 0 ? { llm_config: llmConfig } : {}),
      });

      if (res.reply) {
        setMessages((prev) => [...prev, { role: "assistant", content: res.reply }]);
        setStage(res.stage);
      }

      // 主 Agent 发起了 full_search → 异步轮询 → 完成后生成总结
      if (res.task_id) {
        setSearching(true);
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "检索已启动，正在后台执行（预计 1-2 分钟）..." },
        ]);
        try {
          while (true) {
            await new Promise((r) => setTimeout(r, 3000));
            const status = await getChatSearchStatus(res.task_id);
            if (status.status === "done") break;
            if (status.status === "error") throw new Error(status.error || "search failed");
          }
          const summary = await finalizeSearchSummary(res.task_id);
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: summary.summary,
              project_id: summary.project_id,
              project_name: summary.project_name,
            },
          ]);
          onProjectCreated(summary.project_id);
          setStage("greeting");
        } catch (e) {
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: `检索失败：${e instanceof Error ? e.message : String(e)}。你可以修改需求后重试。`,
            },
          ]);
        } finally {
          setSearching(false);
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

  const inputDisabled = sending || searching;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* ── 初始空态：居中大对话框（Hero） ── */}
      {!hasConversation ? (
        <div className="flex-1 overflow-y-auto">
          <div className="min-h-full flex flex-col items-center justify-center px-6 py-10">
            {/* 品牌区 */}
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-gold-light to-gold-hover flex items-center justify-center mb-5 shadow-lg shadow-gold/10">
              <Sparkles className="w-6 h-6 text-[#171614]" />
            </div>
            <h1 className="font-serif text-[26px] font-semibold bg-gradient-to-br from-gold-bright via-gold-light to-gold bg-clip-text text-transparent">
              Scholar Funnel
            </h1>
            <p className="text-[13px] text-ink-muted mt-2 mb-8 text-center">
              用对话的方式描述研究方向，自动拆解意图、召回并构建文献骨架
            </p>

            {/* 居中输入框（炫彩流光环绕）—— 加宽 */}
            <div className="w-full max-w-3xl glow-shell">
              <div className="glow-inner">
                <div className="flex items-center gap-2 px-4 py-2.5">
                  <input
                    ref={inputRef}
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={placeholder}
                    className="flex-1 min-w-0 bg-transparent border-0 outline-none focus:ring-0 focus:ring-transparent h-9 text-[14px] leading-normal text-ink placeholder:text-ink-faint"
                    disabled={inputDisabled}
                    autoFocus
                  />
                  <button
                    onClick={() => handleSend()}
                    disabled={inputDisabled || !input.trim()}
                    className="w-8 h-8 shrink-0 rounded-lg bg-gradient-to-br from-gold-light to-gold-hover flex items-center justify-center text-[#171614] hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {sending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <ArrowUp className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* 配置工具栏（输入框下方一排） */}
            <div className="mt-3 w-full max-w-3xl flex justify-center">
              <ChatConfigBar config={config} onChange={handleConfigChange} />
            </div>

            {/* 示例问题 */}
            <div className="mt-6 w-full max-w-3xl">
              <p className="text-[11px] text-ink-faint mb-3 text-center tracking-wide">
                试试这些研究方向
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => handleSend(s)}
                    disabled={inputDisabled}
                    className="px-3 py-1.5 rounded-full border border-line text-[12px] text-ink-secondary
                               hover:border-gold/50 hover:text-gold-light hover:bg-accent-light/20
                               transition-colors disabled:opacity-40"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* ── 对话态：消息流居中 + 底部输入框居中 ── */
        <>
          <div className="flex-1 overflow-y-auto px-6 py-6">
            <div className="max-w-3xl mx-auto space-y-4">
              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-[13px] leading-relaxed whitespace-pre-wrap ${
                    msg.role === "user"
                      ? "bg-gradient-to-br from-gold-light to-gold-hover text-[#171614]"
                      : "card"
                  }`}>
                    {msg.content}
                    {msg.project_id && (
                      <button
                        onClick={() => onOpenProject(msg.project_id!)}
                        className="mt-2.5 flex items-center gap-1.5 btn-secondary text-[12px] !py-1.5"
                      >
                        <ExternalLink className="w-3 h-3" />
                        查看项目「{msg.project_name || `#${msg.project_id}`}」
                      </button>
                    )}
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

              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* 底部居中输入框（加宽） */}
          <div className="shrink-0 px-6 pb-5 pt-2">
            <div className="max-w-4xl mx-auto">
              <div className="glow-shell">
                <div className="glow-inner">
                  <div className="flex items-center gap-2 px-4 py-2.5">
                    <input
                      ref={inputRef}
                      type="text"
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder={placeholder}
                      className="flex-1 min-w-0 bg-transparent border-0 outline-none focus:ring-0 focus:ring-transparent h-9 text-[13px] leading-normal text-ink placeholder:text-ink-faint"
                      disabled={inputDisabled}
                    />
                    <button
                      onClick={() => handleSend()}
                      disabled={inputDisabled || !input.trim()}
                      className="w-8 h-8 shrink-0 rounded-lg bg-gradient-to-br from-gold-light to-gold-hover flex items-center justify-center text-[#171614] hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {sending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Send className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* 配置工具栏 */}
              <div className="mt-2 flex justify-center">
                <ChatConfigBar config={config} onChange={handleConfigChange} />
              </div>

              {stage === "confirming" && userQuery && (
                <div className="mt-2 flex items-center gap-3 text-[11px] text-ink-faint">
                  <span>方向：<span className="text-ink-secondary">{userQuery.slice(0, 40)}</span></span>
                  {yearFrom && <span>年份：{yearFrom}-{yearTo}</span>}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
