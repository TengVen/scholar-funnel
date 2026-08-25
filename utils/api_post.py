"""
通用 JSON POST 客户端 —— 供 embedding / rerank 的 API 后端使用

带指数退避重试（429 / 5xx / 网络错误，最多 3 次），归一化异常。
与 llm/client.py、sources/openalex.py 的容错策略保持一致。
"""
import time

import httpx

_TIMEOUT = 30.0
_RETRIES = 3


def post_json(url: str, payload: dict, api_key: str) -> dict:
    """POST JSON（Bearer 鉴权），重试后返回响应 JSON"""
    last_err: Exception | None = None
    for attempt in range(_RETRIES):
        try:
            with httpx.Client(timeout=_TIMEOUT) as client:
                resp = client.post(
                    url,
                    json=payload,
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                )
                if resp.status_code == 429:
                    wait = 2 ** attempt
                    time.sleep(wait)
                    continue
                resp.raise_for_status()
                return resp.json()
        except httpx.HTTPStatusError as e:
            last_err = e
            code = e.response.status_code
            if code >= 500 and attempt < _RETRIES - 1:
                time.sleep(2 ** attempt)
                continue
            raise RuntimeError(f"API HTTP {code}: {e.response.text[:200]}") from e
        except httpx.RequestError as e:
            last_err = e
            if attempt < _RETRIES - 1:
                time.sleep(2 ** attempt)
                continue
            raise RuntimeError(f"API 请求失败: {e}") from e
        except Exception as e:
            raise RuntimeError(f"API 调用异常: {e}") from e
    raise RuntimeError(f"API 请求失败（重试 {_RETRIES} 次）: {last_err}")
