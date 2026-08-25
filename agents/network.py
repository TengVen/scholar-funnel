"""
网络图谱服务 —— 基于引用关系发现遗漏论文
四种分析：后向追溯 / 前向追踪 / 共被引聚类 / 作者脉络
"""
import json
import concurrent.futures
from collections import Counter, defaultdict
from dataclasses import dataclass, field

from storage.mysql_db import get_session
from storage.models import Paper, CartItem, Project
from sources import openalex as oa
from utils.log import setup_logger

logger = setup_logger("network")


@dataclass
class RecommendedPaper:
    """推荐论文（网络图谱发现的）"""
    openalex_id: str
    title: str
    authors: list[str] = field(default_factory=list)
    year: int = 0
    venue: str = ""
    doi: str = ""
    cited_by_count: int = 0
    abstract: str = ""
    # 推荐信息
    source: str = ""          # "backward" / "forward"
    cited_by_n: int = 0       # 被 N 篇骨架论文引用（后向）
    citing_n: int = 0         # 引用了 N 篇骨架论文（前向）
    reason: str = ""


@dataclass
class GraphEdge:
    """图谱边（引用关系）"""
    source_id: str
    target_id: str
    label: str = ""


@dataclass
class GraphNode:
    """图谱节点"""
    id: str
    label: str
    group: str = "recommended"   # "skeleton" / "recommended"
    category: str = ""           # skeleton 的分类
    year: int = 0
    size: int = 10


@dataclass
class NetworkResult:
    """网络分析结果"""
    backward: list[RecommendedPaper] = field(default_factory=list)
    forward: list[RecommendedPaper] = field(default_factory=list)
    graph_nodes: list[GraphNode] = field(default_factory=list)
    graph_edges: list[GraphEdge] = field(default_factory=list)
    stats: dict = field(default_factory=dict)


# ── 配置 ──
BACKWARD_MIN_CITE = 2       # 后向：被至少 N 篇骨架论文引用
FORWARD_YEAR_LIMIT = 3      # 前向：最近 N 年
FORWARD_PER_PAPER = 20      # 前向：每篇骨架论文最多查 N 篇引用者
TOP_K = 30                  # 每种分析最多推荐 N 篇


# ══════════════════════════════════════════════════════════
#  主入口
# ══════════════════════════════════════════════════════════

def run_analysis(
    project_id: int, category: str = "", on_progress=None,
) -> NetworkResult:
    """
    执行网络分析。

    Args:
        project_id: 项目 ID
        category: 分类范围（foundation/mainstream/frontier，空=全部）
        on_progress: 进度回调 fn(step_name, detail)

    Returns:
        NetworkResult
    """
    skeleton = _load_skeleton(project_id, category)
    if not skeleton:
        logger.warning(f"项目 {project_id} 骨架为空")
        return NetworkResult(stats={"error": "骨架为空"})

    skeleton_ids = {p["openalex_id"] for p in skeleton}
    result = NetworkResult()

    # ── Step 1: 后向追溯 ──
    if on_progress:
        on_progress("后向追溯", "获取骨架论文的参考文献...")
    result.backward = _backward_tracing(skeleton, skeleton_ids)
    logger.info(f"后向追溯: 发现 {len(result.backward)} 篇推荐论文")

    # ── Step 2: 前向追踪 ──
    if on_progress:
        on_progress("前向追踪", "查找引用骨架论文的近期工作...")
    result.forward = _forward_tracking(skeleton, skeleton_ids)
    logger.info(f"前向追踪: 发现 {len(result.forward)} 篇推荐论文")

    # ── 构建图谱 ──
    if on_progress:
        on_progress("构建图谱", "生成节点和边...")
    result.graph_nodes, result.graph_edges = _build_graph(
        skeleton, result.backward, result.forward
    )

    # ── 统计 ──
    result.stats = {
        "skeleton_count": len(skeleton),
        "backward_count": len(result.backward),
        "forward_count": len(result.forward),
        "graph_nodes": len(result.graph_nodes),
        "graph_edges": len(result.graph_edges),
    }

    return result


# ══════════════════════════════════════════════════════════
#  后向追溯
# ══════════════════════════════════════════════════════════

def _fetch_skeleton_refs(skeleton: list[dict]) -> dict[str, set[str]]:
    """
    并行获取每篇骨架论文的引用列表（每篇仅调一次 OpenAlex），构建引用缓存。
    供后向追溯与图谱构建复用，避免同一骨架论文被重复拉取（原实现最多 300 次串行调用）。
    """
    refs_map: dict[str, set[str]] = {}
    targets = [(p["openalex_id"], p) for p in skeleton if p.get("openalex_id")]
    if not targets:
        return refs_map

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        futures = {
            executor.submit(oa.get_references, oid): oid
            for oid, _ in targets
        }
        for future in concurrent.futures.as_completed(futures):
            oid = futures[future]
            try:
                refs_map[oid] = set(future.result() or [])
            except Exception as e:
                refs_map[oid] = set()
                logger.warning(f"获取 referenced_works 失败 ({oid}): {e}")
    return refs_map


def _backward_tracing(
    skeleton: list[dict], skeleton_ids: set[str],
) -> list[RecommendedPaper]:
    """
    后向追溯：统计骨架论文的参考文献，找出被多篇共同引用的论文。
    这些论文可能是用户遗漏的奠基理论。
    """
    # 并行获取每篇骨架论文的 referenced_works（每篇一次）
    ref_counter = Counter()
    refs_map = _fetch_skeleton_refs(skeleton)
    fetch_errors = sum(1 for refs in refs_map.values() if not refs)

    for oid, refs in refs_map.items():
        for ref_id in refs:
            if ref_id and ref_id not in skeleton_ids:
                ref_counter[ref_id] += 1

    if fetch_errors > 0:
        logger.warning(f"后向追溯: {fetch_errors} 篇论文的参考文献获取失败")

    # 筛选：被 >= BACKWARD_MIN_CITE 篇骨架论文引用
    candidates = [
        (ref_id, count)
        for ref_id, count in ref_counter.most_common(TOP_K * 2)
        if count >= BACKWARD_MIN_CITE
    ][:TOP_K]

    if not candidates:
        return []

    # 批量获取候选论文的元数据（并行）
    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        futures = {
            executor.submit(oa.get_work_by_id, ref_id): (ref_id, count)
            for ref_id, count in candidates
        }
        for future in concurrent.futures.as_completed(futures):
            ref_id, count = futures[future]
            try:
                paper = future.result()
                if paper and paper.title:
                    results.append(RecommendedPaper(
                        openalex_id=paper.openalex_id,
                        title=paper.title,
                        authors=paper.authors,
                        year=paper.year,
                        venue=paper.venue,
                        doi=paper.doi or "",
                        cited_by_count=paper.cited_by_count,
                        abstract=paper.abstract,
                        source="backward",
                        cited_by_n=count,
                        reason=f"被 {count} 篇骨架论文共同引用",
                    ))
            except Exception as e:
                logger.debug(f"获取论文元数据失败 ({ref_id}): {e}")

    results.sort(key=lambda r: (-r.cited_by_n, -r.cited_by_count))
    return results[:TOP_K]


# ══════════════════════════════════════════════════════════
#  前向追踪
# ══════════════════════════════════════════════════════════

def _forward_tracking(
    skeleton: list[dict], skeleton_ids: set[str],
) -> list[RecommendedPaper]:
    """
    前向追踪：查找近期引用了骨架论文的工作。
    这些论文可能是最新的前沿进展。
    """
    from datetime import datetime
    current_year = datetime.now().year
    year_from = current_year - FORWARD_YEAR_LIMIT

    # 收集每篇候选论文被哪些骨架论文引用（并行查询）
    citing_counter = Counter()     # openalex_id → 被几篇骨架论文引用
    citing_papers = {}             # openalex_id → OpenAlexPaper

    targets = [p["openalex_id"] for p in skeleton if p.get("openalex_id")]
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        futures = {
            executor.submit(
                oa.search_citing_works,
                oid,
                per_page=FORWARD_PER_PAPER,
                year_from=year_from,
            ): oid
            for oid in targets
        }
        for future in concurrent.futures.as_completed(futures):
            oid = futures[future]
            try:
                works = future.result()
                for w in works:
                    wid = w.openalex_id
                    if wid and wid not in skeleton_ids:
                        citing_counter[wid] += 1
                        if wid not in citing_papers:
                            citing_papers[wid] = w
            except Exception as e:
                logger.warning(f"前向追踪查询失败 ({oid}): {e}")

    # 筛选：引用了 >= 1 篇骨架论文，按引用数+被引量排序
    candidates = citing_counter.most_common(TOP_K * 2)

    results = []
    for wid, citing_n in candidates[:TOP_K]:
        p = citing_papers.get(wid)
        if not p or not p.title:
            continue
        results.append(RecommendedPaper(
            openalex_id=p.openalex_id,
            title=p.title,
            authors=p.authors,
            year=p.year,
            venue=p.venue,
            doi=p.doi or "",
            cited_by_count=p.cited_by_count,
            abstract=p.abstract,
            source="forward",
            citing_n=citing_n,
            reason=f"引用了 {citing_n} 篇骨架论文（{year_from} 年后）",
        ))

    results.sort(key=lambda r: (-r.citing_n, -r.cited_by_count))
    return results[:TOP_K]


# ══════════════════════════════════════════════════════════
#  图谱构建
# ══════════════════════════════════════════════════════════

def _build_graph(
    skeleton: list[dict],
    backward: list[RecommendedPaper],
    forward: list[RecommendedPaper],
) -> tuple[list[GraphNode], list[GraphEdge]]:
    """构建 ECharts 力导向图的节点和边"""
    nodes = []
    edges = []
    seen_ids = set()

    # 骨架引用缓存：每篇骨架论文只抓一次，边判断走内存集合（原实现 O(N×M) 次 OpenAlex 调用）
    refs_map = _fetch_skeleton_refs(skeleton)

    def _is_referenced_by(skeleton_id: str, ref_id: str) -> bool:
        return ref_id in refs_map.get(skeleton_id, set())

    cat_colors = {
        "foundation": "#E8A838",
        "mainstream": "#4CAF50",
        "frontier": "#2196F3",
    }

    # 骨架论文节点
    for paper in skeleton:
        oid = paper["openalex_id"]
        if not oid or oid in seen_ids:
            continue
        seen_ids.add(oid)
        cat = paper.get("category", "mainstream")
        nodes.append(GraphNode(
            id=oid,
            label=paper["title"][:40],
            group="skeleton",
            category=cat,
            year=paper.get("year", 0),
            size=20,
        ))

    # 后向推荐节点 + 边
    for rec in backward[:15]:
        if rec.openalex_id in seen_ids:
            continue
        seen_ids.add(rec.openalex_id)
        nodes.append(GraphNode(
            id=rec.openalex_id,
            label=rec.title[:40],
            group="recommended",
            category="backward",
            year=rec.year,
            size=10 + rec.cited_by_n * 3,
        ))
        # 边：推荐论文 → 引用它的骨架论文
        for paper in skeleton:
            if _is_referenced_by(paper["openalex_id"], rec.openalex_id):
                edges.append(GraphEdge(
                    source_id=paper["openalex_id"],
                    target_id=rec.openalex_id,
                    label=f"被引 {rec.cited_by_n}",
                ))

    # 前向推荐节点 + 边
    for rec in forward[:15]:
        if rec.openalex_id in seen_ids:
            continue
        seen_ids.add(rec.openalex_id)
        nodes.append(GraphNode(
            id=rec.openalex_id,
            label=rec.title[:40],
            group="recommended",
            category="forward",
            year=rec.year,
            size=10 + rec.citing_n * 3,
        ))
        # 边：推荐论文引用骨架论文
        for paper in skeleton:
            edges.append(GraphEdge(
                source_id=rec.openalex_id,
                target_id=paper["openalex_id"],
                label=f"引用",
            ))

    return nodes, edges


# ══════════════════════════════════════════════════════════
#  数据加载
# ══════════════════════════════════════════════════════════

def _load_skeleton(project_id: int, category: str = "") -> list[dict]:
    """加载骨架论文（可按分类过滤，category 空=全部）"""
    with get_session() as session:
        q = (
            session.query(CartItem, Paper)
            .join(Paper, CartItem.paper_id == Paper.id)
            .filter(CartItem.project_id == project_id)
        )
        if category:
            q = q.filter(CartItem.category == category)
        rows = q.all()
        return [
            {
                "paper_id": paper.id,
                "openalex_id": paper.openalex_id or "",
                "title": paper.title or "",
                "authors": paper.authors or [],
                "year": paper.year,
                "venue": paper.venue or "",
                "doi": paper.doi or "",
                "cited_by_count": paper.cited_by_count or 0,
                "category": item.category,
            }
            for item, paper in rows
        ]
