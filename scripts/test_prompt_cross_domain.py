"""
跨领域探针/全景分析测试（业务逻辑层，无需真实 LLM）

运行：
  D:\\Anaconda\\envs\\paper\\python.exe scripts/test_prompt_cross_domain.py

覆盖：
  - _compute_probe_match 业务层规则（Case 1-8 期望）
  - _normalize_usage_role / _normalize_evidence 校验
  - _analyze_probe_match（mock LLM）输出 usage_role / probe_match / evidence
  - _analyze_landscape（mock LLM）新 9 维 + evidence + optimization_method 留空
  - _simple_keyword_match 确定性 usage_role
  - generate_paper_profile 缓存读 / 写
"""
import json
import sys
from unittest.mock import patch, MagicMock

# 让脚本可从项目根目录运行
sys.path.insert(0, ".")

import agents.branch as branch
from agents.branch import (
    _compute_probe_match, _normalize_usage_role, _normalize_evidence,
    _simple_keyword_match, _analyze_probe_match, _analyze_landscape,
    generate_paper_profile, PaperProfile, StructuredFullText,
)

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


# ──────────────────────────────────────────────
#  1) 业务层 probe_match 规则（Case 1-8 映射）
# ──────────────────────────────────────────────
def test_compute_probe_match():
    print("[1] _compute_probe_match 业务规则")
    cases = [
        ("core", True),
        ("auxiliary", True),
        ("baseline", True),
        ("comparison", True),
        ("mentioned", False),
        ("none", False),
        ("UNKNOWN_ROLE", False),   # 非法值降级为 none → False
        ("", False),
    ]
    for role, expected in cases:
        got = _compute_probe_match(role)
        check(f"usage_role={role!r} → probe_match={expected}", got == expected)


# ──────────────────────────────────────────────
#  2) 规范化函数
# ──────────────────────────────────────────────
def test_normalizers():
    print("[2] 规范化函数")
    check("_normalize_usage_role 大写+空格",
          _normalize_usage_role("  CORE ") == "core")
    check("_normalize_usage_role 非法→none",
          _normalize_usage_role("foobar") == "none")
    check("_normalize_evidence 过滤非 dict",
          _normalize_evidence([{"section": "3", "description": "x"}, "junk", None]) ==
          [{"section": "3", "description": "x"}])
    check("_normalize_evidence 非 list→[]",
          _normalize_evidence({"a": 1}) == [])
    check("_normalize_evidence 截断>6",
          len(_normalize_evidence([{"section": str(i), "description": ""} for i in range(10)])) == 6)
    check("_normalize_evidence 缺字段补全",
          _normalize_evidence([{"section": "X"}]) == [{"section": "X", "description": ""}])


# ──────────────────────────────────────────────
#  3) 跨领域 8 个 Case：mock LLM 输出 → 验证解析
# ──────────────────────────────────────────────
# (探针, 论文实际方法描述, 论文内容, 期望 usage_role, 期望 probe_match)
PROBE_CASES = [
    # Case 1: AI, BERT 文本分类, 探针 Transformer → core/true
    ("Transformer", "We use BERT for text classification.",
     "3 Method\nWe fine-tune BERT and use it as the encoder for text classification.",
     "core", True),
    # Case 2: AI baseline, 提 CNN, BERT 作 baseline → baseline/true
    ("Transformer", "We propose a CNN and use BERT as a baseline.",
     "3 Method\nOur model is a CNN. We compare against BERT as a baseline.",
     "baseline", True),
    # Case 3: 仅提及, Related Work 讨论 Transformer, 实验用 CNN → mentioned/false
    ("Transformer", "Related Work discusses Transformer; we use CNN.",
     "2 Related Work\nTransformer-based approaches have been widely studied.\n"
     "3 Method\nWe build a CNN for the main experiments.",
     "mentioned", False),
    # Case 4: 医学 Cox regression → core/true
    ("Cox regression", "We adopt Cox proportional hazards model.",
     "3 Methods\nWe applied Cox proportional hazards regression to analyze survival.",
     "core", True),
    # Case 5: 经济学 DID → core/true
    ("Difference-in-Differences", "We use DID to evaluate policy.",
     "4 Identification\nWe exploit a Difference-in-Differences design with fixed effects.",
     "core", True),
    # Case 6: 材料 XRD 表征 → auxiliary/true
    ("XRD", "We characterize crystal structure via XRD.",
     "2 Experimental\nSamples were synthesized by CVD. XRD was used to characterize crystal structure.",
     "auxiliary", True),
    # Case 7: 无关方法, 用 Kaplan-Meier + Cox → none/false
    ("Transformer", "We use Kaplan-Meier and Cox regression.",
     "3 Methods\nSurvival was estimated by Kaplan-Meier and Cox regression.",
     "none", False),
    # Case 8: 方法族 参数高效微调, LoRA → core/true
    ("parameter-efficient fine-tuning", "We adapt the model with LoRA.",
     "3 Method\nWe apply LoRA, a parameter-efficient fine-tuning method, to adapt the pretrained model.",
     "core", True),
]


def _make_sft(content: str) -> StructuredFullText:
    return StructuredFullText(
        title="T", abstract="",
        sections=[{"level": 1, "title": "Full Text", "page_start": 0, "page_end": 0,
                   "char_len": len(content), "text": content}],
        source="html_full", level=2, flat=content,
    )


def test_probe_cases():
    print("[3] 跨领域探针 8 case（mock LLM）")
    for probe, _desc, content, exp_role, exp_match in PROBE_CASES:
        llm_out = {
            "usage_role": exp_role,
            "confidence": "high",
            "method_summary": _desc,
            "probe_relation": "探针用于本文核心/辅助/基线/对比/提及/无关",
            "key_findings": "相关发现",
            "implementation_or_application": "具体实现方式",
            "evidence": [{"section": "3 Method", "description": "正文明确指出该方法的使用"}],
        }
        paper = {
            "paper_id": 1, "title": "T", "authors": [], "year": 2020,
            "venue": "", "doi": "", "abstract": "", "cited_by_count": 0,
        }
        with patch.object(branch.llm, "chat_json", return_value=json.dumps(llm_out)):
            res = _analyze_probe_match(paper, _make_sft(content), probe, None)
        ok = (res.usage_role == exp_role and res.probe_match == exp_match
              and res.optimization_method == "具体实现方式"
              and res.evidence == [{"section": "3 Method", "description": "正文明确指出该方法的使用"}])
        check(f"探针={probe!r} → role={exp_role},match={exp_match}",
              ok, f"got role={res.usage_role},match={res.probe_match}")


# ──────────────────────────────────────────────
#  4) 全景扫描（mock LLM）新字段
# ──────────────────────────────────────────────
def test_landscape():
    print("[4] 全景扫描新 9 维 + evidence")
    llm_out = {
        "research_question": "如何提升小样本泛化？",
        "methodology_type": "深度学习",
        "method_summary": "用元学习+对比学习提升泛化",
        "method_category": "元学习",
        "method_components": ["MAML", "对比学习"],
        "research_design": "少样本基准评测",
        "key_innovation": "提出自适应原型",
        "limitations": "未明确说明",
        "evidence": [{"section": "3 Method", "description": "给出元学习训练流程"}],
    }
    paper = {
        "paper_id": 2, "title": "T", "authors": [], "year": 2021,
        "venue": "", "doi": "", "abstract": "", "cited_by_count": 0,
    }
    with patch.object(branch.llm, "chat_json", return_value=json.dumps(llm_out)):
        res = _analyze_landscape(paper, _make_sft("3 Method\n..."), None)
    ok = (
        res.research_question == "如何提升小样本泛化？"
        and res.method_category == "元学习"
        and res.method_components == ["MAML", "对比学习"]
        and res.key_innovation == "提出自适应原型"
        and res.limitations == "未明确说明"
        and res.optimization_method == ""            # 不再 hack
        and res.probe_match is False
        and res.evidence == [{"section": "3 Method", "description": "给出元学习训练流程"}]
    )
    check("Landscape 9 维 + evidence + optimization_method 留空", ok,
          f"opt={res.optimization_method!r}, components={res.method_components!r}")


# ──────────────────────────────────────────────
#  5) 兜底关键词匹配确定性
# ──────────────────────────────────────────────
def test_keyword_fallback():
    print("[5] _simple_keyword_match 兜底")
    hit = _simple_keyword_match({"abstract": "We use Transformer for translation."}, "Transformer")
    check("命中→usage_role=mentioned", hit["usage_role"] == "mentioned")
    check("命中→confidence=low", hit["confidence"] == "low")
    miss = _simple_keyword_match({"abstract": "We use CNN."}, "Transformer")
    check("未命中→usage_role=none", miss["usage_role"] == "none")
    check("未命中→无 probe_match 字段", "probe_match" not in miss)


# ──────────────────────────────────────────────
#  6) generate_paper_profile 缓存读写
# ──────────────────────────────────────────────
def test_paper_profile():
    print("[6] generate_paper_profile 缓存")
    cached = {
        "research_domain": "Medicine",
        "subdomain": "Oncology",
        "research_type": "clinical",
        "methodology_type": "randomized controlled trial",
        "research_objects": ["patients"],
        "candidate_method_families": ["Cox regression"],
    }
    fake_paper = MagicMock()
    fake_paper.method_profile = cached

    class FakeSession:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def get(self, cls, pk): return fake_paper

    with patch.object(branch, "get_session", return_value=FakeSession()):
        prof = generate_paper_profile(99, "T", "abstract")
    check("缓存命中直接返回不调 LLM",
          isinstance(prof, PaperProfile) and prof.research_domain == "Medicine")

    # 未命中 → 调 LLM 并写回
    fake_paper2 = MagicMock()
    fake_paper2.method_profile = None
    written = {}
    class FakeSession2:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def get(self, cls, pk): return fake_paper2
    llm_out = {
        "research_domain": "Economics", "subdomain": "Labor",
        "research_type": "econometric", "methodology_type": "DID",
        "research_objects": ["wages"], "candidate_method_families": ["fixed effects"],
    }
    with patch.object(branch, "get_session", return_value=FakeSession2()), \
         patch.object(branch.llm, "chat_json", return_value=json.dumps(llm_out)):
        prof2 = generate_paper_profile(100, "T", "abstract")
    check("未命中→生成并写回缓存",
          prof2.research_domain == "Economics" and fake_paper2.method_profile is not None)


# ──────────────────────────────────────────────
#  7) select_context_for_mode landscape 组装（噪声过滤 + 高预算）
# ──────────────────────────────────────────────
def test_select_context_landscape():
    print("[7] select_context_for_mode landscape 组装")
    from agents.branch import (
        select_context_for_mode, StructuredFullText, MODE_LANDSCAPE, MODE_PROBE,
    )
    # 模拟 PDF 分节：噪声节（preamble/References/Acknowledgements）+ 正文节
    secs = [
        {"level": 1, "title": "(preamble)", "page_start": 0, "page_end": 0, "char_len": 100, "text": "meta noise"},
        {"level": 1, "title": "1 Introduction", "page_start": 0, "page_end": 0, "char_len": 1000, "text": "intro " * 200},
        {"level": 1, "title": "3 Method", "page_start": 0, "page_end": 0, "char_len": 5000, "text": "method detail " * 400},
        {"level": 1, "title": "5 Results", "page_start": 0, "page_end": 0, "char_len": 3000, "text": "result text " * 300},
        {"level": 1, "title": "6 Experiments", "page_start": 0, "page_end": 0, "char_len": 4000, "text": "exp result " * 400},
        {"level": 1, "title": "7 Conclusion", "page_start": 0, "page_end": 0, "char_len": 500, "text": "conclusion " * 60},
        {"level": 1, "title": "References", "page_start": 0, "page_end": 0, "char_len": 4000, "text": "refs " * 800},
        {"level": 1, "title": "Acknowledgements", "page_start": 0, "page_end": 0, "char_len": 50, "text": "thanks"},
    ]
    sft = StructuredFullText(title="T", abstract="abs", sections=secs,
                             source="pdf_pymupdf", level=2, flat="")
    ctx = select_context_for_mode(sft, MODE_LANDSCAPE, {"abstract": "abs"})
    check("landscape 默认预算>8000（生效 24000）", len(ctx) > 8000)
    check("landscape 排除 References", "References" not in ctx and "refs" not in ctx)
    check("landscape 排除 (preamble)", "(preamble)" not in ctx)
    check("landscape 排除 Acknowledgements", "Acknowledgements" not in ctx)
    check("landscape 包含 Method", "3 Method" in ctx and "method detail" in ctx)
    check("landscape 包含 Experiments", "6 Experiments" in ctx and "exp result" in ctx)
    check("landscape 包含 Results", "5 Results" in ctx and "result text" in ctx)

    ctx_probe = select_context_for_mode(sft, MODE_PROBE, {"abstract": "abs"})
    check("probe 默认预算仍 8000（上下文短于 landscape）", len(ctx_probe) < len(ctx))


if __name__ == "__main__":
    test_compute_probe_match()
    test_normalizers()
    test_probe_cases()
    test_landscape()
    test_keyword_fallback()
    test_paper_profile()
    test_select_context_landscape()
    print(f"\n结果: {PASS} 通过, {FAIL} 失败")
    sys.exit(1 if FAIL else 0)
