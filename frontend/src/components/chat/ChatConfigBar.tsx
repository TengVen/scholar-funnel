"use client";

import { useState, useRef, useEffect } from "react";
import { SlidersHorizontal, Gauge, Cpu, ChevronDown, Check, Bell } from "lucide-react";
import { setLLMConfig } from "@/lib/api/settings";
import type { ChatConfig } from "@/types/domain";
import { ANN_LEVEL_STYLE, LLM_MODEL_OPTIONS } from "@/config/chat";
import { useAnnouncements } from "@/hooks/useAnnouncements";

// ── 配置工具栏 ──

type PanelKey = "search" | "dialog" | "advanced" | "model";

interface ChatConfigBarProps {
  config: ChatConfig;
  onChange: (cfg: ChatConfig) => void;
}

export function ChatConfigBar({ config, onChange }: ChatConfigBarProps) {
  const [openPanel, setOpenPanel] = useState<PanelKey | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const barRef = useRef<HTMLDivElement>(null);

  // 系统公告（数据与未读状态由 hook 管理，组件只负责展示）
  const { announcements, unreadCount, markAllRead, markRead, isRead } = useAnnouncements();
  const [annOpen, setAnnOpen] = useState(false);

  // 点击外部关闭面板
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpenPanel(null);
        setAnnOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const patchSearch = (p: Partial<ChatConfig["search"]>) =>
    onChange({ ...config, search: { ...config.search, ...p } });
  const patchDialog = (p: Partial<ChatConfig["dialog"]>) =>
    onChange({ ...config, dialog: { ...config.dialog, ...p } });
  const patchAdvanced = (p: Partial<ChatConfig["advanced"]>) =>
    onChange({ ...config, advanced: { ...config.advanced, ...p } });
  const patchLLM = (p: Partial<ChatConfig["llm"]>) =>
    onChange({ ...config, llm: { ...config.llm, ...p } });

  const handleSaveLLM = async () => {
    setSaveState("saving");
    try {
      // 仅切换模型，API Key / Base URL 走后台内置配置（不传即沿用 .env 默认值）
      await setLLMConfig({ model: config.llm.model || LLM_MODEL_OPTIONS[0].value });
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 1500);
    } catch {
      setSaveState("idle");
    }
  };

  const items: { key: PanelKey; label: string; icon: React.ReactNode; badge?: string }[] = [
    { key: "search", label: "检索", icon: <SlidersHorizontal className="w-3.5 h-3.5" />, badge: activeSearchBadge(config) },
    { key: "dialog", label: "对话", icon: <Gauge className="w-3.5 h-3.5" /> },
    { key: "advanced", label: "高级", icon: <Gauge className="w-3.5 h-3.5" /> },
    { key: "model", label: "模型", icon: <Cpu className="w-3.5 h-3.5" />, badge: config.llm.model ? config.llm.model : undefined },
  ];

  return (
    <div ref={barRef} className="relative">
      {/* 工具栏按钮排 */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {items.map((it) => (
          <button
            key={it.key}
            onClick={() => {
              setOpenPanel(openPanel === it.key ? null : it.key);
              setAnnOpen(false);
            }}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] transition-colors border ${
              openPanel === it.key
                ? "border-gold/50 bg-accent-light/20 text-gold-light"
                : "border-line text-ink-muted hover:text-gold-light hover:border-gold/30"
            }`}
          >
            {it.icon}
            {it.label}
            {it.badge && (
              <span className="max-w-[90px] truncate text-ink-faint">{it.badge}</span>
            )}
            <ChevronDown className={`w-3 h-3 transition-transform ${openPanel === it.key ? "rotate-180" : ""}`} />
          </button>
        ))}

        {/* 系统公告铃铛 */}
        <button
          onClick={() => {
            setAnnOpen(!annOpen);
            setOpenPanel(null);
          }}
          className={`relative flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] transition-colors border ${
            annOpen
              ? "border-gold/50 bg-accent-light/20 text-gold-light"
              : "border-line text-ink-muted hover:text-gold-light hover:border-gold/30"
          }`}
        >
          <Bell className="w-3.5 h-3.5" />
          公告
          {unreadCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-[#e24b4a] text-white text-[10px] font-semibold flex items-center justify-center border border-paper-white shadow shadow-black/30">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      </div>

      {/* 展开面板（悬浮于工具栏上方） */}
      {openPanel && (
        <div className="absolute bottom-full mb-2 left-0 w-[420px] max-w-[calc(100vw-3rem)] bg-paper-white border border-gold/25 rounded-xl shadow-2xl shadow-black/40 p-4 z-20">
          {openPanel === "search" && (
            <div className="space-y-3">
              <p className="text-[11px] font-medium text-ink-faint tracking-wide">检索参数</p>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-[11px] text-ink-muted">起始年份</span>
                  <input
                    type="number" min={1900} max={2030}
                    value={config.search.yearFrom}
                    onChange={(e) => patchSearch({ yearFrom: e.target.value })}
                    placeholder="不限"
                    className="input mt-1"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] text-ink-muted">结束年份</span>
                  <input
                    type="number" min={1900} max={2030}
                    value={config.search.yearTo}
                    onChange={(e) => patchSearch({ yearTo: e.target.value })}
                    placeholder="不限"
                    className="input mt-1"
                  />
                </label>
              </div>
              <label className="block">
                <span className="text-[11px] text-ink-muted">论文类型</span>
                <select
                  value={config.search.paperType}
                  onChange={(e) => patchSearch({ paperType: e.target.value as ChatConfig["search"]["paperType"] })}
                  className="input mt-1"
                >
                  <option value="all">全部</option>
                  <option value="survey">综述优先</option>
                  <option value="original">原创研究</option>
                </select>
              </label>
              <label className="block">
                <span className="text-[11px] text-ink-muted">技术探针（可选）</span>
                <input
                  type="text"
                  value={config.search.techProbe}
                  onChange={(e) => patchSearch({ techProbe: e.target.value })}
                  placeholder="如：Transformer、GAN、PDE 约束"
                  className="input mt-1"
                />
              </label>
            </div>
          )}

          {openPanel === "dialog" && (
            <div className="space-y-3">
              <p className="text-[11px] font-medium text-ink-faint tracking-wide">对话参数</p>
              <label className="block">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-ink-muted">温度（创造性）</span>
                  <span className="text-[11px] text-gold-light tabular-nums">{config.dialog.temperature.toFixed(1)}</span>
                </div>
                <input
                  type="range" min={0} max={1.5} step={0.1}
                  value={config.dialog.temperature}
                  onChange={(e) => patchDialog({ temperature: Number(e.target.value) })}
                  className="w-full mt-2 accent-[#c9a24b]"
                />
                <span className="text-[10px] text-ink-faint">较低 = 严谨精确，较高 = 发散灵活</span>
              </label>
            </div>
          )}

          {openPanel === "advanced" && (
            <div className="space-y-3">
              <p className="text-[11px] font-medium text-ink-faint tracking-wide">高级选项</p>
              <label className="block">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-ink-muted">召回数量 top_k</span>
                  <span className="text-[11px] text-gold-light tabular-nums">{config.advanced.topK}</span>
                </div>
                <input
                  type="range" min={10} max={300} step={10}
                  value={config.advanced.topK}
                  onChange={(e) => patchAdvanced({ topK: Number(e.target.value) })}
                  className="w-full mt-2 accent-[#c9a24b]"
                />
              </label>
              <label className="block">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-ink-muted">相关度阈值</span>
                  <span className="text-[11px] text-gold-light tabular-nums">{config.advanced.scoreThreshold.toFixed(1)}</span>
                </div>
                <input
                  type="range" min={0} max={1} step={0.05}
                  value={config.advanced.scoreThreshold}
                  onChange={(e) => patchAdvanced({ scoreThreshold: Number(e.target.value) })}
                  className="w-full mt-2 accent-[#c9a24b]"
                />
              </label>
            </div>
          )}

          {openPanel === "model" && (
            <div className="space-y-3">
              <p className="text-[11px] font-medium text-ink-faint tracking-wide">模型（使用后台内置 API Key）</p>
              <label className="block">
                <span className="text-[11px] text-ink-muted">选择模型</span>
                <select
                  value={config.llm.model || LLM_MODEL_OPTIONS[0].value}
                  onChange={(e) => patchLLM({ model: e.target.value })}
                  className="input mt-1"
                >
                  {LLM_MODEL_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </label>
              <button
                onClick={handleSaveLLM}
                disabled={saveState === "saving"}
                className="btn-primary w-full text-[12px] flex items-center justify-center gap-1.5"
              >
                {saveState === "saving" ? "保存中..." : saveState === "saved" ? (<><Check className="w-3 h-3" /> 已生效</>) : "应用模型"}
              </button>
              <p className="text-[10px] text-ink-faint">API Key 由后台统一提供，无需填写，仅切换模型。仅本次运行生效，重启后回到默认</p>
            </div>
          )}
        </div>
      )}

      {/* 系统公告面板（铃铛） */}
      {annOpen && (
        <div className="absolute bottom-full mb-2 right-0 w-[400px] max-w-[calc(100vw-3rem)] bg-paper-white border border-gold/25 rounded-xl shadow-2xl shadow-black/40 p-4 z-20">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1.5">
              <Bell className="w-3.5 h-3.5 text-gold-light" />
              <p className="text-[12px] font-medium text-ink tracking-wide">系统公告</p>
              {unreadCount > 0 && (
                <span className="px-1.5 py-px rounded-full text-[10px] font-medium bg-[#e24b4a]/15 text-[#ff8a85]">
                  {unreadCount} 条未读
                </span>
              )}
            </div>
            {announcements.length > 0 && (
              <button onClick={markAllRead} className="text-[11px] text-gold-light hover:underline">
                全部标为已读
              </button>
            )}
          </div>
          {announcements.length === 0 ? (
            <p className="text-[12px] text-ink-faint py-10 text-center">暂无公告</p>
          ) : (
            <div className="space-y-2.5 max-h-[340px] overflow-y-auto pr-1">
              {announcements.map((a) => {
                const st = ANN_LEVEL_STYLE[a.level] ?? ANN_LEVEL_STYLE.info;
                const LevelIcon = st.icon;
                const read = isRead(a.id);
                return (
                  <button
                    key={a.id}
                    onClick={() => markRead(a.id)}
                    className={`block w-full text-left rounded-lg p-3 transition-all hover:brightness-110 ${read ? "opacity-55" : ""}`}
                    style={{ background: st.bg, borderLeft: `3px solid ${st.color}` }}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0"
                        style={{ color: st.color, background: `${st.color}1f` }}
                      >
                        <LevelIcon className="w-3 h-3" />
                        {st.label}
                      </span>
                      <span className="text-[13px] font-medium text-ink truncate">{a.title}</span>
                      <span className="ml-auto flex items-center gap-1.5 shrink-0">
                        {!read && <span className="w-1.5 h-1.5 rounded-full" style={{ background: st.color }} />}
                        <span className="text-[10px] text-ink-faint tabular-nums">{a.created_at.slice(0, 10)}</span>
                      </span>
                    </div>
                    <p className="text-[12px] text-ink-secondary mt-1.5 whitespace-pre-wrap leading-relaxed">{a.content}</p>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function activeSearchBadge(cfg: ChatConfig): string | undefined {
  const parts: string[] = [];
  if (cfg.search.yearFrom || cfg.search.yearTo) parts.push(`${cfg.search.yearFrom || "?"}-${cfg.search.yearTo || "?"}`);
  if (cfg.search.paperType !== "all") parts.push(cfg.search.paperType === "survey" ? "综述" : "原创");
  if (cfg.search.techProbe) parts.push(cfg.search.techProbe);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}
