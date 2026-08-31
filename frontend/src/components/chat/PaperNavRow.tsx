"use client";

import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";

/**
 * 论文导航行（L1/L2/L3 对话卡共用）—— 整行可点进入论文详情页。
 * 操作已收敛到详情页（深入探究/问答），对话卡只保留"点击进入"一个动作。
 */
interface PaperNavRowProps {
  title: string;
  meta: string[];              // 元数据片段（年份/作者/被引…），空片段自动忽略
  reason?: string;
  href: string;                // /paper/{id}?project_id= 或 /paper/openalex/{oa}?project_id=
}

export function PaperNavRow({ title, meta, reason, href }: PaperNavRowProps) {
  const router = useRouter();
  const metaText = meta.filter(Boolean).join(" · ");

  return (
    <button
      type="button"
      onClick={() => router.push(href)}
      className="group w-full flex items-start justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-accent-light/10 transition-colors text-left"
    >
      <div className="min-w-0">
        <p className="text-sm text-ink leading-snug group-hover:text-gold-light transition-colors">{title}</p>
        {metaText && <p className="text-xs text-ink-faint mt-0.5">{metaText}</p>}
        {reason && <p className="text-xs text-ink-muted mt-1 leading-relaxed">{reason}</p>}
      </div>
      <ArrowRight className="w-3.5 h-3.5 shrink-0 text-ink-faint mt-1 group-hover:text-accent transition-colors" />
    </button>
  );
}
