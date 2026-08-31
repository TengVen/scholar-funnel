"use client";

/**
 * 左栏-上部：论文目录（点击跳到中栏对应章节；只放目录，不放多余内容）
 * 外框（宽度/折叠/滚动）由 ResizablePanel 提供，本组件只渲染目录内容。
 */
interface TocSidebarProps {
  hasSections: boolean;
  headings: string[];          // 分节标题（不含 Abstract/References 固定项）
}

export function TocSidebar({ hasSections, headings }: TocSidebarProps) {
  const items = hasSections
    ? ["Abstract", ...headings, "References"]
    : ["Abstract"];

  const jump = (label: string, idx: number) => {
    const el = document.getElementById(`paper-sec-${label === "Abstract" ? "abstract" : idx}`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <nav className="space-y-0.5">
      <p className="text-xs text-ink-faint mb-2">论文目录</p>
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
