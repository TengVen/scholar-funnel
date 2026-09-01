"use client";

import { Suspense, useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LayoutGrid, ArrowLeft } from "lucide-react";
import type { SortSpec, Category } from "@/types/domain";
import { DEFAULT_SORT } from "@/config/search";
import type { Paper, SearchResult, GapSearchResult } from "@/types/dto";
import { listPapers } from "@/lib/api/search";
import {
  runTrunkSearch, runGapSearch, runGapSemantic, lookupTitleByTitle, runLocalSearch,
} from "@/lib/api/search";
import { useProjectStore } from "@/stores/projectStore";
import { useCartStore } from "@/stores/cartStore";
import { useAuth } from "@/hooks/useAuth";
import { Sidebar } from "@/components/layout/Sidebar";
import { SearchPanel } from "@/components/search/SearchPanel";
import { PaperList } from "@/components/search/PaperList";
import { PaperCard } from "@/components/search/PaperCard";
import { GapPanel } from "@/components/search/GapPanel";
import { StatsBar } from "@/components/search/StatsBar";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { ResizablePanel } from "@/components/paper/ResizablePanel";
import { WorkspacePanel } from "@/components/workspace/WorkspacePanel";
import { ToastContainer } from "@/components/common/ToastContainer";
import { Database } from "lucide-react";
import { toast } from "@/lib/toast";

export default function Home() {
  const router = useRouter();
  // ── 主区域视图（2-page IA：无顶部 tab，对话为主；检索为工作台进入的子视图）──
  const [activeView, setActiveView] = useState<"chat" | "search">("chat");
  const [workspaceOpen, setWorkspaceOpen] = useState(false); // 工作台概览右栏
  const [workspaceW, setWorkspaceW] = useState(320);         // 工作台右栏宽度（可拖拽）

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

  // ── 本地库二次检索（对已入库论文按领域/技术语义召回）──
  const [scope, setScope] = useState<"openalex" | "local">("openalex");
  const [localMode, setLocalMode] = useState(false);
  const [localPapers, setLocalPapers] = useState<Paper[]>([]);
  const [localQuery, setLocalQuery] = useState("");
  const [localSearching, setLocalSearching] = useState(false);

  // ── 启动：认证初始化（游客兜底 / 恢复会话）──
  useEffect(() => {
    initAuth();
  }, [initAuth]);

  // ── 认证变化（首次游客 / 登录 / 登出 / 过期）→ 重置当前项目 + 刷新数据 ──
  useEffect(() => {
    if (!authInitialized) return;
    resetSession();
    setActiveView("chat");
    setWorkspaceOpen(false);
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

  // ── 跨视图导航指令（检索页返回对话）──
  useEffect(() => {
    const toChat = () => setActiveView("chat");
    window.addEventListener("navigate-to-chat", toChat);
    return () => {
      window.removeEventListener("navigate-to-chat", toChat);
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

  // ── 执行检索（广域 OpenAlex）──
  const handleSearch = async (query: string, techProbe: string) => {
    if (!activeProject) return;
    setLocalMode(false);
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
      toast(`检索失败: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setSearching(false);
    }
  };

  // ── 本地库二次检索（对已入库论文按领域/技术语义召回）──
  const handleLocalSearch = async (query: string) => {
    if (!activeProject) return;
    setLocalSearching(true);
    setLocalMode(true);
    setActiveView("search");
    try {
      const res = await runLocalSearch({ project_id: activeProject.id, query, limit: 30 });
      setLocalPapers(res.papers);
      setLocalQuery(res.query);
    } catch (e: unknown) {
      toast(`本地检索失败: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setLocalSearching(false);
    }
  };

  // ── 范围开关：切回广域时退出本地检索视图 ──
  const handleScopeChange = (s: "openalex" | "local") => {
    setScope(s);
    if (s === "openalex") setLocalMode(false);
  };

  // ── 创建新项目 ──
  const handleNewProject = async (query: string, techProbe: string) => {
    try {
      await createProjectStore(query, techProbe);
    } catch (e: unknown) {
      toast(`创建项目失败: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  };

  // ── 工作台：检索记录 → 检索页（切到该子研究）──
  const handleOpenSearch = (pid: number) => {
    loadProjects().then(() => {
      const found = useProjectStore.getState().projects.find((p) => p.id === pid);
      if (found) {
        setActiveProject(found);
        setActiveView("search");
      }
    });
  };

  // ── 工作台：深入研究 / 论文 → 详情页（带来源对话，供详情页"返回对话"直达）──
  const handleOpenPaper = (paperId: number, projectId: number) => {
    const conv = activeConversationId ? `&conv_id=${activeConversationId}` : "";
    router.push(`/paper/${paperId}?project_id=${projectId}${conv}`);
  };

  // ── 详情页返回路由：/?view=search&project_id= → 切检索；/?conversation_id= → 打开对话 ──
  const handleRouteQuery = useCallback((q: URLSearchParams) => {
    const convId = q.get("conversation_id");
    if (convId) {
      selectConversation(convId);
      setActiveView("chat");
      return;
    }
    const pidRaw = q.get("project_id");
    if (q.get("view") === "search" && pidRaw) {
      const pid = Number(pidRaw);
      if (Number.isFinite(pid)) {
        loadProjects().then(() => {
          const found = useProjectStore.getState().projects.find((p) => p.id === pid);
          if (found) {
            setActiveProject(found);
            setActiveView("search");
          }
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectConversation, loadProjects, setActiveProject]);

  // ── 加入/移出骨架（cartStore 内部已自动重载骨架；"已在骨架"标记由 PaperCard 从 store 实时推导，
  //    论文列表数据未变，无需重拉 → 避免列表闪烁）──
  const handleAddToCart = async (paperId: number, category = "mainstream", notes = "") => {
    if (!activeProject) return;
    try {
      await cartAddItem(activeProject.id, paperId, category, notes);
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  };

  const handleRemoveFromCart = async (paperId: number) => {
    if (!activeProject) return;
    try {
      await cartRemoveItem(activeProject.id, paperId);
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : String(e), "error");
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
      setActiveView("search");            // 跳到检索页查看重检索结果
    } catch (e: unknown) {
      toast(`补充检索失败: ${e instanceof Error ? e.message : String(e)}`, "error");
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
      setActiveView("search");
    } catch (e: unknown) {
      toast(`标题查找失败: ${e instanceof Error ? e.message : String(e)}`, "error");
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

  // ── 渲染主内容区（纯页面组装；2-page IA：对话 / 检索两个视图）──
  const renderContent = () => {
    // 检索视图需要当前子研究（activeProject）
    const needsProject = activeView !== "chat";
    if (needsProject && !activeProject) {
      return (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-base text-ink-faint">请从工作台的检索记录进入</p>
        </div>
      );
    }

    switch (activeView) {
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
        // 本地库二次检索模式：对已入库论文做领域/技术语义召回
        if (localMode) {
          return (
            <>
              <SearchPanel
                activeProject={activeProject}
                searching={scope === "local" ? localSearching : searching}
                scope={scope}
                onScopeChange={handleScopeChange}
                onSearch={handleSearch}
                onNewProject={handleNewProject}
                onLocalSearch={handleLocalSearch}
              />
              <div className="flex items-center justify-between px-6 py-2 border-b border-[#4FAF9F]/25 bg-[#4FAF9F]/[0.06] shrink-0">
                <span className="flex items-center gap-2 text-sm text-ink-muted">
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#4FAF9F]/15 text-[#6fcebd] border border-[#4FAF9F]/30">
                    <Database className="w-3 h-3" />
                    本地库召回
                  </span>
                  <span className="text-ink-secondary font-medium">{localQuery}</span>
                  <span className="ml-1 text-ink-faint">{localPapers.length} 篇</span>
                </span>
                <button
                  onClick={() => setLocalMode(false)}
                  className="btn-ghost text-sm"
                >
                  退出本地检索
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2 bg-[#4FAF9F]/[0.02]">
                {localSearching && localPapers.length === 0 ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="w-5 h-5 border-2 border-line border-t-[#4FAF9F] rounded-full animate-spin" />
                  </div>
                ) : localPapers.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center gap-2 text-ink-faint">
                    <Database className="w-6 h-6 opacity-40" />
                    <p className="text-base">未找到匹配的已入库论文</p>
                  </div>
                ) : (
                  localPapers.map((p) => (
                    <PaperCard key={p.id} paper={p} onAddToCart={handleAddToCart} />
                  ))
                )}
              </div>
            </>
          );
        }
        return (
          <>
            <SearchPanel
              activeProject={activeProject}
              searching={scope === "local" ? localSearching : searching}
              scope={scope}
              onScopeChange={handleScopeChange}
              onSearch={handleSearch}
              onNewProject={handleNewProject}
              onLocalSearch={handleLocalSearch}
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
                  setActiveView("search");
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
            workspaceOpen={workspaceOpen}
            onToggleWorkspace={() => setWorkspaceOpen((v) => !v)}
          />
        );
    }
  };

  return (
    <div className="flex h-screen overflow-hidden">
      {/* 左栏：对话历史（2-page IA：无项目索引） */}
      <Sidebar
        conversations={conversations}
        activeConversationId={activeConversationId}
        onSelectConversation={(cid) => {
          selectConversation(cid);
          setActiveView("chat");
        }}
        onNewConversation={() => {
          newConversation();
          setActiveView("chat");
        }}
      />

      {/* 主区域（对话 / 检索两视图） */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {activeView === "chat" ? (
          <div className="flex flex-1 min-h-0">
            <div className="flex-1 flex flex-col min-w-0">
              {/* 对话区顶部：对话标题 + 工作台概览入口 */}
              <div className="flex items-center gap-3 px-4 py-2 border-b border-line bg-paper-white shrink-0">
                <p className="flex-1 min-w-0 text-sm text-ink-muted truncate">
                  {conversations.find((c) => c.conversation_id === activeConversationId)?.title || "新对话"}
                </p>
              </div>
              <div className="flex-1 flex flex-col min-h-0">{renderContent()}</div>
            </div>

            {/* 工作台概览右栏（可拖拽/折叠） */}
            {workspaceOpen && (
              <ResizablePanel
                side="right"
                width={workspaceW}
                collapsed={false}
                minWidth={260}
                maxWidth={440}
                onResize={setWorkspaceW}
                onToggle={() => setWorkspaceOpen(false)}
                header={<><LayoutGrid className="w-4 h-4 text-accent" /> 工作台概览</>}
              >
                <WorkspacePanel
                  conversationId={activeConversationId}
                  onOpenSearch={handleOpenSearch}
                  onOpenPaper={handleOpenPaper}
                />
              </ResizablePanel>
            )}
          </div>
        ) : (
          <div className="flex flex-1 min-h-0">
            <div className="flex-1 flex flex-col min-w-0">
              {/* 检索视图顶部：返回对话 */}
              <div className="flex items-center gap-2 px-4 py-2 border-b border-line bg-paper-white shrink-0">
                <button
                  type="button"
                  onClick={() => setActiveView("chat")}
                  className="flex items-center gap-1 text-sm text-ink-muted hover:text-ink transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" /> 返回对话
                </button>
                <span className="flex-1 min-w-0 text-sm text-ink-faint truncate">
                  {activeProject?.name ?? ""}
                </span>
              </div>
              <div className="flex-1 flex flex-col min-h-0">{renderContent()}</div>
            </div>
          </div>
        )}
      </main>

      <Suspense fallback={null}>
        <RouteQueryBridge onRoute={handleRouteQuery} />
      </Suspense>
      <ToastContainer />
    </div>
  );
}

/** URL 路由桥：响应详情页"返回对话/返回检索"携带的 query（Suspense 包裹满足 useSearchParams 要求） */
function RouteQueryBridge({ onRoute }: { onRoute: (q: URLSearchParams) => void }) {
  const search = useSearchParams();
  useEffect(() => {
    onRoute(search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);
  return null;
}
