"""
Tab 1: 主干检索页面 —— 发起检索、查看结果、筛选排序、过程分析
"""
import streamlit as st
from datetime import datetime
import urllib.parse
from sqlalchemy import desc, func

from storage.mysql_db import get_session
from storage.models import Paper, CartItem
from storage import cart as cart_svc
from ui.components import render_paper_card, render_stats_panel, render_query_tags
from retrieval import TrunkSearchEngine


def render(project_id: int, user_query: str, tech_probe: str):
    """主干检索页面的完整渲染逻辑"""

    # ── 检索控制区 ──
    with st.container(border=True):
        st.subheader("🔭 主干检索配置")

        col_left, col_right = st.columns([3, 1])

        with col_left:
            st.text(f"研究方向：{user_query}")
            if tech_probe:
                st.text(f"技术探针：{tech_probe}")

        with col_right:
            year_range = st.slider(
                "发表年份范围",
                min_value=1990,
                max_value=datetime.now().year,
                value=(2010, datetime.now().year),
                key="trunk_year_range",
            )
            per_query = st.select_slider(
                "每组检索词获取数量",
                options=[15, 25, 50, 100],
                value=25,
                key="trunk_per_query",
            )

        # 检索按钮
        search_clicked = st.button(
            "🚀 开始主干检索",
            type="primary",
            use_container_width=True,
            key="btn_trunk_search",
        )

    # ── 执行检索 ──
    if search_clicked:
        try:
            with st.status("正在执行主干检索...", expanded=True) as status:
                st.write("📡 Step 1/4: LLM 拆解研究意图（可能 10-20s）...")
                engine = TrunkSearchEngine()
                result = engine.search(
                    project_id=project_id,
                    user_query=user_query,
                    tech_probe=tech_probe or "",
                    per_query=per_query,
                    year_from=year_range[0],
                    year_to=year_range[1],
                    score_threshold=0.0,
                    top_k=100,
                )
                st.write(f"📡 完成 LLM 拆解")
                st.write(f"✅ Step 2/4: 召回 {result['total_found']} 篇候选")
                st.write(f"✅ Step 3/4: 重排后保留 {result['after_rerank']} 篇")
                st.write(f"✅ Step 4/4: 新增入库 {result['new_saved']} 篇")

                # 如果有慢步骤警告，展示在 status 中
                trace_data = result.get("trace", {})
                for w in trace_data.get("slow_warnings", []):
                    st.write(f"⚠️ {w['label']}: {w['seconds']}s（超过预期）")

                status.update(label="主干检索完成！", state="complete")

            st.session_state["trunk_queries"] = result.get("expanded_queries", [])
            st.session_state["trunk_reasoning"] = result.get("reasoning", "")
            st.session_state["trunk_trace"] = result.get("trace", {})

        except Exception as e:
            st.error(f"❌ 检索失败: {e}")
            import traceback
            st.code(traceback.format_exc(), language="bash")
            return

    # ── 过程分析区 ──
    _render_trace()

    # ── 展示区域：检索词 + 论文列表 + 统计面板 ──
    render_results(project_id)


def _render_trace():
    """渲染检索过程分析面板"""
    trace = st.session_state.get("trunk_trace")
    if not trace:
        return

    timing = trace.get("timing", {})
    warnings = trace.get("slow_warnings", [])

    with st.container(border=True):
        st.subheader("🔍 检索过程分析")

        # ── 耗时总览条 ──
        if timing:
            total_sec = timing.get("total", 0)
            cols = st.columns(6)
            labels = [
                ("🧠 LLM 拆解", "step1_decomposition"),
                ("📡 API 检索", "step2_recall"),
                ("⚡ BGE 重排", "step3_rerank"),
                ("📊 评分", "step4_scoring"),
                ("💾 入库", "step5_storage"),
            ]
            for i, (label, key) in enumerate(labels):
                sec = timing.get(key, 0)
                col = cols[i]
                color = "🔴" if sec > 10 else "🟡" if sec > 5 else "🟢"
                col.metric(f"{color} {label}", f"{sec}s", border=True if i == 3 else False)
            cols[-1].metric("⏱️ 总耗时", f"{total_sec}s")

            if warnings:
                for w in warnings:
                    st.warning(f"⚠️ **{w['label']}** 耗时 {w['seconds']}s — 超过建议阈值 10s")

        # ── Step 1: 意图拆解 ──
        s1 = trace.get("step1_decomposition", {})
        t1 = timing.get("step1_decomposition", 0)
        with st.expander(f"📡 Step 1: LLM 意图拆解（{t1}s）", expanded=False):
            c1, c2 = st.columns(2)
            with c1:
                st.markdown("**方法论 (Methodology)**")
                st.write(f"核心词: `{', '.join(s1.get('methodology_core', []))}`")
                if s1.get('methodology_synonyms'):
                    st.caption(f"同义词: {', '.join(s1['methodology_synonyms'])}")
                if s1.get('methodology_related'):
                    st.caption(f"相关技术: {', '.join(s1['methodology_related'])}")
            with c2:
                st.markdown("**应用领域 (Domain)**")
                st.write(f"核心词: `{', '.join(s1.get('domain_core', []))}`")
                if s1.get('domain_synonyms'):
                    st.caption(f"同义词: {', '.join(s1['domain_synonyms'])}")
                if s1.get('domain_broader'):
                    st.caption(f"上位概念: {', '.join(s1['domain_broader'])}")

            if s1.get('paradigm'):
                st.info(f"技术范式: **{s1['paradigm']}**")

            st.markdown("**生成的检索词 (combined_queries):**")
            orig = s1.get("original_query_count", 0)
            used = s1.get("used_query_count", 0)
            if orig > used:
                st.caption(f"LLM 生成了 {orig} 个检索词，取前 {used} 个以提升速度")
            for i, q in enumerate(s1.get('combined_queries', []), 1):
                st.code(f"{i}. {q}")

            if s1.get('reasoning'):
                with st.expander("💡 LLM 拆解思路", expanded=False):
                    st.write(s1['reasoning'])

        # ── Step 2: 召回统计 ──
        s2 = trace.get("step2_recall", {})
        t2 = timing.get("step2_recall", 0)
        with st.expander(f"📄 Step 2: 召回统计（{t2}s）", expanded=False):
            col_a, col_b, col_c = st.columns(3)
            with col_a:
                st.metric("原始召回总数", s2.get("total_raw", 0))
            with col_b:
                st.metric("去重后", s2.get("total_unique", 0))
            with col_c:
                st.metric("去重数量", s2.get("duplicates", 0))

            query_stats = s2.get("query_stats", [])
            if query_stats:
                st.markdown("**各检索词召回明细:**")
                import pandas as pd
                df = pd.DataFrame(query_stats)
                df = df.rename(columns={
                    "query": "检索词",
                    "count": "召回数",
                    "status": "状态",
                    "error": "错误",
                    "sample_title": "首篇标题",
                })
                # 状态列加颜色
                def _status_badge(s):
                    return "✅ 成功" if s == "success" else "❌ 失败"
                df["状态"] = df["状态"].apply(_status_badge)
                st.dataframe(df[["检索词", "召回数", "状态", "首篇标题"]],
                             use_container_width=True, hide_index=True)

        # ── Step 3: 重排序 ──
        s3 = trace.get("step3_rerank", {})
        t3 = timing.get("step3_rerank", 0)
        with st.expander(f"🎯 Step 3: 重排序 (BGE Reranker)（{t3}s）", expanded=False):
            col_d, col_e, col_f = st.columns(3)
            with col_d:
                st.metric("重排数量", s3.get("reranked_count", 0))
            with col_e:
                st.metric("最低分", s3.get("score_min", 0))
            with col_f:
                st.metric("最高分", s3.get("score_max", 0))

            top10_rerank = s3.get("top10", [])
            if top10_rerank:
                st.markdown("**重排 Top 10:**")
                import pandas as pd
                df_r = pd.DataFrame(top10_rerank)
                df_r["排名"] = range(1, len(df_r) + 1)
                df_r = df_r[["排名", "title", "score"]]
                df_r.columns = ["排名", "标题", "BGE 分数"]
                st.dataframe(df_r, use_container_width=True, hide_index=True)

        # ── Step 4: 评分详情 ──
        s4 = trace.get("step4_scoring", {})
        t4 = timing.get("step4_scoring", 0)
        with st.expander(f"📊 Step 4: 评分详情（{t4}s）", expanded=False):
            col_g, col_h, col_i, col_j = st.columns(4)
            with col_g:
                st.metric("重排输入", s4.get("before_threshold", 0))
            with col_h:
                st.metric("阈值过滤", s4.get("filtered_by_threshold", 0))
            with col_i:
                st.metric("最终入选", s4.get("after_threshold", 0))
            with col_j:
                st.metric("综述占比", s4.get("survey_count", 0))

            # 分数分布图
            dist = s4.get("score_distribution", {})
            if dist.get("bins"):
                import pandas as pd
                df_dist = pd.DataFrame({
                    "分数区间": [f"{dist['bins'][i]:.1f}~{dist['bins'][i+1]:.1f}" for i in range(len(dist['counts']))],
                    "论文数": dist["counts"],
                })
                st.markdown("**最终分数分布:**")
                st.bar_chart(df_dist.set_index("分数区间"))

            top10_score = s4.get("top10_breakdown", [])
            if top10_score:
                st.markdown("**最终 Top 10 分数分解:**")
                import pandas as pd
                df_s = pd.DataFrame(top10_score)
                df_s["排名"] = range(1, len(df_s) + 1)
                df_s["综述"] = df_s["is_survey"].apply(lambda x: "是" if x else "否")
                df_s = df_s[["排名", "title", "final_score", "rerank_score", "cited_by", "year", "综述"]]
                df_s.columns = ["排名", "标题", "最终分", "BGE分", "被引量", "年份", "综述"]
                st.dataframe(df_s, use_container_width=True, hide_index=True)

        st.divider()


def render_results(project_id: int):
    """渲染已检索到的论文列表"""

    # 显示扩展的检索词
    queries = st.session_state.get("trunk_queries", [])
    if queries:
        render_query_tags(queries)
        reasoning = st.session_state.get("trunk_reasoning", "")
        if reasoning:
            with st.expander("💡 LLM 扩展思路", expanded=False):
                st.write(reasoning)
        st.divider()

    # 从数据库加载论文
    with get_session() as session:
        papers_query = (
            session.query(Paper)
            .filter_by(project_id=project_id, stage="trunk")
        )
        total_count = papers_query.count()

        if total_count == 0:
            st.info("📭 尚未执行检索，请点击上方按钮开始。")
            return

        # 统计数据
        current_year = datetime.now().year
        survey_count = papers_query.filter_by(is_survey=True).count()
        high_cited_count = papers_query.filter(Paper.cited_by_count > 100).count()
        recent_count = papers_query.filter(Paper.year >= current_year - 3).count()
        cart_count = (
            session.query(CartItem).filter_by(project_id=project_id).count()
        )

        # 提前加载数据，避免 session 关闭后 lazy load 失败
        stats = {
            "total": total_count,
            "survey": survey_count,
            "high_cited": high_cited_count,
            "recent": recent_count,
            "cart": cart_count,
        }

    # ── 布局：左侧论文列表 + 右侧统计 ──
    col_list, col_stats = st.columns([3, 1])

    with col_stats:
        render_stats_panel(
            total_papers=stats["total"],
            survey_count=stats["survey"],
            high_cited_count=stats["high_cited"],
            recent_count=stats["recent"],
            cart_count=stats["cart"],
        )

    with col_list:
        # 筛选和排序控制
        filter_col1, filter_col2, filter_col3 = st.columns(3)

        with filter_col1:
            sort_option = st.selectbox(
                "排序方式",
                ["相关度 (高→低)", "被引量 (高→低)", "年份 (新→旧)", "年份 (旧→新)"],
                index=0,
                key="trunk_sort",
            )
        with filter_col2:
            filter_survey = st.selectbox(
                "论文类型",
                ["全部", "仅综述", "非综述"],
                key="trunk_filter_survey",
            )
        with filter_col3:
            min_citations = st.number_input(
                "最低被引量",
                min_value=0,
                max_value=10000,
                value=0,
                step=10,
                key="trunk_min_cite",
            )

        # 构建查询
        with get_session() as session:
            q = session.query(Paper).filter_by(
                project_id=project_id, stage="trunk"
            )

            # 筛选
            if filter_survey == "仅综述":
                q = q.filter_by(is_survey=True)
            elif filter_survey == "非综述":
                q = q.filter_by(is_survey=False)

            if min_citations > 0:
                q = q.filter(Paper.cited_by_count >= min_citations)

            # 排序
            if sort_option == "相关度 (高→低)":
                # MySQL 兼容：ISNULL=1(NULL) 排后面，非 NULL 按 trunk_score 降序
                q = q.order_by(
                    func.isnull(Paper.trunk_score).asc(),
                    desc(Paper.trunk_score),
                )
            elif sort_option == "被引量 (高→低)":
                q = q.order_by(Paper.cited_by_count.desc())
            elif sort_option == "年份 (新→旧)":
                q = q.order_by(Paper.year.desc())
            elif sort_option == "年份 (旧→新)":
                q = q.order_by(Paper.year.asc())

            # 分页
            page_size = 20
            page_num = st.session_state.get("trunk_page", 0)
            papers = q.offset(page_num * page_size).limit(page_size).all()

            # 提前提取完整数据，避免 session 关闭后报错
            papers_data = []
            for p in papers:
                papers_data.append({
                    "id": p.id,
                    "title": p.title,
                    "authors": p.authors,
                    "year": p.year,
                    "venue": p.venue,
                    "doi": p.doi,
                    "arxiv_id": p.arxiv_id,
                    "abstract": p.abstract,
                    "cited_by_count": p.cited_by_count,
                    "is_survey": p.is_survey,
                })

            filtered_total = q.count()

        # 显示论文卡片
        st.caption(f"共 {filtered_total} 篇（当前第 {page_num + 1} 页）")

        for pd in papers_data:
            _render_trunk_card(project_id, pd)

        # 翻页按钮
        max_page = max(0, (filtered_total - 1) // page_size)
        pg_col1, pg_col2, pg_col3 = st.columns([1, 2, 1])
        with pg_col1:
            if page_num > 0:
                if st.button("⬅️ 上一页", key="trunk_prev"):
                    st.session_state["trunk_page"] = page_num - 1
                    st.rerun()
        with pg_col3:
            if page_num < max_page:
                if st.button("下一页 ➡️", key="trunk_next"):
                    st.session_state["trunk_page"] = page_num + 1
                    st.rerun()


def _render_add_to_cart_button(project_id: int, paper_data: dict):
    """渲染"加入骨架"按钮，点击时调用 AI 建议分类后加入"""
    paper_id = paper_data["id"]
    btn_key = f"cart_add_{paper_id}"

    # 已经在骨架中 → 显示已加入
    if cart_svc.is_in_cart(project_id, paper_id):
        st.button("✅ 已加入", key=btn_key, disabled=True, use_container_width=True)
        return

    # 骨架已满 → 禁用
    if cart_svc.is_full(project_id):
        st.button("📥 骨架已满", key=btn_key, disabled=True, use_container_width=True)
        return

    # 点击加入
    if st.button("📥 加入骨架", key=btn_key, use_container_width=True):
        # 从数据库获取完整的 Paper 对象（用于 AI 分类）
        with get_session() as session:
            paper = session.get(Paper, paper_id)
            if paper:
                suggestion = cart_svc.suggest_category(paper)
                category = suggestion.get("suggested_category", "mainstream")
                reason = suggestion.get("reason", "")

                result = cart_svc.add(project_id, paper_id, category)
                if result.get("ok"):
                    counts = result.get("counts", {})
                    total = sum(counts.values())
                    cat_label = {"foundation": "奠基理论", "mainstream": "主流方法", "frontier": "最新前沿"}
                    st.toast(
                        f"已加入 {cat_label.get(category, category)} "
                        f"（{total}/20）\n{reason}",
                        icon="📦",
                    )
                    st.rerun()
                else:
                    st.toast(result.get("error", "加入失败"), icon="⚠️")


def _render_trunk_card(project_id: int, paper_data: dict):
    """渲染单篇论文卡片（从 dict 数据渲染，不依赖 ORM session）"""
    with st.container(border=True):
        col_title, col_tags = st.columns([5, 2])

        with col_title:
            st.markdown(f"**{paper_data['title']}**")

        with col_tags:
            tags = []
            if paper_data.get("is_survey"):
                tags.append("📖 综述")
            if paper_data.get("arxiv_id"):
                tags.append("📄 arXiv")
            if paper_data.get("cited_by_count", 0) > 100:
                tags.append("🔥 高被引")
            st.caption(" · ".join(tags) if tags else "")

        # 作者 + 元信息
        authors = paper_data.get("authors", [])
        if isinstance(authors, list) and authors:
            display = ", ".join(authors[:3])
            if len(authors) > 3:
                display += f" 等 {len(authors)} 人"
        else:
            display = ""

        meta = []
        if paper_data.get("venue"):
            meta.append(paper_data["venue"])
        if paper_data.get("year"):
            meta.append(str(paper_data["year"]))
        if paper_data.get("cited_by_count"):
            meta.append(f"被引 {paper_data['cited_by_count']}")
        if display:
            meta.append(display)
        st.caption(" · ".join(meta))

        # 摘要（默认展开，完整阅读）
        abstract = paper_data.get("abstract", "")
        if abstract:
            with st.expander("📋 摘要", expanded=True):
                st.write(abstract)

        # 操作按钮
        btn_cols = st.columns(4)
        with btn_cols[0]:
            _render_add_to_cart_button(project_id, paper_data)
        with btn_cols[1]:
            if paper_data.get("doi"):
                st.link_button(
                    "🔗 DOI",
                    f"https://doi.org/{paper_data['doi']}",
                    use_container_width=True,
                )
        with btn_cols[2]:
            arxiv_id = paper_data.get("arxiv_id")
            if arxiv_id:
                arxiv_url = f"https://arxiv.org/abs/{arxiv_id}"
                st.link_button("📄 arXiv", arxiv_url, use_container_width=True)
        with btn_cols[3]:
            title = paper_data.get("title", "")
            if title:
                scholar_url = f"https://scholar.google.com/scholar?q={urllib.parse.quote(title[:120])}"
                st.link_button("🌐 搜索", scholar_url, use_container_width=True)
