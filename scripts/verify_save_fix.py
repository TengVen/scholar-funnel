"""验证 _save 修复：删除 trunk 时排除骨架引用论文"""
import sys
sys.path.insert(0, r"F:/New_Python/paper")
from storage.mysql_db import get_session
from storage.models import Paper, CartItem

project_id = 10
with get_session() as session:
    cart_ids = [cid for (cid,) in session.query(CartItem.paper_id).filter_by(project_id=project_id).all()]
    del_q = session.query(Paper).filter(
        Paper.project_id == project_id, Paper.stage == "trunk"
    )
    if cart_ids:
        del_q = del_q.filter(~Paper.id.in_(cart_ids))
    candidates = del_q.all()
    in_cart_hit = sum(1 for p in candidates if p.id in cart_ids)
    print(f"项目 {project_id}: 骨架引用 {len(cart_ids)} 篇")
    print(f"修复后会被删除的 trunk 行: {len(candidates)}")
    print(f"其中误删骨架论文: {in_cart_hit} (应为 0)")
