"use client";

import { Package, Trash2, Download } from "lucide-react";
import type { CartStatus } from "@/lib/api";

interface CartPanelProps {
  cart: CartStatus | null;
  onRemove: (paperId: number) => void;
}

const CATEGORIES = [
  { key: "foundation", label: "奠基理论", limit: 5 },
  { key: "mainstream", label: "主流方法", limit: 10 },
  { key: "frontier", label: "最新前沿", limit: 5 },
];

export function CartPanel({ cart, onRemove }: CartPanelProps) {
  if (!cart) {
    return (
      <aside className="w-64 border-l border-line bg-paper-white flex flex-col items-center justify-center shrink-0">
        <Package className="w-6 h-6 text-ink-faint mb-2" />
        <p className="text-[12px] text-ink-faint">选择项目后显示骨架</p>
      </aside>
    );
  }

  const grouped = CATEGORIES.map((cat) => ({
    ...cat,
    items: cart.items.filter((it) => it.category === cat.key),
  }));

  return (
    <aside className="w-64 border-l border-line bg-paper-white flex flex-col shrink-0 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-line shrink-0">
        <div className="flex items-center justify-between">
          <span className="font-serif text-[14px] font-semibold text-ink">
            核心骨架
          </span>
          <span className="text-[12px] text-ink-muted tabular-nums">
            {cart.total}/20
          </span>
        </div>

        <div className="progress-track mt-2">
          <div
            className="progress-fill"
            style={{ width: `${Math.min(cart.total / 20, 1) * 100}%` }}
          />
        </div>

        {cart.total > 0 && (
          <button className="btn-secondary w-full mt-2 text-[12px] flex items-center justify-center gap-1.5">
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
              <span className="text-[12px] font-medium text-ink">
                {cat.label}
              </span>
              <span className="text-[11px] text-ink-faint tabular-nums">
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
                    <p className="text-[12px] text-ink leading-tight line-clamp-2">
                      {item.title}
                    </p>
                    <p className="text-[11px] text-ink-faint mt-0.5">
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
                <p className="text-[11px] text-ink-faint py-1">
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
