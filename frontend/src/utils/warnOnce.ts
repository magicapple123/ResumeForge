// SPDX-License-Identifier: Apache-2.0
/**
 * 同一个 key 只 `console.warn` 一次（T12）。
 *
 * 为什么需要：契约漂移类的警告（后端字段缺失、两版 HTML 不一致）在每次渲染/每次选择
 * 都会重新触发。刷屏的后果不是"看着烦"，而是**用户和开发都学会了忽略控制台**——真正
 * 的失败就被埋在同一个面板里。
 *
 * 为什么不用"模块级布尔"：警告点会越来越多，每个点各写一个 `let warned = false` 既不
 * 统一，也没法在测试之间重置。这里用 key 集合，测试调 `resetWarnOnce()`。
 *
 * 边界：只用于**可恢复的**异常（退回默认值、按兜底路径继续）。真正的错误走 error 通道，
 * 不能被它吞掉。
 */

const seen = new Set<string>();

/**
 * 第一次调用时打印，之后同 key 静默。
 *
 * @param key 稳定的标识（如 `"resumeFontScale:missing-base-px"`），不要拼进变量值，
 *            否则每次值不同就退化成"每次都打"。
 */
export function warnOnce(key: string, ...args: unknown[]): void {
  if (seen.has(key)) return;
  seen.add(key);
  console.warn(...args);
}

/** 清空已记录 key（测试用；生产代码不要调）。 */
export function resetWarnOnce(): void {
  seen.clear();
}
