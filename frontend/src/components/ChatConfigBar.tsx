"use client";

import { useState, useRef, useEffect } from "react";
import { SlidersHorizontal, Gauge, Cpu, ChevronDown, Check } from "lucide-react";
import { setLLMConfig, type LLMConfig } from "@/lib/api";

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

  // 点击外部关闭面板
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpenPanel(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const patch = (p: Partial<ChatConfig>) => onChange({ ...config, ...p });
  const patchLLM = (p: Partial<LLMConfig>) =>
    onChange({ ...config, llm: { ...config.llm, ...p } });

  const handleSaveLLM = async () => {
    if (!config.llm.api_key && !config.llm.base_url && !config.llm.model) return;
    setSaveState("saving");
    try {
      await setLLMConfig(config.llm);
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
            onClick={() => setOpenPanel(openPanel === it.key ? null : it.key)}
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
              <p className="text-[11px] font-medium text-ink-faint tracking-wide">模型配置（自定义 API Key）</p>
              <label className="block">
                <span className="text-[11px] text-ink-muted">API Key</span>
                <input
                  type="password"
                  value={config.llm.api_key ?? ""}
                  onChange={(e) => patchLLM({ api_key: e.target.value })}
                  placeholder="sk-...（留空则用 .env 默认）"
                  className="input mt-1 font-mono"
                />
              </label>
              <label className="block">
                <span className="text-[11px] text-ink-muted">Base URL（可选）</span>
                <input
                  type="text"
                  value={config.llm.base_url ?? ""}
                  onChange={(e) => patchLLM({ base_url: e.target.value })}
                  placeholder="https://api.deepseek.com"
                  className="input mt-1 font-mono"
                />
              </label>
              <label className="block">
                <span className="text-[11px] text-ink-muted">模型名称</span>
                <input
                  type="text"
                  value={config.llm.model ?? ""}
                  onChange={(e) => patchLLM({ model: e.target.value })}
                  placeholder="deepseek-v4-flash"
                  className="input mt-1 font-mono"
                />
              </label>
              <button
                onClick={handleSaveLLM}
                disabled={saveState === "saving" || (!config.llm.api_key && !config.llm.base_url && !config.llm.model)}
                className="btn-primary w-full text-[12px] flex items-center justify-center gap-1.5"
              >
                {saveState === "saving" ? "保存中..." : saveState === "saved" ? (<><Check className="w-3 h-3" /> 已生效</>) : "应用配置"}
              </button>
              <p className="text-[10px] text-ink-faint">仅对本次运行生效；重启后回到 .env 默认值</p>
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
