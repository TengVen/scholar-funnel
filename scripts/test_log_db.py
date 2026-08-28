"""
日志落库验证 —— 确认 setup_logger 输出的日志被异步写入 sys_app_logs

运行：D:\Anaconda\envs\paper\python.exe scripts/test_log_db.py
"""
import sys
import time
sys.path.insert(0, ".")

from utils.log import setup_logger, set_request_id, clear_request_id

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


def main():
    logger = setup_logger("test_log_db")
    set_request_id("test-req-123")

    # 输出三个级别日志（message 唯一便于核对）
    logger.info("落库测试-INFO-9f3k")
    logger.warning("落库测试-WARNING-9f3k")
    try:
        raise ValueError("故意异常")
    except ValueError:
        logger.error("落库测试-ERROR-9f3k", exc_info=True)
    clear_request_id()

    # 等后台线程批量写（1s 间隔）
    time.sleep(2.5)

    import psycopg
    from utils.config import settings

    dsn = settings.postgres_url.replace("postgresql+psycopg://", "postgresql://", 1)
    with psycopg.connect(dsn, connect_timeout=3) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT level, logger, message, request_id, detail IS NOT NULL "
                "FROM sys_app_logs WHERE logger='test_log_db' "
                "ORDER BY id DESC LIMIT 5"
            )
            rows = cur.fetchall()
    print(f"  查到 {len(rows)} 条 test_log_db 日志")

    check("INFO 落库", any("INFO" == r[0] and "INFO-9f3k" in r[2] for r in rows))
    check("WARNING 落库", any("WARNING" == r[0] and "WARNING-9f3k" in r[2] for r in rows))
    check("ERROR 落库", any("ERROR" == r[0] and "ERROR-9f3k" in r[2] for r in rows))
    check("request_id 关联", any(r[3] == "test-req-123" for r in rows))
    check("异常 traceback 写入 detail", any(r[0] == "ERROR" and r[4] for r in rows))


if __name__ == "__main__":
    main()
    print(f"\n结果: {PASS} 通过, {FAIL} 失败")
    sys.exit(1 if FAIL else 0)
