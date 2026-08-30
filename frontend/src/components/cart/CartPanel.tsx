"use client";

import { useEffect, useState } from "react";
import {
  Package, Trash2, Download, PanelLeftClose, PanelLeft,
} from "lucide-react";
import type { CartStatus } from "@/types/dto";
import { useProjectStore } from "@/stores/projectStore";
import { CATEGORIES } from "@/config/categories";
import type { Category } from "@/types/domain";

interface CartPanelProps {
  cart: CartStatus | null;
  onRemove: (paperId: number) => void;
}

export function CartPanel({ cart, onRemove }: CartPanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  // 项目级限额（动态；检索页侧栏展示 x/limit）
  const activeProject = useProjectStore((s) => s.activeProject);
  const limits = useProjectStore((s) => s.limitsByProject[activeProject?.id ?? -1]);
  const loadLimits = useProjectStore((s) => s.loadLimits);
  useEffect(() => {
    if (activeProject) loadLimits(activeProject.id);
  }, [activeProject?.id, loadLimits]);

  const limOf = (cat: Category) =>
    limits?.[cat] ?? CATEGORIES.find((c) => c.key === cat)?.limit ?? 5;
  const totalLimit = CATEGORIES.reduce((acc, c) => acc + limOf(c.key), 0);

  // 折叠态：窄条，只显示图标 + 数量
  if (collapsed) {
    return (
      <aside className="w-10 border-l border-line bg-paper-white flex flex-col items-center shrink-0 overflow-hidden">
        <button
          onClick={() => setCollapsed(false)}
          title="展开核心骨架"
          className="w-full flex flex-col items-center gap-2 py-3 hover:bg-paper-warm transition-colors"
        >
          <PanelLeft className="w-4 h-4 text-ink-muted" />
          <span className="text-[9px] text-ink-faint [writing-mode:vertical-rl]">骨架</span>
          {cart && (
            <span className="w-5 h-5 rounded-full bg-accent-light text-gold-light text-2xs tabular-nums flex items-center justify-center">
              {cart.total}
            </span>
          )}
        </button>
      </aside>
    );
  }

  if (!cart) {
    return (
      <aside className="w-64 border-l border-line bg-paper-white flex flex-col items-center justify-center shrink-0 relative">
        <button
          onClick={() => setCollapsed(true)}
          title="收起核心骨架"
          className="absolute top-2 left-2 p-1 rounded hover:bg-paper-warm text-ink-faint hover:text-ink-muted transition-colors"
        >
          <PanelLeftClose className="w-3.5 h-3.5" />
        </button>
        <Package className="w-6 h-6 text-ink-faint mb-2" />
        <p className="text-sm text-ink-faint">选择项目后显示骨架</p>
      </aside>
    );
  }

  const grouped = CATEGORIES.map((cat) => ({
    ...cat,
    limit: limOf(cat.key),
    items: cart.items.filter((it) => it.category === cat.key),
  }));

  return (
    <aside className="w-64 border-l border-line bg-paper-white flex flex-col shrink-0 overflow-hidden relative">
      {/* 折叠按钮 */}
      <button
        onClick={() => setCollapsed(true)}
        title="收起核心骨架"
        className="absolute top-2.5 left-2 p-1 rounded hover:bg-paper-warm text-ink-faint hover:text-ink-muted transition-colors z-10"
      >
        <PanelLeftClose className="w-3.5 h-3.5" />
      </button>

      {/* Header */}
      <div className="px-4 py-3 pl-8 border-b border-line shrink-0">
        <div className="flex items-center justify-between">
          <span className="font-serif text-base font-semibold text-ink">
            核心骨架
          </span>
          <span className="text-sm text-ink-muted tabular-nums">
            {cart.total}/{totalLimit}
          </span>
        </div>

        <div className="progress-track mt-2">
          <div
            className="progress-fill"
            style={{ width: `${Math.min(cart.total / totalLimit, 1) * 100}%` }}
          />
        </div>

        {cart.total > 0 && (
          <button className="btn-secondary w-full mt-2 text-sm flex items-center justify-center gap-1.5">
            <Download className="w-3 h-3" />
            导出 BibTeX
          </button>
        )}
      </div>

      {/* Categories */}
      <div className="flex-1 overflow-y-auto">
        {grouped.map((cat) => (
          <div key={cat.key} className="border-b border-line-light last:border-0">
            <div className="px-4 pt-3 pb-1 flex items-center justify-between">
              <span className="text-sm font-medium text-ink">
                {cat.label}
              </span>
              <span className="text-xs text-ink-faint tabular-nums">
                {cat.items.length}/{cat.limit}
              </span>
            </div>

            <div className="px-4 pb-1">
              <div className="progress-track">
                <div
                  className="progress-fill"
                  style={{
                    width: `${Math.min(cat.items.length / cat.limit, 1) * 100}%`,
                  }}
                />
              </div>
            </div>

            <div className="px-4 pb-3 space-y-0.5">
              {cat.items.map((item) => (
                <div
                  key={item.paper_id}
                  className="group/item flex items-start gap-2 py-1.5 px-2 -mx-2 rounded hover:bg-paper-warm transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-ink leading-tight line-clamp-2">
                      {item.title}
                    </p>
                    <p className="text-xs text-ink-faint mt-0.5">
                      {item.year}
                      {item.cited_by_count > 0 && ` · 被引 ${item.cited_by_count}`}
                    </p>
                  </div>
                  <button
                    onClick={() => onRemove(item.paper_id)}
                    className="opacity-0 group-hover/item:opacity-100 p-0.5 rounded
                               hover:bg-red-500/15 text-ink-faint hover:text-red-400
                               transition-all shrink-0"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}

              {cat.items.length === 0 && (
                <p className="text-xs text-ink-faint py-1">
                  还可添加 {cat.limit} 篇
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
