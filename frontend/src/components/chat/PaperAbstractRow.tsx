"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Loader2 } from "lucide-react";
import { getPaperDetail } from "@/lib/api/papers";

/**
 * L2 认知结构论文行（带行内摘要查看）——整行可点进入详情页；
 * meta 行右侧「摘要」按钮 → 行内展开论文摘要（按需拉取详情接口，不离开对话卡）。
 *
 * 与共用纯展示行 PaperNavRow（L1/L3）区分：本行持有"摘要展开"这一展示态，
 * 摘要数据经传输层 getPaperDetail 获取（不走裸 fetch）。
 */
interface PaperAbstractRowProps {
  title: string;
  meta: string[];              // 元数据片段（年份/被引…），空片段自动忽略
  reason?: string;
  href: string;                // /paper/{id}?project_id=…
  paperId?: number | null;     // 有则提供摘要按需拉取能力
  projectId?: number | null;
}

export function PaperAbstractRow({
  title, meta, reason, href, paperId, projectId,
}: PaperAbstractRowProps) {
  const router = useRouter();
  const metaText = meta.filter(Boolean).join(" · ");
  const canFetch = paperId != null && projectId != null;

  const [open, setOpen] = useState(false);
  const [abstract, setAbstract] = useState<string | null>(null);  // 已拉取的摘要缓存（收起再开不重复请求）
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const toggleAbstract = async () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (abstract !== null || error || !canFetch) return;  // 已有结果/已失败/无拉取条件：不再请求
    setLoading(true);
    try {
      const d = await getPaperDetail(paperId!, projectId!);
      setAbstract(d.abstract?.trim() ? d.abstract : "该论文暂无摘要");
    } catch {
      setError(true);  // 展开区给出兜底提示（详情页仍可看摘要）
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="group rounded-lg px-2 py-1.5 hover:bg-accent-light/10 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={() => router.push(href)}
          className="flex-1 min-w-0 text-left"
        >
          <p className="text-sm text-ink leading-snug group-hover:text-gold-light transition-colors">
            {title}
          </p>
          {metaText && <p className="text-xs text-ink-faint mt-0.5">{metaText}</p>}
          {reason && <p className="text-xs text-ink-muted mt-1 leading-relaxed">{reason}</p>}
        </button>

        {canFetch && (
          <button
            type="button"
            onClick={toggleAbstract}
            title={open ? "收起摘要" : "查看摘要"}
            className={[
              "shrink-0 mt-0.5 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs transition-colors",
              open
                ? "bg-accent-light text-accent"
                : "text-ink-faint hover:bg-accent-light/40 hover:text-accent",
            ].join(" ")}
          >
            <FileText className="w-3 h-3" />
            {open ? "收起" : "摘要"}
          </button>
        )}
      </div>

      {open && (
        <div className="mt-1.5 pl-3 border-l-2 border-accent/30">
          {loading ? (
            <p className="flex items-center gap-1.5 text-xs text-ink-muted">
              <Loader2 className="w-3 h-3 animate-spin text-accent" />
              正在获取摘要…
            </p>
          ) : error ? (
            <p className="text-xs text-ink-muted leading-relaxed">
              摘要获取失败，
              <button
                type="button"
                onClick={() => router.push(href)}
                className="text-accent hover:underline"
              >
                进入详情页查看
              </button>
            </p>
          ) : (
            <p className="text-xs text-ink-secondary leading-relaxed whitespace-pre-wrap">
              {abstract}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
