"""
统一日志配置 —— 所有模块通过此模块输出日志

- 同时输出到 stdout 和 stderr，确保终端可见；
- 可选异步落库 PostgreSQL sys_app_logs（DbLogHandler：内存队列 + 后台
  daemon 线程批量写，零依赖；写库失败只提示不阻塞业务，防日志风暴）。
"""
import contextvars
import json
import logging
import queue
import sys
import threading
import time
import traceback

# ── 请求上下文（request_log 中间件注入，DbLogHandler 落库时关联 request_id）──
_request_id_ctx: contextvars.ContextVar = contextvars.ContextVar("request_id", default=None)


def set_request_id(req_id: str | None) -> None:
    """设置当前请求 ID（由 utils/request_log.py 中间件调用）"""
    _request_id_ctx.set(req_id)


def clear_request_id() -> None:
    """清除当前请求 ID（请求结束时调用）"""
    _request_id_ctx.set(None)


class DbLogHandler(logging.Handler):
    """异步落库日志 Handler：内存队列 + 后台 daemon 线程批量 INSERT sys_app_logs。

    设计要点：
      - emit() 仅入队（微秒级），绝不阻塞业务线程；队列满直接丢弃；
      - 后台线程每 1s 或攒满 50 条批量写一次；
      - DB 写失败：stderr 提示一次并丢弃本批，不重试（防日志风暴）；
      - 连接惰性建立（settings.postgres_url，剥掉 SQLAlchemy 前缀），断线自动重建；
      - 表不存在时自动 CREATE TABLE IF NOT EXISTS（幂等），首次启动即可用。
    """

    _FLUSH_INTERVAL = 1.0   # 秒
    _BATCH_SIZE = 50        # 条

    def __init__(self, level: int = logging.NOTSET):
        super().__init__(level)
        self._queue: queue.Queue = queue.Queue(maxsize=2000)
        self._conn = None
        self._last_flush = 0.0
        self._thread = threading.Thread(
            target=self._run, daemon=True, name="db-log-flusher"
        )
        self._thread.start()

    # ── 主线程侧：只入队（request_id 在此快照，跨线程随 record 传递）──
    def emit(self, record: logging.LogRecord) -> None:
        record.request_id = _request_id_ctx.get()
        try:
            self._queue.put_nowait(record)
        except queue.Full:
            pass  # 队列满丢弃，绝不阻塞业务

    # ── 后台线程侧：批量落库 ──
    def _run(self) -> None:
        batch: list = []
        while True:
            try:
                rec = self._queue.get(timeout=self._FLUSH_INTERVAL)
                batch.append(rec)
            except queue.Empty:
                pass
            now = time.monotonic()
            if batch and (len(batch) >= self._BATCH_SIZE or now - self._last_flush >= self._FLUSH_INTERVAL):
                self._flush(batch)
                batch = []
                self._last_flush = now

    def _flush(self, batch: list) -> None:
        rows = []
        for rec in batch:
            try:
                message = rec.getMessage()[:4000]
            except Exception:
                message = str(rec.msg)[:4000]
            exc_text = ""
            if rec.exc_info and rec.exc_info[2]:
                try:
                    exc_text = "".join(traceback.format_exception(*rec.exc_info))[:4000]
                except Exception:
                    exc_text = ""
            rows.append((
                (rec.levelname or "INFO")[:10],
                (rec.name or "")[:64],
                message,
                getattr(rec, "request_id", None),
                json.dumps({"exc": exc_text}) if exc_text else None,
            ))
        if not rows:
            return
        try:
            self._ensure_conn()
            with self._conn.cursor() as cur:
                cur.executemany(
                    "INSERT INTO sys_app_logs (level, logger, message, request_id, detail) "
                    "VALUES (%s, %s, %s, %s, %s)",
                    rows,
                )
            self._conn.commit()
        except Exception as e:
            self._drop_conn()
            sys.stderr.write(f"[db-log] 落库失败(丢弃{len(rows)}条): {e}\n")

    def _ensure_conn(self):
        if self._conn is not None:
            return
        from utils.config import settings

        # 后台线程第一次落库时建表（幂等），后续不再执行
        dsn = settings.postgres_url.replace("postgresql+psycopg://", "postgresql://", 1)
        import psycopg

        conn = psycopg.connect(dsn, connect_timeout=3)
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS sys_app_logs (
                  id BIGSERIAL PRIMARY KEY,
                  level VARCHAR(10) NOT NULL,
                  logger VARCHAR(64) NOT NULL DEFAULT '',
                  message TEXT NOT NULL,
                  request_id VARCHAR(40),
                  detail JSONB,
                  created_at TIMESTAMP DEFAULT NOW()
                )
                """
            )
            conn.commit()
        self._conn = conn

    def _drop_conn(self):
        try:
            if self._conn is not None:
                self._conn.close()
        except Exception:
            pass
        self._conn = None


def setup_logger(name: str = None, level: int = logging.INFO) -> logging.Logger:
    """获取或创建带统一格式的 logger（stdout + stderr + 可选 DB 落库）"""
    logger = logging.getLogger(name)

    if logger.handlers:
        return logger  # 避免重复添加 handler

    logger.setLevel(level)
    logger.propagate = False  # 防止重复传给根 logger

    fmt = logging.Formatter(
        "[%(asctime)s] %(levelname)-5s %(name)s | %(message)s",
        datefmt="%H:%M:%S",
    )

    # 单一控制台 handler（stdout）。
    # 注意：不要同时挂 stdout + stderr 两个 handler，否则同一行会在终端
    # 打印两次（两个流都回显到控制台），误导排查。
    h1 = logging.StreamHandler(sys.stdout)
    h1.setFormatter(fmt)
    h1.setLevel(level)
    logger.addHandler(h1)

    # 异步落库（默认开启，级别可配；失败不影响主流程）
    try:
        from utils.config import settings

        if settings.log_db_enabled:
            db_level = logging.getLevelName(settings.log_db_level)
            logger.addHandler(DbLogHandler(level=db_level))
    except Exception:
        pass  # 落库 handler 异常静默降级为纯控制台

    return logger
