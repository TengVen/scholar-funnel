/**
 * 任务失败话术（lib/taskFeedback.ts）——把轮询/取结果阶段的原始错误
 * 转成面向用户的自然语言（原因 + 下一步建议），杜绝把技术错误原文裸抛给用户。
 *
 * 规则先匹配已知可解释类别（服务端 500 / 超时 / 限流 / 断连 / 任务过期），
 * 兜底保留原文但附行动指引。
 */
export function taskFailureMessage(e: unknown, kind: "检索" | "深度调研"): string {
  const raw = e instanceof Error ? e.message : String(e);
  const s = raw.toLowerCase();

  if (/internal server error|status of 500|"detail".*500|\b500\b/.test(raw)) {
    return (
      `${kind}未能完成：服务端在整理结果时出了点问题` +
      "（后台任务本身可能已完成，只是结果返回失败）。" +
      "请稍后重试一次；若仍失败，可直接去检索页查看已入库的论文。"
    );
  }
  if (/timeout|timed ?out|超时/.test(s)) {
    return (
      `${kind}超时未返回。` +
      "可稍后重试；若方向描述包含太多限定，建议精简后重新发起。"
    );
  }
  if (/rate.?limit|429|too many|限流|throttl/.test(s)) {
    return (
      `文献数据源暂时限流，${kind}未能执行。` +
      "请稍等 1-2 分钟再重试，或先换个方向描述发起。"
    );
  }
  if (/fetch failed|network|connect|econnrefused|load failed|socket/.test(s)) {
    return (
      `网络或服务连接中断，${kind}未能完成。` +
      "请确认后端服务正常运行后重试。"
    );
  }
  if (/task not found|不存在|已过期|not found/i.test(raw)) {
    return (
      `${kind}任务已失效（服务可能刚重启过，任务状态在内存中丢失）。` +
      "请直接重新发起一次。"
    );
  }
  return (
    `${kind}未能完成：${raw}。` +
    "可换个说法重试；若反复出现同样问题，把这段提示反馈给维护者排查。"
  );
}
