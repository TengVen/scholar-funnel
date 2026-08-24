/**
 * 骨架（Cart）全局状态（zustand）
 *
 * 管理 cart 数据 + 增删/换分类编排（内部调 API 后自动重载 cart），
 * 组件不再直接 import API 做骨架变更。
 */
import { create } from "zustand";
import {
  getCart,
  addToCart,
  addToCartByOpenAlex,
  removeFromCart,
  changeCategory,
} from "@/lib/api/cart";
import type { CartStatus } from "@/types/dto";

interface CartStore {
  cart: CartStatus | null;
  loadCart: (projectId: number) => Promise<void>;
  /** 按 paper_id 加入（错误向上抛，由调用方提示） */
  addItem: (projectId: number, paperId: number, category?: string, notes?: string) => Promise<void>;
  /** 按 openalex_id 加入（网络推荐） */
  addByOpenAlex: (projectId: number, openalexId: string, category: string, notes?: string) => Promise<void>;
  /** 移除 */
  removeItem: (projectId: number, paperId: number) => Promise<void>;
  /** 切换分类 */
  switchCategory: (projectId: number, paperId: number, newCategory: string) => Promise<void>;
}

export const useCartStore = create<CartStore>((set, get) => ({
  cart: null,

  loadCart: async (projectId) => {
    try {
      set({ cart: await getCart(projectId) });
    } catch {
      /* 静默 */
    }
  },

  addItem: async (projectId, paperId, category = "mainstream", notes = "") => {
    await addToCart(projectId, paperId, category, notes);
    await get().loadCart(projectId);
  },

  addByOpenAlex: async (projectId, openalexId, category, notes = "") => {
    await addToCartByOpenAlex(projectId, openalexId, category, notes);
    await get().loadCart(projectId);
  },

  removeItem: async (projectId, paperId) => {
    await removeFromCart(projectId, paperId);
    await get().loadCart(projectId);
  },

  switchCategory: async (projectId, paperId, newCategory) => {
    await changeCategory(projectId, paperId, newCategory);
    await get().loadCart(projectId);
  },
}));
