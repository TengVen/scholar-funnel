"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Search,
  Puzzle,
  GitBranch,
  Network,
  MessageSquare,
  type LucideIcon,
} from "lucide-react";
import {
  listProjects,
  createProject,
  runTrunkSearch,
  runGapSearch,
  runGapSemantic,
  lookupTitleByTitle,
  listPapers,
  getCart,
  addToCart,
  removeFromCart,
  type Project,
  type Paper,
  type CartStatus,
  type SearchResult,
  type GapSearchResult,
} from "@/lib/api";
import { Sidebar } from "@/components/layout/Sidebar";
import { SearchPanel } from "@/components/search/SearchPanel";
import { PaperList } from "@/components/search/PaperList";
import { GapPanel } from "@/components/search/GapPanel";
import { CartPanel } from "@/components/cart/CartPanel";
import { StatsBar } from "@/components/search/StatsBar";
import { BranchPanel } from "@/components/branch/BranchPanel";
import { NetworkPanel } from "@/components/network/NetworkPanel";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { CartDetail } from "@/components/cart/CartDetail";
import type { SortSpec } from "@/components/search/PaperList";
import { ensureGuest } from "@/lib/auth";

type Page = "search" | "cart" | "branch" | "network" | "chat";

// 低饱和珠宝色导航
const NAV_TABS: {
  key: Page;
  label: string;
  icon: LucideIcon;
  color: string;
  glow: string;
}[] = [
  { key: "chat", label: "对话", icon: MessageSquare, color: "#D6B35A", glow: "rgba(214,179,90,0.18)" },
  { key: "search", label: "检索", icon: Search, color: "#5B8FF9", glow: "rgba(91,143,249,0.18)" },
  { key: "cart", label: "骨架", icon: Puzzle, color: "#D4AF37", glow: "rgba(212,175,55,0.18)" },
  { key: "branch", label: "分支", icon: GitBranch, color: "#9B7ED8", glow: "rgba(155,126,216,0.18)" },
  { key: "network", label: "网络", icon: Network, color: "#4FAF9F", glow: "rgba(79,175,159,0.18)" },
];

export default function Home() {
  // ── 状态 ──
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [papers, setPapers] = useState<Paper[]>([]);
  const [paperTotal, setPaperTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [cart, setCart] = useState<CartStatus | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
  const [loadingPapers, setLoadingPapers] = useState(false);
  const [activePage, setActivePage] = useState<Page>("chat");

  // ── 排序/筛选状态 ──
  const [sortBy, setSortBy] = useState<SortSpec[]>([{ field: "trunk_score", order: "desc" }]);
  const [filterSurvey, setFilterSurvey] = useState("all");
  // ── 缺口补充检索（重检索）状态 ──
  const [gapMode, setGapMode] = useState(false);          // 是否显示重检索视图
  const [gapResult, setGapResult] = useState<GapSearchResult | null>(null);
  const [gapSearching, setGapSearching] = useState(false);

  // ── 加载项目列表 ──
  const loadProjectsList = useCallback(() => {
    listProjects().then(setProjects).catch(console.error);
  }, []);

  // ── 启动：确保游客身份（无 token 自动注册游客），再加载项目 ──
  useEffect(() => {
    (async () => {
      await ensureGuest();
      loadProjectsList();
    })();
  }, [loadProjectsList]);

  // ── 认证变化（登录/游客升级/登出）→ 刷新项目列表 ──
  useEffect(() => {
    const handler = () => {
      setActiveProject(null);
      setActivePage("chat");
      loadProjectsList();
    };
    window.addEventListener("auth:changed", handler);
    return () => window.removeEventListener("auth:changed", handler);
  }, [loadProjectsList]);

  // ── 登录过期（401 且 refresh 失败）→ 引导重新登录 ──
  useEffect(() => {
    const handler = () => {
      setActiveProject(null);
      setActivePage("chat");
      loadProjectsList();
    };
    window.addEventListener("auth:expired", handler);
    return () => window.removeEventListener("auth:expired", handler);
  }, [loadProjectsList]);

  // ── 监听检索页"去对话页"引导跳转 ──
  useEffect(() => {
    const handler = () => setActivePage("chat");
    window.addEventListener("navigate-to-chat", handler);
    return () => window.removeEventListener("navigate-to-chat", handler);
  }, []);

  // ── 监听分支页"去骨架页"引导跳转 ──
  useEffect(() => {
    const handler = () => setActivePage("cart");
    window.addEventListener("navigate-to-cart", handler);
    return () => window.removeEventListener("navigate-to-cart", handler);
  }, []);

  // ── 加载论文和骨架 ──
  const loadPapers = useCallback(
    async (pid: number, p = 0) => {
      setLoadingPapers(true);
      try {
        const res = await listPapers({
          project_id: pid,
          page: p,
          sort_by: sortBy.map((s) => s.field).join(","),
          sort_order: sortBy.map((s) => s.order).join(","),
          filter_survey: filterSurvey,
        });
        setPapers(res.papers);
        setPaperTotal(res.total);
        setPage(res.page);
      } catch (e) {
        console.error(e);
      } finally {
        setLoadingPapers(false);
      }
    },
    [sortBy, filterSurvey],
  );

  const loadCart = useCallback(async (pid: number) => {
    try {
      setCart(await getCart(pid));
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    if (activeProject) {
      loadPapers(activeProject.id, 0);
      loadCart(activeProject.id);
    }
  }, [activeProject, loadPapers, loadCart]);

  // ── 执行检索 ──
  const handleSearch = async (query: string, techProbe: string) => {
    if (!activeProject) return;
    setSearching(true);
    setSearchResult(null);
    try {
      const result = await runTrunkSearch({
        project_id: activeProject.id,
        user_query: query,
        tech_probe: techProbe,
      });
      setSearchResult(result);
      await loadPapers(activeProject.id, 0);
      await loadCart(activeProject.id);
    } catch (e: unknown) {
      alert(`检索失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSearching(false);
    }
  };

  // ── 创建新项目 ──
  const handleNewProject = async (query: string, techProbe: string) => {
    const name = query.slice(0, 80);
    const p = await createProject(name, query, techProbe);
    setProjects((prev) => [p, ...prev]);
    setActiveProject(p);
  };

  // ── 加入/移出骨架 ──
  const handleAddToCart = async (paperId: number, category = "mainstream", notes = "") => {
    if (!activeProject) return;
    try {
      await addToCart(activeProject.id, paperId, category, notes);
      await loadCart(activeProject.id);
      if (activePage === "search") {
        await loadPapers(activeProject.id, page);
      }
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  const handleRemoveFromCart = async (paperId: number) => {
    if (!activeProject) return;
    try {
      await removeFromCart(activeProject.id, paperId);

      await loadCart(activeProject.id);
      // 强制从后端重新拉取论文列表，确保 in_cart 与后端一致
      // （仅当处于检索页时刷新当前列表，其他页无需）
      if (activePage === "search") {
        await loadPapers(activeProject.id, page);
      }
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  // ── 缺口补充检索（重检索）──
  const handleGapSearch = async (
    targetCategory: string, constraint = "", threshold = 0.35, mode = "search",
  ) => {
    if (!activeProject) return;
    setGapSearching(true);
    try {
      const res = mode === "semantic"
        ? await runGapSemantic(activeProject.id, targetCategory, 20, threshold)
        : await runGapSearch({
            project_id: activeProject.id,
            user_query: activeProject.name,   // 领域描述用项目名
            tech_probe: activeProject.tech_probe || "",
            target_category: targetCategory,
            user_constraint: constraint,
            score_threshold: threshold,
          });
      setGapResult(res);
      setGapMode(true);
      setActivePage("search");            // 跳到检索页查看重检索结果
    } catch (e: unknown) {
      alert(`补充检索失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setGapSearching(false);
    }
  };

  // 退出重检索视图
  const handleExitGapMode = () => {
    setGapMode(false);
    setGapResult(null);
  };

  // ── 标题直达查找（骨架补充"输入标题"模式）──
  const handleTitleLookup = async (targetCategory: string, title: string) => {
    if (!activeProject) return;
    setGapSearching(true);
    try {
      const res = await lookupTitleByTitle({
        project_id: activeProject.id,
        title,
        target_category: targetCategory,
      });
      setGapResult(res);
      setGapMode(true);
      setActivePage("search");
    } catch (e: unknown) {
      alert(`标题查找失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setGapSearching(false);
    }
  };

  // ── 翻页 ──
  const handlePageChange = (newPage: number) => {
    if (activeProject) {
      loadPapers(activeProject.id, newPage);
    }
  };

  // ── 骨架论文 ID 集合（用于网络面板判断是否已加入） ──
  const cartPaperIds = new Set(cart?.items.map((it) => it.paper_id) ?? []);

  // ── 渲染主内容区 ──
  const renderContent = () => {
    // 需要项目的页面
    const needsProject = activePage !== "chat";
    if (needsProject && !activeProject) {
      return (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-[13px] text-ink-faint">选择或创建一个项目开始</p>
        </div>
      );
    }

    switch (activePage) {
      case "search":
        // 重检索模式：展示缺口补充候选（按类别分组）
        if (gapMode) {
          return (
            <GapPanel
              result={gapResult}
              searching={gapSearching}
              cartPaperIds={cartPaperIds}
              onAddToCart={handleAddToCart}
              onExit={handleExitGapMode}
            />
          );
        }
        return (
          <>
            <SearchPanel
              activeProject={activeProject}
              searching={searching}
              onSearch={handleSearch}
              onNewProject={handleNewProject}
            />
            {searchResult && <StatsBar result={searchResult} />}
            <PaperList
              papers={papers}
              total={paperTotal}
              page={page}
              loading={loadingPapers}
              sortBy={sortBy}
              filterSurvey={filterSurvey}
              gapActive={gapMode}
              onToggleGap={() => setGapMode(!gapMode)}
              onSortChange={setSortBy}
              onFilterChange={setFilterSurvey}
              onPageChange={handlePageChange}
              onAddToCart={handleAddToCart}
            />
          </>
        );
      case "cart":
        return (
          <CartDetail
            projectId={activeProject!.id}
            cart={cart}
            onRefresh={async () => {
              await Promise.all([
                loadCart(activeProject!.id),
                loadPapers(activeProject!.id, page),
              ]);
            }}
            onGapSearch={handleGapSearch}
            onTitleLookup={handleTitleLookup}
            gapSearching={gapSearching}
          />
        );
      case "branch":
        return <BranchPanel projectId={activeProject!.id} cart={cart} />;
      case "network":
        return (
          <NetworkPanel
            projectId={activeProject!.id}
            cart={cart}
            onAddToCart={async () => {
              await loadCart(activeProject!.id);
            }}
          />
        );
      case "chat":
        return (
          <ChatPanel
            onProjectCreated={(pid) => {
              listProjects().then(setProjects).catch(console.error);
              // Auto-select the newly created project
              listProjects().then((ps) => {
                const found = ps.find((p) => p.id === pid);
                if (found) setActiveProject(found);
              });
            }}
          />
        );
    }
  };

  return (
    <div className="flex h-screen overflow-hidden">
      {/* 左侧边栏 */}
      <Sidebar
        projects={projects}
        activeProject={activeProject}
        onSelect={(p) => {
          setActiveProject(p);
          setActivePage("search");
        }}
        onNewProject={handleNewProject}
      />

      {/* 中间主区域 */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* 导航标签 —— 分段控制器 + 低饱和珠宝色（居中） */}
        <div className="flex items-center px-4 border-b border-line bg-paper-white shrink-0">
          {/* 左侧占位（对称） */}
          <div className="flex-1" />

          <div className="flex items-center gap-1 p-1 rounded-xl bg-paper-warm border border-line">
            {NAV_TABS.map((tab) => {
              const Icon = tab.icon;
              const active = activePage === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => setActivePage(tab.key)}
                  className="nav-tab group flex items-center gap-1.5 px-3.5 py-1.5 text-[12.5px] rounded-lg transition-all duration-150"
                  style={{
                    ["--tab-color" as string]: tab.color,
                    ["--tab-glow" as string]: tab.glow,
                    ...(active
                      ? {
                          background: tab.glow,
                          color: tab.color,
                          boxShadow: `inset 0 0 0 1px ${tab.color}55`,
                        }
                      : {}),
                  }}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* 右侧占位：项目名徽章 */}
          <div className="flex-1 flex items-center justify-end">
            {activeProject && (
              <span className="flex items-center gap-1.5 text-[11px] text-ink-muted pl-2 pr-1 truncate max-w-[220px]">
                <span className="w-1.5 h-1.5 rounded-full bg-gold shrink-0" />
                <span className="truncate">{activeProject.name}</span>
              </span>
            )}
          </div>
        </div>

        {/* 内容区 */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {renderContent()}
        </div>
      </main>

      {/* 右侧骨架面板（仅检索页显示） */}
      {activePage === "search" && (
        <CartPanel cart={cart} onRemove={handleRemoveFromCart} />
      )}
    </div>
  );
}
