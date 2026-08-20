"""
骨架清单 Tab —— 三列布局、AI 诊断、导出、管理交互
"""
import streamlit as st
import urllib.parse

from storage import cart as cart_svc
from utils.log import setup_logger

logger = setup_logger("page_cart")

CATEGORIES = [
    ("foundation", "🏛️ 奠基理论", 5),
    ("mainstream", "🔬 主流方法", 10),
    ("frontier", "🚀 最新前沿", 5),
]

CAT_LABEL = {"foundation": "奠基理论", "mainstream": "主流方法", "frontier": "最新前沿"}
CAT_ICON = {"foundation": "🏛️", "mainstream": "🔬", "frontier": "🚀"}

TOTAL_LIMIT = 20


def render(project_id: int):
    """渲染骨架清单页面"""
    # ── 顶部：进度 + AI 诊断 + 导出按钮 ──
    _render_header(project_id)

    # ── 三列布局 ──
    items = cart_svc.get_items(project_id)
    if not items:
        st.info("📭 骨架为空。从主干检索结果中点击 **「加入骨架」** 开始构建。")
        return

    grouped = {"foundation": [], "mainstream": [], "frontier": []}
    for item in items:
        grouped.get(item["category"], []).append(item)

    cols = st.columns(3)
    for idx, (cat_key, cat_label, cat_limit) in enumerate(CATEGORIES):
        with cols[idx]:
            cat_items = grouped.get(cat_key, [])
            count = len(cat_items)
            filled_pct = min(count / cat_limit, 1.0)

            # 分类标题 + 进度
            st.markdown(f"**{cat_label}**")
            st.progress(filled_pct, text=f"{count}/{cat_limit}")

            # 论文卡片列表
            for item in cat_items:
                _render_cart_card(project_id, item)

            # 空位提示
            if count < cat_limit:
                remaining = cat_limit - count
                st.caption(f"还可添加 {remaining} 篇")
                st.markdown("&nbsp;")


def _render_header(project_id: int):
    """渲染头部：进度条、AI 诊断、导出"""
    counts = cart_svc.get_counts(project_id)
    total = cart_svc.get_total(project_id)
    full = total >= TOTAL_LIMIT

    # ── 第一行：总体进度 ──
    col_pg, col_btn = st.columns([3, 2])
    with col_pg:
        st.markdown(f"### 📦 核心骨架 ({total}/{TOTAL_LIMIT})")
        st.progress(min(total / TOTAL_LIMIT, 1.0),
                    text=f"{'✅ 已满！' if full else '还可添加 ' + str(TOTAL_LIMIT - total) + ' 篇'}")

    with col_btn:
        st.markdown("&nbsp;")
        st.markdown("&nbsp;")
        # 导出按钮（满 1 篇才可用）
        if total >= 1:
            bibtex = cart_svc.export_bibtex(project_id)
            st.download_button(
                label="📖 导出 BibTeX",
                data=bibtex,
                file_name=f"scholar_funnel_cart_{project_id}.bib",
                mime="text/plain",
                use_container_width=True,
            )

    # ── 第二行：AI 诊断 ──
    if total >= 3:
        with st.spinner("🔍 正在分析骨架结构..."):
            diagnosis = cart_svc.diagnose(project_id)
        _render_diagnosis(diagnosis)


def _render_diagnosis(diag: dict):
    """渲染 AI 诊断结果"""
    verdict = diag.get("verdict", "overall")
    issues = diag.get("issues", [])
    suggestions = diag.get("suggestions", [])

    if verdict == "overall":
        emoji = "✅"
        label = "结构总体完整"
    elif verdict == "biased":
        emoji = "⚠️"
        label = "存在偏科"
    else:
        emoji = "❌"
        label = "结构不太完善"

    with st.expander(f"{emoji} AI 诊断：{label}", expanded=bool(issues)):
        if issues:
            for issue in issues[:3]:
                st.markdown(f"- ⚠️ {issue}")
        if suggestions:
            for s in suggestions[:3]:
                st.markdown(f"- 💡 {s}")


def _render_cart_card(project_id: int, item: dict):
    """渲染单篇骨架论文卡片"""
    card_key = f"cart_{item['paper_id']}"

    with st.container(border=True):
        # 标题
        title = item["title"]
        st.markdown(f"**{title[:80]}{'...' if len(title) > 80 else ''}**")

        # 元信息
        author_str = ""
        if item["authors"] and len(item["authors"]) > 0:
            display = item["authors"][:3]
            author_str = ", ".join(display)
            if len(item["authors"]) > 3:
                author_str += f" 等 {len(item['authors'])} 人"

        meta = []
        if item["venue"]:
            meta.append(item["venue"])
        if item["year"]:
            meta.append(str(item["year"]))
        if item["cited_by_count"]:
            meta.append(f"被引 {item['cited_by_count']}")
        if author_str:
            meta.append(author_str)
        st.caption(" · ".join(meta))

        # 摘要（可折叠展开）
        if item["abstract"]:
            with st.expander("📋 查看摘要", expanded=False):
                st.write(item["abstract"])

        # 操作行
        op_cols = st.columns([1, 1, 1])

        with op_cols[0]:
            # 切换分类
            current_cat = item["category"]
            other_cats = [c for c in ["foundation", "mainstream", "frontier"] if c != current_cat]
            new_cat = st.selectbox(
                "分类",
                options=[current_cat] + other_cats,
                format_func=lambda x: CAT_LABEL.get(x, x),
                key=f"cat_{item['paper_id']}",
                label_visibility="collapsed",
            )
            if new_cat != current_cat:
                result = cart_svc.change_category(project_id, item["paper_id"], new_cat)
                if result.get("ok"):
                    st.rerun()
                else:
                    st.toast(result.get("error", "切换失败"), icon="⚠️")

        with op_cols[1]:
            # 外部链接
            if item["doi"]:
                st.link_button(
                    "🔗 DOI",
                    f"https://doi.org/{item['doi']}",
                    use_container_width=True,
                )

        with op_cols[2]:
            # 移除
            if st.button("🗑️ 移出", key=f"del_{item['paper_id']}", use_container_width=True):
                result = cart_svc.remove(project_id, item["paper_id"])
                if result.get("ok"):
                    st.rerun()
                else:
                    st.toast(result.get("error", "移除失败"), icon="⚠️")
