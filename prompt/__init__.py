"""
提示词集中管理 —— 所有 LLM 提示词统一存放，按模块细分

目录结构：
  prompt/
  ├── retrieval.py   检索链路（意图拆解）
  ├── chat_agent.py  主 Agent（系统提示词）
  ├── branch.py      分支深挖分析 ×3
  ├── cart.py        骨架（AI 分类/摘要/诊断）×3
  └── funnel/        漏斗编排（意图/探针/骨架）×5

修改提示词只需改这里，业务代码不动。
"""
