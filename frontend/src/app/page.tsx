"use client";

import { useState, useEffect, useCallback } from "react";
import { NAV_TABS } from "@/config/nav";
import { DEFAULT_SORT } from "@/config/search";
import type { Page, SortSpec, Category } from "@/types/domain";
import type { Paper, SearchResult, GapSearchResult } from "@/types/dto";
import { listPapers } from "@/lib/api/search";
import { runTrunkSearch, runGapSearch, runGapSemantic, lookupTitleByTitle } from "@/lib/api/search";
import { useProjectStore } from "@/stores/projectStore";
import { useCartStore } from "@/stores/cartStore";
import { useAuth } from "@/hooks/useAuth";
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

export default function Home() {
  // ── 路由状态（局部 UI 状态，按 spec 用 useState）──
  const [activePage, setActivePage] = useState<Page>("chat");

  // ── 项目 / 会话（全局共享 → projectStore）──
  const projects = useProjectStore((s) => s.projects);
  const activeProject = useProjectStore((s) => s.activeProject);
  const conversations = useProjectStore((s) => s.conversations);
  const activeConversationId = useProjectStore((s) => s.activeConversationId);
  const lastConvForProject = useProjectStore((s) => s.lastConvForProject);
  const chatOpenConvId = useProjectStore((s) => s.chatOpenConvId);
  const chatNewSignal = useProjectStore((s) => s.chatNewSignal);
  const loadProjects = useProjectStore((s) => s.loadProjects);
  const loadConversations = useProjectStore((s) => s.loadConversations);
  const selectProject = useProjectStore((s) => s.selectProject);
  const selectConversation = useProjectStore((s) => s.selectConversation);
  const newConversation = useProjectStore((s) => s.newConversation);
  const setActiveProject = useProjectStore((s) => s.setActiveProject);
  const setActiveConversationId = useProjectStore((s) => s.setActiveConversationId);
  const setChatOpenConvId = useProjectStore((s) => s.setChatOpenConvId);
  const rememberLastConversation = useProjectStore((s) => s.rememberLastConversation);
  const resetSession = useProjectStore((s) => s.resetSession);
  const createProjectStore = useProjectStore((s) => s.createProject);

  // ── 骨架（全局共享 → cartStore）──
  const cart = useCartStore((s) => s.cart);
  const loadCart = useCartStore((s) => s.loadCart);
  const cartAddItem = useCartStore((s) => s.addItem);
  const cartRemoveItem = useCartStore((s) => s.removeItem);

  // ── 认证（authStore + useAuth）──
  const { init: initAuth, user: authUser, initialized: authInitialized } = useAuth();

  // ── 检索页流程状态（页面级，保持 useState）──
  const [papers, setPapers] = useState<Paper[]>([]);
  const [paperTotal, setPaperTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [sortBy, setSortBy] = useState<SortSpec[]>(DEFAULT_SORT);
  const [filterSurvey, setFilterSurvey] = useState("all");
  const [loadingPapers, setLoadingPapers] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
  const [gapMode, setGapMode] = useState(false);            // 是否显示重检索视图
  const [gapResult, setGapResult] = useState<GapSearchResult | null>(null);
  const [gapSearching, setGapSearching] = useState(false);

  // ── 启动：认证初始化（游客兜底 / 恢复会话）──
  useEffect(() => {
    initAuth();
  }, [initAuth]);

  // ── 认证变化（首次游客 / 登录 / 登出 / 过期）→ 重置当前项目 + 刷新数据 ──
  useEffect(() => {
    if (!authInitialized) return;
    resetSession();
    setActivePage("chat");
    loadProjects();
    loadConversations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser?.id, authInitialized, resetSession, loadProjects, loadConversations]);

  // ── 对话产生新消息/新项目 → 刷新会话列表 ──
  useEffect(() => {
    const handler = () => loadConversations();
    window.addEventListener("chat:updated", handler);
    return () => window.removeEventListener("chat:updated", handler);
  }, [loadConversations]);

  // ── 跨页导航指令（检索页→对话页 / 分支·网络页→骨架页）──
  useEffect(() => {
    const toChat = () => setActivePage("chat");
    const toCart = () => setActivePage("cart");
    window.addEventListener("navigate-to-chat", toChat);
    window.addEventListener("navigate-to-cart", toCart);
    return () => {
      window.removeEventListener("navigate-to-chat", toChat);
      window.removeEventListener("navigate-to-cart", toCart);
    };
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
    try {
      await createProjectStore(query, techProbe);
    } catch (e: unknown) {
      alert(`创建项目失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // ── 加入/移出骨架（cartStore 内部自动重载骨架；检索页额外刷新论文列表）──
  const handleAddToCart = async (paperId: number, category = "mainstream", notes = "") => {
    if (!activeProject) return;
    try {
      await cartAddItem(activeProject.id, paperId, category, notes);
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
      await cartRemoveItem(activeProject.id, paperId);
      if (activePage === "search") {
        await loadPapers(activeProject.id, page);
      }
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  // ── 缺口补充检索（重检索）──
  const handleGapSearch = async (
    targetCategory: Category, constraint = "", threshold = 0.35, mode = "search",
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
  const handleTitleLookup = async (targetCategory: Category, title: string) => {
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

  // ── 渲染主内容区（纯页面组装） ──
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
        return <NetworkPanel projectId={activeProject!.id} cart={cart} />;
      case "chat":
        return (
          <ChatPanel
            onProjectCreated={(pid) => {
              // 对话里检索完成 → 刷新项目并自动选中新建项目
              loadProjects().then(() => {
                const found = useProjectStore.getState().projects.find((p) => p.id === pid);
                if (found) setActiveProject(found);
              });
            }}
            onOpenProject={(pid) => {
              // 对话里点"查看项目"→ 跳检索页 + 切到该项目
              loadProjects().then(() => {
                const found = useProjectStore.getState().projects.find((p) => p.id === pid);
                if (found) {
                  setActiveProject(found);
                  setActivePage("search");
                }
              });
            }}
            requestedConversationId={chatOpenConvId ?? lastConvForProject[activeProject?.id ?? -1]}
            newSignal={chatNewSignal}
            currentProjectId={activeProject?.id ?? null}
            onRequestConsumed={() => setChatOpenConvId(null)}
            onConversationChanged={(cid, pid) => {
              setActiveConversationId(cid);
              rememberLastConversation(cid, pid ?? null);
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
        conversations={conversations}
        activeConversationId={activeConversationId}
        onSelect={(p) => {
          selectProject(p);
          setActivePage("search");
        }}
        onSelectConversation={(cid) => {
          selectConversation(cid);
          setActivePage("chat");
        }}
        onNewConversation={() => {
          newConversation();
          setActivePage("chat");
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
