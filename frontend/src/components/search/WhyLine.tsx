"use client";

import { Sparkles } from "lucide-react";
import type { PaperWhy } from "@/types/dto";

/**
 * "为什么推荐" 自然语言理由行（2026-08-30 拍板版）。
 * 只展示后端生成的 reason（模板+主题注入）；检索分数/匹配类型/置信度为
 * 系统内部决策信号，前端不得展示（含展开态）。
 */
interface WhyLineProps {
  why: PaperWhy;
}

export function WhyLine({ why }: WhyLineProps) {
  const reason = why?.reason?.trim();
  if (!reason) return null;

  return (
    <div className="border-t border-line mt-2 pt-1.5">
      <p className="flex items-start gap-1.5 text-xs text-ink-muted leading-relaxed">
        <Sparkles className="w-3 h-3 shrink-0 mt-0.5 text-accent/80" />
        <span>
          <span className="text-ink-secondary">为什么推荐：</span>
          {reason}
        </span>
      </p>
    </div>
  );
}
