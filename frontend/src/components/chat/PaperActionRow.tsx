"use client";

import { PackageSearch, Loader2 } from "lucide-react";

/**
 * 论文操作行（L2/L3 认知结构卡共用）—— 标题 + 元数据 + 推荐理由 + 加入骨架。
 * 状态由父级 store（cart）驱动，本组件只呈现与触发。
 */
interface PaperActionRowProps {
  title: string;
  meta: string[];              // 元数据片段（年份/作者/被引…），空片段自动忽略
  reason?: string;
  inCart: boolean;
  adding: boolean;
  onAdd: () => void;
}

export function PaperActionRow({ title, meta, reason, inCart, adding, onAdd }: PaperActionRowProps) {
  const metaText = meta.filter(Boolean).join(" · ");
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-accent-light/10 transition-colors">
      <div className="min-w-0">
        <p className="text-sm text-ink leading-snug">{title}</p>
        {metaText && <p className="text-xs text-ink-faint mt-0.5">{metaText}</p>}
        {reason && <p className="text-xs text-ink-muted mt-1 leading-relaxed">{reason}</p>}
      </div>
      <button
        type="button"
        onClick={onAdd}
        disabled={adding || inCart}
        className="btn-secondary text-xs !py-1.5 shrink-0 disabled:opacity-50"
      >
        {inCart ? "已在骨架" : adding ? <Loader2 className="w-3 h-3 animate-spin" /> : "加入骨架"}
        {!adding && !inCart && <PackageSearch className="w-3 h-3" />}
      </button>
    </div>
  );
}
