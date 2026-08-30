"use client";

import { useToastStore } from "@/lib/toast";
import type { ToastType } from "@/lib/toast";
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from "lucide-react";

const META: Record<ToastType, { Icon: typeof Info; ring: string; text: string }> = {
  success: { Icon: CheckCircle2, ring: "border-emerald-400/30", text: "text-emerald-300" },
  error: { Icon: XCircle, ring: "border-red-400/30", text: "text-red-300" },
  warning: { Icon: AlertTriangle, ring: "border-amber-400/30", text: "text-amber-300" },
  info: { Icon: Info, ring: "border-gold/30", text: "text-gold-light" },
};

/** 全局 Toast 渲染容器（在 app/page.tsx 根部挂载一次） */
export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  if (toasts.length === 0) return null;
  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 w-[330px] max-w-[90vw] pointer-events-none">
      {toasts.map((t) => {
        const { Icon, ring, text } = META[t.type];
        return (
          <div
            key={t.id}
            className={`pointer-events-auto card flex items-start gap-2.5 px-3.5 py-2.5 border ${ring} shadow-lg shadow-black/30`}
          >
            <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${text}`} />
            <span className="text-sm leading-relaxed flex-1 text-ink">{t.text}</span>
            <button
              onClick={() => dismiss(t.id)}
              className="text-ink-faint hover:text-ink transition-colors shrink-0"
              aria-label="关闭提示"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
