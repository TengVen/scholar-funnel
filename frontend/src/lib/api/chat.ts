/**
 * 对话 API —— 发消息 / 检索任务轮询 / 会话历史
 */
import { request } from "../http";
import type {
  ChatResponse,
  ConversationHistory,
  ConversationSummary,
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

export function listConversations(): Promise<ConversationSummary[]> {
  return request("/api/chat/conversations");
}

export function getChatHistory(conversationId: string): Promise<ConversationHistory> {
  return request(`/api/chat/history?conversation_id=${conversationId}`);
}
