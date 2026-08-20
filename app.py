"""
Scholar Funnel — 文献高效检索智能工具
入口文件：streamlit run app.py
对话式交互：上半对话问询 → 确认 → 下方展示论文卡片
"""
import streamlit as st
import warnings
import logging

from storage.mysql_db import init_db
from utils.log import setup_logger
from ui import chat as chat_ui
from ui import page_trunk
from ui import page_cart
from ui import page_branch
from ui import page_network

# ── 初始化日志 ──
logger = setup_logger("app")

# 抑制 transformers 警告
logging.getLogger("transformers").setLevel(logging.ERROR)
warnings.filterwarnings("ignore", category=UserWarning, module="transformers")

# ── 页面基础配置 ──
st.set_page_config(
    page_title="Scholar Funnel",
    page_icon="💬",
    layout="wide",
    initial_sidebar_state="expanded",
)


def init_app():
    """应用初始化（仅执行一次）"""
    if "db_initialized" not in st.session_state:
        logger.info("Scholar Funnel 启动中...")
        init_db()
        st.session_state.db_initialized = True


def main():
    init_app()
    chat_ui.render_sidebar()

    # ── 上半：对话区 ──
    chat_ui.render_chat()

    # ── 检索状态条（独立于对话和结果面板） ──
    _render_status_bar()

    # ── 分割线 ──
    st.divider()

    # ── 下方的论文卡片面板 ──
    _render_results_panel()


def _render_status_bar():
    """渲染检索状态条（对话区下方，结果面板上方）"""
    project_id = chat_ui.get_active_project_id()
    if not project_id:
        return

    summary = chat_ui.get_search_summary(project_id)
    if not summary:
        return

    total = summary.get("total", 0)
    survey = summary.get("survey", 0)
    timing = summary.get("timing", {})
    queries = summary.get("queries", [])

    parts = [f"✅ **检索完成** — {total} 篇", f"综述 {survey} 篇"]
    if timing.get("total"):
        parts.append(f"⏱️ {timing['total']}s")
    if queries:
        parts.append(f"🔍 {' | '.join(queries[:4])}")
        if len(queries) > 4:
            parts[-1] += f" 等 {len(queries)} 组"

    st.info(" · ".join(parts), icon=None)


def _render_results_panel():
    """渲染下方结果面板：主干检索卡片 + 待实现模块占位"""
    project_id = chat_ui.get_active_project_id()

    tab1, tab2, tab3, tab4 = st.tabs([
        "🔭 主干检索",
        "🔬 分支深挖",
        "🕸️ 网络图谱",
        "📦 骨架清单",
    ])

    with tab1:
        if project_id:
            page_trunk.render_results(project_id)
        else:
            st.info("💡 完成一次对话检索后，论文结果将在这里展示，可以筛选、排序、查看摘要和全文。")

    with tab2:
        if project_id:
            page_branch.render(project_id)
        else:
            st.info("🔬 请先完成主干检索，然后将论文加入骨架，再进行分支深挖分析。")

    with tab3:
        if project_id:
            page_network.render(project_id)
        else:
            st.info("🕸️ 请先完成主干检索并加入骨架，此模块将基于引用关系发现遗漏论文。")

    with tab4:
        if project_id:
            page_cart.render(project_id)
        else:
            st.info("💡 完成一次对话检索后，可以在此将论文加入骨架，构建核心知识支架。")


if __name__ == "__main__":
    main()
