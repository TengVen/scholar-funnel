/**
 * 对话页两条异步任务轮询管线（full_search / deep_research）
 *
 * 从 ChatPanel 主组件外移：两个 useTaskPolling 实例只依赖回调参数，
 * 不持有对话状态，消息落盘统一走 pushMessage。
 *
 * 语义保持与旧实现逐字一致，特别是深研 getStatus 的容错：
 * - AbortError → 向上抛出（由 useTaskPolling 按取消静默处理）
 * - funnel checkpoint 尚未写入（启动瞬间）→ 视为 running
 */
import { useRef } from "react";
import { useTaskPolling } from "@/hooks/useTaskPolling";
import {
  getChatSearchStatus,
  finalizeSearchSummary,
  finalizeDeepResearch,
} from "@/lib/api/chat";
import { getFunnelState } from "@/lib/api/funnel";
import type { ChatMessage, DeepResearchAttachments, SearchSummary } from "@/types/dto";
import { toast } from "@/lib/toast";

export interface UseChatTasksOptions {
  onProjectCreated: (projectId: number) => void;
  setStage: (stage: string) => void;
  /** 追加一条 assistant 消息（内部为函数式 setMessages，语义：尾部追加） */
  pushMessage: (msg: ChatMessage) => void;
  /** 把所有 running 的深度调研卡标记为 ended（超时用） */
  markDeepResearchEnded: () => void;
  /** 深度调研是否正在轮询（防重复提交） */
  drActiveRef: React.MutableRefObject<boolean>;
}

export function useChatTasks({
  onProjectCreated,
  setStage,
  pushMessage,
  markDeepResearchEnded,
  drActiveRef,
}: UseChatTasksOptions) {
  // 主 Agent 发起 full_search 后的异步检索轮询（统一走 useTaskPolling）
  const { running: searching, run: runSearchPoll, cancel: cancelSearchPoll } =
    useTaskPolling<SearchSummary>({
      getStatus: getChatSearchStatus,
      getResult: finalizeSearchSummary,
      onResult: (summary) => {
        pushMessage({
          role: "assistant",
          content: summary.summary,
          project_id: summary.project_id,
          project_name: summary.project_name,
          attachments: summary.cognitive_structure
            ? { type: "l2_structure", level: "L2", cognitive_structure: summary.cognitive_structure }
            : undefined,
        });
        // 领域地图消息卡（T10）：finalize 后追加（地图异步生成，卡内自拉状态与结果）
        if (summary.run_id) {
          pushMessage({
            role: "assistant",
            content: "",
            project_id: summary.project_id,
            project_name: summary.project_name,
            attachments: { type: "run_map", run_id: summary.run_id, project_id: summary.project_id },
          });
        }
        onProjectCreated(summary.project_id);
        setStage("greeting");
        window.dispatchEvent(new CustomEvent("chat:updated")); // 刷新左侧会话列表
      },
      onError: (e) => {
        pushMessage({
          role: "assistant",
          content: `检索失败：${e instanceof Error ? e.message : String(e)}。你可以修改需求后重试。`,
        });
      },
      intervalMs: 3000,
    });

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
        pushMessage({
          role: "assistant",
          content: res.content,
          attachments: res.attachments,
          project_id: res.attachments.project_id,
        });
        onProjectCreated(res.attachments.project_id);
        window.dispatchEvent(new CustomEvent("chat:updated"));
        drActiveRef.current = false;
      },
      onError: (e) => {
        pushMessage({
          role: "assistant",
          content: `深度调研失败：${e instanceof Error ? e.message : String(e)}。你可以换个说法重新发起。`,
        });
        drActiveRef.current = false;
      },
      // 前端超时：约 10 分钟无响应 → 标记卡片结束 + 提示（与失败区分）
      timeoutMs: 10 * 60 * 1000,
      onTimeout: () => {
        markDeepResearchEnded();
        toast("深度调研超时（约 10 分钟），可重新发起一次", "warning");
        drActiveRef.current = false;
      },
      intervalMs: 2500,
    });

  return { searching, runSearchPoll, cancelSearchPoll, runDeepResearchPoll, cancelDeepResearch };
}
