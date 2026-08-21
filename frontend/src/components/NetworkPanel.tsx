"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Loader2, ChevronDown, ChevronUp, ExternalLink, Share2, ArrowRight,
  Plus, Check, Package,
} from "lucide-react";
import {
  startNetworkAnalyze, getNetworkStatus, getNetworkResult,
  addToCartByOpenAlex,
  type RecommendedPaper,
  type NetworkResultResponse,
  type CartStatus,
} from "@/lib/api";
import { useNetworkStore } from "@/lib/stores/networkStore";

interface NetworkPanelProps {
  projectId: number;
  cart: CartStatus | null;
  onAddToCart: () => void;
}

// 分类专属色（与分支页一致）+ 流光渐变对
const CATEGORY_COLORS: Record<string, { text: string; textBright: string; bar: string; dot: string }> = {
  foundation: { text: "#7BA7FF", textBright: "#A8C6FF", bar: "linear-gradient(90deg,#5B8FF9,#B7D2FF,#5B8FF9)", dot: "rgba(123,167,255,1)" },
  mainstream: { text: "#F0CE6E", textBright: "#FFE9A8", bar: "linear-gradient(90deg,#D6B35A,#FFE9A8,#D6B35A)", dot: "rgba(240,206,110,1)" },
  frontier: { text: "#5FCFBE", textBright: "#A8EADF", bar: "linear-gradient(90deg,#4FAF9F,#A8EADF,#4FAF9F)", dot: "rgba(95,207,190,1)" },
};

const CATEGORY_GROUPS = [
  { key: "foundation", label: "奠基理论" },
  { key: "mainstream", label: "主流方法" },
  { key: "frontier", label: "最新前沿" },
];

export function NetworkPanel({ projectId, cart, onAddToCart }: NetworkPanelProps) {
  // ── 本地 UI 状态（切换标签页可重置） ──
  const [activeTab, setActiveTab] = useState<"backward" | "forward">("backward");
  // 当前查看范围：""=全量，foundation/mainstream/frontier=单类
  const [viewCat, setViewCat] = useState("");
  // 当前正在分析的范围（用于分析中放大动画）
  const [analyzingCat, setAnalyzingCat] = useState("");

  // ── 从全局 store 读取分析结果（按 projectId + category，互不覆盖） ──
  const byCat = useNetworkStore((s) => s.resultsByProject[projectId] ?? {});
  const result = byCat[viewCat] ?? null;
  const analyzing = useNetworkStore((s) => s.analyzingByProject[projectId] ?? false);
  const progress = useNetworkStore((s) => s.progressByProject[projectId] ?? "");
  const setResult = useNetworkStore((s) => s.setResult);
  const setAnalyzing = useNetworkStore((s) => s.setAnalyzing);
  const setProgress = useNetworkStore((s) => s.setProgress);

  // ── 启动分析（category 空=全量，否则单类） ──
  const handleAnalyze = useCallback(async (category = "") => {
    setAnalyzing(projectId, true);
    setAnalyzingCat(category);
    setProgress(projectId, "正在启动分析...");
    setResult(projectId, category, null);
    try {
      const { task_id } = await startNetworkAnalyze(projectId, category);
      while (true) {
        await new Promise((r) => setTimeout(r, 3000));
        const status = await getNetworkStatus(task_id);
        if (status.status === "done") break;
        if (status.status === "error") throw new Error(status.error || "分析失败");
        setProgress(projectId, status.step ? `${status.step}：${status.detail || "..."}` : "分析中...");
      }
      const res = await getNetworkResult(task_id);
      setResult(projectId, category, res);
    } catch (e) {
      alert(`分析失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAnalyzing(projectId, false);
      setProgress(projectId, "");
      setAnalyzingCat("");
    }
  }, [projectId, setAnalyzing, setProgress, setResult]);

  const cartEmpty = !cart || cart.total === 0;
  const catCounts = (cat: string) =>
    cart?.items.filter((it) => it.category === cat).length ?? 0;

  // 各范围是否有结果（用于 ✓已分析 标记）
  const hasResult = (cat: string) => !!byCat[cat] && byCat[cat].stats && !byCat[cat].stats.error;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-6 py-4 border-b border-line bg-paper-white shrink-0 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-[15px] font-semibold text-ink">网络图谱</h2>
          {/* 分析对象状态条 */}
          <div className="flex items-center gap-2 text-[12px]">
            <span className="text-ink-muted flex items-center gap-1.5">
              <Share2 className="w-3.5 h-3.5 text-gold-light" />
              分析对象：核心骨架
            </span>
            {cartEmpty ? (
              <span className="badge bg-red-500/15 text-red-400">空骨架</span>
            ) : (
              <span className="badge bg-paper-warm text-ink-secondary tabular-nums">
                {cart.total} 篇
              </span>
            )}
            {!cartEmpty && (
              <span className="flex items-center gap-1.5 text-[11px] text-ink-faint">
                {CATEGORY_GROUPS.map((g, i) => (
                  <span key={g.key}>
                    {i > 0 && "·"}
                    {g.label} {catCounts(g.key)}
                  </span>
                ))}
              </span>
            )}
          </div>
        </div>

        <p className="text-[12px] text-ink-muted">基于骨架论文的引用关系，发现遗漏的奠基论文和最新前沿</p>

        {/* 空骨架引导 */}
        {cartEmpty && (
          <div className="flex items-center gap-3 bg-paper-warm rounded-lg px-4 py-3 border border-gold/15">
            <Package className="w-4 h-4 text-ink-faint shrink-0" />
            <p className="text-[12.5px] text-ink-secondary">
              骨架为空，网络分析基于骨架论文的引用关系。先去添加论文吧。
            </p>
            <a
              href="#cart"
              onClick={() => window.dispatchEvent(new CustomEvent("navigate-to-cart"))}
              className="btn-secondary text-[12px] ml-auto flex items-center gap-1"
            >
              去骨架页
              <ArrowRight className="w-3 h-3" />
            </a>
          </div>
        )}

        {/* 范围选择 + 全量分析 */}
        <div className="flex flex-wrap items-center gap-2">
          {[{ key: "", label: "全部" }, ...CATEGORY_GROUPS].map((g) => (
            <button
              key={g.key || "all"}
              onClick={() => setViewCat(g.key)}
              className={`px-2.5 py-1 rounded-md text-[12px] transition-colors ${
                viewCat === g.key
                  ? "bg-accent-light text-accent font-medium"
                  : "text-ink-muted hover:text-ink-secondary bg-paper-warm"
              }`}
            >
              {g.label}
              {hasResult(g.key) && (
                <span className="ml-1 text-[9.5px] px-1 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300">
                  ✓
                </span>
              )}
            </button>
          ))}
          <div className="flex-1" />
          <button
            onClick={() => handleAnalyze(viewCat)}
            disabled={analyzing || cartEmpty || (viewCat !== "" && catCounts(viewCat) === 0)}
            className="btn-primary"
          >
            {analyzing
              ? <><Loader2 className="w-3.5 h-3.5 inline mr-1.5 animate-spin" />{progress || "分析中..."}</>
              : viewCat
                ? `分析${CATEGORY_GROUPS.find((g) => g.key === viewCat)?.label ?? ""}`
                : "开始全量网络分析"}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {result ? (
          <div className="space-y-4 px-6 py-4">
            <div className="flex items-center gap-5 text-[12px] text-ink-muted">
              <span>骨架 <span className="text-ink font-medium">{result.stats.skeleton_count ?? 0}</span></span>
              <span>后向推荐 <span className="text-ink font-medium">{result.stats.backward_count ?? 0}</span></span>
              <span>前向推荐 <span className="text-ink font-medium">{result.stats.forward_count ?? 0}</span></span>
              <span>图谱节点 <span className="text-ink font-medium">{result.stats.graph_nodes ?? 0}</span></span>
            </div>

            {result.graph_nodes.length > 0 && <NetworkChart result={result} />}

            <div className="flex gap-1 border-b border-line">
              <button onClick={() => setActiveTab("backward")}
                className={`px-4 py-2 text-[13px] border-b-2 transition-colors ${activeTab === "backward" ? "border-accent text-accent font-medium" : "border-transparent text-ink-muted hover:text-ink-secondary"}`}>
                后向追溯（{result.backward.length} 篇）
              </button>
              <button onClick={() => setActiveTab("forward")}
                className={`px-4 py-2 text-[13px] border-b-2 transition-colors ${activeTab === "forward" ? "border-accent text-accent font-medium" : "border-transparent text-ink-muted hover:text-ink-secondary"}`}>
                前向追踪（{result.forward.length} 篇）
              </button>
            </div>

            <div className="space-y-2">
              {(activeTab === "backward" ? result.backward : result.forward).map((paper, i) => (
                <RecommendedPaperCard
                  key={paper.openalex_id || i}
                  paper={paper}
                  projectId={projectId}
                  cart={cart}
                  onAddToCart={onAddToCart}
                />
              ))}
              {(activeTab === "backward" ? result.backward : result.forward).length === 0 && (
                <p className="text-[13px] text-ink-faint py-8 text-center">暂无推荐论文</p>
              )}
            </div>
          </div>
        ) : analyzing ? (
          /* 分析中：被分析的主星放大占主视野 + 轻量解析动画 */
          <AnalyzingScene
            category={analyzingCat}
            cart={cart}
            progress={progress}
          />
        ) : cartEmpty ? (
          <div className="flex items-center justify-center h-full px-6 py-4">
            <p className="text-[13px] text-ink-faint">添加骨架论文后，即可开始网络分析</p>
          </div>
        ) : (
          /* 未分析：三区意境视图（三类独立成团，可单独/全量分析） */
          <SkeletonPreviewWall
            cart={cart}
            analyzing={analyzing}
            onAnalyze={async (cat) => {
              setViewCat(cat);
              await handleAnalyze(cat);
            }}
          />
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
//  分析中：被分析主星放大占主视野 + 轻量解析动画
// ══════════════════════════════════════════════════════════

function AnalyzingScene({
  category, cart, progress,
}: {
  category: string;
  cart: CartStatus | null;
  progress: string;
}) {
  const c = CATEGORY_COLORS[category] ?? CATEGORY_COLORS.mainstream;
  const label = CATEGORY_GROUPS.find((g) => g.key === category)?.label ?? "全部骨架";
  const count = category
    ? cart?.items.filter((it) => it.category === category).length ?? 0
    : cart?.total ?? 0;

  const cx = 340;
  const cy = 235;
  const orbit = 130;      // 环绕轨道（放大后）
  const radius = 64;      // 主星（放大）

  // 环绕星点：加速旋转（8s/圈），分析中的"解析感"
  const satellites = Array.from({ length: Math.max(count, 1) }, (_, i) => {
    const angle = (i / Math.max(count, 1)) * 360;
    return (
      <g key={`sat${i}`} className="net-orbit-fast"
        style={{ transformOrigin: `${cx}px ${cy}px`, animationDelay: `${-angle / 360 * 8}s` }}>
        <circle cx={cx + orbit} cy={cy} r={5} fill={c.textBright} opacity={0.95} />
        <circle cx={cx + orbit} cy={cy} r={9} fill="none" stroke={c.textBright}
          strokeWidth={0.7} opacity={0.35} />
      </g>
    );
  });

  return (
    <div className="relative w-full h-full overflow-hidden">
      {/* 星空背景（复用意境背景） */}
      <div
        className="absolute inset-0"
        style={{
          background: "radial-gradient(ellipse at 50% 46%, #2e2820 0%, #221d16 32%, #171410 60%, #0e0c0a 82%, #0a0908 100%)",
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(ellipse at 50% 50%, ${c.dot}26 0%, ${c.dot}10 45%, transparent 70%)`,
        }}
      />

      {/* 内容：放大主星 + 环绕星点 */}
      <div className="absolute inset-0 flex items-center justify-center">
        <svg viewBox="0 0 680 480" className="w-full max-w-[640px]" role="img"
          aria-label={`正在分析${label}`}>
          {/* 背景星空 */}
          {STAR_FIELD.map((s, i) => (
            <circle key={`star${i}`} cx={s.x} cy={s.y} r={s.r} fill={s.c}
              opacity={s.o} className="net-twinkle" style={{ animationDelay: `${s.d}s` }} />
          ))}

          {/* 呼吸大光环 */}
          <circle cx={cx} cy={cy} r={orbit + 26} fill="none" stroke={c.textBright}
            strokeWidth={0.8} opacity={0.22} className="net-breathe" />
          <circle cx={cx} cy={cy} r={orbit + 10} fill="none" stroke={c.textBright}
            strokeWidth={1} opacity={0.3} className="net-breathe" style={{ animationDelay: "0.9s" }} />

          {/* 自转虚线环 */}
          <circle cx={cx} cy={cy} r={orbit + 16} fill="none" stroke={c.textBright}
            strokeWidth={0.7} strokeDasharray="10 14" opacity={0.4}
            style={{ transformOrigin: `${cx}px ${cy}px`, animation: "net-spin 40s linear infinite" }} />

          {/* 环绕星点（加速解析） */}
          {satellites}

          {/* 主星（放大） */}
          <circle cx={cx} cy={cy} r={radius} fill={c.dot} opacity={0.14} />
          <circle cx={cx} cy={cy} r={radius} fill="none" stroke={c.textBright} strokeWidth={1.4} />
          <circle cx={cx} cy={cy} r={10} fill={c.textBright} className="net-twinkle" />

          {/* 名称 + 状态 */}
          <text x={cx} y={cy - 24} textAnchor="middle" fill={c.textBright}
            fontSize={15} fontWeight={500} fontFamily="Georgia, serif">{label}</text>
          <text x={cx} y={cy - 6} textAnchor="middle" fill="#8f8a80" fontSize={11.5}>
            {count} 篇论文 · 正在解析引用网络
          </text>

          {/* 进度 */}
          <text x={cx} y={cy + radius + 26} textAnchor="middle" fill="#b8b0a4" fontSize={12}>
            {progress || "正在检索引用关系..."}
          </text>
        </svg>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
//  未分析时的三区意境视图：三类各据一方，样式区分
// ══════════════════════════════════════════════════════════

function SkeletonPreviewWall({
  cart, analyzing, onAnalyze,
}: {
  cart: CartStatus;
  analyzing: boolean;
  onAnalyze: (cat: string) => void;
}) {
  const counts = {
    foundation: cart.items.filter((it) => it.category === "foundation").length,
    mainstream: cart.items.filter((it) => it.category === "mainstream").length,
    frontier: cart.items.filter((it) => it.category === "frontier").length,
  };

  return (
    <div className="relative w-full h-full overflow-hidden">
      {/* 星空背景：铺满整个结果区（CSS 渐变，无边界） */}
      <div
        className="absolute inset-0"
        style={{
          background: "radial-gradient(ellipse at 50% 44%, #2e2820 0%, #221d16 32%, #171410 60%, #0e0c0a 82%, #0a0908 100%)",
        }}
      />
      {/* 金色光晕（铺满背景） */}
      <div
        className="absolute inset-0"
        style={{
          background: "radial-gradient(ellipse at 50% 50%, rgba(230,200,121,0.12) 0%, rgba(230,200,121,0.05) 55%, transparent 75%)",
        }}
      />

      {/* 星空内容（SVG 透明背景，居中） */}
      <div className="absolute inset-0 flex items-center justify-center">
        <svg viewBox="0 0 680 480" className="w-full max-w-[640px]" role="img"
          aria-label="网络未展开：三类骨架论文各据一方，论文星点环绕主星旋转，等待分析展开引用网络">
          {/* 背景星空（60 颗小星点，错峰闪烁） */}
          {STAR_FIELD.map((s, i) => (
            <circle key={`star${i}`} cx={s.x} cy={s.y} r={s.r} fill={s.c}
              opacity={s.o} className="net-twinkle" style={{ animationDelay: `${s.d}s` }} />
          ))}

        {/* ── 连接三组的淡弧线（三角布局） ── */}
        <path d="M150 165 Q 340 100 530 165" fill="none" stroke="#c9a24b"
          strokeWidth={0.6} strokeDasharray="2 5" opacity={0.22} className="net-dash" />
        <path d="M150 165 Q 200 330 330 330" fill="none" stroke="#c9a24b"
          strokeWidth={0.6} strokeDasharray="2 5" opacity={0.22} className="net-dash"
          style={{ animationDelay: "0.8s" }} />
        <path d="M530 165 Q 480 330 350 330" fill="none" stroke="#c9a24b"
          strokeWidth={0.6} strokeDasharray="2 5" opacity={0.22} className="net-dash"
          style={{ animationDelay: "1.6s" }} />

        {/* ── 三个主星群：三角布局，距离拉开（整体缓慢自转） ── */}
        <StarCluster
          cx={150} cy={162} count={counts.foundation}
          label="奠基理论" labelColor="#A8C6FF" color="#7BA7FF" fill="#5B8FF9"
          radius={44} orbit={68} analyzing={analyzing}
          onAnalyze={() => !analyzing && counts.foundation > 0 && onAnalyze("foundation")}
          disabled={analyzing || counts.foundation === 0}
          orbitDelay={0} spinDelay={0}
        />
        <StarCluster
          cx={530} cy={162} count={counts.frontier}
          label="最新前沿" labelColor="#A8EADF" color="#5FCFBE" fill="#4FAF9F"
          radius={40} orbit={62} analyzing={analyzing}
          onAnalyze={() => !analyzing && counts.frontier > 0 && onAnalyze("frontier")}
          disabled={analyzing || counts.frontier === 0}
          orbitDelay={8} spinDelay={10}
        />
        <StarCluster
          cx={340} cy={330} count={counts.mainstream}
          label="主流方法" labelColor="#FFE9A8" color="#F0CE6E" fill="#D6B35A"
          radius={50} orbit={80} analyzing={analyzing}
          onAnalyze={() => !analyzing && counts.mainstream > 0 && onAnalyze("mainstream")}
          disabled={analyzing || counts.mainstream === 0}
          orbitDelay={4} spinDelay={5}
        />

        {/* ── 底部提示 ── */}
        <text x={340} y={412} textAnchor="middle" fill="#8f8a80" fontSize={12}>
          三类骨架各据一方 · 每篇论文是一颗环绕的星点
        </text>
        <text x={340} y={432} textAnchor="middle" fill="#6b655a" fontSize={11}>
          点击「分析此组」单独展开，或上方「开始全量网络分析」
        </text>
        </svg>
      </div>
    </div>
  );
}

// ── 背景星空常量（确定性伪随机，避免每次渲染抖动） ──
const STAR_FIELD = Array.from({ length: 60 }, (_, i) => {
  const x = 20 + ((i * 137.3) % 640);
  const y = 18 + ((i * 89.7) % 440);
  const r = 0.7 + ((i * 7.1) % 10) / 5;
  const o = 0.14 + ((i * 13.7) % 20) / 40;
  const d = ((i * 29.3) % 48) / 10;
  const c = i % 3 === 0 ? "#e6c879" : i % 3 === 1 ? "#b8b0a4" : "#8fd8ec";
  return { x, y, r, o, d, c };
});

// ── 单主星群：主星 + 呼吸光环 + 自转装饰 + N 篇环绕星点 ──
function StarCluster({
  cx, cy, count, label, labelColor, color, fill,
  radius, orbit, analyzing, onAnalyze, disabled, orbitDelay, spinDelay,
}: {
  cx: number; cy: number; count: number;
  label: string; labelColor: string; color: string; fill: string;
  radius: number; orbit: number;
  analyzing: boolean; onAnalyze: () => void; disabled: boolean;
  orbitDelay: number; spinDelay: number;
}) {
  // 环绕星点：每篇论文一个，均匀分布 + 轨道旋转
  const satellites = Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * 360;
    return (
      <g key={`sat${i}`} className="net-orbit"
        style={{ transformOrigin: `${cx}px ${cy}px`, animationDelay: `${-angle / 360 * 26 + orbitDelay}s` }}>
        <circle cx={cx + orbit} cy={cy} r={4} fill={color} opacity={0.9} />
        <circle cx={cx + orbit} cy={cy} r={7} fill="none" stroke={color}
          strokeWidth={0.6} opacity={0.3} />
      </g>
    );
  });

  return (
    <g>
      {/* 星体组：整体缓慢自转（文字/按钮保持在组外，不跟着转） */}
      <g
        style={{
          transformOrigin: `${cx}px ${cy}px`,
          animation: `net-spin 90s linear infinite`,
          animationDelay: `${spinDelay}s`,
        }}
      >
        {/* 呼吸光环（双层） */}
        <circle cx={cx} cy={cy} r={orbit + 10} fill="none" stroke={color}
          strokeWidth={0.7} opacity={0.22} className="net-breathe" />
        <circle cx={cx} cy={cy} r={radius + 12} fill="none" stroke={color}
          strokeWidth={0.8} opacity={0.3} className="net-breathe" style={{ animationDelay: "1.1s" }} />

        {/* 自转装饰虚线环（随整体旋转，视觉增强） */}
        <circle cx={cx} cy={cy} r={radius + 6} fill="none" stroke={color}
          strokeWidth={0.7} strokeDasharray="10 14" opacity={0.4} />

        {/* 环绕论文星点 */}
        {satellites}

        {/* 主星 */}
        <circle cx={cx} cy={cy} r={radius} fill={fill} opacity={0.14} />
        <circle cx={cx} cy={cy} r={radius} fill="none" stroke={color} strokeWidth={1.2} />
        <circle cx={cx} cy={cy} r={7} fill={color} className="net-twinkle" />
      </g>

      {/* 名称 + 数量（不旋转，保持可读） */}
      <text x={cx} y={cy - 14} textAnchor="middle" fill={labelColor}
        fontSize={13.5} fontWeight={500} fontFamily="Georgia, serif">{label}</text>
      <text x={cx} y={cy + 2} textAnchor="middle" fill="#8f8a80" fontSize={11}>
        {count} 篇
      </text>

      {/* 分析此组（不旋转） */}
      <g
        onClick={onAnalyze}
        style={{ cursor: disabled ? "not-allowed" : "pointer" }}
        opacity={disabled ? 0.35 : 1}
      >
        <rect x={cx - 46} y={cy + 26} width={92} height={24} rx={12} fill={fill} opacity={0.16}
          stroke={color} strokeWidth={0.8} />
        <text x={cx} y={cy + 41} textAnchor="middle" fill={labelColor} fontSize={11}>
          {analyzing ? "分析中..." : "分析此组"}
        </text>
      </g>
    </g>
  );
}

function NetworkChart({ result }: { result: NetworkResultResponse }) {
  const chartRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<{ dispose: () => void } | null>(null);

  useEffect(() => {
    if (!chartRef.current) return;
    const init = async () => {
      const echarts = await import("echarts");
      if (instanceRef.current) instanceRef.current.dispose();
      const chart = echarts.init(chartRef.current!);
      instanceRef.current = chart;

      // 星图配色：骨架三分类（与全站分类色一致）+ 推荐两类
      const categories = [
        { name: "奠基理论", itemStyle: { color: "#7BA7FF", shadowColor: "rgba(123,167,255,0.8)" } },
        { name: "主流方法", itemStyle: { color: "#F0CE6E", shadowColor: "rgba(240,206,110,0.8)" } },
        { name: "最新前沿", itemStyle: { color: "#5FCFBE", shadowColor: "rgba(95,207,190,0.8)" } },
        { name: "后向推荐", itemStyle: { color: "#d4a54e", shadowColor: "rgba(212,165,78,0.6)" } },
        { name: "前向推荐", itemStyle: { color: "#6fbfa0", shadowColor: "rgba(111,191,160,0.6)" } },
      ];
      const catMap: Record<string, number> = {
        foundation: 0, mainstream: 1, frontier: 2, skeleton: 0,
        backward: 3, forward: 4,
      };

      chart.setOption({
        backgroundColor: "transparent",
        tooltip: {
          backgroundColor: "rgba(23,22,20,0.92)",
          borderColor: "#3a332a",
          textStyle: { color: "#f0ece4", fontSize: 12 },
          formatter: (p: { dataType: string; data?: { name: string; year?: number; cited?: number }; name?: string; value?: number; label?: { name: string } }) => {
            const d = p.data ?? {} as { name: string; year?: number; cited?: number };
            const title = (d.name ?? p.label?.name ?? p.name ?? "").slice(0, 60);
            let html = `<div style="font-weight:500;color:#f0ece4;max-width:260px">${title}</div>`;
            if (d.year) html += `<div style="color:#8f8a80;font-size:11px;margin-top:2px">${d.year} 年</div>`;
            if (d.cited) html += `<div style="color:#8f8a80;font-size:11px">被引 ${d.cited}</div>`;
            if (p.dataType === "edge" && p.value) html += `<div style="color:#8f8a80;font-size:11px">${p.value}</div>`;
            return html;
          },
        },
        legend: {
          data: categories.map((c) => c.name),
          top: 8, left: "center",
          itemWidth: 10, itemHeight: 10,
          textStyle: { color: "#8f8a80", fontSize: 11 },
          icon: "circle",
        },
        series: [{
          type: "graph", layout: "force", roam: true,
          draggable: true,
          label: {
            show: true, fontSize: 10, position: "right",
            color: "#b8b0a4", formatter: (p: { data?: { name: string } }) => (p.data?.name ?? "").slice(0, 18),
          },
          edgeSymbol: ["", "arrow"], edgeSymbolSize: [0, 7],
          lineStyle: {
            color: "#4a4238", opacity: 0.55,
            width: 1, type: "dashed", dashOffset: 4,
            curveness: 0.15,
          },
          force: {
            repulsion: 260, gravity: 0.08,
            edgeLength: [60, 170], layoutAnimation: true,
          },
          data: result.graph_nodes.map((n) => {
            const ci = catMap[n.category] ?? 0;
            const isSkeleton = n.group === "skeleton";
            const isBackward = n.category === "backward";
            const isForward = n.category === "forward";
            return {
              id: n.id,
              name: n.label,
              symbolSize: isSkeleton ? n.size + 6 : n.size + 4,
              category: ci,
              value: n.year,
              itemStyle: {
                color: categories[ci].itemStyle.color,
                borderColor: isSkeleton ? "#ffffff55" : "#00000000",
                borderWidth: isSkeleton ? 2 : 1,
                shadowBlur: isSkeleton ? 18 : 12,
                shadowColor: categories[ci].itemStyle.shadowColor,
                opacity: 1,
              },
              // 骨架节点加光环（第二个装饰圆）
              symbolOffset: [0, 0],
              emphasis: {
                itemStyle: {
                  shadowBlur: 30,
                  shadowColor: categories[ci].itemStyle.shadowColor,
                  borderColor: "#ffffff88",
                  borderWidth: 2,
                },
              },
            };
          }),
          links: result.graph_edges.map((e) => ({
            source: e.source_id, target: e.target_id,
            value: e.label,
          })),
          categories: categories.map((c) => ({ name: c.name })),
          emphasis: { focus: "adjacency", lineStyle: { width: 3, opacity: 0.9, color: "#e6c879" } },
        }],
      });
      const onResize = () => chart.resize();
      window.addEventListener("resize", onResize);
      return () => window.removeEventListener("resize", onResize);
    };
    init();
    return () => { if (instanceRef.current) instanceRef.current.dispose(); };
  }, [result]);

  return (
    <div className="relative overflow-hidden rounded-lg border border-gold/25 bg-paper-warm">
      {/* 深空背景（与初始态一致） */}
      <div
        className="absolute inset-0"
        style={{
          background: "radial-gradient(ellipse at 50% 40%, #2e2820 0%, #221d16 32%, #171410 60%, #0e0c0a 82%, #0a0908 100%)",
        }}
      />
      {/* 背景星点 */}
      <div className="absolute inset-0 overflow-hidden">
        {STAR_FIELD.slice(0, 36).map((s, i) => (
          <span key={`gstar${i}`} className="absolute rounded-full net-twinkle"
            style={{
              left: `${(s.x / 680) * 100}%`,
              top: `${(s.y / 480) * 100}%`,
              width: s.r * 1.6, height: s.r * 1.6,
              background: s.c, opacity: s.o * 0.8,
              animationDelay: `${s.d}s`,
            }} />
        ))}
      </div>
      {/* 图表本体 */}
      <div ref={chartRef} className="relative" style={{ height: 420 }} />
    </div>
  );
}

function RecommendedPaperCard({
  paper, projectId, cart, onAddToCart,
}: {
  paper: RecommendedPaper;
  projectId: number;
  cart: CartStatus | null;
  onAddToCart: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [adding, setAdding] = useState(false);
  const authors = paper.authors.length > 3
    ? `${paper.authors.slice(0, 3).join(", ")} 等 ${paper.authors.length} 人`
    : paper.authors.join(", ");

  // 已在骨架判断（按 openalex_id）
  const inCart = cart?.items.some((it) => it.openalex_id === paper.openalex_id) ?? false;
  // 推荐分类：后向（遗漏奠基）→ foundation，前向（新前沿）→ frontier
  const recommendCategory = paper.source === "backward" ? "foundation" : "frontier";
  const categoryLabel = recommendCategory === "foundation" ? "奠基理论" : "最新前沿";

  const handleAdd = async () => {
    if (!paper.openalex_id || inCart || adding) return;
    setAdding(true);
    try {
      await addToCartByOpenAlex(projectId, paper.openalex_id, recommendCategory,
        `网络图谱${paper.source === "backward" ? "后向追溯" : "前向追踪"}推荐`);
      onAddToCart(); // 触发刷新骨架
    } catch (e) {
      alert(`加入失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="card px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-serif text-[14px] font-semibold text-ink leading-snug flex-1">{paper.title}</h3>
        {paper.reason && <span className="badge-blue shrink-0">{paper.reason}</span>}
      </div>
      <div className="flex items-center gap-2 mt-1 text-[12px] text-ink-muted">
        {paper.year > 0 && <span>{paper.year}</span>}
        {paper.venue && <><span className="text-line">|</span><span>{paper.venue}</span></>}
        {paper.cited_by_count > 0 && <><span className="text-line">|</span><span>被引 {paper.cited_by_count}</span></>}
        {paper.cited_by_n > 0 && <><span className="text-line">|</span><span>共引 {paper.cited_by_n}</span></>}
        {paper.citing_n > 0 && <><span className="text-line">|</span><span>引用 {paper.citing_n}</span></>}
        {authors && <><span className="text-line">|</span><span className="truncate">{authors}</span></>}
      </div>
      {paper.abstract && (
        <div className="mt-2">
          <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-1 text-[12px] text-ink-faint hover:text-ink-muted transition-colors">
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {expanded ? "收起" : "摘要"}
          </button>
          {expanded && <p className="mt-2 text-[13px] text-ink-secondary leading-relaxed whitespace-pre-wrap">{paper.abstract}</p>}
        </div>
      )}
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-line-light">
        {/* 一键加入骨架：后向→奠基，前向→前沿 */}
        <button
          onClick={handleAdd}
          disabled={inCart || adding}
          className={inCart
            ? "btn-ghost text-success text-[12px] cursor-default"
            : "btn-secondary text-[12px]"}
        >
          {inCart ? (
            <><Check className="w-3 h-3 inline mr-1" />已在骨架</>
          ) : adding ? (
            <><Loader2 className="w-3 h-3 inline mr-1 animate-spin" />加入中...</>
          ) : (
            <><Plus className="w-3 h-3 inline mr-1" />加入{categoryLabel}</>
          )}
        </button>
        {!inCart && (
          <span className="text-[10.5px] text-ink-faint">
            将预选为「{categoryLabel}」
          </span>
        )}
        {paper.doi && <a href={`https://doi.org/${paper.doi}`} target="_blank" rel="noopener noreferrer" className="btn-ghost text-[12px]"><ExternalLink className="w-3 h-3 inline mr-0.5" />DOI</a>}
        {paper.title && <a href={`https://scholar.google.com/scholar?q=${encodeURIComponent(paper.title.slice(0, 120))}`} target="_blank" rel="noopener noreferrer" className="btn-ghost text-[12px]">Scholar</a>}
        <div className="flex-1" />
        <span className="badge bg-paper-warm text-ink-muted text-[11px]">{paper.source === "backward" ? "后向" : "前向"}</span>
      </div>
    </div>
  );
}
