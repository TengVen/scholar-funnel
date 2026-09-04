"use client";

import { useParams, useSearchParams, useRouter } from "next/navigation";
import { PaperDetailPage } from "@/components/paper/PaperDetailPage";

/** transient 论文详情（/paper/openalex/[openalex_id]?project_id=&conv_id=）：OpenAlex 实时拉取，不落库 */
export default function TransientPaperRoute() {
  const params = useParams<{ openalex_id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const projectId = search.get("project_id") ? Number(search.get("project_id")) : null;
  const convId = search.get("conv_id") || null;

  return (
    <PaperDetailPage
      openalexId={params.openalex_id}
      projectId={projectId}
      onBackChat={() => router.push(convId ? `/?conversation_id=${convId}` : "/")}
      onBackSearch={() => router.push(
        projectId ? `/?view=search&project_id=${projectId}${convId ? `&conv_id=${convId}` : ""}` : "/",
      )}
    />
  );
}
