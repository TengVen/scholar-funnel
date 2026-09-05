"use client";

import { Suspense, useState, useEffect, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LayoutGrid, ArrowLeft } from "lucide-react";
import type { SortSpec } from "@/types/domain";
import { DEFAULT_SORT } from "@/config/search";
import type { Paper, SearchResult, RunDetail } from "@/types/dto";
import { listPapers, getRunDetail, runTrunkSearch, runLocalSearch } from "@/lib/api/search";
import { taskFailureMessage } from "@/lib/taskFeedback";
import { useProjectStore } from "@/stores/projectStore";
import { useCartStore } from "@/stores/cartStore";
import { useAuth } from "@/hooks/useAuth";
import { Sidebar } from "@/components/layout/Sidebar";
import { SearchPanel } from "@/components/search/SearchPanel";
import { PaperList } from "@/components/search/PaperList";
import { PaperCard } from "@/components/search/PaperCard";
import { RecommendedPanel } from "@/components/search/RecommendedPanel";
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
  const [activeRunId, setActiveRunId] = useState<number | null>(null); // 检索页当前 run 上下文（工作台 run 进入 / 详情页返回恢复）
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null);  // 当前 run 详情（已推荐视图 + 主列表剔除数据源）
  const [runLoading, setRunLoading] = useState(false);
  const [searchView, setSearchView] = useState<"list" | "recommended">("list"); // 检索页视图：全部结果 / 已推荐
  const [workspaceOpen, setWorkspaceOpen] = useState(false); // 工作台概览右栏
  const [workspaceW, setWorkspaceW] = useState(320);         // 工作台右栏宽度（可拖拽）

  // ── 项目 / 会话（全局共享 → projectStore）──
  const projects = useProjectStore((s) => s.projects);
  const activeProject = useProjectStore((s) => s.activeProject);
  const conversations = useProjectStore((s) => s.conversations);
  const activeConversationId = useProjectStore((s) => s.activeConversationId);
  const lastConvForProject = useProjectStore((s) => s.lastConvForProject);
  const lastActiveConversationId = useProjectStore((s) => s.lastActiveConversationId);
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

  // ── 骨架（全局共享 → cartStore；页面本身无骨架 UI，loadCart 供其它视图读取）──
  const loadCart = useCartStore((s) => s.loadCart);

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
    setActiveRunId(null);
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

  // ── 跨视图导航指令（检索页"去对话页"引导）──
  // 返回对话须带恢复指令：ChatPanel 在检索视图期间被卸载，重挂载后仅凭
  // requestedConversationId（chatOpenConvId）恢复历史；selectConversation 会设置该指令。
  useEffect(() => {
    const toChat = () => {
      if (activeConversationId) selectConversation(activeConversationId);
      setActiveView("chat");
    };
    window.addEventListener("navigate-to-chat", toChat);
    return () => {
      window.removeEventListener("navigate-to-chat", toChat);
    };
  }, [activeConversationId, selectConversation]);

  // ── 当前 run 详情：进入检索页（带 run_id）时拉取 → 「已推荐」视图 + 主列表剔除的数据源 ──
  useEffect(() => {
    if (activeRunId == null) {
      setRunDetail(null);
      setSearchView("list");
      return;
    }
    let alive = true;
    setRunLoading(true);
    getRunDetail(activeRunId)
      .then((d) => {
        if (!alive) return;
        setRunDetail(d);
        // 从 run 进入默认落「全部结果」主视图（推荐论文在工具栏「已推荐」切换查看）
      })
      .catch(() => { /* 静默：run 详情加载失败不打断检索页（列表视图降级可用） */ })
      .finally(() => {
        if (alive) setRunLoading(false);
      });
    return () => { alive = false; };
  }, [activeRunId]);

  // 当前 run 的推荐论文 id（剔除主列表用；无 run / 无推荐 = 空）
  const recommendedIds = useMemo(() => {
    const cs = runDetail?.cognitive;
    if (!cs) return [] as number[];
    return [...(cs.foundation ?? []), ...(cs.mainstream ?? []), ...(cs.frontier ?? [])]
      .map((p) => p.paper_id)
      .filter((pid): pid is number => pid != null);
  }, [runDetail]);

  // ── 加载论文和骨架（主视图=trunk 池，SQL 层剔除当前 run 推荐论文）──
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
          exclude_paper_ids: activeRunId != null ? recommendedIds : undefined,
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
    [sortBy, filterSurvey, activeRunId, recommendedIds],
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
      toast(taskFailureMessage(e, "检索"), "error");
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
      toast(taskFailureMessage(e, "检索"), "error");
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

  // ── 工作台：检索记录 → 检索页（切到该子研究 + 当前 run 上下文）──
  const handleOpenSearch = (pid: number, runId?: number | null) => {
    loadProjects().then(() => {
      const found = useProjectStore.getState().projects.find((p) => p.id === pid);
      if (found) {
        setActiveProject(found);
        setActiveRunId(runId ?? null);
        setActiveView("search");
      }
    });
  };

  // ── 工作台：深入研究 / 论文 → 详情页（带来源对话 + run 上下文；auto=1 点开即预热升 L2）──
  const handleOpenPaper = (paperId: number, projectId: number, auto = false) => {
    const conv = activeConversationId ? `&conv_id=${activeConversationId}` : "";
    const run = activeRunId != null ? `&run_id=${activeRunId}` : "";
    router.push(`/paper/${paperId}?project_id=${projectId}${auto ? "&auto=1" : ""}${conv}${run}`);
  };

  // ── 详情页返回路由：/?view=search&project_id=&run_id= → 切检索并恢复 run；/?conversation_id= → 打开对话 ──
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
            const rid = q.get("run_id");
            setActiveRunId(rid && Number.isFinite(Number(rid)) ? Number(rid) : null);
            // 恢复来源对话（详情页「返回检索」URL 携带 conv_id；供随后「返回对话」回到同一会话历史，
            // 而非新对话——Home 重挂载时 resetSession 已清空 store 会话态）
            const cid = q.get("conv_id");
            if (cid) setActiveConversationId(cid);
            setActiveView("search");
          }
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectConversation, loadProjects, setActiveProject]);

  // ── 翻页 ──
  const handlePageChange = (newPage: number) => {
    if (activeProject) {
      loadPapers(activeProject.id, newPage);
    }
  };

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
              <div className="flex items-center justify-between px-6 py-2 border-b border-aux-teal/25 bg-aux-teal/[0.06] shrink-0">
                <span className="flex items-center gap-2 text-sm text-ink-muted">
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-aux-teal/15 text-aux-teal border border-aux-teal/30">
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
              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2 bg-aux-teal/[0.02]">
                {localSearching && localPapers.length === 0 ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="w-5 h-5 border-2 border-line border-t-aux-teal rounded-full animate-spin" />
                  </div>
                ) : localPapers.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center gap-2 text-ink-faint">
                    <Database className="w-6 h-6 opacity-40" />
                    <p className="text-base">未找到匹配的已入库论文</p>
                  </div>
                ) : (
                  localPapers.map((p) => (
                    <PaperCard key={p.id} paper={p} onOpenPaper={() => handleOpenPaper(p.id, activeProject!.id, true)} />
                  ))
                )}
              </div>
            </>
          );
        }
        // run 上下文视图：对话推荐论文与全量结果分离（2026-09-03 拍板）
        if (activeRunId != null) {
          const cs = runDetail?.cognitive;
          const recCount =
            (cs?.foundation?.length ?? 0) + (cs?.mainstream?.length ?? 0) + (cs?.frontier?.length ?? 0);
          return searchView === "recommended" ? (
            runLoading ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="w-5 h-5 border-2 border-line border-t-gold-light rounded-full animate-spin" />
              </div>
            ) : runDetail ? (
              <RecommendedPanel
                run={runDetail}
                projectId={runDetail.project_id}
                view={searchView}
                recCount={recCount}
                onViewChange={setSearchView}
                onOpenPaper={(pid) => handleOpenPaper(pid, runDetail.project_id, true)}
              />
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center gap-2 text-ink-faint">
                <p className="text-base">加载推荐失败</p>
                <button type="button" onClick={() => setSearchView("list")} className="btn-ghost text-sm">
                  查看全部结果
                </button>
              </div>
            )
          ) : (
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
                view={searchView}
                recCount={recCount}
                onViewChange={setSearchView}
                onSortChange={setSortBy}
                onFilterChange={setFilterSurvey}
                onPageChange={handlePageChange}
                onOpenPaper={(pid) => handleOpenPaper(pid, activeProject!.id, true)}
              />
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
              onSortChange={setSortBy}
              onFilterChange={setFilterSurvey}
              onPageChange={handlePageChange}
              onOpenPaper={(pid) => handleOpenPaper(pid, activeProject!.id, true)}
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
            onOpenSearchResults={handleOpenSearch}
            requestedConversationId={
              chatOpenConvId
              ?? lastConvForProject[activeProject?.id ?? -1]
              ?? lastActiveConversationId
            }
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
              <div className="flex items-center gap-3 px-4 py-2 border-b border-line bg-paper-chrome shrink-0">
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
              <div className="flex items-center gap-2 px-4 py-2 border-b border-line bg-paper-chrome shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    // 带恢复指令回对话：ChatPanel 重挂载后凭 chatOpenConvId 加载该会话历史
                    if (activeConversationId) selectConversation(activeConversationId);
                    setActiveView("chat");
                  }}
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
