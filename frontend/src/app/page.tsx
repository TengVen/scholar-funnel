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
  listPapers,
  getCart,
  addToCart,
  removeFromCart,
  type Project,
  type Paper,
  type CartStatus,
  type SearchResult,
} from "@/lib/api";
import { Sidebar } from "@/components/Sidebar";
import { SearchPanel } from "@/components/SearchPanel";
import { PaperList } from "@/components/PaperList";
import { CartPanel } from "@/components/CartPanel";
import { StatsBar } from "@/components/StatsBar";
import { BranchPanel } from "@/components/BranchPanel";
import { NetworkPanel } from "@/components/NetworkPanel";
import { ChatPanel } from "@/components/ChatPanel";
import { CartDetail } from "@/components/CartDetail";
import type { SortSpec } from "@/components/PaperList";

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

  // ── 加载项目列表 ──
  useEffect(() => {
    listProjects().then(setProjects).catch(console.error);
  }, []);

  // ── 监听检索页"去对话页"引导跳转 ──
  useEffect(() => {
    const handler = () => setActivePage("chat");
    window.addEventListener("navigate-to-chat", handler);
    return () => window.removeEventListener("navigate-to-chat", handler);
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
  const handleAddToCart = async (paperId: number, category = "mainstream") => {
    if (!activeProject) return;
    try {
      await addToCart(activeProject.id, paperId, category);
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
          />
        );
      case "branch":
        return <BranchPanel projectId={activeProject!.id} />;
      case "network":
        return (
          <NetworkPanel
            projectId={activeProject!.id}
            cartPaperIds={cartPaperIds}
            onAddToCart={handleAddToCart}
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
