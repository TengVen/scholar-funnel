"use client";

import { useParams, useSearchParams, useRouter } from "next/navigation";
import { PaperDetailPage } from "@/components/paper/PaperDetailPage";

/** 项目论文详情（/paper/[id]?project_id=&auto=1&persist=1）
 *  auto=1：L2/L3 点开即自动预热；persist=1：L3 分析完成直接落库 */
export default function PaperDetailRoute() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const paperId = Number(params.id);
  const projectId = search.get("project_id") ? Number(search.get("project_id")) : null;

  return (
    <PaperDetailPage
      paperId={Number.isFinite(paperId) ? paperId : undefined}
      projectId={projectId}
      autoExplore={search.get("auto") === "1"}
      persistAnalysis={search.get("persist") === "1"}
      onBack={() => router.back()}
    />
  );
}
