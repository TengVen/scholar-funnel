/**
 * 深度调研卡的历史恢复：刷新/恢复历史后，把"运行中"的启动卡升级为结果卡或结束态
 *
 * 幂等与竞态（2026-09-05 修复）：
 * - completedRef 只在「收尾成功」后记录 thread_id——若查询途中被 messages 变化 abort，
 *   该 thread 未进入 completedRef，新 effect 会重新发起查询（不再被永久跳过）；
 * - inflightRef 记录「正在查询中」的 thread_id，防止同一 effect 重跑对同一线程并发重复请求；
 * - 仍在跑（未 done）→ 不记录 completed，保持卡片 running（任务真在跑，待后续重查收尾）；
 * - 已有结果卡 → 只把启动卡标记 ended（避免重复）；
 * - funnel 内存态丢失（服务重启）→ 标记 ended，保留已生成内容。
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
  // 已收尾（ended/升级结果卡/失败）的 thread_id——收尾成功后才记录，避免 abort 后永久跳过
  const completedRef = useRef<Set<string>>(new Set());
  // 正在查询中的 thread_id——防并发重复请求（effect 重跑时跳过在途项）
  const inflightRef = useRef<Set<string>>(new Set());
  const recoveryAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    recoveryAbortRef.current?.abort();
    const ac = new AbortController();
    recoveryAbortRef.current = ac;

    messages.forEach((msg, i) => {
      const att = msg.attachments;
      if (!att || att.type !== "deep_research" || att.status !== "running") return;
      const tid = att.thread_id;
      if (completedRef.current.has(tid) || inflightRef.current.has(tid)) return;
      inflightRef.current.add(tid);
      (async () => {
        try {
          const s = await getFunnelState(tid, ac.signal);
          if (ac.signal.aborted || !mountedRef.current) return;
          if (s.state?.error) {
            patchMessage(i, { content: `深度调研失败：${s.state!.error}` });
            completedRef.current.add(tid);
            return;
          }
          if (s.current_stage !== "done" || s.state?.stage_status !== "done") return; // 仍在跑，保持卡片
          // 已有结果卡 → 只把启动卡标记结束，避免重复
          const hasResult = messages.some(
            (x, j) => j !== i && x.attachments?.type === "deep_research_result" && x.attachments?.thread_id === tid,
          );
          if (hasResult) {
            patchMessage(i, { attachments: { ...att, status: "ended" } });
            completedRef.current.add(tid);
            return;
          }
          const res = await finalizeDeepResearch(tid);
          if (!mountedRef.current) return;
          patchMessage(i, { content: res.content, attachments: res.attachments, project_id: res.attachments.project_id });
          completedRef.current.add(tid);
        } catch {
          if (ac.signal.aborted || !mountedRef.current) return;
          // funnel 内存态已丢失（服务重启）→ 标记结束，保留已生成内容
          patchMessage(i, { attachments: { ...att, status: "ended" } });
          completedRef.current.add(tid);
        } finally {
          inflightRef.current.delete(tid);
        }
      })();
    });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  return completedRef;
}
