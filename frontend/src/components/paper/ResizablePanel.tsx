"use client";

import { useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * 可拖拽、可折叠的边栏外壳（详情页左右栏通用）。
 * - 拖拽：边缘 4px 手柄（左栏右缘 / 右栏左缘），mousedown + 全局 mousemove 跟随
 * - 折叠：header 右侧折叠按钮；折叠态在中栏边缘渲染展开条
 * - 宽度/折叠状态由父组件持有并持久化，本组件为受控组件
 * - 只负责外壳（尺寸/边框/折叠/拖拽），滚动与内部布局由 children 自行管理
 */
interface ResizablePanelProps {
  side: "left" | "right";
  width: number;
  collapsed: boolean;
  minWidth: number;
  maxWidth: number;
  onResize: (w: number) => void;
  onToggle: () => void;
  header: React.ReactNode;
  children: React.ReactNode;
}

export function ResizablePanel({ side, width, collapsed, minWidth, maxWidth, onResize, onToggle, header, children }: ResizablePanelProps) {
  const startRef = useRef<{ x: number; w: number } | null>(null);

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    startRef.current = { x: e.clientX, w: width };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const dir = side === "left" ? 1 : -1; // 左栏向右拉宽、右栏向右拉窄
    const onMove = (ev: MouseEvent) => {
      if (!startRef.current) return;
      const w = startRef.current.w + dir * (ev.clientX - startRef.current.x);
      onResize(Math.min(maxWidth, Math.max(minWidth, Math.round(w))));
    };
    const onUp = () => {
      startRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // 折叠态：中栏边缘的展开条
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onToggle}
        title={side === "left" ? "展开左侧面板" : "展开右侧面板"}
        className={`w-3 shrink-0 flex items-center justify-center text-ink-faint hover:text-accent hover:bg-accent-light/20 transition-colors ${
          side === "left" ? "border-r border-line" : "border-l border-line"
        }`}
      >
        {side === "left" ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
      </button>
    );
  }

  return (
    <aside
      className={`relative shrink-0 flex flex-col min-h-0 ${side === "left" ? "border-r border-line" : "border-l border-line"}`}
      style={{ width }}
    >
      {/* 头部：标题（左侧）+ 折叠按钮（右侧） */}
      <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-line shrink-0">
        <div className="flex items-center gap-2 min-w-0">{header}</div>
        <button
          type="button"
          onClick={onToggle}
          title={side === "left" ? "收起左侧面板" : "收起右侧面板"}
          className="text-ink-faint hover:text-ink transition-colors shrink-0"
        >
          {side === "left" ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
      </div>

      {/* 内容区：flex 容器，children 以 flex-1 + overflow 自行管理滚动 */}
      <div className="flex-1 min-h-0 flex flex-col">{children}</div>

      {/* 拖拽手柄：8px 热区 + 常驻细线提示，hover 高亮（无感但有迹可循） */}
      <div
        onMouseDown={startResize}
        title="拖拽调整宽度"
        className={`group absolute top-0 bottom-0 w-2 cursor-col-resize z-10 flex ${
          side === "left" ? "right-0 justify-end pr-0.5" : "left-0 justify-start pl-0.5"
        }`}
      >
        <div className={`w-px my-2 transition-colors ${
          side === "left" ? "border-r border-line/80 group-hover:border-accent/70" : "border-l border-line/80 group-hover:border-accent/70"
        }`} />
      </div>
    </aside>
  );
}
