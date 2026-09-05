"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { streamChatMessage, getChatHistory, relaunchDeepResearch } from "@/lib/api/chat";
import type { ChatMessage, ChatResponse } from "@/types/dto";
import { ChatHero } from "./ChatHero";
import { ChatComposer } from "./ChatComposer";
import { MessageList } from "./MessageList";
import type { ChatConfig } from "@/types/domain";
import { DEFAULT_CONFIG, EXEC_STAGES } from "@/config/chat";
import { STORAGE_KEYS } from "@/config/storage";
import { useLocalStorageConfig, normalizeChatConfig } from "@/hooks/useLocalStorageConfig";
import { useChatTasks } from "@/hooks/useChatTasks";
import { useDeepResearchRecovery, type MessagePatch } from "@/hooks/useDeepResearchRecovery";
import { taskFailureMessage } from "@/lib/taskFeedback";
import { toast } from "@/lib/toast";

interface ChatPanelProps {
  onProjectCreated: (projectId: number) => void;
  onOpenSearchResults: (projectId: number, runId?: number | null) => void; // 认知卡「查看所有检索结果」→ 检索页（带 run）
  requestedConversationId?: string | null;      // 左侧点历史会话 → 打开它
  newSignal?: number;                            // 左侧点新对话 → 重置
  currentProjectId?: number | null;             // 当前项目（会话按项目恢复时记录）
  onRequestConsumed?: () => void;
  onConversationChanged?: (cid: string | null, projectId?: number | null) => void;
  workspaceOpen?: boolean;                       // 工作台概览开合（按钮状态）
  onToggleWorkspace?: () => void;                // 工作台概览开关（输入框附近小图标）
}

const genConvId = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2);

/**
 * 对话面板 —— 会话状态机 + 两条异步任务轮询（full_search / deep_research）
 *
 * 呈现层见 ChatHero（空态）、MessageList（消息流）、ChatComposer（对话输入栏）。
 *
 * ⚠️ 以下逻辑承载过线上竞态修复，改动前请确认不破坏其语义：
 * - openConversation 的 latestReqRef（2026-08-26：切换会话曾触发 38 次并发 history 请求 + 页面闪烁）
 * - 历史恢复（useDeepResearchRecovery）的 drUpgradedRef 幂等（刷新后把"运行中"卡升级为结果卡）
 */
export function ChatPanel({
  onProjectCreated,
  onOpenSearchResults,
  requestedConversationId,
  newSignal,
  currentProjectId,
  onRequestConsumed,
  onConversationChanged,
  workspaceOpen,
  onToggleWorkspace,
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

  // 流式输出：进行中的草稿正文（null=无在途流）；非 null 时 MessageList 渲染为平铺流式块
  const [streamText, setStreamText] = useState<string | null>(null);
  // 在途流的 AbortController（切会话/新对话/卸载/连点时中断，防止跨会话写入）
  const streamAbortRef = useRef<AbortController | null>(null);

  // 深度调研：当前是否正在轮询（避免重复提交）
  const drActiveRef = useRef(false);
  // 组件挂载标记：切换 tab 卸载后不再 setState，避免 React 警告/内存泄漏
  const mountedRef = useRef(true);

  // 对话配置：localStorage 由 hook 管理（水合后加载，首屏默认值保证 SSR 一致）
  const [config, setConfig] = useLocalStorageConfig<ChatConfig>(
    STORAGE_KEYS.chatConfig,
    DEFAULT_CONFIG,
    normalizeChatConfig,
  );

  // ── 消息写入辅助（全部走函数式 setMessages，避免过期捕获） ──
  const pushMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  const markDeepResearchEnded = useCallback(() => {
    setMessages((prev) =>
      prev.map((m) =>
        m.attachments?.type === "deep_research" && m.attachments.status === "running"
          ? { ...m, attachments: { ...m.attachments, status: "ended" } }
          : m,
      ),
    );
  }, []);

  const patchMessage = useCallback((i: number, patch: MessagePatch) => {
    setMessages((prev) => prev.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  }, []);

  // 中断在途流式回复并清理草稿（切会话/新对话/卸载/连点时调用，防跨会话写入）
  const stopStream = useCallback(() => {
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    setStreamText(null);
    setPendingIdx(null);
  }, []);

  // 主 Agent 发起的异步任务轮询：
  // - full_search：单次检索 → /chat/search/status + 总结
  // - deep_research：多智能体调研 → /funnel/state + 结果卡
  const { searching, runSearchPoll, cancelSearchPoll, runDeepResearchPoll, cancelDeepResearch } =
    useChatTasks({
      onProjectCreated,
      setStage,
      pushMessage,
      markDeepResearchEnded,
      drActiveRef,
    });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 卸载（切换 tab）时取消在途轮询与流式请求，避免对已卸载组件 setState / 泄漏请求
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopStream();
      cancelSearchPoll();
      cancelDeepResearch();
    };
  }, [stopStream, cancelSearchPoll, cancelDeepResearch]);

  // ── 历史恢复：把"运行中"的深度调研卡升级为结果卡 / 结束态（幂等）──
  useDeepResearchRecovery(messages, mountedRef, patchMessage);

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
    stopStream();  // 切换会话：中断在途流，防止旧会话回复写入新会话
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
    stopStream();  // 清空在途流与草稿
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
  }, [messages, hasConversation, streamText]);

  const handleSend = async (textOverride?: string) => {
    const text = (textOverride ?? input).trim();
    if (!text || sending) return;

    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setSending(true);

    // 中断可能残留的在途流（防连点双开），并接管本次流
    stopStream();
    const ac = new AbortController();
    streamAbortRef.current = ac;

    const llmConfig: Record<string, string> = {};
    if (config.llm.api_key) llmConfig.api_key = config.llm.api_key;
    if (config.llm.base_url) llmConfig.base_url = config.llm.base_url;
    if (config.llm.model) llmConfig.model = config.llm.model;
    // 向量化/重排模型来源（本地 / API）→ 后端全局生效（检索/深度调研同样用）
    llmConfig.embedding_provider = config.advanced.modelProvider;

    setPendingIdx(0);   // 首 token 前显示执行中占位（轮换文案）

    // 流式完成收尾：done 事件负载语义与旧 sendChatMessage 返回的 ChatResponse 一致
    const finish = (res: ChatResponse) => {
      setStage(res.stage);
      if (res.reply) {
        // L1 来源卡：answer_with_sources 的 hits 随回复渲染（论文 = 回答来源）
        const l1 = res.l1_sources;
        pushMessage({
          role: "assistant",
          content: res.reply,
          project_id: currentProjectId ?? undefined,
          attachments: l1?.length
            ? { type: "l1_sources", level: "L1", sources: l1 }
            : undefined,
        });
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
                content: "深度调研已启动：意图解析 → 主干检索 → 候选归纳 → 探针推导（预计 2-5 分钟）",
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
    };

    let acc = "";
    try {
      await streamChatMessage(
        conversationId,
        text,
        { ...(Object.keys(llmConfig).length > 0 ? { llm_config: llmConfig } : {}) },
        (ev) => {
          if (streamAbortRef.current !== ac) return;   // 已被新请求接管：丢弃过期事件
          if (ev.type === "token") {
            acc += String(ev.text ?? "");
            setPendingIdx(null);   // 首 token 到达，占位结束
            setStreamText(acc);
          } else if (ev.type === "done") {
            setPendingIdx(null);
            setStreamText(null);
            finish(ev as unknown as ChatResponse);
          } else if (ev.type === "error") {
            setPendingIdx(null);
            setStreamText(null);
            const msg = String(ev.message ?? "生成失败");
            // 已有部分内容 → 保留已生成部分并标注中断；无内容 → 纯错误提示
            pushMessage({
              role: "assistant",
              content: acc ? `${acc}\n\n_（生成中断：${msg}）_` : `抱歉，出了点问题：${msg}`,
            });
          }
        },
        ac.signal,
      );
    } catch (e) {
      // 主动取消（切会话/新对话/卸载）→ 静默；真实失败 → 本地错误消息
      if (!ac.signal.aborted) {
        setPendingIdx(null);
        setStreamText(null);
        pushMessage({
          role: "assistant",
          content: `抱歉，出了点问题：${e instanceof Error ? e.message : String(e)}`,
        });
      }
    } finally {
      if (streamAbortRef.current === ac) streamAbortRef.current = null;
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

  // 0 召回卡「去掉时间/类型限定重试」：复用 relaunch 端点（后端剥离年份 + 清空 year/type），
  // 追加 running 卡并进入既有深研轮询管线（结果/失败展示与正常深研一致）
  const handleDeepRelaxedRetry = async (query: string) => {
    if (drActiveRef.current) {
      toast("已有深度调研正在进行中，请等待完成", "info");
      return;
    }
    try {
      const { thread_id } = await relaunchDeepResearch(query, conversationId);
      drActiveRef.current = true;
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "深度调研已重新启动：已自动去掉时间与类型限定，按同一方向重跑（预计 1-2 分钟）。",
          attachments: {
            type: "deep_research",
            thread_id,
            project_id: 0,
            status: "running",
          },
        },
      ]);
      runDeepResearchPoll(thread_id);
    } catch (e) {
      toast(taskFailureMessage(e, "深度调研"), "error");
    }
  };

  // 0 召回卡「修改方向再试」→ 回填输入框并聚焦（用户自行调整后重新发送）
  const handleEmptyEditQuery = (query: string) => {
    setInput(query);
    requestAnimationFrame(() => inputRef.current?.focus());
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
      {!hasConversation ? (
        <ChatHero
          input={input}
          setInput={setInput}
          onSend={handleSend}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          inputDisabled={inputDisabled}
          sending={sending}
          config={config}
          setConfig={setConfig}
          inputRef={inputRef}
          workspaceOpen={workspaceOpen}
          onToggleWorkspace={onToggleWorkspace}
        />
      ) : (
        <>
          <MessageList
            messages={messages}
            onCancelDeepResearch={handleCancelDeepResearch}
            onOpenSearchResults={onOpenSearchResults}
            onEmptyRetry={handleDeepRelaxedRetry}
            onEmptyEdit={handleEmptyEditQuery}
            pendingIdx={pendingIdx}
            searching={searching}
            streamingText={streamText}
            messagesEndRef={messagesEndRef}
          />
          <ChatComposer
            input={input}
            setInput={setInput}
            onSend={() => handleSend()}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            inputDisabled={inputDisabled}
            sending={sending}
            config={config}
            setConfig={setConfig}
            inputRef={inputRef}
            stage={stage}
            userQuery={userQuery}
            yearFrom={yearFrom}
            yearTo={yearTo}
            workspaceOpen={workspaceOpen}
            onToggleWorkspace={onToggleWorkspace}
          />
        </>
      )}
    </div>
  );
}
