"""
兼容壳子：旧入口统一转发到 retrieval.pipeline
其他模块如果 from agents.search import run_trunk_search 不会报错
"""
from retrieval.pipeline import TrunkSearchEngine

_engine = TrunkSearchEngine()


def run_trunk_search(
    project_id: int,
    user_query: str,
    tech_probe: str = "",
    per_query: int = 50,
    year_from: int | None = None,
    year_to: int | None = None,
) -> dict:
    return _engine.search(
        project_id=project_id,
        user_query=user_query,
        tech_probe=tech_probe,
        per_query=per_query,
        year_from=year_from,
        year_to=year_to,
    )