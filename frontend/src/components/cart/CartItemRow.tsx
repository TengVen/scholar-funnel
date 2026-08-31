"use client";

import { useState } from "react";
import {
  ChevronDown, ChevronUp, ExternalLink, Trash2, ArrowLeftRight, Github,
} from "lucide-react";
import type { CartItem } from "@/types/dto";
import { useCartStore } from "@/stores/cartStore";
import { CATEGORIES } from "@/config/categories";
import { KEYWORD_COLORS } from "@/config/keywords";
import { toast } from "@/lib/toast";

/**
 * 骨架内单篇论文行：切换分类 / 移除 / 摘要展开 / 外链
 *
 * 增删改走 cartStore（内部调 API 并自动重载 cart），成功后回调 onRefresh。
 */
export function CartItemRow({
  item,
  projectId,
  onRefresh,
}: {
  item: CartItem;
  projectId: number;
  onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [showCategoryMenu, setShowCategoryMenu] = useState(false);

  // 骨架变更走 cartStore（内部调 API + 自动重载 cart）
  const removeItem = useCartStore((s) => s.removeItem);
  const switchCategory = useCartStore((s) => s.switchCategory);

  const handleRemove = async () => {
    setRemoving(true);
    try {
      await removeItem(projectId, item.paper_id);
      onRefresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setRemoving(false);
    }
  };

  const handleSwitchCategory = async (newCat: string) => {
    setSwitching(true);
    try {
      await switchCategory(projectId, item.paper_id, newCat);
      setShowCategoryMenu(false);
      onRefresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setSwitching(false);
    }
  };

  return (
    <div className="card px-4 py-3 group">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-base font-serif text-ink leading-snug line-clamp-2">
            {item.title}
          </p>
          <p className="text-xs text-ink-faint mt-0.5">
            {item.year}
            {item.cited_by_count > 0 && ` · 被引 ${item.cited_by_count}`}
            {item.venue && ` · ${item.venue}`}
          </p>
          {/* 分类理由（notes） */}
          {item.notes && (
            <p className="text-xs text-gold-light/80 mt-0.5 flex items-center gap-1">
              <span className="w-1 h-1 rounded-full bg-gold shrink-0" />
              {item.notes}
            </p>
          )}

          {/* 关键词（玻璃徽章） */}
          {item.keywords && item.keywords.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 mt-1.5">
              {item.keywords.slice(0, 5).map((kw, i) => {
                const c = KEYWORD_COLORS[i % KEYWORD_COLORS.length];
                return (
                  <span
                    key={kw}
                    className="px-1.5 py-0.5 rounded-md text-2xs backdrop-blur-sm"
                    style={{ background: c.bg, border: `1px solid ${c.border}`, color: c.text }}
                  >
                    {kw}
                  </span>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          {/* Switch category */}
          <div className="relative">
            <button
              onClick={() => setShowCategoryMenu(!showCategoryMenu)}
              disabled={switching}
              className="p-1 rounded hover:bg-paper-warm text-ink-faint hover:text-ink-muted transition-colors"
              title="切换分类"
            >
              <ArrowLeftRight className="w-3 h-3" />
            </button>
            {showCategoryMenu && (
              <div className="absolute right-0 top-full mt-1 bg-paper-white border border-line rounded-md shadow-sm z-10 py-1 min-w-[100px]">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat.key}
                    onClick={() => handleSwitchCategory(cat.key)}
                    disabled={cat.key === item.category}
                    className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${
                      cat.key === item.category
                        ? "text-accent bg-accent-light"
                        : "text-ink-secondary hover:bg-paper-warm"
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Remove */}
          <button
            onClick={handleRemove}
            disabled={removing}
            className="p-1 rounded hover:bg-red-500/15 text-ink-faint hover:text-red-400 transition-colors"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Abstract toggle：展开后"收起"按钮跟随在摘要末尾 */}
      {item.abstract && (
        <div className="mt-1">
          {!expanded && (
            <button
              onClick={() => setExpanded(true)}
              className="flex items-center gap-1 text-xs text-ink-faint hover:text-ink-muted transition-colors"
            >
              <ChevronDown className="w-3 h-3" />
              摘要
            </button>
          )}
          {expanded && (
            <>
              <p className="mt-1 text-sm text-ink-secondary leading-relaxed">
                {item.abstract}
              </p>
              <button
                onClick={() => setExpanded(false)}
                className="flex items-center gap-1 mt-1.5 text-xs text-ink-faint hover:text-ink-muted transition-colors"
              >
                <ChevronUp className="w-3 h-3" />
                收起
              </button>
            </>
          )}
        </div>
      )}

      {/* Links */}
      <div className="flex items-center gap-2 mt-2">
        {item.github_url && (
          <a
            href={item.github_url}
            target="_blank"
            rel="noopener noreferrer"
            title="查看 GitHub 代码仓库"
            className="text-xs text-ink-faint hover:text-accent transition-colors"
          >
            <Github className="w-2.5 h-2.5 inline mr-0.5" />
            GitHub
          </a>
        )}
        {item.doi && (
          <a
            href={`https://doi.org/${item.doi}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-ink-faint hover:text-accent transition-colors"
          >
            <ExternalLink className="w-2.5 h-2.5 inline mr-0.5" />
            DOI
          </a>
        )}
      </div>
    </div>
  );
}
