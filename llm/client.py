"""
LLM 统一调用接口 —— provider 与 base_url / model 已绑定
"""
from openai import OpenAI
from utils.config import settings

_client: OpenAI | None = None


def _get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(
            api_key=settings.llm_api_key,
            base_url=settings.llm_base_url,
        )
    return _client


def chat(
    prompt: str,
    system: str = "你是一个专业的学术研究助手。",
    model: str = None,
    temperature: float = 0.2,
    max_tokens: int = 300000,
) -> str:
    client = _get_client()
    model = model or settings.llm_default_model

    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ],
        temperature=temperature,
        max_tokens=max_tokens,
    )
    return response.choices[0].message.content.strip()


def chat_json(
    prompt: str,
    system: str = "你是一个专业的学术研究助手。请严格以 JSON 格式返回结果。",
    model: str = None,
    temperature: float = 0.2,
    max_tokens: int = 300000,
) -> str:
    client = _get_client()
    model = model or settings.llm_default_model

    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ],
        temperature=temperature,
        max_tokens=max_tokens,
        response_format={"type": "json_object"},
    )
    return response.choices[0].message.content.strip()