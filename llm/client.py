"""
LLM 统一调用接口 —— provider 与 base_url / model 已绑定

支持运行时动态配置：configure() 可在不改 .env 的情况下替换 api_key / base_url / model
"""
from openai import OpenAI
from utils.config import settings

_client: OpenAI | None = None

# 运行时配置（优先级高于 settings/.env，由 configure() 写入）
_runtime: dict = {}


def _get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(
            api_key=_runtime.get("api_key") or settings.llm_api_key,
            base_url=_runtime.get("base_url") or settings.llm_base_url,
        )
    return _client


def configure(api_key: str | None = None, base_url: str | None = None, model: str | None = None) -> None:
    """运行时替换 LLM 配置（api_key / base_url / model）。传入 None 表示不修改对应项。

    注意：修改 api_key / base_url 会重建 client；仅修改 model 不重建。
    """
    global _client
    if api_key is not None:
        _runtime["api_key"] = api_key
    if base_url is not None:
        _runtime["base_url"] = base_url
    if model is not None:
        _runtime["model"] = model
    # api_key / base_url 变化需要重建连接
    if api_key is not None or base_url is not None:
        _client = None


def _resolve_model(model: str | None) -> str:
    if model:
        return model
    return _runtime.get("model") or settings.llm_default_model


def chat(
    prompt: str,
    system: str = "你是一个专业的学术研究助手。",
    model: str = None,
    temperature: float = 0.2,
    max_tokens: int = 300000,
) -> str:
    client = _get_client()
    model = _resolve_model(model)

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
    model = _resolve_model(model)

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


def chat_with_tools(
    messages: list[dict],
    tools: list[dict] | None = None,
    system: str | None = None,
    model: str = None,
    temperature: float = 0.2,
    max_tokens: int = 300000,
) -> tuple[str | None, list[dict] | None]:
    """
    带工具调用（Function Calling）的对话接口。

    Args:
        messages: 完整消息列表（[{"role","content"}, ...]，含历史）
        tools: 工具注册表（OpenAI function calling 格式）
        system: 追加的 system prompt（会插入消息开头）
        model / temperature / max_tokens: 同 chat()

    Returns:
        (content, tool_calls)
        - content: 模型文本回复（无工具调用时）
        - tool_calls: [{"id","name","arguments"(dict)}, ...]（有工具调用时）
    """
    client = _get_client()
    model = _resolve_model(model)

    msgs = []
    if system:
        msgs.append({"role": "system", "content": system})
    msgs.extend(messages)

    kwargs = {
        "model": model,
        "messages": msgs,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if tools:
        kwargs["tools"] = tools

    response = client.chat.completions.create(**kwargs)
    message = response.choices[0].message

    tool_calls = None
    if getattr(message, "tool_calls", None):
        tool_calls = [
            {
                "id": tc.id,
                "name": tc.function.name,
                "arguments": json_loads_safe(tc.function.arguments),
            }
            for tc in message.tool_calls
        ]
    return message.content, tool_calls


def json_loads_safe(s: str) -> dict:
    """安全解析工具参数 JSON（DeepSeek 可能返回带格式的字符串）"""
    import json
    try:
        return json.loads(s)
    except Exception:
        return {}
