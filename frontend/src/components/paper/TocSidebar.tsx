"use client";

/**
 * 左栏-上部：论文目录（点击跳到中栏对应章节/PDF 对应页）
 * 外框（宽度/折叠/滚动）由 ResizablePanel 提供，本组件只渲染目录内容。
 * onJump（可选）：父组件统一裁决跳转目标（PDF 页码优先 / 正文锚点降级）；
 * 未提供时内部回退到正文分节锚点滚动。
 */
interface TocSidebarProps {
  hasSections: boolean;
  headings: string[];          // 分节标题（不含 Abstract/References 固定项）
  onJump?: (label: string) => void;
}

export function TocSidebar({ hasSections, headings, onJump }: TocSidebarProps) {
  const items = hasSections
    ? ["Abstract", ...headings, "References"]
    : ["Abstract"];

  const jump = (label: string, idx: number) => {
    if (onJump) {
      onJump(label);
      return;
    }
    const el = document.getElementById(`paper-sec-${label === "Abstract" ? "abstract" : idx}`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <nav className="space-y-0.5">
      <p className="text-xs text-ink-muted mb-2">论文目录</p>
      {items.map((label, i) => (
        <button
          key={`${label}-${i}`}
          type="button"
          onClick={() => jump(label, i)}
          className="block w-full text-left text-sm text-ink-muted hover:text-ink transition-colors px-2 py-1 rounded-md hover:bg-accent-light/10"
        >
          {label}
        </button>
      ))}
    </nav>
  );
}
