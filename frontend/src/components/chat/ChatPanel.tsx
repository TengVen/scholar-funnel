"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Loader2, Sparkles, ArrowUp, ExternalLink } from "lucide-react";
import {
  sendChatMessage,
  getChatSearchStatus,
  finalizeSearchSummary,
  finalizeDeepResearch,
  getChatHistory,
} from "@/lib/api/chat";
import { getFunnelState } from "@/lib/api/funnel";
import type { ChatMessage, DeepResearchAttachments, SearchSummary } from "@/types/dto";
import { ChatConfigBar } from "./ChatConfigBar";
import { MarkdownBody } from "./MarkdownBody";
import { L1SourcesCard } from "./L1SourcesCard";
import { L2StructureCard } from "./L2StructureCard";
import { ResearchResultCard } from "./ResearchResultCard";
import type { ChatConfig } from "@/types/domain";
import { DEFAULT_CONFIG, SUGGESTIONS } from "@/config/chat";
import { STORAGE_KEYS } from "@/config/storage";
import { useLocalStorageConfig, normalizeChatConfig } from "@/hooks/useLocalStorageConfig";
import { useTaskPolling } from "@/hooks/useTaskPolling";
import { toast } from "@/lib/toast";

/** 等待期间的阶段性文案（轮换展示，避免"空白 → 突然跳出一整段"） */
const EXEC_STAGES = [
  "正在理解你的问题…",
  "正在检索相关文献…",
  "正在分析论文脉络…",
  "正在组织回答…",
];

interface ChatPanelProps {
  onProjectCreated: (projectId: number) => void;
  onOpenProject: (projectId: number) => void;   // 查看项目 → 检索页
  requestedConversationId?: string | null;      // 左侧点历史会话 → 打开它
  newSignal?: number;                            // 左侧点新对话 → 重置
  currentProjectId?: number | null;             // 当前项目（会话按项目恢复时记录）
  onRequestConsumed?: () => void;
  onConversationChanged?: (cid: string | null, projectId?: number | null) => void;
}

const genConvId = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2);

export function ChatPanel({
  onProjectCreated,
  onOpenProject,
  requestedConversationId,
  newSignal,
  currentProjectId,
  onRequestConsumed,
  onConversationChanged,
}: ChatPanelProps) {
  const [conversationId, setConversationId] = useState(genConvId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [stage, setStage] = useState("greeting");
  const [confirmedParams, setConfirmedParams] = useState<Record<string, unknown>>({});

  // 等待回复期间的执行中占位（轮换文案；收到响应后置 null）
  const [pendingIdx, setPendingIdx] = useState<number | null>(null);
  useEffect(() => {
    if (pendingIdx === null) return;
    const timer = setInterval(() => {
      setPendingIdx((i) => (i === null ? null : (i + 1) % EXEC_STAGES.length));
    }, 2200);
    return () => clearInterval(timer);
  }, [pendingIdx !== null]);

  // 深度调研：历史恢复去重 + 当前是否正在轮询（避免重复提交）
  const drUpgradedRef = useRef<Set<string>>(new Set());
  const drActiveRef = useRef(false);
  // 组件挂载标记：切换 tab 卸载后不再 setState，避免 React 警告/内存泄漏
  const mountedRef = useRef(true);

  // 对话配置：localStorage 由 hook 管理（水合后加载，首屏默认值保证 SSR 一致）
  const [config, setConfig] = useLocalStorageConfig<ChatConfig>(
    STORAGE_KEYS.chatConfig,
    DEFAULT_CONFIG,
    normalizeChatConfig,
  );

  // 主 Agent 发起 full_search 后的异步检索轮询（统一走 useTaskPolling）
  const { running: searching, run: runSearchPoll, cancel: cancelSearchPoll } =
    useTaskPolling<SearchSummary>({
      getStatus: getChatSearchStatus,
      getResult: finalizeSearchSummary,
      onResult: (summary) => {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: summary.summary,
            project_id: summary.project_id,
            project_name: summary.project_name,
            attachments: summary.cognitive_structure
              ? { type: "l2_structure", level: "L2", cognitive_structure: summary.cognitive_structure }
              : undefined,
          },
        ]);
        onProjectCreated(summary.project_id);
        setStage("greeting");
        window.dispatchEvent(new CustomEvent("chat:updated")); // 刷新左侧会话列表
      },
      onError: (e) => {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `检索失败：${e instanceof Error ? e.message : String(e)}。你可以修改需求后重试。`,
          },
        ]);
      },
      intervalMs: 3000,
    });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 主 Agent 发起 deep_research → 轮询 /funnel/state → 完成后生成结果卡
  const { run: runDeepResearchPoll, cancel: cancelDeepResearch } =
    useTaskPolling<{
      content: string;
      attachments: DeepResearchAttachments;
    }>({
      getStatus: async (threadId, signal) => {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        try {
          const s = await getFunnelState(threadId, signal);
          if (s.state?.error) return { status: "error", error: s.state.error };
          if (s.current_stage === "done" && s.state?.stage_status === "done") {
            return { status: "done" };
          }
          return { status: "running", detail: s.current_stage };
        } catch (e) {
          // 取消/卸载（AbortError）→ 向上抛出，由 run 捕获后静默吞掉（不报错）
          if (signal?.aborted || (e instanceof DOMException && e.name === "AbortError")) throw e;
          // 任务尚未写入 checkpoint（启动瞬间）→ 视为运行中
          return { status: "running", detail: "intent" };
        }
      },
      getResult: finalizeDeepResearch,
      onResult: (res) => {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: res.content,
            attachments: res.attachments,
            project_id: res.attachments.project_id,
          },
        ]);
        onProjectCreated(res.attachments.project_id);
        window.dispatchEvent(new CustomEvent("chat:updated"));
        drActiveRef.current = false;
      },
      onError: (e) => {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `深度调研失败：${e instanceof Error ? e.message : String(e)}。你可以换个说法重新发起。`,
          },
        ]);
        drActiveRef.current = false;
      },
      // 前端超时：约 10 分钟无响应 → 标记卡片结束 + 提示（与失败区分）
      timeoutMs: 10 * 60 * 1000,
      onTimeout: () => {
        setMessages((prev) =>
          prev.map((m) =>
            m.attachments?.type === "deep_research" && m.attachments.status === "running"
              ? { ...m, attachments: { ...m.attachments, status: "ended" } }
              : m,
          ),
        );
        toast("深度调研超时（约 10 分钟），可重新发起一次", "warning");
        drActiveRef.current = false;
      },
      intervalMs: 2500,
    });

  // 卸载（切换 tab）时取消在途轮询，避免对已卸载组件 setState / 泄漏请求
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancelSearchPoll();
      cancelDeepResearch();
    };
  }, [cancelSearchPoll, cancelDeepResearch]);

  // ── 历史恢复：把"运行中"的深度调研卡升级为结果卡 / 结束态（幂等） ──
  // 历史恢复：把"运行中"的深度调研卡升级为结果卡 / 结束态（幂等）
  const recoveryAbortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    recoveryAbortRef.current?.abort();
    const ac = new AbortController();
    recoveryAbortRef.current = ac;
    messages.forEach((msg, i) => {
      const att = msg.attachments;
      if (!att || att.type !== "deep_research" || att.status !== "running") return;
      if (drUpgradedRef.current.has(att.thread_id)) return;
      drUpgradedRef.current.add(att.thread_id);
      (async () => {
        try {
          const s = await getFunnelState(att.thread_id, ac.signal);
          if (ac.signal.aborted || !mountedRef.current) return;
          if (s.state?.error) {
            setMessages((prev) =>
              prev.map((x, j) => (j === i ? { ...x, content: `深度调研失败：${s.state!.error}` } : x)),
            );
            return;
          }
          if (s.current_stage !== "done" || s.state?.stage_status !== "done") return; // 仍在跑，保持卡片
          // 已有结果卡 → 只把启动卡标记结束，避免重复
          const hasResult = messages.some(
            (x, j) => j !== i && x.attachments?.type === "deep_research_result" && x.attachments?.thread_id === att.thread_id,
          );
          if (hasResult) {
            setMessages((prev) =>
              prev.map((x, j) => (j === i ? { ...x, attachments: { ...att, status: "ended" } } : x)),
            );
            return;
          }
          const res = await finalizeDeepResearch(att.thread_id);
          if (!mountedRef.current) return;
          setMessages((prev) =>
            prev.map((x, j) =>
              j === i
                ? { ...x, content: res.content, attachments: res.attachments, project_id: res.attachments.project_id }
                : x,
            ),
          );
        } catch {
          if (ac.signal.aborted || !mountedRef.current) return;
          // funnel 内存态已丢失（服务重启）→ 标记结束，保留已生成内容
          setMessages((prev) =>
            prev.map((x, j) => (j === i ? { ...x, attachments: { ...att, status: "ended" } } : x)),
          );
        }
      })();
    });
    return () => ac.abort();
  }, [messages]);

  const hasConversation = messages.some((m) => m.role === "user");

  // 竞态防护：记录"最后一次发起的会话请求"。
  // openConversation 是 async，响应到达前用户可能已切换会话——
  // 过期响应必须丢弃，且 onRequestConsumed 只能在「当前请求仍是最新」时消费，
  // 否则 chatOpenConvId 被提前清空会回落到 lastConvForProject 旧值 → A↔X 竞态循环
  // （2026-08-26 修复：切换会话触发 38 次并发 /api/chat/history + 页面高频闪烁）
  const latestReqRef = useRef<string | null>(null);

  // ── 打开历史会话（左侧点击触发，直接加载消息）──
  const openAbortRef = useRef<AbortController | null>(null);
  const openConversation = async (cid: string) => {
    latestReqRef.current = cid;
    openAbortRef.current?.abort();
    const ac = new AbortController();
    openAbortRef.current = ac;
    try {
      const h = await getChatHistory(cid, ac.signal);
      if (latestReqRef.current !== cid) return;  // 已有更新的会话请求，丢弃过期响应
      if (ac.signal.aborted || !mountedRef.current) return;  // 已取消/卸载：丢弃
      setConversationId(h.conversation_id);
      setMessages(h.messages || []);
      setStage(h.stage || "greeting");
      setConfirmedParams(h.params || {});
      onConversationChanged?.(h.conversation_id, currentProjectId);
    } catch (e) {
      if (ac.signal.aborted || !mountedRef.current) return;  // 取消/卸载：静默
      if (latestReqRef.current === cid) {
        toast(`加载会话失败: ${e instanceof Error ? e.message : String(e)}`, "error");
      }
    } finally {
      // 仅在"本次请求仍是最新"时消费指令：消费后 requestedConversationId 回落
      // 到 lastConvForProject（此时已更新为当前会话），值不变 → 不再触发 effect
      if (latestReqRef.current === cid) {
        onRequestConsumed?.();
      }
    }
  };

  // ── 新对话（左侧点击触发）──
  const newConversation = () => {
    setConversationId(genConvId());
    setMessages([]);
    setStage("greeting");
    setConfirmedParams({});
    onConversationChanged?.(null, currentProjectId);
  };

  // 外部指令：打开历史会话（完成后再消费，避免竞态循环）
  useEffect(() => {
    if (requestedConversationId) {
      openConversation(requestedConversationId);
      // 注意：不再在此同步 onRequestConsumed——必须等 openConversation 完成
      //（见 openConversation 的 finally），否则指令被提前清空后
      // requestedConversationId 回落到 lastConvForProject 旧值会二次触发
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }
  }, [requestedConversationId]);

  // 外部指令：新对话
  useEffect(() => {
    if (newSignal && newSignal > 0) {
      newConversation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newSignal]);

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
    setPendingIdx(0);   // 显示执行中占位（轮换文案）

    try {
      const llmConfig: Record<string, string> = {};
      if (config.llm.api_key) llmConfig.api_key = config.llm.api_key;
      if (config.llm.base_url) llmConfig.base_url = config.llm.base_url;
      if (config.llm.model) llmConfig.model = config.llm.model;
      // 向量化/重排模型来源（本地 / API）→ 后端全局生效（检索/深度调研同样用）
      llmConfig.embedding_provider = config.advanced.modelProvider;

      const res = await sendChatMessage(conversationId, text, {
        ...(Object.keys(llmConfig).length > 0 ? { llm_config: llmConfig } : {}),
      });
      setPendingIdx(null);   // 收到响应，占位结束

      if (res.reply) {
        // L1 来源卡：answer_with_sources 的 hits 随回复渲染（论文 = 回答来源）
        const l1 = res.l1_sources;
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: res.reply,
            project_id: currentProjectId ?? undefined,
            attachments: l1?.length
              ? { type: "l1_sources", level: "L1", sources: l1 }
              : undefined,
          },
        ]);
        setStage(res.stage);
      }
      onConversationChanged?.(conversationId, currentProjectId);   // 当前会话跟随（切页回来可恢复）
      window.dispatchEvent(new CustomEvent("chat:updated"));   // 刷新左侧会话列表（消息数/时间）

      // 主 Agent 发起异步任务 → 按类型轮询：
      // - full_search：单次检索 → /chat/search/status + 总结
      // - deep_research：多智能体调研 → /funnel/state + 结果卡
      if (res.task_id) {
        if (res.task_type === "deep_research") {
          if (drActiveRef.current) {
            toast("已有深度调研正在进行中…", "info");
          } else {
            drActiveRef.current = true;
            setMessages((prev) => [
              ...prev,
              {
                role: "assistant",
                content: "深度调研已启动：意图解析 → 主干检索 → 骨架候选 → 探针推导（预计 2-5 分钟）",
                attachments: {
                  type: "deep_research",
                  thread_id: res.task_id!,
                  project_id: 0,
                  status: "running",
                },
              },
            ]);
            runDeepResearchPoll(res.task_id);
          }
        } else {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: "检索已启动，正在后台执行（预计 1-2 分钟）..." },
          ]);
          runSearchPoll(res.task_id);
        }
      }
    } catch (e) {
      setPendingIdx(null);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `抱歉，出了点问题：${e instanceof Error ? e.message : String(e)}` },
      ]);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  // 用户主动取消深度调研：停止轮询 + 标记卡片结束 + 提示（四种状态之一：取消）
  const handleCancelDeepResearch = () => {
    cancelDeepResearch();
    setMessages((prev) =>
      prev.map((m) =>
        m.attachments?.type === "deep_research" && m.attachments.status === "running"
          ? { ...m, attachments: { ...m.attachments, status: "ended" } }
          : m,
      ),
    );
    toast("已取消深度调研", "info");
    drActiveRef.current = false;
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
            <p className="text-base text-ink-muted mt-2 mb-8 text-center">
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
                    className="flex-1 min-w-0 bg-transparent border-0 outline-none focus:ring-0 focus:ring-transparent h-9 text-base leading-normal text-ink placeholder:text-ink-faint"
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
              <ChatConfigBar config={config} onChange={setConfig} />
            </div>

            {/* 示例问题 */}
            <div className="mt-6 w-full max-w-3xl">
              <p className="text-xs text-ink-faint mb-3 text-center tracking-wide">
                试试这些研究方向
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => handleSend(s)}
                    disabled={inputDisabled}
                    className="px-3 py-1.5 rounded-full border border-line text-sm text-ink-secondary
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
            <div className="max-w-4xl mx-auto space-y-4">
              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  {msg.attachments?.type === "deep_research_result" ? (
                    <ResearchResultCard att={msg.attachments} projectId={msg.project_id ?? null} />
                  ) : msg.attachments?.type === "deep_research" ? (
                    <DeepResearchRunningCard att={msg.attachments} onCancel={handleCancelDeepResearch} />
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
                      className="flex-1 min-w-0 bg-transparent border-0 outline-none focus:ring-0 focus:ring-transparent h-9 text-base leading-normal text-ink placeholder:text-ink-faint"
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
                <ChatConfigBar config={config} onChange={setConfig} />
              </div>

              {stage === "confirming" && userQuery && (
                <div className="mt-2 flex items-center gap-3 text-xs text-ink-faint">
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

// ── 深度调研运行卡（进行中 / 已结束 / 可取消） ──

function DeepResearchRunningCard({
  att,
  onCancel,
}: {
  att: DeepResearchAttachments;
  onCancel: () => void;
}) {
  const ended = att.status === "ended";
  return (
    <div className="max-w-[85%] w-[400px] rounded-2xl card px-4 py-3">
      <div className="flex items-center gap-2">
        {!ended ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-[#C27BA0]" />
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
            意图解析 → 主干检索 → 骨架候选 → 探针推导，完成后在此展示结果
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
