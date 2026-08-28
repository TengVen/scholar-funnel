"""
OpenAlex filter 语法回归测试（lexical._build_layered_jobs）

背景（2026-08-26）：原写法 `title.search:A|abstract.search:A` 是 OpenAlex
不支持的 "OR query between filters" → 400 Bad Request。本测试锁死修复后形态：

  - 核心路：`default.search:"A",default.search:"B"`（逗号 AND，同字段重复合法）
  - 同义/辅助路：`default.search:"A"|"B"`（值内 OR，字段前缀只出现一次）
  - 铁律：filter 表达式中，`|` 分割后的非首段不得包含 `:`（否则就是 filter 间 OR 非法形态）

运行：D:\Anaconda\envs\paper\python.exe scripts/test_lexical_filters.py
"""
import sys
sys.path.insert(0, ".")

from retrieval.lexical import LexicalRetriever
from retrieval.intent import ResearchIntent, MethodologyDim, DomainDim

PASS = 0
FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ✓ {name}")
    else:
        FAIL += 1
        print(f"  ✗ {name}  {detail}")


def _make_intent():
    return ResearchIntent(
        raw_query="student modeling cognitive diagnosis temporal modeling reward design",
        tech_probe="",
        methodology=MethodologyDim(
            core=["student modeling", "cognitive diagnosis", "temporal modeling"],
            synonyms=["knowledge tracing", "DKT"],
            related=["deep learning", "graph neural network"],
        ),
        domain=DomainDim(
            core=["education"],
            synonyms=["intelligent tutoring system"],
            broader=["edtech"],
        ),
        paradigm="",
        combined_queries=["student modeling cognitive diagnosis temporal modeling"],
        reasoning="",
    )


def test_no_filter_inter_or():
    """铁律：filter 表达式中 | 分割后的非首段不得含 ':'（filter 间 OR 非法形态）"""
    print("[1] 禁止 filter 间 OR（400 根因回归）")
    lr = LexicalRetriever()
    jobs = lr._build_layered_jobs(_make_intent())
    check("至少生成 3 条 filter 路 + 1 条宽松路", len(jobs) >= 4)
    for q, f in jobs:
        if not f:
            continue
        parts = f.split("|")
        bad = [p for p in parts[1:] if ":" in p]
        check(f"filter 无 filter 间 OR: {f!r}", not bad, f"非法段: {bad}")


def test_core_and():
    """核心路：逗号 AND，多词共同出现"""
    print("[2] 核心路 = default.search 逗号 AND")
    lr = LexicalRetriever()
    jobs = lr._build_layered_jobs(_make_intent())
    core_filter = jobs[0][1]
    check("核心路含 default.search", "default.search:" in core_filter, core_filter)
    check("核心路逗号连接多词", "," in core_filter, core_filter)
    check("核心路不含 |（AND 语义）", "|" not in core_filter, core_filter)
    check("核心路词间 AND（多词各自 default.search）",
          core_filter.count("default.search:") >= 2, core_filter)


def test_syn_aux_or():
    """同义/辅助路：值内 OR，字段前缀只出现一次"""
    print("[3] 同义/辅助路 = default.search 值内 OR")
    lr = LexicalRetriever()
    jobs = lr._build_layered_jobs(_make_intent())
    # 找同义路（q 含 knowledge tracing）
    syn = next((f for q, f in jobs if f and "knowledge" in q), None)
    aux = next((f for q, f in jobs if f and "deep learning" in q), None)
    check("同义路存在", syn is not None)
    check("辅助路存在", aux is not None)
    for name, f in [("同义路", syn), ("辅助路", aux)]:
        check(f"{name} 值内 OR（含 |）", f and "|" in f, f)
        # 字段前缀只出现一次：| 分割后每段不再含 ":"（前面已断言），且以 default.search: 开头
        check(f"{name} 字段前缀仅一次", f and f.startswith("default.search:"), f)
        check(f"{name} 无 title/abstract.search", f and "title.search" not in f and "abstract.search" not in f, f)


def test_loose_queries():
    """宽松路：combined_queries 不带 filter"""
    print("[4] 宽松路不带 filter")
    lr = LexicalRetriever()
    jobs = lr._build_layered_jobs(_make_intent())
    loose = [q for q, f in jobs if f is None]
    check("宽松路存在且来自 combined_queries",
          any("student modeling cognitive" in q for q in loose))


if __name__ == "__main__":
    test_no_filter_inter_or()
    test_core_and()
    test_syn_aux_or()
    test_loose_queries()
    print(f"\n结果: {PASS} 通过, {FAIL} 失败")
    sys.exit(1 if FAIL else 0)
