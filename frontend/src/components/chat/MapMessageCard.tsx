"use client";

import { useRouter } from "next/navigation";
import type { RunMapAttachment } from "@/types/dto";
import { RunMapSection } from "@/components/map/RunMapSection";

/**
 * 对话内「领域地图」消息卡（T10，甲）：finalize 后追加的 run_map 消息附件。
 * 地图异步生成：卡内 RunMapSection 自拉状态（generating 占位 → done 全图/失败重试）。
 * 默认折叠（对话流不占高），节点点击 → 论文详情（同 project）。
 */
interface MapMessageCardProps {
  att: RunMapAttachment;
  projectId?: number | null;
}

export function MapMessageCard({ att, projectId }: MapMessageCardProps) {
  const router = useRouter();
  return (
    <div className="max-w-[85%] w-full rounded-2xl card bg-paper-chrome px-4 py-3">
      <RunMapSection
        runId={att.run_id}
        defaultCollapsed
        onOpenPaper={(pid) => {
          if (projectId) router.push(`/paper/${pid}?project_id=${projectId}`);
        }}
      />
    </div>
  );
}
