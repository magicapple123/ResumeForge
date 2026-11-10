// SPDX-License-Identifier: Apache-2.0
/**
 * 求职进度「阶段构成条」的纯函数（12.2）：把五个互斥阶段的数量换算成图例百分比。
 *
 * 为什么不用 `count / total` 各算各的：四舍五入会出现 38+13+13+25+13 = 102%，
 * 五段数字加起来不等于 100 会让用户怀疑数据坏了。最大余数法先取整、再把剩下的
 * 百分点按余数从大到小逐个补回，保证**合计恰好 100**。余数相同时按「数量大的
 * 优先、再靠后的阶段优先」定序，使 3/1/1/2/1 稳定显示 38/12/12/25/13。
 *
 * 段宽本身不在这里算：DOM 里用 `flex: {count} 0 0` 让浏览器按原始计数分配剩余空间，
 * 天然正好铺满；本函数只负责图例上印出来的整数百分比。
 */

/** 最大余数法：返回与输入等长的整数百分比数组，合计恒为 100（全 0 时全 0）。 */
export function largestRemainderPercents(counts: readonly number[]): number[] {
  const total = counts.reduce((sum, count) => sum + Math.max(0, count), 0);
  if (total <= 0) return counts.map(() => 0);
  const exact = counts.map((count) => (Math.max(0, count) / total) * 100);
  const floors = exact.map((value) => Math.floor(value));
  const allocated = floors.reduce((sum, value) => sum + value, 0);
  const remaining = Math.max(0, 100 - allocated);
  const order = exact
    .map((value, index) => ({
      index,
      remainder: value - floors[index],
      count: Math.max(0, counts[index]),
    }))
    .sort((a, b) => b.remainder - a.remainder || b.count - a.count || b.index - a.index);
  const result = [...floors];
  for (let step = 0; step < remaining; step += 1) {
    result[order[step % order.length].index] += 1;
  }
  return result;
}
