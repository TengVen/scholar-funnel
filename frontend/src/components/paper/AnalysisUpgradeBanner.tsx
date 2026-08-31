"use client";

import { Loader2, RefreshCw } from "lucide-react";

/**
 * 分析升级提示条（B 方案，2026-08-31 拍板）：
 * 当前分析基于摘要、已获取完整 PDF → 提示一键重算全文级分析。
 * 纯展示组件：显示条件（摘要级 + PDF 就绪）与回调由调用方计算注入。
 */
interface AnalysisUpgradeBannerProps {
  upgrading: boolean;
  onUpgrade: () => void;
}

export function AnalysisUpgradeBanner({ upgrading, onUpgrade }: AnalysisUpgradeBannerProps) {
  return (
    <div className="shrink-0 mx-3 mt-3 rounded-lg border border-gold/40 bg-gold/10 px-3 py-2 flex items-center gap-2">
      <p className="flex-1 text-xs text-ink-muted leading-relaxed">
        当前分析基于 <span className="text-gold-light font-medium">摘要</span>，已获取完整 PDF，可重新深入分析
      </p>
      <button
        type="button"
        onClick={onUpgrade}
        disabled={upgrading}
        className="btn-secondary text-xs !py-1 shrink-0 disabled:opacity-50"
      >
        {upgrading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
        重新分析
      </button>
    </div>
  );
}
