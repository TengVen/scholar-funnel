/**
 * 对话 API —— 发消息（含 SSE 流式）/ 检索任务轮询 / 会话历史
 */
import { request, requestEventStream } from "../http";
import type {
  ChatResponse,
  ConversationHistory,
  ConversationSummary,
  ConversationWorkspace,
  DeepResearchAttachments,
  SearchSummary,
  TaskStatus,
} from "@/types/dto";

export function sendChatMessage(
  conversationId: string,
  message: string,
  extra: Record<string, unknown> = {},
): Promise<ChatResponse> {
  return request("/api/chat/message", {
    method: "POST",
    body: JSON.stringify({ conversation_id: conversationId, message, ...extra }),
  });
}

/** 流式发送对话消息（SSE）：token/done/error 事件经 onEvent 回调；signal 可中断在途流 */
export function streamChatMessage(
  conversationId: string,
  message: string,
  extra: Record<string, unknown>,
  onEvent: (ev: Record<string, unknown>) => void,
  signal?: AbortSignal,
): Promise<void> {
  return requestEventStream(
    "/api/chat/message/stream",
    {
      method: "POST",
      body: JSON.stringify({ conversation_id: conversationId, message, ...extra }),
    },
    onEvent,
    signal,
  );
}

export function getChatSearchStatus(taskId: string): Promise<TaskStatus> {
  return request(`/api/chat/search/status?task_id=${taskId}`);
}

export function finalizeSearchSummary(taskId: string): Promise<SearchSummary> {
  return request(`/api/chat/search/${taskId}/summary`, { method: "POST" });
}

/** 深度调研完成：生成结果卡（幂等，重复调用返回既有结果） */
export function finalizeDeepResearch(
  threadId: string,
): Promise<{ content: string; attachments: DeepResearchAttachments }> {
  return request(`/api/chat/deep-research/${threadId}/finalize`, { method: "POST" });
}

/** 0 召回一键重跑：同一方向去掉时间/类型限定（后端剥离年份 + 显式清空 year/paper_type） */
export function relaunchDeepResearch(
  query: string,
  convId: string,
): Promise<{ status: string; thread_id: string }> {
  return request("/api/chat/deep-research/relaunch", {
    method: "POST",
    body: JSON.stringify({ query, conv_id: convId }),
  });
}

export function listConversations(): Promise<ConversationSummary[]> {
  return request("/api/chat/conversations");
}

export function getChatHistory(
  conversationId: string,
  signal?: AbortSignal,
): Promise<ConversationHistory> {
  return request(
    `/api/chat/history?conversation_id=${conversationId}`,
    signal ? { signal } : undefined,
  );
}

/** 工作台概览：对话 → 子研究（检索记录 / 认知结构 / 论文集合 / 深入研究） */
export function getWorkspace(conversationId: string): Promise<ConversationWorkspace> {
  return request(`/api/chat/conversations/${encodeURIComponent(conversationId)}/workspace`);
}
