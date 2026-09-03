"""
LLM 统一调用接口 —— provider 与 base_url / model 已绑定

支持运行时动态配置：configure() 可在不改 .env 的情况下替换 api_key / base_url / model
统一错误处理：timeout + 指数退避重试（限流/超时/5xx）+ 归一化为 LLMError
"""
import time

from openai import OpenAI
from openai import APIError, APITimeoutError, RateLimitError

from utils.config import settings
from utils.log import setup_logger

logger = setup_logger("llm")

_client: OpenAI | None = None

# 运行时配置（优先级高于 settings/.env，由 configure() 写入）
_runtime: dict = {}

# ── 重试参数 ──
_MAX_RETRIES = 3        # 总尝试次数
_BASE_DELAY = 1.0       # 退避基数（1s, 2s, 4s）
_TIMEOUT = 60.0         # 单次请求超时


class LLMError(Exception):
    """统一 LLM 调用错误（对外可读的异常类型）"""


def _get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(
            api_key=_runtime.get("api_key") or settings.llm_api_key,
            base_url=_runtime.get("base_url") or settings.llm_base_url,
            timeout=_TIMEOUT,
            max_retries=1,  # SDK 自身重试收敛，由 _call_with_retry 统一控制
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


def _call_with_retry(fn, what: str):
    """统一重试：RateLimit / Timeout / 5xx 指数退避，其余错误直接归一化抛出"""
    last_err: Exception | None = None
    for attempt in range(_MAX_RETRIES):
        try:
            return fn()
        except RateLimitError as e:
            last_err = e
            wait = _BASE_DELAY * (2 ** attempt)
            logger.warning(f"LLM 限流({what})，{wait:.0f}s 后重试 (第{attempt + 1}次): {e}")
            time.sleep(wait)
        except APITimeoutError as e:
            last_err = e
            wait = _BASE_DELAY * (2 ** attempt)
            logger.warning(f"LLM 超时({what})，{wait:.0f}s 后重试 (第{attempt + 1}次): {e}")
            time.sleep(wait)
        except APIError as e:
            last_err = e
            if attempt < _MAX_RETRIES - 1:
                wait = _BASE_DELAY * (2 ** attempt)
                logger.warning(f"LLM API 错误({what})，{wait:.0f}s 后重试 (第{attempt + 1}次): {e}")
                time.sleep(wait)
            else:
                raise LLMError(f"LLM 调用失败({what}): {e}") from e
        except Exception as e:  # 非 API 类异常（如本地配置错误）不重试
            raise LLMError(f"LLM 调用失败({what}): {e}") from e

    raise LLMError(f"LLM 调用失败({what}，重试 {_MAX_RETRIES} 次仍失败): {last_err}")


def chat(
    prompt: str,
    system: str = "你是一个专业的学术研究助手。",
    model: str = None,
    temperature: float = 0.2,
    max_tokens: int = 300000,
) -> str:
    client = _get_client()
    model = _resolve_model(model)

    response = _call_with_retry(
        lambda: client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
            temperature=temperature,
            max_tokens=max_tokens,
        ),
        what="chat",
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

    response = _call_with_retry(
        lambda: client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
            temperature=temperature,
            max_tokens=max_tokens,
            response_format={"type": "json_object"},
        ),
        what="chat_json",
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

    response = _call_with_retry(
        lambda: client.chat.completions.create(**kwargs),
        what="chat_with_tools",
    )
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


def chat_with_tools_stream(
    messages: list[dict],
    tools: list[dict] | None = None,
    system: str | None = None,
    model: str = None,
    temperature: float = 0.2,
    max_tokens: int = 300000,
):
    """带工具调用的流式对话（OpenAI SDK stream=True，逐 token 产出）。

    与 chat_with_tools 语义等价，差异只在产出方式：
    - 每段文本增量 yield {"type": "text", "text": str}
    - 整轮结束 yield {"type": "done", "content": str, "tool_calls": list | None}
      tool_calls 为 None 表示模型直接作答；否则本轮为工具调用轮（content 一般为空）。

    可靠性：仅在「尚未产出任何文本」时可整轮重试（限流/超时/5xx，参数与 _call_with_retry 一致）；
    一旦已产出文本后出错 → 抛 LLMError（已产出内容由调用方保留展示，不重复生成）。
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
        "stream": True,
    }
    if tools:
        kwargs["tools"] = tools

    for attempt in range(_MAX_RETRIES):
        started = False          # 是否已产出过文本（决定可否整轮重试）
        parts: list[str] = []
        tool_acc: dict[int, dict] = {}
        try:
            stream = client.chat.completions.create(**kwargs)
            for chunk in stream:
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta
                if delta and delta.content:
                    parts.append(delta.content)
                    started = True
                    yield {"type": "text", "text": delta.content}
                if delta and getattr(delta, "tool_calls", None):
                    for t in delta.tool_calls:
                        acc = tool_acc.setdefault(t.index, {"id": "", "name": "", "arguments": ""})
                        if t.id:
                            acc["id"] = t.id
                        fn = getattr(t, "function", None)
                        if fn:
                            if fn.name:
                                acc["name"] += fn.name
                            if fn.arguments:
                                acc["arguments"] += fn.arguments
            break  # 正常流结束
        except Exception as e:
            # 已产出文本（或已达最大尝试）→ 中断抛出；否则整轮重试
            if started or attempt >= _MAX_RETRIES - 1:
                raise LLMError(f"LLM 流式调用失败: {e}") from e
            wait = _BASE_DELAY * (2 ** attempt)
            logger.warning(
                f"LLM 流式调用中断且未产出文本（第{attempt + 1}次），{wait:.0f}s 后整轮重试: {e}"
            )
            time.sleep(wait)
            continue

    tool_calls = None
    if tool_acc:
        tool_calls = [
            {
                "id": v["id"] or f"call_{i}",
                "name": v["name"],
                "arguments": json_loads_safe(v["arguments"]),
            }
            for i, v in sorted(tool_acc.items())
        ]
    yield {"type": "done", "content": "".join(parts), "tool_calls": tool_calls}


def json_loads_safe(s: str) -> dict:
    """安全解析工具参数 JSON（DeepSeek 可能返回带格式的字符串）"""
    import json
    try:
        return json.loads(s)
    except Exception:
        return {}
