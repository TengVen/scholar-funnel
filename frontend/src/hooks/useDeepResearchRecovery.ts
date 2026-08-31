/**
 * 深度调研卡的历史恢复：刷新/恢复历史后，把"运行中"的启动卡升级为结果卡或结束态
 *
 * 从 ChatPanel 主组件外移。幂等语义保持原样：
 * - drUpgradedRef 记录已处理过的 thread_id，避免同一线程重复升级
 * - 仍在跑（未 done）→ 保持卡片不动
 * - 已有结果卡 → 只把启动卡标记 ended（避免重复）
 * - funnel 内存态丢失（服务重启）→ 标记 ended，保留已生成内容
 *
 * 更新消息统一走 patchMessage(i, partial)，不直接持有 setMessages。
 */
import { useEffect, useRef } from "react";
import { getFunnelState } from "@/lib/api/funnel";
import { finalizeDeepResearch } from "@/lib/api/chat";
import type { ChatMessage } from "@/types/dto";

export type MessagePatch = Partial<Pick<ChatMessage, "content" | "attachments" | "project_id">>;

export function useDeepResearchRecovery(
  messages: ChatMessage[],
  mountedRef: React.MutableRefObject<boolean>,
  patchMessage: (index: number, patch: MessagePatch) => void,
) {
  const drUpgradedRef = useRef<Set<string>>(new Set());
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
            patchMessage(i, { content: `深度调研失败：${s.state!.error}` });
            return;
          }
          if (s.current_stage !== "done" || s.state?.stage_status !== "done") return; // 仍在跑，保持卡片
          // 已有结果卡 → 只把启动卡标记结束，避免重复
          const hasResult = messages.some(
            (x, j) => j !== i && x.attachments?.type === "deep_research_result" && x.attachments?.thread_id === att.thread_id,
          );
          if (hasResult) {
            patchMessage(i, { attachments: { ...att, status: "ended" } });
            return;
          }
          const res = await finalizeDeepResearch(att.thread_id);
          if (!mountedRef.current) return;
          patchMessage(i, { content: res.content, attachments: res.attachments, project_id: res.attachments.project_id });
        } catch {
          if (ac.signal.aborted || !mountedRef.current) return;
          // funnel 内存态已丢失（服务重启）→ 标记结束，保留已生成内容
          patchMessage(i, { attachments: { ...att, status: "ended" } });
        }
      })();
    });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  return drUpgradedRef;
}
