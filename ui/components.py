"""
Streamlit 通用 UI 组件 —— 论文卡片、标签、统计指标等
"""
import streamlit as st
import urllib.parse
from storage.models import Paper


def render_paper_card(paper: Paper, show_add_to_cart: bool = False):
    """
    渲染单篇论文卡片
    """
    # 外层容器
    with st.container(border=True):
        # 第一行：标题 + 标签
        col_title, col_tags = st.columns([5, 2])

        with col_title:
            st.markdown(f"**{paper.title}**")

        with col_tags:
            tags = []
            if paper.is_survey:
                tags.append("📖 综述")
            if paper.arxiv_id:
                tags.append("📄 arXiv")
            if paper.cited_by_count and paper.cited_by_count > 100:
                tags.append(f"🔥 高被引")
            st.caption(" · ".join(tags) if tags else "")

        # 第二行：元信息
        authors_str = ""
        if paper.authors:
            if isinstance(paper.authors, list):
                authors_display = paper.authors[:3]
                authors_str = ", ".join(authors_display)
                if len(paper.authors) > 3:
                    authors_str += f" 等 {len(paper.authors)} 人"
            else:
                authors_str = str(paper.authors)

        meta_parts = []
        if paper.venue:
            meta_parts.append(paper.venue)
        if paper.year:
            meta_parts.append(str(paper.year))
        if paper.cited_by_count:
            meta_parts.append(f"被引 {paper.cited_by_count}")
        if authors_str:
            meta_parts.append(authors_str)

        st.caption(" · ".join(meta_parts))

        # 第三行：摘要（完整展示，默认展开）
        if paper.abstract:
            with st.expander("📋 查看摘要", expanded=True):
                st.write(paper.abstract)

        # 第四行：操作按钮
        if show_add_to_cart:
            col1, col2, col3, col4 = st.columns(4)
            with col1:
                st.button(
                    "📥 加入骨架",
                    key=f"cart_{paper.id}",
                    use_container_width=True,
                )
            with col2:
                if paper.doi:
                    doi_url = f"https://doi.org/{paper.doi}"
                    st.link_button("🔗 DOI", doi_url, use_container_width=True)
            with col3:
                if paper.arxiv_id:
                    arxiv_url = f"https://arxiv.org/abs/{paper.arxiv_id}"
                    st.link_button("📄 arXiv", arxiv_url, use_container_width=True)
            with col4:
                if paper.title:
                    scholar_url = f"https://scholar.google.com/scholar?q={urllib.parse.quote(paper.title[:120])}"
                    st.link_button("🌐 搜索", scholar_url, use_container_width=True)


def render_stats_panel(
    total_papers: int,
    survey_count: int,
    high_cited_count: int,
    recent_count: int,
    cart_count: int = 0,
):
    """
    渲染右侧统计面板
    """
    st.subheader("📊 检索统计")

    col1, col2 = st.columns(2)
    with col1:
        st.metric("论文总数", total_papers)
        st.metric("综述论文", survey_count)
    with col2:
        st.metric("高被引 (>100)", high_cited_count)
        st.metric("近3年发表", recent_count)

    st.divider()
    st.subheader("📦 骨架进度")
    progress = min(cart_count / 20, 1.0)
    st.progress(progress, text=f"{cart_count} / 20 篇")


def render_query_tags(queries: list[str]):
    """
    渲染检索词标签组
    """
    if not queries:
        return

    st.caption("🔍 LLM 扩展的检索词：")
    # Streamlit 没有原生 tag 组件，用 columns 模拟
    cols = st.columns(min(len(queries), 5))
    for i, query in enumerate(queries):
        with cols[i % len(cols)]:
            st.code(query, language=None)