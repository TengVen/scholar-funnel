"""
统一日志配置 —— 所有模块通过此模块输出日志
同时输出到 stdout 和 stderr，确保终端可见
"""
import logging
import sys


def setup_logger(name: str = None, level: int = logging.INFO) -> logging.Logger:
    """获取或创建带统一格式的 logger"""
    logger = logging.getLogger(name)

    if logger.handlers:
        return logger  # 避免重复添加 handler

    logger.setLevel(level)
    logger.propagate = False  # 防止重复传给根 logger

    fmt = logging.Formatter(
        "[%(asctime)s] %(levelname)-5s %(name)s | %(message)s",
        datefmt="%H:%M:%S",
    )

    # stdout handler（Streamlit 终端明确显示）
    h1 = logging.StreamHandler(sys.stdout)
    h1.setFormatter(fmt)
    h1.setLevel(level)
    logger.addHandler(h1)

    # stderr handler（备用）
    h2 = logging.StreamHandler(sys.stderr)
    h2.setFormatter(fmt)
    h2.setLevel(level)
    logger.addHandler(h2)

    return logger
