"""
分支深挖 Tab —— 验证骨架论文的方法论覆盖
三种模式：探针匹配 / AI 推荐探针 / 全景扫描
"""
import streamlit as st

from agents import branch as branch_svc
from storage import cart as cart_svc
from utils.log import setup_logger

logger = setup_logger("page_branch")

# ── 模式说明 ──
MODE_INFO = {
    branch_svc.MODE_PROBE: {
        "icon": "🎯",
        "label": "探针匹配",
        "desc": "输入技术探针，检查骨架论文是否使用了该技术",
        "probe_required": True,
    },
    branch_svc.MODE_AI_SUGGEST: {
        "icon": "🤖",
        "label": "AI 推荐探针",
        "desc": "AI 扫描骨架论文，推荐共同的技术关键词作为探针",
        "probe_required": False,
    },
    branch_svc.MODE_LANDSCAPE: {
        "icon": "🗺️",
        "label": "全景扫描",
        "desc": "无探针，提取每篇论文的核心方法论，绘制技术全景图",
        "probe_required": False,
    },
}


def render(project_id: int):
    """渲染分支深挖页面"""
    st.subheader("🔬 分支深挖")

    # ── 模式选择 + 探针输入 ──
    mode, probe = _render_controls(project_id)

    # ── 执行分析 ──
    results = _run_or_load(project_id, mode, probe)

    # ── 结果展示 ──
    if results:
        _render_results(project_id, results, mode, probe)
    else:
        _render_empty_hint(project_id)


def _render_controls(project_id: int) -> tuple[str, str]:
    """渲染模式选择和探针输入，返回 (mode, probe)"""

    with st.container(border=True):
        # ── 模式选择 ──
        st.markdown("**选择分析模式**")
        mode_cols = st.columns(3)
        selected_mode = branch_svc.MODE_PROBE  # 默认

        for idx, (mode_key, info) in enumerate(MODE_INFO.items()):
            with mode_cols[idx]:
                if st.button(
                    f"{info['icon']} {info['label']}",
                    key=f"mode_{mode_key}",
                    use_container_width=True,
                    type="primary" if st.session_state.get("branch_mode") == mode_key else "secondary",
                ):
                    st.session_state["branch_mode"] = mode_key

        # 使用 session_state 中的模式
        selected_mode = st.session_state.get("branch_mode", branch_svc.MODE_PROBE)
        info = MODE_INFO[selected_mode]
        st.caption(f"{info['icon']} {info['desc']}")

        # ── 探针输入（probe_match 模式必填） ──
        probe = ""
        if info["probe_required"]:
            # 从项目获取默认探针
            default_probe = branch_svc.get_project_probe(project_id)
            probe = st.text_input(
                "技术探针",
                value=default_probe,
                placeholder="如：Transformer、LSTM、GAN、PDE 约束...",
                key="branch_probe_input",
                help="输入你关注的技术方法，用于匹配骨架论文",
            )
        else:
            # 非必填，但也允许输入
            probe = st.text_input(
                "技术探针（可选）",
                value="",
                placeholder="输入探针可提高匹配精度...",
                key="branch_probe_optional",
            )

        # ── 骨架状态 ──
        count = cart_svc.get_total(project_id)
        if count > 0:
            counts = cart_svc.get_counts(project_id)
            st.caption(
                f"📦 当前骨架 {count}/20 篇 "
                f"（奠基 {counts.get('foundation', 0)} / "
                f"主流 {counts.get('mainstream', 0)} / "
                f"前沿 {counts.get('frontier', 0)}）"
            )
        else:
            st.warning("骨架为空，请先从主干检索中选择论文加入骨架。")

    return selected_mode, probe


def _run_or_load(
    project_id: int, mode: str, probe: str,
) -> list[branch_svc.BranchPaperResult]:
    """执行分析或加载已有结果"""

    # 检查是否有存储的结果
    stored = branch_svc.get_stored_results(project_id)
    analyze_key = f"branch_analyze_{project_id}"

    # ── 分析按钮 ──
    btn_label = "🔍 开始分析"
    if mode == branch_svc.MODE_PROBE:
        btn_label = f"🎯 探针匹配分析"
    elif mode == branch_svc.MODE_AI_SUGGEST:
        btn_label = "🤖 AI 推荐分析"
    else:
        btn_label = "🗺️ 全景扫描分析"

    can_analyze = True
    if mode == branch_svc.MODE_PROBE and not probe:
        can_analyze = False
        st.info("💡 请输入技术探针后点击分析")

    if st.button(
        btn_label,
        type="primary",
        use_container_width=True,
        disabled=not can_analyze,
        key="btn_branch_analyze",
    ):
        # 执行分析
        results = _execute_analysis(project_id, mode, probe)
        st.session_state[analyze_key] = results
        return results

    # 如果 session_state 中有结果，返回
    if analyze_key in st.session_state:
        return st.session_state[analyze_key]

    # 返回已有存储结果
    return stored


def _execute_analysis(
    project_id: int, mode: str, probe: str,
) -> list[branch_svc.BranchPaperResult]:
    """执行分支分析并显示进度"""
    progress_bar = st.progress(0, text="准备分析...")
    status_text = st.empty()

    def on_progress(current, total, title):
        pct = current / total
        progress_bar.progress(pct, text=f"分析中 {current}/{total}")
        status_text.caption(f"📄 {title[:60]}...")

    try:
        with st.spinner("正在分析骨架论文..."):
            results = branch_svc.run_analysis(
                project_id=project_id,
                mode=mode,
                probe=probe,
                on_progress=on_progress,
            )

        progress_bar.progress(1.0, text="分析完成！")
        status_text.success(f"✅ 完成 {len(results)} 篇论文分析")
        return results

    except ValueError as e:
        st.error(f"❌ {e}")
        return []
    except Exception as e:
        logger.error(f"分支分析失败: {e}")
        st.error(f"❌ 分析失败：{e}")
        return []


def _render_results(
    project_id: int,
    results: list[branch_svc.BranchPaperResult],
    mode: str,
    probe: str,
):
    """渲染分析结果"""
    st.divider()

    # ── 汇总统计 ──
    _render_summary(results, mode, probe)

    # ── 结果列表 ──
    # 排序：匹配的排前面
    sorted_results = sorted(
        results,
        key=lambda r: (
            0 if r.probe_match else 1,
            {"high": 0, "medium": 1, "low": 2, "none": 3}.get(r.probe_confidence, 4),
        ),
    )

    for result in sorted_results:
        _render_result_card(project_id, result, mode)


def _render_summary(
    results: list[branch_svc.BranchPaperResult],
    mode: str,
    probe: str,
):
    """渲染汇总统计"""
    total = len(results)
    matched = sum(1 for r in results if r.probe_match)
    high_conf = sum(1 for r in results if r.probe_confidence == "high")

    # 内容来源统计
    level_counts = {}
    for r in results:
        src = branch_svc.get_content_level_label(r.content_level)
        level_counts[src] = level_counts.get(src, 0) + 1

    if mode == branch_svc.MODE_PROBE:
        st.markdown(f"**🎯 探针匹配结果：「{probe}」**")
        cols = st.columns(4)
        cols[0].metric("论文总数", total)
        cols[1].metric("命中探针", matched)
        cols[2].metric("高度匹配", high_conf)
        cols[3].metric(
            "命中率",
            f"{matched / total * 100:.0f}%" if total > 0 else "0%",
        )
    elif mode == branch_svc.MODE_LANDSCAPE:
        st.markdown("**🗺️ 技术全景扫描结果**")
        cols = st.columns(3)
        cols[0].metric("论文总数", total)
        cols[1].metric("成功分析", sum(1 for r in results if r.method_summary))
        cols[2].metric(
            "内容来源",
            " | ".join(f"{src} {cnt}" for src, cnt in level_counts.items()),
        )
    else:
        st.markdown("**🤖 AI 探针推荐结果**")
        st.metric("已分析论文", total)

    # 内容来源分布
    with st.expander("📊 内容来源分布", expanded=False):
        for src, cnt in level_counts.items():
            st.caption(f"  {src}: {cnt} 篇")


def _render_result_card(
    project_id: int,
    result: branch_svc.BranchPaperResult,
    mode: str,
):
    """渲染单篇论文的分析结果卡片"""
    with st.container(border=True):
        # ── 标题行 ──
        title_col, badge_col = st.columns([4, 1])
        with title_col:
            st.markdown(f"**{result.title[:80]}{'...' if len(result.title) > 80 else ''}**")
        with badge_col:
            if mode == branch_svc.MODE_PROBE:
                emoji, label = branch_svc.get_confidence_label(result.probe_confidence)
                if result.probe_match:
                    st.success(f"{emoji} {label}")
                else:
                    st.caption(f"{emoji} {label}")

        # ── 元信息 ──
        meta = []
        if result.year:
            meta.append(str(result.year))
        if result.venue:
            meta.append(result.venue)
        if result.cited_by_count:
            meta.append(f"被引 {result.cited_by_count}")
        if result.authors:
            display = ", ".join(result.authors[:3])
            if len(result.authors) > 3:
                display += f" 等 {len(result.authors)} 人"
            meta.append(display)
        if meta:
            st.caption(" · ".join(meta))

        # ── 方法论摘要 ──
        if result.method_summary:
            st.markdown(f"**方法论**：{result.method_summary}")

        # ── 内容来源 ──
        level_label = branch_svc.get_content_level_label(result.content_level)
        st.caption(f"分析来源：{level_label}")

        # ── 详细信息 ──
        detail_parts = []
        if result.key_findings:
            detail_parts.append(f"**关键发现**：{result.key_findings}")
        if result.optimization_method:
            if mode == branch_svc.MODE_AI_SUGGEST:
                detail_parts.append(f"**推荐探针**：{result.optimization_method}")
            elif mode == branch_svc.MODE_LANDSCAPE:
                detail_parts.append(f"**方法类别**：{result.optimization_method}")
            else:
                detail_parts.append(f"**优化方式**：{result.optimization_method}")
        if result.error:
            detail_parts.append(f"**错误**：{result.error}")

        if detail_parts:
            with st.expander("📋 详细分析", expanded=False):
                for part in detail_parts:
                    st.markdown(part)
                if result.abstract:
                    st.markdown("**摘要**：")
                    st.write(result.abstract)

        # ── 操作按钮 ──
        _render_action_buttons(project_id, result, mode)


def _render_action_buttons(
    project_id: int,
    result: branch_svc.BranchPaperResult,
    mode: str,
):
    """渲染操作按钮"""
    pid = result.paper_id
    btn_cols = st.columns([1, 1, 1, 1])

    with btn_cols[0]:
        # 外部链接
        if result.doi:
            st.link_button(
                "🔗 DOI",
                f"https://doi.org/{result.doi}",
                use_container_width=True,
                key=f"branch_doi_{pid}",
            )

    with btn_cols[1]:
        # Google Scholar
        if result.title:
            import urllib.parse
            url = f"https://scholar.google.com/scholar?q={urllib.parse.quote(result.title[:120])}"
            st.link_button("🌐 搜索", url, use_container_width=True, key=f"branch_scholar_{pid}")

    with btn_cols[2]:
        # 加入骨架（如果尚未加入）
        if not cart_svc.is_in_cart(project_id, pid):
            if not cart_svc.is_full(project_id):
                if st.button(
                    "📥 加入骨架",
                    key=f"branch_add_{pid}",
                    use_container_width=True,
                ):
                    suggested = "mainstream"
                    r = cart_svc.add(project_id, pid, suggested)
                    if r.get("ok"):
                        st.toast(f"已加入主流方法（{sum(r['counts'].values())}/20）", icon="📦")
                        st.rerun()
                    else:
                        st.toast(r.get("error", "加入失败"), icon="⚠️")
            else:
                st.button("📥 骨架已满", disabled=True, key=f"branch_full_{pid}", use_container_width=True)
        else:
            st.button("✅ 已加入", disabled=True, key=f"branch_done_{pid}", use_container_width=True)

    with btn_cols[3]:
        # 在骨架中切换分类
        if cart_svc.is_in_cart(project_id, result.paper_id):
            st.caption("已在骨架中")
        else:
            st.caption("")


def _render_empty_hint(project_id: int):
    """骨架为空时的提示"""
    count = cart_svc.get_total(project_id)
    if count == 0:
        st.info(
            "📭 骨架为空。\n\n"
            "请先在 **🔭 主干检索** 中检索论文，"
            "然后将感兴趣的论文加入骨架。\n\n"
            "加入后再回到此页面进行分支深挖分析。"
        )
    else:
        st.info(
            "💡 **分支深挖** 对骨架中的论文进行全文分析，"
            "验证它们是否使用了你关注的技术方法。\n\n"
            "选择一个分析模式，然后点击 **开始分析**。"
        )
