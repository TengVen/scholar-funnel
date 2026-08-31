"use client";

/**
 * AI 诊断结果卡：结论徽章 + 问题列表 + 建议列表
 */
export function DiagnosisCard({
  diagnosis,
}: {
  diagnosis: {
    verdict: string;
    issues: string[];
    suggestions: string[];
  };
}) {
  const verdictLabel = {
    overall: { text: "结构良好", cls: "badge-green" },
    biased: { text: "分布不均", cls: "badge-amber" },
    insufficient: { text: "数量不足", cls: "bg-red-500/15 text-red-400 badge" },
  }[diagnosis.verdict] || { text: diagnosis.verdict, cls: "badge" };

  return (
    <div className="bg-paper-warm rounded-lg p-3 text-sm space-y-2">
      <div className="flex items-center gap-2">
        <span className={verdictLabel.cls}>{verdictLabel.text}</span>
      </div>

      {diagnosis.issues.length > 0 && (
        <div className="space-y-0.5">
          {diagnosis.issues.map((issue, i) => (
            <p key={i} className="text-ink-muted">
              · {issue}
            </p>
          ))}
        </div>
      )}

      {diagnosis.suggestions.length > 0 && (
        <div className="space-y-0.5">
          {diagnosis.suggestions.map((s, i) => (
            <p key={i} className="text-ink-secondary">
              → {s}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
