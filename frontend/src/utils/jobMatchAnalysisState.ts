// SPDX-License-Identifier: Apache-2.0
/**
 * 匹配度分析「后台进行中」的全局登记表。
 *
 * 为什么不放进 JobMatchModal：分析请求是弹窗里发出的 Promise，但"正在分析"这件事
 * 不只属于弹窗——用户关掉弹窗去做别的时，岗位列表 / 详情抽屉上也需要一个
 * 「分析中」的标志，否则后台进行与"什么都没发生"在界面上无法区分（用户反馈的原话：
 * 后台进行时没有任何标志）。
 *
 * 这里只存"哪些岗位的分析正在跑"（模块级 Set + 订阅），不轮询、不持久化：
 * 刷新页面后请求本来就断了，登记跟着消失是正确行为。
 */

const analyzingJobIds = new Set<number>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** 分析开始登记（同一个岗位重复登记幂等）。 */
export function beginMatchAnalysis(jobId: number): void {
  if (analyzingJobIds.has(jobId)) return;
  analyzingJobIds.add(jobId);
  emit();
}

/** 分析结束（成功/失败都要调）。 */
export function endMatchAnalysis(jobId: number): void {
  if (!analyzingJobIds.delete(jobId)) return;
  emit();
}

export function isMatchAnalyzing(jobId: number): boolean {
  return analyzingJobIds.has(jobId);
}

export function getMatchAnalyzingIds(): ReadonlySet<number> {
  return analyzingJobIds;
}

/** 订阅变化；返回取消订阅函数。 */
export function subscribeMatchAnalysis(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
