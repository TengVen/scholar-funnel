"use client";

import { useState } from "react";
import { X, LogIn, UserPlus, Sparkles } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

interface AuthModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function AuthModal({ open, onClose, onSuccess }: AuthModalProps) {
  const { user, login, register, upgrade } = useAuth();
  const [tab, setTab] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  if (!open) return null;

  const isGuest = user?.is_guest;

  const submit = async () => {
    setError("");
    if (!username.trim() || password.length < 6) {
      setError("用户名至少 2 位，密码至少 6 位");
      return;
    }
    setLoading(true);
    try {
      if (isGuest && tab === "register") {
        // 游客升级：直接升级当前游客账号（数据归入）
        await upgrade(username.trim(), password, email.trim() || undefined);
      } else if (tab === "login") {
        await login(username.trim(), password);
      } else {
        await register(username.trim(), password, email.trim() || undefined);
      }
      onSuccess?.();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[380px] max-w-[92vw] rounded-2xl border border-line bg-paper-white shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-gold-light" />
            <span className="font-serif text-[15px] font-semibold text-ink">
              {isGuest && tab === "register" ? "保存游客数据" : tab === "login" ? "登录" : "注册账号"}
            </span>
          </div>
          <button onClick={onClose} className="text-ink-faint hover:text-ink-muted">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Guest upgrade hint */}
        {isGuest && tab === "register" && (
          <div className="mx-5 mt-3 rounded-lg bg-accent-light/40 border border-gold/20 px-3 py-2 text-[11.5px] text-gold-light">
            当前为游客模式，注册后游客期间创建的项目与骨架将全部归入新账号。
          </div>
        )}

        {/* Tabs */}
        <div className="flex mx-5 mt-4 bg-paper-warm rounded-lg p-1">
          {(["login", "register"] as const).map((t) => (
            <button
              key={t}
              onClick={() => { setTab(t); setError(""); }}
              className={`flex-1 py-1.5 rounded-md text-[12.5px] font-medium transition-colors ${
                tab === t ? "bg-paper-white text-accent shadow-sm" : "text-ink-faint hover:text-ink-muted"
              }`}
            >
              {t === "login" ? "登录" : isGuest ? "注册并保存" : "注册"}
            </button>
          ))}
        </div>

        {/* Form */}
        <div className="px-5 py-4 space-y-3">
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="用户名"
            className="input !text-[13px]"
            autoFocus
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="密码（至少 6 位）"
            className="input !text-[13px]"
          />
          {tab === "register" && (
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="邮箱（可选）"
              className="input !text-[13px]"
            />
          )}

          {error && (
            <p className="text-[12px] text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{error}</p>
          )}

          <button
            onClick={submit}
            disabled={loading}
            className="btn-primary w-full justify-center !py-2.5"
          >
            {loading ? "请稍候..." : (
              <>
                {tab === "login" ? <LogIn className="w-3.5 h-3.5 inline mr-1.5" /> : <UserPlus className="w-3.5 h-3.5 inline mr-1.5" />}
                {tab === "login" ? "登录" : isGuest ? "注册并保存我的数据" : "注册"}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
