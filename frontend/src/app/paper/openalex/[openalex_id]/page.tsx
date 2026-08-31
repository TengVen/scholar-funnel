"use client";

import { useParams, useSearchParams, useRouter } from "next/navigation";
import { PaperDetailPage } from "@/components/paper/PaperDetailPage";

/** transient 论文详情（/paper/openalex/[openalex_id]?project_id=）：OpenAlex 实时拉取，不落库 */
export default function TransientPaperRoute() {
  const params = useParams<{ openalex_id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const projectId = search.get("project_id") ? Number(search.get("project_id")) : null;

  return (
    <PaperDetailPage
      openalexId={params.openalex_id}
      projectId={projectId}
      onBack={() => router.back()}
    />
  );
}
