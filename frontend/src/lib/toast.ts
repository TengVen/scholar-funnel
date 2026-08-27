/**
 * 极简全局 Toast（基于 zustand，不引入新依赖）
 *
 * 替代散落各处的 alert()：按场景使用 success / error / warning / info。
 * 任何组件/事件处理里直接 `toast("消息", "error")` 即可，无需层层透传。
 *
 * 渲染端见 components/common/ToastContainer.tsx，需在应用根部挂载一次。
 */
import { create } from "zustand";

export type ToastType = "success" | "error" | "warning" | "info";

export interface ToastItem {
  id: number;
  type: ToastType;
  text: string;
}

interface ToastState {
  toasts: ToastItem[];
  push: (type: ToastType, text: string, duration?: number) => number;
  dismiss: (id: number) => void;
}

let seq = 0;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (type, text, duration = 3500) => {
    const id = ++seq;
    set((s) => ({ toasts: [...s.toasts, { id, type, text }] }));
    if (duration > 0) {
      // 自动消失（即使组件已卸载，store 是全局的，不影响）
      setTimeout(() => get().dismiss(id), duration);
    }
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** 全局入口：任意位置直接调用，无需 hook */
export function toast(message: string, type: ToastType = "info", duration?: number): number {
  return useToastStore.getState().push(type, message, duration);
}
