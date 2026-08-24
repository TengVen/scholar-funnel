/**
 * 认证状态 Hook —— 封装 authStore + 登录过期事件
 *
 * 替代旧的「手写 pub-sub + 模块级 _currentUser」与 window auth:changed 事件。
 */
import { useEffect } from "react";
import { useAuthStore } from "@/stores/authStore";

export function useAuth() {
  const user = useAuthStore((s) => s.user);
  const initialized = useAuthStore((s) => s.initialized);
  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);
  const upgrade = useAuthStore((s) => s.upgrade);
  const logout = useAuthStore((s) => s.logout);
  const init = useAuthStore((s) => s.init);

  // 登录过期（http 层 401 刷新失败时派发）→ 清空用户状态
  useEffect(() => {
    const handler = () => useAuthStore.getState().setUser(null);
    window.addEventListener("auth:expired", handler);
    return () => window.removeEventListener("auth:expired", handler);
  }, []);

  return {
    user,
    initialized,
    isGuest: user?.is_guest ?? false,
    isAdmin: user?.role === "admin",
    login,
    register,
    upgrade,
    logout,
    init,
  };
}
