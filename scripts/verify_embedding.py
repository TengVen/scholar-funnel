"""
验证 embedding 链路：
1. bge-large-zh-v1.5 能否加载并生成 1024 维向量
2. 中文 query → 英文论文 跨语言匹配是否有效（价值点 1 核心场景）
3. 向量写入 PG + pgvector 余弦检索
"""
import sys
sys.path.insert(0, r"F:/New_Python/paper")

from retrieval.embedding import get_embedder

# 1. 模型加载 + 向量化
embedder = get_embedder()
texts = [
    "A Survey of Deep Retrieval Augmented Generation and Reasoning in Large Language Models",
    "Temperature Scaling: An Effective Calibration Method for Deep Neural Networks",
    "Attention Is All You Need",
    "Wasserstein GAN",
]
vecs = embedder.encode(texts)
print(f"✓ 模型加载成功，向量维度: {len(vecs[0])}")

# 2. 跨语言 sanity check：中文 query 应该匹配英文论文
query_zh = "深度神经网络中的温度标定方法"
q_vec = embedder.encode_one(query_zh)

import numpy as np
qs = np.array(q_vec)
scores = []
for i, v in enumerate(vecs):
    sim = float(np.dot(qs, np.array(v)))  # 已归一化，点积=余弦
    scores.append((i, sim, texts[i][:50]))

scores.sort(key=lambda x: -x[1])
print(f"\n中文 query「{query_zh}」的向量匹配 Top 3：")
for i, s, t in scores[:3]:
    print(f"  {s:.3f}  {t}")

# 3. 向量写入 PG + 余弦检索
from sqlalchemy import create_engine, text
engine = create_engine("postgresql+psycopg://postgres:123456@localhost:5432/agent")
with engine.begin() as conn:
    # 清测试数据（幂等）
    conn.execute(text("DELETE FROM ai_papers WHERE id < 0"))
    # 写一条测试向量
    conn.execute(
        text("INSERT INTO ai_papers (id, project_id, openalex_id, title, embedding) "
             "VALUES (-1, 1, 'TEST_EMB', 'temperature scaling calibration', :vec)"),
        {"vec": q_vec},
    )
    # 余弦检索
    row = conn.execute(
        text("SELECT title, embedding <=> :q AS dist FROM ai_papers WHERE id = -1"),
        {"q": q_vec},
    ).first()
    print(f"\n✓ PG 向量写入+检索成功: title={row[0]}, 距离(0=最相似)={row[1]:.4f}")
    conn.execute(text("DELETE FROM ai_papers WHERE id < 0"))
print("\n🎉 embedding 链路验证完成")
