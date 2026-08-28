"""
论文向量存储工具 —— pgvector 读写封装

统一封装 embedding 向量的 PG 写入与余弦检索（SQLAlchemy text + CAST 方式，
避免 pgvector 0.5.0 的 adapter 注册问题）。

用法：
    from storage.vector_store import embed_papers, semantic_search

    # 为一批论文生成并写入向量
    embed_papers([{id, title, abstract}...])

    # 语义检索：返回 (paper_id, title, 余弦距离) 列表（距离越小越相似）
    semantic_search(query_text, limit=10)
"""
import logging
from typing import Optional
import math
import json

from sqlalchemy import text

from storage.mysql_db import engine
from retrieval.embedding import get_embedder

logger = logging.getLogger("vector_store")


def _paper_text(title: str, abstract: str = "") -> str:
    """论文向量化文本：标题 + 摘要前 800 字符（与 reranker 输入对齐）"""
    parts = [title or ""]
    if abstract:
        parts.append(abstract[:800])
    return " | ".join(parts)


def embed_papers(papers: list[dict], project_id: Optional[int] = None) -> int:
    """
    为论文列表生成并写入 embedding（ai_papers.embedding）。

    Args:
        papers: [{"id": int, "title": str, "abstract": str}, ...]
        project_id: 若提供，仅更新该项目的论文；否则按 id 精确更新

    Returns:
        更新的论文数
    """
    if not papers:
        return 0
    embedder = get_embedder()
    texts = [_paper_text(p.get("title", ""), p.get("abstract", "")) for p in papers]
    vectors = embedder.encode(texts)

    count = 0
    with engine.begin() as conn:
        for p, vec in zip(papers, vectors):
            conn.execute(
                text("UPDATE ai_papers SET embedding = CAST(:vec AS vector) WHERE id = :pid"),
                {"vec": vec, "pid": p["id"]},
            )
            count += 1
    logger.info(f"已写入 {count} 篇论文向量")
    return count


def semantic_search(
    query_text: str,
    project_id: Optional[int] = None,
    limit: int = 10,
    exclude_ids: Optional[list[int]] = None,
) -> list[dict]:
    """
    语义检索：query 向量化后按余弦距离升序返回论文。

    Args:
        query_text: 查询文本（中文/英文均可，bge-large-zh 支持跨语言）
        project_id: 限定项目（None=全库）
        limit: 返回条数
        exclude_ids: 排除的 paper_id（如已入骨架的）

    Returns:
        [{"id", "title", "year", "distance"}, ...] 距离越小越相似
    """
    embedder = get_embedder()
    q_vec = embedder.encode_one(query_text)

    sql = """
        SELECT id, title, year, embedding <=> CAST(:q AS vector) AS distance
        FROM ai_papers
        WHERE embedding IS NOT NULL
    """
    params: dict = {"q": q_vec}
    if project_id is not None:
        sql += " AND project_id = :pid"
        params["pid"] = project_id
    if exclude_ids:
        sql += f" AND id NOT IN ({','.join([':e' + str(i) for i in range(len(exclude_ids))])})"
        params.update({f"e{i}": pid for i, pid in enumerate(exclude_ids)})
    sql += " ORDER BY distance LIMIT :lim"
    params["lim"] = limit

    with engine.connect() as conn:
        rows = conn.execute(text(sql), params).mappings().all()
    return [dict(r) for r in rows]


def semantic_dedup(papers: list[dict], threshold: float = 0.9) -> list[dict]:
    """
    语义去重：对论文列表两两算余弦相似度，返回疑似重复对。

    Args:
        papers: [{"id", "title", "abstract"}, ...]
        threshold: 相似度阈值（>0.9 视为疑似重复）

    Returns:
        [{"a_id", "b_id", "a_title", "b_title", "similarity"}, ...]
    """
    if len(papers) < 2:
        return []
    embedder = get_embedder()
    texts = [_paper_text(p.get("title", ""), p.get("abstract", "")) for p in papers]
    vectors = embedder.encode(texts)

    def cos(a, b):
        dot = sum(x * y for x, y in zip(a, b))
        na = math.sqrt(sum(x * x for x in a))
        nb = math.sqrt(sum(x * x for x in b))
        return dot / (na * nb) if na and nb else 0.0

    dups = []
    for i in range(len(papers)):
        for j in range(i + 1, len(papers)):
            sim = cos(vectors[i], vectors[j])
            if sim >= threshold:
                dups.append({
                    "a_id": papers[i]["id"],
                    "b_id": papers[j]["id"],
                    "a_title": papers[i].get("title", ""),
                    "b_title": papers[j].get("title", ""),
                    "similarity": round(sim, 3),
                })
    dups.sort(key=lambda d: -d["similarity"])
    return dups


def semantic_recall_papers(
    project_id: int,
    query_text: str,
    limit: int = 20,
    similarity_threshold: float = 0.72,
) -> list[dict]:
    """
    本地语义召回（价值点1）：query 向量化 → 项目内已入库论文按相似度排序。

    返回与 lexical 候选兼容的论文 dict（含 openalex_id 等完整字段），
    供检索链路与词法召回合并后统一进 Reranker。

    Args:
        project_id: 限定项目（只召回本项目的已入库论文）
        query_text: 查询文本（用 intent.to_rerank_query() 效果最好）
        limit: 最多召回条数
        similarity_threshold: 相似度下限（低于此值视为不相关）

    Returns:
        [{"id"(openalex_id), "title", "abstract", "authors", "year", "venue",
          "doi", "cited_by_count", "keywords", "github_url",
          "source": "semantic", "similarity": float}, ...] 相似度降序
    """
    embedder = get_embedder()
    q_vec = embedder.encode_one(query_text)

    with engine.connect() as conn:
        rows = conn.execute(text("""
            SELECT id, openalex_id, title, abstract, authors, year, venue,
                   doi, cited_by_count, keywords, github_url,
                   embedding <=> CAST(:q AS vector) AS distance
            FROM ai_papers
            WHERE project_id = :pid AND embedding IS NOT NULL
            ORDER BY distance
            LIMIT :lim
        """), {"q": q_vec, "pid": project_id, "lim": limit * 2}).mappings().all()

    papers = []
    for r in rows:
        similarity = 1 - r["distance"]
        if similarity < similarity_threshold:
            continue
        papers.append({
            "paper_id": r["id"],          # 整数 DB id（本地二次检索加入骨架用）
            "id": r["openalex_id"],       # openalex_id（主干链路去重用，保持不变）
            "title": r["title"] or "",
            "abstract": r["abstract"] or "",
            "authors": r["authors"] or [],
            "year": r["year"],
            "venue": r["venue"] or "",
            "doi": r["doi"],
            "cited_by_count": r["cited_by_count"] or 0,
            "keywords": r["keywords"] or [],
            "github_url": r["github_url"],
            "source": "semantic",
            "similarity": round(similarity, 3),
        })
        if len(papers) >= limit:
            break
    return papers


def ensure_project_embeddings(project_id: int, max_embed: int = 200) -> int:
    """
    懒向量化：为项目内尚无 embedding 的论文补齐向量（增量）。

    Args:
        project_id: 项目 ID
        max_embed: 单次最多向量化数量（避免检索时卡死）

    Returns:
        本次向量化的论文数
    """
    with engine.connect() as conn:
        rows = conn.execute(text("""
            SELECT id, title, abstract FROM ai_papers
            WHERE project_id = :pid AND embedding IS NULL
            LIMIT :lim
        """), {"pid": project_id, "lim": max_embed}).mappings().all()
    if not rows:
        return 0
    return embed_papers([dict(r) for r in rows])


def semantic_gap_candidates(
    project_id: int,
    target_category: str,
    top_k: int = 20,
    similarity_threshold: float = 0.35,
) -> list[dict]:
    """
    语义缺口补充：该类骨架论文的向量质心 → 项目内未入骨架论文按相似度排序。

    与关键词 gap_search 的区别：候选来自【已入库论文】（有 embedding），
    找的是"语义上最像该类、但还没进骨架"的论文。

    Args:
        project_id: 项目 ID
        target_category: foundation / mainstream / frontier
        top_k: 返回条数
        similarity_threshold: 相似度下限（低于此值视为不相关）

    Returns:
        [{"paper_id", "title", "authors", "year", "venue", "abstract",
          "cited_by_count", "similarity", "source"}, ...] 相似度降序
    """
    with engine.connect() as conn:
        # 1. 该类骨架论文的 embedding
        skeleton_vecs = conn.execute(text("""
            SELECT p.embedding FROM ai_cart cart
            JOIN ai_papers p ON p.id = cart.paper_id
            WHERE cart.project_id = :pid AND cart.category = :cat
              AND p.embedding IS NOT NULL
        """), {"pid": project_id, "cat": target_category}).scalars().all()

        if not skeleton_vecs:
            return []

        # 2. 计算质心（均值后归一化）
        def _parse_vec(raw) -> list[float]:
            """pgvector 返回的 embedding 可能是 str/bytes，解析成 list[float]"""
            if isinstance(raw, str):
                return [float(x) for x in raw.strip("[]").split(",")]
            if isinstance(raw, (list, tuple)):
                return [float(x) for x in raw]
            return list(raw)  # numpy array 等

        parsed = [_parse_vec(v) for v in skeleton_vecs]
        dim = len(parsed[0])
        centroid = [0.0] * dim
        for vec in parsed:
            for i, v in enumerate(vec):
                centroid[i] += v
        norm = math.sqrt(sum(x * x for x in centroid))
        if norm > 0:
            centroid = [x / norm for x in centroid]

        # 3. 项目内未入骨架的论文，按与质心余弦距离排序
        rows = conn.execute(text("""
            SELECT p.id, p.title, p.authors, p.year, p.venue, p.abstract,
                   p.cited_by_count,
                   p.embedding <=> CAST(:centroid AS vector) AS distance
            FROM ai_papers p
            WHERE p.project_id = :pid
              AND p.embedding IS NOT NULL
              AND p.id NOT IN (
                  SELECT paper_id FROM ai_cart WHERE project_id = :pid
              )
            ORDER BY distance
            LIMIT :lim
        """), {"pid": project_id, "centroid": centroid, "lim": top_k * 3}).mappings().all()

    # 4. 过滤低相似度（distance < 1 - threshold 即相似度 > threshold）
    candidates = []
    for r in rows:
        similarity = 1 - r["distance"]
        if similarity < similarity_threshold:
            continue
        candidates.append({
            "paper_id": r["id"],
            "title": r["title"],
            "authors": r["authors"] or [],
            "year": r["year"],
            "venue": r["venue"] or "",
            "abstract": r["abstract"] or "",
            "cited_by_count": r["cited_by_count"] or 0,
            "similarity": round(similarity, 3),
            "source": "semantic",
        })
        if len(candidates) >= top_k:
            break
    return candidates
