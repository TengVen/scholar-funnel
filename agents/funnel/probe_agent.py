"""
探针推导 Agent

从骨架论文的摘要/方法论中，分析共性技术关键词，
推导出适合做分支深挖的技术探针。

职责：
1. 收集骨架论文的摘要和元数据
2. 调用 LLM 分析论文集群的方法论特征
3. 生成 3-5 个候选探针，每个标注覆盖率和代表论文
4. 输出推荐的探针列表，供用户选择
"""
from __future__ import annotations
import json
import re
from collections import Counter

from llm import client as llm
from agents.funnel.tools import (
    logger,
    summarize_paper_short,
)
from agents.funnel.state import ProbeDerivation


# ══════════════════════════════════════════════════════════
#  主入口
# ══════════════════════════════════════════════════════════

def derive_probes(
    skeleton_papers: list[dict],
    user_query: str = "",
    max_probes: int = 5,
) -> list[ProbeDerivation]:
    """
    从骨架论文中推导技术探针。

    Args:
        skeleton_papers: 骨架中的论文列表（dict）
        user_query: 原始研究方向（辅助 LLM 理解上下文）
        max_probes: 最多推荐几个探针

    Returns:
        探针推荐列表，按覆盖率降序
    """
    if not skeleton_papers:
        logger.warning("骨架为空，无法推导探针")
        return []

    logger.info(f"开始探针推导: {len(skeleton_papers)} 篇骨架论文")

    # ── 第一步：关键词频率分析（规则层） ──
    keyword_candidates = _extract_keywords(skeleton_papers)
    logger.info(f"关键词提取: {len(keyword_candidates)} 个候选")

    # ── 第二步：LLM 分析方法论集群（语义层） ──
    llm_probes = _llm_analyze_methodology(
        skeleton_papers, user_query, max_probes,
    )
    logger.info(f"LLM 推导: {len(llm_probes)} 个探针")

    # ── 第三步：合并 + 计算覆盖率 ──
    all_probes = _merge_and_score(
        keyword_candidates, llm_probes, skeleton_papers,
    )

    # ── 第四步：截取 Top N ──
    result = all_probes[:max_probes]

    logger.info(f"探针推导完成: {len(result)} 个推荐")
    return result


# ══════════════════════════════════════════════════════════
#  规则层：关键词频率提取
# ══════════════════════════════════════════════════════════

# 学术论文中常见的无意义高频词（停用词扩展）
STOP_WORDS = {
    "the", "a", "an", "and", "or", "of", "in", "to", "for", "with", "on",
    "at", "by", "from", "as", "is", "are", "was", "were", "be", "been",
    "this", "that", "these", "those", "it", "its", "we", "our", "they",
    "not", "but", "if", "so", "than", "more", "most", "also", "can",
    "model", "method", "approach", "result", "results", "paper", "propose",
    "proposed", "using", "based", "show", "using", "new", "novel", "two",
    "one", "first", "second", "different", "however", "which", "between",
    "data", "set", "task", "image", "problem", "work", "use", "used",
    "performance", "experimental", "experiments", "state", "art", "learning",
}


def _extract_keywords(papers: list[dict]) -> list[str]:
    """从论文标题和摘要中提取高频技术关键词"""
    word_counter = Counter()

    for p in papers:
        text = f"{p.get('title', '')} {p.get('abstract', '')}".lower()
        # 提取 2-gram 和 3-gram
        words = re.findall(r"[a-z][a-z\-]+[a-z]", text)
        words = [w for w in words if w not in STOP_WORDS and len(w) > 3]

        # 单词
        for w in words:
            word_counter[w] += 1

        # 2-gram
        for i in range(len(words) - 1):
            bigram = f"{words[i]} {words[i+1]}"
            if bigram not in STOP_WORDS:
                word_counter[bigram] += 1

    # 取出现频率 >= 2 且不在停用词表中的
    candidates = [
        word for word, count in word_counter.most_common(50)
        if count >= 2
    ]
    return candidates[:20]


# ══════════════════════════════════════════════════════════
#  语义层：LLM 方法论分析
# ══════════════════════════════════════════════════════════

DERIVE_PROBES_PROMPT = """\
你是一个学术研究方法论分析专家。用户正在研究"{user_query}"方向，
已经筛选出了一批核心论文。请分析这些论文的方法论特征，推导出
适合做进一步深挖的技术探针。

核心论文列表：
{papers_text}

请分析：
1. 这些论文主要使用了哪些核心技术/方法？
2. 有哪些共同的优化目标或损失函数？
3. 有哪些可以作为"技术探针"来深挖的关键词？

技术探针是指：用来在更大范围的论文中检索"使用了该技术的论文"的关键词。
好的探针应该是具体的学术术语，而非泛词。

请输出严格 JSON：
{{
  "probes": [
    {{
      "probe": "技术探针关键词（英文，2-4个词）",
      "description": "这个探针的含义和用途（中文，20字以内）",
      "sample_papers": ["代表论文标题1", "代表论文标题2"]
    }}
  ],
  "reasoning": "分析思路简述"
}}

注意：
- 推荐 {max_probes} 个探针
- 优先推荐具体的技术方法（如 "total variation regularization"），
  而非泛词（如 "optimization"）
- 探针应该能在 OpenAlex 中检索到相关论文
"""


def _llm_analyze_methodology(
    papers: list[dict],
    user_query: str,
    max_probes: int,
) -> list[dict]:
    """用 LLM 分析论文集群的方法论特征，推导出技术探针"""

    # 构建论文列表文本（每篇一行，带摘要前100字）
    papers_lines = []
    for i, p in enumerate(papers):
        title = p.get("title", "")[:80]
        abstract = (p.get("abstract") or "")[:100]
        papers_lines.append(f"[{i}] {title}\n    摘要: {abstract}...")
    papers_text = "\n".join(papers_lines)

    prompt = DERIVE_PROBES_PROMPT.format(
        user_query=user_query,
        papers_text=papers_text,
        max_probes=max_probes,
    )

    try:
        raw = llm.chat_json(prompt, temperature=0.2)
        parsed = json.loads(raw)
        return parsed.get("probes", [])
    except Exception as e:
        logger.warning(f"LLM 探针推导失败: {e}")
        return []


# ══════════════════════════════════════════════════════════
#  合并 + 覆盖率计算
# ══════════════════════════════════════════════════════════

def _merge_and_score(
    keyword_candidates: list[str],
    llm_probes: list[dict],
    skeleton_papers: list[dict],
) -> list[ProbeDerivation]:
    """
    合并规则层和语义层的探针，计算每个探针对骨架论文的覆盖率。
    覆盖率 = 骨架中标题或摘要包含该探针关键词的论文数 / 总论文数
    """
    # 从 LLM 结果中提取探针
    probes_from_llm = []
    for p in llm_probes:
        probe_text = p.get("probe", "")
        if probe_text:
            probes_from_llm.append({
                "probe": probe_text,
                "description": p.get("description", ""),
                "sample_papers": p.get("sample_papers", []),
            })

    # 从关键词中提取探针（取前5个作为候选）
    probes_from_kw = []
    for kw in keyword_candidates[:5]:
        probes_from_kw.append({
            "probe": kw,
            "description": f"高频技术关键词: {kw}",
            "sample_papers": [],
        })

    # 合并（LLM 优先，关键词补充）
    all_probe_dicts = probes_from_llm + probes_from_kw
    # 去重（基于 probe 小写）
    seen = set()
    unique_probes = []
    for pd in all_probe_dicts:
        key = pd["probe"].lower().strip()
        if key and key not in seen:
            seen.add(key)
            unique_probes.append(pd)

    # 计算覆盖率
    total_papers = len(skeleton_papers)
    results = []
    for pd in unique_probes:
        probe_text = pd["probe"].lower()
        coverage = 0
        sample_papers = list(pd.get("sample_papers", []))

        for p in skeleton_papers:
            text = f"{p.get('title', '')} {p.get('abstract', '')}".lower()
            # 简单关键词匹配（不区分大小写）
            if probe_text in text or any(
                word in text for word in probe_text.split() if len(word) > 3
            ):
                coverage += 1
                # 收集代表论文（最多3篇）
                if len(sample_papers) < 3:
                    sample_papers.append(p.get("title", "")[:60])

        results.append(ProbeDerivation(
            probe=pd["probe"],
            description=pd["description"],
            coverage=coverage,
            coverage_ratio=round(coverage / total_papers, 2) if total_papers > 0 else 0,
            sample_papers=sample_papers,
        ))

    # 按覆盖率降序排序
    results.sort(key=lambda x: x["coverage_ratio"], reverse=True)
    return results
