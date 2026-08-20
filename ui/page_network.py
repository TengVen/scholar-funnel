"""
网络图谱 Tab —— 引用关系分析、论文推荐、力导向图可视化
"""
import json
import streamlit as st
import streamlit.components.v1 as components

from agents import network as network_svc
from storage import cart as cart_svc
from utils.log import setup_logger

logger = setup_logger("page_network")


def render(project_id: int):
    """渲染网络图谱页面"""
    st.subheader("🕸️ 网络图谱")

    # ── 分析控制 ──
    _render_controls(project_id)

    # ── 结果展示 ──
    result_key = f"network_result_{project_id}"
    result = st.session_state.get(result_key)

    if result:
        _render_results(project_id, result)
    else:
        _render_empty_hint(project_id)


def _render_controls(project_id: int):
    """渲染分析控制区"""
    with st.container(border=True):
        count = cart_svc.get_total(project_id)
        if count == 0:
            st.warning("骨架为空，请先从主干检索中选择论文加入骨架。")
            return

        st.caption(f"📦 当前骨架 {count}/20 篇")

        if st.button(
            "🕸️ 开始网络分析",
            type="primary",
            use_container_width=True,
            key="btn_network_analyze",
        ):
            _execute_analysis(project_id)


def _execute_analysis(project_id: int):
    """执行网络分析"""
    result_key = f"network_result_{project_id}"
    status_text = st.empty()

    def on_progress(step, detail):
        status_text.caption(f"⏳ {step}：{detail}")

    try:
        with st.spinner("正在分析引用网络..."):
            result = network_svc.run_analysis(
                project_id=project_id,
                on_progress=on_progress,
            )
        status_text.success("✅ 网络分析完成")
        st.session_state[result_key] = result
        st.rerun()

    except Exception as e:
        logger.error(f"网络分析失败: {e}")
        st.error(f"❌ 分析失败：{e}")


def _render_results(project_id: int, result: network_svc.NetworkResult):
    """渲染分析结果"""
    st.divider()

    # ── 统计概览 ──
    _render_stats(result)

    # ── 图谱可视化 ──
    _render_graph(result)

    # ── 推荐论文列表 ──
    tab_back, tab_forward = st.tabs([
        f"⬅️ 后向追溯（{len(result.backward)} 篇）",
        f"➡️ 前向追踪（{len(result.forward)} 篇）",
    ])

    with tab_back:
        _render_recommendations(project_id, result.backward, "backward")

    with tab_forward:
        _render_recommendations(project_id, result.forward, "forward")


def _render_stats(result: network_svc.NetworkResult):
    """渲染统计概览"""
    stats = result.stats
    cols = st.columns(4)
    cols[0].metric("骨架论文", stats.get("skeleton_count", 0))
    cols[1].metric("后向推荐", stats.get("backward_count", 0))
    cols[2].metric("前向推荐", stats.get("forward_count", 0))
    cols[3].metric("图谱节点", stats.get("graph_nodes", 0))


def _render_graph(result: network_svc.NetworkResult):
    """渲染 ECharts 力导向图"""
    if not result.graph_nodes:
        st.info("图谱节点不足，无法渲染。")
        return

    # 构建 ECharts 数据
    categories = [
        {"name": "skeleton", "itemStyle": {"color": "#E8A838"}},
        {"name": "backward", "itemStyle": {"color": "#FF7043"}},
        {"name": "forward", "itemStyle": {"color": "#42A5F5"}},
    ]

    nodes_data = []
    for node in result.graph_nodes:
        cat_idx = {"skeleton": 0, "backward": 1, "forward": 2}.get(node.category, 0)
        nodes_data.append({
            "id": node.id,
            "name": node.label,
            "symbolSize": node.size,
            "category": cat_idx,
            "value": node.year,
            "itemStyle": {"color": categories[cat_idx]["itemStyle"]["color"]},
        })

    links_data = []
    for edge in result.graph_edges:
        links_data.append({
            "source": edge.source_id,
            "target": edge.target_id,
            "label": {"show": False},
        })

    chart_option = {
        "tooltip": {
            "formatter": "function(params) { return params.name + ' (' + (params.value || '') + ')'; }",
        },
        "legend": {
            "data": ["骨架论文", "后向推荐", "前向推荐"],
            "top": 10,
        },
        "series": [{
            "type": "graph",
            "layout": "force",
            "roam": True,
            "label": {"show": True, "fontSize": 10, "position": "right"},
            "edgeSymbol": ["", "arrow"],
            "edgeSymbolSize": [0, 8],
            "force": {
                "repulsion": 200,
                "gravity": 0.1,
                "edgeLength": [50, 150],
                "layoutAnimation": True,
            },
            "data": nodes_data,
            "links": links_data,
            "categories": [
                {"name": "骨架论文"},
                {"name": "后向推荐"},
                {"name": "前向推荐"},
            ],
            "emphasis": {
                "focus": "adjacency",
                "lineStyle": {"width": 4},
            },
        }],
    }

    chart_html = f"""
    <div id="network_chart" style="width:100%;height:500px;"></div>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/echarts/5.5.0/echarts.min.js"></script>
    <script>
        var chart = echarts.init(document.getElementById('network_chart'));
        var option = {json.dumps(chart_option, ensure_ascii=False)};
        chart.setOption(option);
        window.addEventListener('resize', function() {{ chart.resize(); }});
    </script>
    """
    components.html(chart_html, height=520)


def _render_recommendations(
    project_id: int,
    papers: list[network_svc.RecommendedPaper],
    source: str,
):
    """渲染推荐论文列表"""
    if not papers:
        st.info("暂无推荐论文。")
        return

    for i, paper in enumerate(papers):
        with st.container(border=True):
            # 标题
            st.markdown(f"**{paper.title[:80]}{'...' if len(paper.title) > 80 else ''}**")

            # 元信息
            meta = []
            if paper.year:
                meta.append(str(paper.year))
            if paper.venue:
                meta.append(paper.venue)
            if paper.cited_by_count:
                meta.append(f"被引 {paper.cited_by_count}")
            if paper.authors:
                display = ", ".join(paper.authors[:3])
                if len(paper.authors) > 3:
                    display += f" 等 {len(paper.authors)} 人"
                meta.append(display)
            if meta:
                st.caption(" · ".join(meta))

            # 推荐理由
            if paper.reason:
                st.caption(f"💡 {paper.reason}")

            # 摘要
            if paper.abstract:
                with st.expander("📋 摘要", expanded=False):
                    st.write(paper.abstract[:500])

            # 操作按钮
            _render_rec_buttons(project_id, paper, i, source)


def _render_rec_buttons(
    project_id: int,
    paper: network_svc.RecommendedPaper,
    index: int,
    source: str,
):
    """渲染推荐论文的操作按钮"""
    import urllib.parse

    btn_cols = st.columns([1, 1, 1, 1])
    pid = f"net_{source}_{index}"

    with btn_cols[0]:
        if paper.doi:
            st.link_button(
                "🔗 DOI",
                f"https://doi.org/{paper.doi}",
                use_container_width=True,
                key=f"doi_{pid}",
            )

    with btn_cols[1]:
        if paper.title:
            url = f"https://scholar.google.com/scholar?q={urllib.parse.quote(paper.title[:120])}"
            st.link_button("🌐 搜索", url, use_container_width=True, key=f"scholar_{pid}")

    with btn_cols[2]:
        # 检查是否已在骨架中（通过 openalex_id 查数据库）
        in_cart = _is_in_cart_by_openalex(project_id, paper.openalex_id)
        if in_cart:
            st.button("✅ 已加入", disabled=True, key=f"done_{pid}", use_container_width=True)
        elif cart_svc.is_full(project_id):
            st.button("📥 骨架已满", disabled=True, key=f"full_{pid}", use_container_width=True)
        else:
            if st.button("📥 加入骨架", key=f"add_{pid}", use_container_width=True):
                # 先确保论文在数据库中
                db_paper_id = _ensure_paper_in_db(project_id, paper)
                if db_paper_id:
                    # 根据来源推荐分类
                    cat = "foundation" if source == "backward" else "frontier"
                    r = cart_svc.add(project_id, db_paper_id, cat)
                    if r.get("ok"):
                        cat_label = {"foundation": "奠基理论", "frontier": "最新前沿"}
                        st.toast(
                            f"已加入{cat_label.get(cat, cat)}（{sum(r['counts'].values())}/20）",
                            icon="📦",
                        )
                        st.rerun()
                    else:
                        st.toast(r.get("error", "加入失败"), icon="⚠️")
                else:
                    st.toast("论文入库失败", icon="⚠️")

    with btn_cols[3]:
        cited_info = ""
        if paper.cited_by_n > 0:
            cited_info = f"共引 {paper.cited_by_n}"
        elif paper.citing_n > 0:
            cited_info = f"引用 {paper.citing_n}"
        if cited_info:
            st.caption(cited_info)


def _is_in_cart_by_openalex(project_id: int, openalex_id: str) -> bool:
    """通过 openalex_id 检查论文是否已在骨架中"""
    from storage.mysql_db import get_session
    from storage.models import Paper, CartItem

    with get_session() as session:
        paper = session.query(Paper).filter_by(openalex_id=openalex_id).first()
        if not paper:
            return False
        return (
            session.query(CartItem)
            .filter_by(project_id=project_id, paper_id=paper.id)
            .first()
        ) is not None


def _ensure_paper_in_db(project_id: int, paper: network_svc.RecommendedPaper) -> int | None:
    """确保推荐论文在数据库中，返回 paper_id"""
    from storage.mysql_db import get_session
    from storage.models import Paper

    with get_session() as session:
        # 检查是否已存在
        existing = session.query(Paper).filter_by(openalex_id=paper.openalex_id).first()
        if existing:
            return existing.id

        # 新建
        new_paper = Paper(
            project_id=project_id,
            openalex_id=paper.openalex_id,
            title=paper.title,
            authors=paper.authors,
            year=paper.year,
            venue=paper.venue or None,
            doi=paper.doi or None,
            abstract=paper.abstract or None,
            cited_by_count=paper.cited_by_count,
            stage="trunk",
        )
        session.add(new_paper)
        session.flush()
        return new_paper.id


def _render_empty_hint(project_id: int):
    """骨架为空时的提示"""
    count = cart_svc.get_total(project_id)
    if count == 0:
        st.info(
            "📭 骨架为空。\n\n"
            "请先在 **🔭 主干检索** 中检索论文，"
            "然后将感兴趣的论文加入骨架。\n\n"
            "加入后再回到此页面进行网络分析。"
        )
    else:
        st.info(
            "🕸️ **网络图谱** 基于骨架论文的引用关系，发现你可能遗漏的重要论文。\n\n"
            "- **后向追溯**：找到被多篇骨架论文共同引用的奠基论文\n"
            "- **前向追踪**：找到近期引用了骨架论文的前沿工作\n\n"
            "点击 **开始网络分析** 启动。"
        )
