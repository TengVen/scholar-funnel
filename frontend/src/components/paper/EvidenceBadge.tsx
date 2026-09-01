"use client";

/**
 * 证据强度徽章（E1-E4，冷调，符合深色纸感视觉基线）
 * - E1 锚定原文：青绿系（与 EvidenceList 引用条同系）
 * - E2 元数据依据：金系（强调色）
 * - E3 AI 归纳：琥珀中性
 * - E4 推测·无锚点：灰
 * 仅渲染徽章；跳转等行为由调用方通过 onClick 注入（组件不做业务判断）。
 */
export type EvidenceLevel = "E1" | "E2" | "E3" | "E4";

interface EvidenceBadgeProps {
  level: EvidenceLevel;
  onClick?: () => void;   // E1/E3 带锚点时可点（跳章节/PDF 页）
  label?: string;         // 自定义文案（如"带来源回答"），默认按等级
}

const CONFIG: Record<EvidenceLevel, { label: string; hint: string; cls: string }> = {
  E1: {
    label: "锚定原文",
    hint: "结论可回溯到论文章节（点击跳转）",
    cls: "bg-aux-teal/15 text-aux-teal border-aux-teal/40",
  },
  E2: {
    label: "元数据依据",
    hint: "来自结构化数据 / 引用网络",
    cls: "bg-aux-gold/15 text-aux-gold border-aux-gold/40",
  },
  E3: {
    label: "AI 归纳",
    hint: "基于全文 / 摘要的模型归纳",
    cls: "bg-aux-amber/15 text-aux-amber border-aux-amber/40",
  },
  E4: {
    label: "推测·无锚点",
    hint: "自由生成，无文献锚定",
    cls: "bg-aux-gray/15 text-aux-gray border-aux-gray/40",
  },
};

export function EvidenceBadge({ level, onClick, label }: EvidenceBadgeProps) {
  const c = CONFIG[level];
  const cls = `text-xs px-2 py-0.5 rounded-full border whitespace-nowrap ${c.cls} ${onClick ? "cursor-pointer hover:opacity-80" : ""}`;
  return onClick ? (
    <button type="button" title={c.hint} onClick={onClick} className={cls}>
      {label ?? c.label}
    </button>
  ) : (
    <span title={c.hint} className={cls}>{label ?? c.label}</span>
  );
}
