"use client";

import { useState, useRef, useEffect } from "react";
import { SlidersHorizontal, Gauge, Cpu, ChevronDown, Check, Bell, Info, AlertTriangle, AlertCircle } from "lucide-react";
import { setLLMConfig, getAnnouncements, type LLMConfig, type Announcement } from "@/lib/api";

// ── 配置数据模型 ──

export interface ChatConfig {
  // 检索参数
  yearFrom: string;
  yearTo: string;
  paperType: "all" | "survey" | "original";
  techProbe: string;
  // 对话参数
  temperature: number;
  // 高级选项
  topK: number;
  scoreThreshold: number;
  // 模型配置
  llm: LLMConfig;
}

export const DEFAULT_CONFIG: ChatConfig = {
  yearFrom: "",
  yearTo: "",
  paperType: "all",
  techProbe: "",
  temperature: 0.2,
  topK: 100,
  scoreThreshold: 0,
  llm: {},
};

const STORAGE_KEY = "scholar_funnel_chat_config";

export function loadConfig(): ChatConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

// ── 系统公告（铃铛）──

const ANN_READ_KEY = "scholar_funnel_read_anns";

const ANN_LEVEL_STYLE: Record<string, { color: string; label: string; icon: React.ReactNode; bg: string }> = {
  info: {
    color: "#5B8FF9",
    label: "公告",
    icon: <Info className="w-3 h-3" />,
    bg: "rgba(91,143,249,0.10)",
  },
  warning: {
    color: "#c9a24b",
    label: "提醒",
    icon: <AlertTriangle className="w-3 h-3" />,
    bg: "rgba(201,162,75,0.10)",
  },
  danger: {
    color: "#e24b4a",
    label: "重要",
    icon: <AlertCircle className="w-3 h-3" />,
    bg: "rgba(226,75,74,0.10)",
  },
};

function loadReadAnns(): Set<number> {
  try {
    return new Set(JSON.parse(localStorage.getItem(ANN_READ_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function saveReadAnns(s: Set<number>) {
  try {
    localStorage.setItem(ANN_READ_KEY, JSON.stringify([...s]));
  } catch {
    /* ignore */
  }
}

// ── 配置工具栏 ──

type PanelKey = "search" | "dialog" | "advanced" | "model";

interface ChatConfigBarProps {
  config: ChatConfig;
  onChange: (cfg: ChatConfig) => void;
}

export function ChatConfigBar({ config, onChange }: ChatConfigBarProps) {
  const [openPanel, setOpenPanel] = useState<PanelKey | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [annOpen, setAnnOpen] = useState(false);
  const [readAnns, setReadAnns] = useState<Set<number>>(loadReadAnns);
  const barRef = useRef<HTMLDivElement>(null);

  // 挂载时拉取系统公告（失败静默，不影响对话）
  useEffect(() => {
    getAnnouncements().then(setAnnouncements).catch(() => {});
  }, []);

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

  const unreadCount = announcements.filter((a) => !readAnns.has(a.id)).length;

  const markAllRead = () => {
    setReadAnns((prev) => {
      const next = new Set(prev);
      announcements.forEach((a) => next.add(a.id));
      saveReadAnns(next);
      return next;
    });
  };

  const markRead = (id: number) => {
    setReadAnns((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      saveReadAnns(next);
      return next;
    });
  };

  const patch = (p: Partial<ChatConfig>) => onChange({ ...config, ...p });
  const patchLLM = (p: Partial<LLMConfig>) =>
    onChange({ ...config, llm: { ...config.llm, ...p } });

  const handleSaveLLM = async () => {
    setSaveState("saving");
    try {
      // 仅切换模型，API Key / Base URL 走后台内置配置（不传即沿用 .env 默认值）
      await setLLMConfig({ model: config.llm.model || "deepseek-v4-flash" });
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
                    value={config.yearFrom}
                    onChange={(e) => patch({ yearFrom: e.target.value })}
                    placeholder="不限"
                    className="input mt-1"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] text-ink-muted">结束年份</span>
                  <input
                    type="number" min={1900} max={2030}
                    value={config.yearTo}
                    onChange={(e) => patch({ yearTo: e.target.value })}
                    placeholder="不限"
                    className="input mt-1"
                  />
                </label>
              </div>
              <label className="block">
                <span className="text-[11px] text-ink-muted">论文类型</span>
                <select
                  value={config.paperType}
                  onChange={(e) => patch({ paperType: e.target.value as ChatConfig["paperType"] })}
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
                  value={config.techProbe}
                  onChange={(e) => patch({ techProbe: e.target.value })}
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
                  <span className="text-[11px] text-gold-light tabular-nums">{config.temperature.toFixed(1)}</span>
                </div>
                <input
                  type="range" min={0} max={1.5} step={0.1}
                  value={config.temperature}
                  onChange={(e) => patch({ temperature: Number(e.target.value) })}
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
                  <span className="text-[11px] text-gold-light tabular-nums">{config.topK}</span>
                </div>
                <input
                  type="range" min={10} max={300} step={10}
                  value={config.topK}
                  onChange={(e) => patch({ topK: Number(e.target.value) })}
                  className="w-full mt-2 accent-[#c9a24b]"
                />
              </label>
              <label className="block">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-ink-muted">相关度阈值</span>
                  <span className="text-[11px] text-gold-light tabular-nums">{config.scoreThreshold.toFixed(1)}</span>
                </div>
                <input
                  type="range" min={0} max={1} step={0.05}
                  value={config.scoreThreshold}
                  onChange={(e) => patch({ scoreThreshold: Number(e.target.value) })}
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
                  value={config.llm.model || "deepseek-v4-flash"}
                  onChange={(e) => patchLLM({ model: e.target.value })}
                  className="input mt-1"
                >
                  <option value="deepseek-v4-flash">DeepSeek V4 Flash</option>
                  <option value="deepseek-v4-pro">DeepSeek V4 Pro</option>
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
                const read = readAnns.has(a.id);
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
                        {st.icon}
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
  if (cfg.yearFrom || cfg.yearTo) parts.push(`${cfg.yearFrom || "?"}-${cfg.yearTo || "?"}`);
  if (cfg.paperType !== "all") parts.push(cfg.paperType === "survey" ? "综述" : "原创");
  if (cfg.techProbe) parts.push(cfg.techProbe);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}
