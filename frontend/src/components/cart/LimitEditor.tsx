"use client";

import { useState } from "react";
import { Loader2, Check } from "lucide-react";
import type { CartItem, ProjectLimits } from "@/types/dto";
import { CATEGORIES } from "@/config/categories";
import {
  CATEGORY_LIMIT_MAX, TOTAL_LIMIT_MAX, totalOf, validateLimits,
} from "@/lib/cart";
import { toast } from "@/lib/toast";

/**
 * 配额编辑面板（三类各一个数字输入）
 *
 * 草稿与保存态只在本面板内使用，收在组件内部；保存成功后由父组件关闭面板。
 * 校验规则与上限值来自 lib/cart.ts（与后端 storage/cart.py 对齐）。
 */
export function LimitEditor({
  initialLimits, items, onSave, onCancel,
}: {
  initialLimits: ProjectLimits;
  items: CartItem[];
  onSave: (limits: ProjectLimits) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<ProjectLimits>(initialLimits);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const err = validateLimits(draft);
    if (err) {
      toast(err, "warning");
      return;
    }
    setSaving(true);
    try {
      await onSave(draft);
    } catch (e) {
      toast(`保存失败: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-line bg-paper-warm/60 p-3 space-y-2">
      <p className="text-xs text-ink-muted">
        每类限额（1-{CATEGORY_LIMIT_MAX}，总和 ≤ {TOTAL_LIMIT_MAX}）
      </p>
      <div className="grid grid-cols-3 gap-2">
        {CATEGORIES.map((cat) => {
          const current = items.filter((it) => it.category === cat.key).length;
          return (
            <div key={cat.key} className="rounded-md border border-line bg-paper-white px-2.5 py-2">
              <p className="text-xs text-ink-muted mb-1">{cat.label}</p>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={1}
                  max={CATEGORY_LIMIT_MAX}
                  value={draft[cat.key]}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, [cat.key]: Number(e.target.value) || 1 }))
                  }
                  className="input !py-1 w-14 text-center text-sm tabular-nums"
                />
                <span className="text-2xs text-ink-faint">当前 {current} 篇</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between pt-1">
        <span className="text-xs text-ink-faint">
          总量上限：{totalOf(draft)} / {TOTAL_LIMIT_MAX}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={onCancel}
            className="px-2.5 py-1 rounded-md text-xs text-ink-muted hover:text-ink border border-line"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-primary text-xs flex items-center gap-1"
          >
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
            保存配额
          </button>
        </div>
      </div>
    </div>
  );
}
