"""
smoke_load.py — Scholar Funnel 内测前并发冒烟 / 轻量压测

为什么不是 k6/JMeter 级重压：
  内测就 5~20 人，且后端限流是「单进程内存滑动窗口」（/api/search/ 等重接口
  单 IP 仅 6~12 次/分钟，轮询只读 120/min）。真·高并发从单 IP 打只会立刻 429，
  测不出应用本身。故本脚本聚焦「正确性 + 稳定性」而非纯吞吐：

  mode=ratelimit : 同 IP 突发打某一端点 → 断言 429 在阈值处精确触发（限流是否真生效）
  mode=load      : N 个虚拟用户（各自不同 X-Forwarded-For，模拟分布式客户端）
                  按权重混合只读轮询 + 少量重操作，收集延迟/RPS/错误分布
  mode=race      : 同一用户「并发」极速重复提交 trunk/branch/network 重操作 →
                   检测「重复 task / 并发无守卫」（即 ChatPanel 竞态同类的后端侧风险）
  mode=all       : 依次跑 ratelimit → load → race，整体退出码可接入 CI

运行（用项目真实环境，已含 httpx）：
  D:\\Anaconda\\envs\\paper\\python.exe scripts/smoke_load.py --mode ratelimit
  D:\\Anaconda\\envs\\paper\\python.exe scripts/smoke_load.py --mode load --concurrency 8 --requests 200
  D:\\Anaconda\\envs\\paper\\python.exe scripts/smoke_load.py --mode race --requests 12
  D:\\Anaconda\\envs\\paper\\python.exe scripts/smoke_load.py --mode all --requests 12

依赖：httpx  （pip install httpx）
注意：后端必须以「单进程」启动（uvicorn api.main:app --workers 1），
      否则内存态限流与 task 存储会失效，本脚本结论也不成立。
"""
from __future__ import annotations

import argparse
import asyncio
import json
import random
import statistics
import time
from dataclasses import dataclass, field

try:
    import httpx
except ImportError:
    raise SystemExit("缺少依赖 httpx：请先 `pip install httpx` 后用项目环境运行")


# ───────────────────────── 配置默认值 ─────────────────────────
DEFAULT_BASE = "http://127.0.0.1:8000"
HEAVY_PREFIXES = ("/api/search/", "/api/branch/analyze", "/api/network/analyze",
                  "/api/cart/classify", "/api/cart/summarize", "/api/chat/message")
DEFAULT_LIMITS = {  # 与 utils/ratelimit.py 对齐，用于 ratelimit 模式断言
    ("POST", "/api/search/"): 6,
    ("POST", "/api/branch/analyze"): 6,
    ("POST", "/api/network/analyze"): 6,
    ("POST", "/api/cart/classify"): 6,
    ("POST", "/api/chat/message"): 12,
}
_DEFAULT_LIMIT = 120  # 未命中限流表的接口走默认配额（轮询/只读）


@dataclass
class Stats:
    total: int = 0
    ok: int = 0
    by_status: dict[int, int] = field(default_factory=dict)
    latencies: list[float] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    # race 模式专用
    task_ids: list[str] = field(default_factory=list)
    # 按顺序记录状态码（用于精确找「第一个 429」出现在第几位）
    status_order: list[int] = field(default_factory=list)

    def record(self, status: int | None, latency: float, err: str = ""):
        self.total += 1
        if status is not None:
            self.by_status[status] = self.by_status.get(status, 0) + 1
            if 200 <= status < 400:
                self.ok += 1
            self.latencies.append(latency)
            self.status_order.append(status)
        if err:
            self.errors.append(err)

    def summary(self) -> str:
        if not self.latencies:
            return "  (无成功样本)"
        lat = sorted(self.latencies)
        p = lambda q: lat[min(len(lat) - 1, int(q * len(lat)))]
        return (
            f"  请求数={self.total}  成功(2xx/3xx)={self.ok}\n"
            f"  状态分布={dict(sorted(self.by_status.items()))}\n"
            f"  延迟 p50={p(.5)*1000:.0f}ms  p95={p(.95)*1000:.0f}ms  p99={p(.99)*1000:.0f}ms  "
            f"max={lat[-1]*1000:.0f}ms\n"
            f"  错误样本(前3)={self.errors[:3]}"
        )


# ───────────────────────── 认证 ─────────────────────────
async def get_token(client: httpx.AsyncClient, base: str,
                    username: str | None, password: str | None,
                    token: str | None) -> str | None:
    """
    登录接口 /api/auth/login 仅接受 {username, password}（见 api/routers/auth.py
    LoginRequest），无 email 登录通道。故 username 参数直接作为登录用户名；
    若用户只给了 --email，则退回用 email 值当 username。
    """
    if token:
        return token
    if not username or not password:
        return None
    r = await client.post(f"{base}/api/auth/login",
                          json={"username": username, "password": password})
    if r.status_code == 200:
        return r.json().get("access_token")
    print(f"  ⚠️ 登录失败 {r.status_code}: {r.text[:160]}")
    print("     提示：本系统登录只认 username（不是 email）。若注册时 username "
          "与 email 不同，请用 --username 指定注册的 username。")
    return None


async def maybe_project_id(client: httpx.AsyncClient, base: str,
                           token: str | None, project_id: int | None) -> int | None:
    if project_id:
        return project_id
    if not token:
        return None
    r = await client.get(f"{base}/api/projects",
                         headers={"Authorization": f"Bearer {token}"})
    if r.status_code == 200:
        items = r.json()
        if isinstance(items, list) and items:
            return items[0].get("id")
    return None


# ───────────────────────── 请求构造 ─────────────────────────
def build_request(method: str, path: str, token: str | None,
                  body: dict | None = None) -> dict:
    h = {}
    if token:
        h["Authorization"] = f"Bearer {token}"
    return {"method": method, "url": path, "headers": h,
            "json": body, "timeout": 30.0}


# 只读/轮询类端点（高频、快返回，构成真实流量主体）
READ_SCENARIOS = [
    ("GET", "/api/health", None),
    ("GET", "/api/projects", None),
    ("GET", "/api/search/trunk/status?task_id=__probe__", None),
    ("GET", "/api/chat/history?conversation_id=__probe__", None),
]


def weighted_scenario(rng: random.Random, pid: int | None, token: str | None):
    """返回 (method, path, body)。重操作仅在给了 project_id 时以低权重出现。"""
    # 80% 只读轮询，20% 重操作（若有 pid）
    if pid is not None and rng.random() < 0.2:
        body = {"project_id": pid, "user_query": "graph neural network survey",
                "tech_probe": "", "max_queries": 2, "top_k": 10, "score_threshold": 0.3}
        return ("POST", "/api/search/trunk", body)
    s = rng.choice(READ_SCENARIOS)
    path = s[1].replace("__probe__", f"probe{rng.randint(1, 9999)}")
    return (s[0], path, None)


# ───────────────────────── 三种模式 ─────────────────────────
def _limit_for(method: str, path: str) -> int:
    """与 utils/ratelimit.py 的 _LIMIT_RULES 对齐：支持「方法+路径前缀」匹配
    （如 /api/search/trunk → /api/search/ → 6/min）。"""
    if (method, path) in DEFAULT_LIMITS:
        return DEFAULT_LIMITS[(method, path)]
    for (m, p), v in DEFAULT_LIMITS.items():
        if m == method and path.startswith(p):
            return v
    return _DEFAULT_LIMIT


async def mode_ratelimit(args, token: str | None) -> int:
    """同 IP 突发，验证 429 在阈值处触发。返回 0=通过 / 1=失败（供 CI 断言）。"""
    print(f"\n[ratelimit] 同 IP 突发 {args.requests} 次 → {args.endpoint}")
    method, path = args.endpoint.split(" ", 1) if " " in args.endpoint else ("POST", args.endpoint)
    limit = _limit_for(method, path)
    print(f"  期望：前 {limit} 次应放行(2xx/4xx)，第 {limit + 1} 次起应 429（阈值 {limit}/min）")
    stats = Stats()
    # 固定 IP（不传 XFF → 服务器取直连地址，所有请求同一限流 key）
    h = {"Authorization": f"Bearer {token}"} if token else {}
    body = {"project_id": args.project_id or 1, "user_query": "test",
            "max_queries": 1, "top_k": 10, "score_threshold": 0.3} if method == "POST" else None
    async with httpx.AsyncClient(base_url=args.base_url) as c:
        for i in range(args.requests):
            t0 = time.monotonic()
            try:
                r = await c.request(method, path, headers=h, json=body, timeout=30)
                stats.record(r.status_code, time.monotonic() - t0)
            except Exception as e:
                stats.record(None, time.monotonic() - t0, str(e)[:80])
    print(stats.summary())
    if 429 not in stats.by_status:
        print("  ✗ 未触发 429，限流可能失效（或该端点不在限流表中）")
        return 1
    first_429_idx = next(i for i, s in enumerate(stats.status_order) if s == 429)
    if first_429_idx < limit:
        print(f"  ✗ 限流过早生效：第 {first_429_idx + 1} 次就 429（期望第 {limit + 1} 次）")
        return 1
    print(f"  ✓ 限流生效：前 {limit} 次放行，第 {first_429_idx + 1} 次起 429（符合阈值 {limit}/min）")
    return 0


async def mode_load(args, token: str | None, pid: int | None):
    """N 虚拟用户（各自不同 XFF）混合流量压测。"""
    print(f"\n[load] 并发={args.concurrency} 总请求≈{args.requests} "
          f"(每用户独立 IP 模拟分布式客户端)")
    stats = Stats()
    rng = random.Random(42)
    sem = asyncio.Semaphore(args.concurrency)

    async def worker(uid: int):
        # 每用户固定一个虚拟 IP（XFF），模拟不同客户端，避免互相限流
        xff = f"10.0.{uid // 255}.{uid % 255}"
        h = {"X-Forwarded-For": xff}
        if token:
            h["Authorization"] = f"Bearer {token}"
        async with httpx.AsyncClient(base_url=args.base_url, headers=h) as c:
            while stats.total < args.requests:
                m, p, b = weighted_scenario(rng, pid, token)
                t0 = time.monotonic()
                try:
                    r = await c.request(m, p, json=b, timeout=30)
                    stats.record(r.status_code, time.monotonic() - t0)
                except Exception as e:
                    stats.record(None, time.monotonic() - t0, str(e)[:80])
                await asyncio.sleep(args.think / 1000.0)

    t_start = time.monotonic()
    await asyncio.gather(*[worker(u) for u in range(args.concurrency)])
    elapsed = time.monotonic() - t_start
    print(stats.summary())
    print(f"  总耗时={elapsed:.1f}s  实测 RPS={stats.total / elapsed:.1f}")
    # 健康度快速判断
    heavy_5xx = sum(v for k, v in stats.by_status.items() if k >= 500)
    print(f"  结论：{'✓ 无 5xx，稳定' if heavy_5xx == 0 else f'✗ 出现 {heavy_5xx} 次 5xx，需查后端日志'}")


# race 模式覆盖的「重操作」目标 —— 均为已加并发守卫（utils/task_guard）的入口
RACE_TARGETS = [
    ("trunk", "POST", "/api/search/trunk",
     {"project_id": 0, "user_query": "duplicate task probe", "tech_probe": "",
      "max_queries": 1, "top_k": 10, "score_threshold": 0.3}),
    ("branch(ai_suggest)", "POST", "/api/branch/analyze",
     {"project_id": 0, "mode": "ai_suggest", "probe": "", "category": ""}),
    ("network", "POST", "/api/network/analyze",
     {"project_id": 0, "category": ""}),
]


async def mode_race(args, token: str | None, pid: int | None) -> int:
    """同用户极速「并发」重复提交各重操作 → 检测重复 task / 并发无守卫。
    返回 0=全部通过 / 1=存在重复 task 风险。
    注意：必须真正并发（asyncio.gather）才能复现双击竞态；顺序发射测不出。"""
    pid = pid or args.project_id or 1
    if not token:
        print("\n[race] ⚠️ 无 token，跳过（需登录后才能提交重操作）")
        return 1
    print(f"\n[race] 同用户极速并发 {args.requests} 次（project_id={pid}），"
          f"检测各重操作是否起重复 task")
    failed = 0
    for name, method, path, base_body in RACE_TARGETS:
        body = dict(base_body, project_id=pid)
        h = {"Authorization": f"Bearer {token}"}
        async with httpx.AsyncClient(base_url=args.base_url, headers=h) as c:
            async def _fire():
                try:
                    return await c.request(method, path, json=body, timeout=30)
                except Exception as e:
                    return ("ERR", str(e))
            resps = await asyncio.gather(*[_fire() for _ in range(args.requests)])
        task_ids, dups, errs = [], 0, 0
        for r in resps:
            if isinstance(r, tuple):   # ("ERR", msg)
                errs += 1
                continue
            if r.status_code == 200:
                j = r.json()
                task_ids.append(j.get("task_id", ""))
                if j.get("duplicate"):
                    dups += 1
            else:
                errs += 1
        uniq = set(t for t in task_ids if t)
        if len(uniq) > 1:
            print(f"  ✗ [{name}] 检测到 {len(uniq)} 个不同 task_id（{len(task_ids)} 次提交）→ "
                  f"重复提交会起多个后台任务，存在数据竞争/资源浪费风险")
            failed += 1
        else:
            print(f"  ✓ [{name}] 守卫生效：{len(task_ids)} 次提交合并到同一 task_id"
                  f"（{dups} 次被标记 duplicate=True，无数据竞争）")
        if errs:
            print(f"      （其中 {errs} 次非 200，需结合后端日志排查）")
    return 1 if failed else 0


# ───────────────────────── 入口 ─────────────────────────
async def main_async(args):
    async with httpx.AsyncClient(base_url=args.base_url) as probe:
        try:
            r = await probe.get("/api/health", timeout=5)
            print(f"服务探测：{args.base_url} → {r.status_code} {r.text[:60]}")
        except Exception as e:
            print(f"✗ 无法连接 {args.base_url}：{e}")
            print("  请先启动后端（单进程）：uvicorn api.main:app --workers 1 --port 8000")
            return

    # 登录用户名：优先 --username，否则退回用 --email 值（系统无 email 登录通道）
    login_id = args.username or args.email
    token = await get_token(httpx.AsyncClient(base_url=args.base_url),
                            args.base_url, login_id, args.password, args.token)
    if args.mode != "ratelimit" and token:
        pid = await maybe_project_id(httpx.AsyncClient(base_url=args.base_url),
                                     args.base_url, token, args.project_id)
        print(f"  登录成功，project_id={pid}")
    else:
        pid = args.project_id
        if args.mode != "ratelimit" and not token:
            print("  ⚠️ 未提供登录凭证（--token / --email / --password），除 /api/health "
                  "外将全部返回 401，本次不会真正压测业务接口。请用凭证重跑。")

    rc = 0
    if args.mode in ("ratelimit", "all"):
        rc |= await mode_ratelimit(args, token)
    if args.mode in ("load", "all"):
        await mode_load(args, token, pid)
    if args.mode in ("race", "all"):
        rc |= await mode_race(args, token, pid)
    return rc


def main():
    ap = argparse.ArgumentParser(description="Scholar Funnel 并发冒烟/轻量压测")
    ap.add_argument("--base-url", default=DEFAULT_BASE)
    ap.add_argument("--mode", choices=["ratelimit", "load", "race", "all"],
                    default="load",
                    help="ratelimit=限流断言 / load=混合负载 / race=并发守卫 / all=依次跑前三者")
    ap.add_argument("--concurrency", type=int, default=8, help="load 模式虚拟用户数")
    ap.add_argument("--requests", type=int, default=100,
                    help="ratelimit/race 总次数；load 模式目标请求数")
    ap.add_argument("--think", type=float, default=50, help="load 模式思考间隔(ms)")
    ap.add_argument("--endpoint", default="POST /api/search/trunk",
                    help="ratelimit 模式目标端点，如 'POST /api/search/trunk'")
    ap.add_argument("--token", default=None, help="直接传入 JWT（免登录）")
    ap.add_argument("--username", default="admin",
                    help="登录用户名（系统登录只认 username，非 email）")
    ap.add_argument("--email", default=None,
                    help="邮箱；未给 --username 时，退回用此值作为登录 username")
    ap.add_argument("--password", default="admin123",
                    help="登录密码（必填；不要硬编码默认值）")
    ap.add_argument("--project-id", type=int, default=None)
    args = ap.parse_args()
    rc = asyncio.run(main_async(args))
    raise SystemExit(rc)


if __name__ == "__main__":
    main()
