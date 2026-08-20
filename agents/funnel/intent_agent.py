"""
意图解析 Agent

漏斗编排的第一个节点。从用户的自然语言输入中提取结构化参数，
判断信息是否足够启动漏斗，不足时返回追问。

职责：
1. 从自然语言中提取 user_query（研究方向）和 tech_probe（技术探针）
2. 识别隐含信息：年份范围、论文类型偏好、方法论偏好
3. 判断信息完整度，决定是直接启动漏斗还是先追问

与 QueryDecomposer 的区别：
- QueryDecomposer 是给主干检索用的，输出的是检索词组合
- IntentAgent 是给漏斗编排用的，输出的是漏斗运行参数 + 追问决策
"""
from __future__ import annotations
import json
from datetime import datetime
from typing import Optional

from llm import client as llm
from agents.funnel.tools import logger


# ══════════════════════════════════════════════════════════
#  数据结构
# ══════════════════════════════════════════════════════════

class IntentResult:
    """意图解析结果"""

    def __init__(
        self,
        user_query: str,
        tech_probe: str = "",
        methodology: str = "general",
        paper_type: str = "all",
        year_from: Optional[int] = None,
        year_to: Optional[int] = None,
        confidence: str = "medium",
        reasoning: str = "",
        all_complete: bool = True,
        next_question: str = "",
    ):
        self.user_query = user_query
        self.tech_probe = tech_probe
        self.methodology = methodology
        self.paper_type = paper_type
        self.year_from = year_from
        self.year_to = year_to
        self.confidence = confidence
        self.reasoning = reasoning
        self.all_complete = all_complete
        self.next_question = next_question

    def to_dict(self) -> dict:
        return {
            "user_query": self.user_query,
            "tech_probe": self.tech_probe,
            "methodology": self.methodology,
            "paper_type": self.paper_type,
            "year_from": self.year_from,
            "year_to": self.year_to,
            "confidence": self.confidence,
            "reasoning": self.reasoning,
            "all_complete": self.all_complete,
            "next_question": self.next_question,
        }


# ══════════════════════════════════════════════════════════
#  主入口
# ══════════════════════════════════════════════════════════

def parse_intent(
    user_input: str,
    conversation_history: Optional[list[dict]] = None,
) -> IntentResult:
    """
    从用户输入中解析意图。

    Args:
        user_input: 用户的自然语言输入
            可以是单句话："我想研究图像修复中用了最小二乘法的论文"
            也可以是多轮对话中的最新一条消息
        conversation_history: 可选的对话历史
            [{"role": "user", "content": "..."}, {"role": "assistant", "content": "..."}]
            用于多轮对话场景，帮助 LLM 理解上下文

    Returns:
        IntentResult，包含提取的参数和追问决策
    """
    # 如果有对话历史，结合历史解析；否则只看当前输入
    if conversation_history and len(conversation_history) > 1:
        return _parse_with_history(user_input, conversation_history)
    return _parse_single(user_input)


# ══════════════════════════════════════════════════════════
#  单轮解析
# ══════════════════════════════════════════════════════════

SINGLE_PARSE_PROMPT = """\
你是一个学术检索意图解析专家。用户会用自然语言描述他们想研究的方向，
你需要从中提取结构化的检索参数。

用户输入：
{user_input}

当前年份：{current_year}

请分析用户输入，提取以下信息：

1. **研究方向（user_query）**：用户想研究的核心领域/问题
   - 用学术化的英文短语描述（如果用户用中文输入，翻译成英文）
   - 保留用户提到的具体技术名词

2. **技术探针（tech_probe）**：用户想深挖的具体技术/方法
   - 如果用户提到了具体的技术（如"最小二乘"、"Transformer"、"GAN"），提取出来
   - 如果用户没有提到具体技术，留空字符串

3. **方法论偏好（methodology）**：
   - "traditional"：用户明确说要传统方法
   - "deep_learning"：用户明确说要深度学习
   - "general"：没有明确偏好

4. **论文类型（paper_type）**：
   - "survey"：用户只想看综述
   - "original"：用户只想看原创论文
   - "all"：没有限制

5. **年份范围**：用户是否提到了时间限制

6. **信息完整度判断（all_complete）**：
   - true：研究方向明确，可以启动检索
   - false：信息不够，需要追问

7. **追问内容（next_question）**：
   - all_complete=false 时，用自然口语问最需要的那一个信息
   - all_complete=true 时，留空字符串

请输出严格 JSON：
{{
  "user_query": "提取的研究方向",
  "tech_probe": "提取的技术探针（没有就空字符串）",
  "methodology": "general / traditional / deep_learning",
  "paper_type": "all / survey / original",
  "year_from": null 或年份数字,
  "year_to": null 或年份数字,
  "confidence": "high / medium / low",
  "reasoning": "提取思路简述",
  "all_complete": true 或 false,
  "next_question": "追问内容"
}}

判断规则：
- user_query 为空或太模糊（如只有"论文"两个字）→ all_complete=false
- user_query 具体（如"图像修复"、"transformer在NLP中的应用"）→ all_complete=true
- tech_probe 有值时，说明用户有明确的技术方向，这是好事，不是缺失信息
"""


def _parse_single(user_input: str) -> IntentResult:
    """单轮解析：直接从用户输入提取参数"""
    prompt = SINGLE_PARSE_PROMPT.format(
        user_input=user_input,
        current_year=datetime.now().year,
    )

    try:
        raw = llm.chat_json(prompt, temperature=0.2)
        parsed = json.loads(raw)

        return IntentResult(
            user_query=parsed.get("user_query", ""),
            tech_probe=parsed.get("tech_probe", ""),
            methodology=parsed.get("methodology", "general"),
            paper_type=parsed.get("paper_type", "all"),
            year_from=parsed.get("year_from"),
            year_to=parsed.get("year_to"),
            confidence=parsed.get("confidence", "medium"),
            reasoning=parsed.get("reasoning", ""),
            all_complete=parsed.get("all_complete", True),
            next_question=parsed.get("next_question", ""),
        )
    except Exception as e:
        logger.warning(f"意图解析失败，回退到简单提取: {e}")
        return _fallback_parse(user_input)


# ══════════════════════════════════════════════════════════
#  多轮解析
# ══════════════════════════════════════════════════════════

HISTORY_PARSE_PROMPT = """\
你是一个学术检索意图解析专家。用户正在和你对话，讨论他们想研究的方向。
请结合对话历史和最新消息，提取检索参数。

对话历史（最近几轮）：
{conversation_text}

当前年份：{current_year}

请综合对话上下文，提取以下信息：

1. **研究方向（user_query）**：用户最终确认的研究方向
2. **技术探针（tech_probe）**：用户想深挖的具体技术
3. **方法论偏好（methodology）**：general / traditional / deep_learning
4. **论文类型（paper_type）**：all / survey / original
5. **年份范围**：如果用户提到了时间限制
6. **信息完整度判断（all_complete）**：研究方向是否足够明确

请输出严格 JSON（格式同上）：
{{
  "user_query": "",
  "tech_probe": "",
  "methodology": "general",
  "paper_type": "all",
  "year_from": null,
  "year_to": null,
  "confidence": "high / medium / low",
  "reasoning": "",
  "all_complete": true 或 false,
  "next_question": ""
}}
"""


def _parse_with_history(
    user_input: str,
    conversation_history: list[dict],
) -> IntentResult:
    """多轮解析：结合对话历史提取参数"""
    # 构建对话文本（最近8轮）
    lines = []
    for msg in conversation_history[-8:]:
        role = msg.get("role", "user")
        content = msg.get("content", "")[:500]
        lines.append(f"{role}: {content}")
    # 加上当前输入（如果不在历史中）
    if not conversation_history or conversation_history[-1].get("content") != user_input:
        lines.append(f"user: {user_input}")
    conversation_text = "\n".join(lines)

    prompt = HISTORY_PARSE_PROMPT.format(
        conversation_text=conversation_text,
        current_year=datetime.now().year,
    )

    try:
        raw = llm.chat_json(prompt, temperature=0.2)
        parsed = json.loads(raw)

        return IntentResult(
            user_query=parsed.get("user_query", ""),
            tech_probe=parsed.get("tech_probe", ""),
            methodology=parsed.get("methodology", "general"),
            paper_type=parsed.get("paper_type", "all"),
            year_from=parsed.get("year_from"),
            year_to=parsed.get("year_to"),
            confidence=parsed.get("confidence", "medium"),
            reasoning=parsed.get("reasoning", ""),
            all_complete=parsed.get("all_complete", True),
            next_question=parsed.get("next_question", ""),
        )
    except Exception as e:
        logger.warning(f"多轮意图解析失败: {e}")
        return _fallback_parse(user_input)


# ══════════════════════════════════════════════════════════
#  兜底解析（LLM 失败时）
# ══════════════════════════════════════════════════════════

def _fallback_parse(user_input: str) -> IntentResult:
    """
    兜底解析：不调 LLM，用简单的规则提取。
    当 LLM API 不可用时保证系统不崩溃。
    """
    text = user_input.strip()

    # 简单判断：输入是否足够具体（长度 > 4 且不是纯停用词）
    is_specific = len(text) > 4 and not all(
        w in {"的", "了", "是", "在", "和", "与", "the", "a", "an", "of"}
        for w in text.split()
    )

    if is_specific:
        return IntentResult(
            user_query=text,
            tech_probe="",
            methodology="general",
            paper_type="all",
            confidence="low",
            reasoning="LLM 解析失败，使用规则兜底",
            all_complete=True,
            next_question="",
        )
    else:
        return IntentResult(
            user_query="",
            tech_probe="",
            methodology="general",
            paper_type="all",
            confidence="low",
            reasoning="输入太模糊，需要追问",
            all_complete=False,
            next_question="你想研究什么方向？能说得更具体一些吗？",
        )
