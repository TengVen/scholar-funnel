"use client";

import { useParams, useSearchParams, useRouter } from "next/navigation";
import { PaperDetailPage } from "@/components/paper/PaperDetailPage";

/** 项目论文详情（/paper/[id]?project_id=&auto=1&persist=1&conv_id=&run_id=）
 *  auto=1：L2/L3 点开即自动预热；persist=1：L3 分析完成直接落库
 *  conv_id：来源对话 id（"返回对话"直达该会话）
 *  run_id：来源检索 run（"返回检索"恢复该 run 上下文） */
export default function PaperDetailRoute() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const paperId = Number(params.id);
  const projectId = search.get("project_id") ? Number(search.get("project_id")) : null;
  const convId = search.get("conv_id") || null;
  const runId = search.get("run_id") || null;

  return (
    <PaperDetailPage
      paperId={Number.isFinite(paperId) ? paperId : undefined}
      projectId={projectId}
      autoExplore={search.get("auto") === "1"}
      persistAnalysis={search.get("persist") === "1"}
      onBackChat={() => router.push(convId ? `/?conversation_id=${convId}` : "/")}
      onBackSearch={() => router.push(
        projectId
          ? `/?view=search&project_id=${projectId}${runId ? `&run_id=${runId}` : ""}${convId ? `&conv_id=${convId}` : ""}`
          : "/",
      )}
    />
  );
}
