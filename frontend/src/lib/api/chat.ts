/**
 * 对话 API —— 发消息 / 检索任务轮询 / 会话历史
 */
import { request } from "../http";
import type {
  ChatResponse,
  ConversationHistory,
  ConversationSummary,
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
