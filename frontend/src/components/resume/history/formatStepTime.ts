// SPDX-License-Identifier: Apache-2.0
/**
 * 历史步骤的时间戳格式化（W03 左栏「历史」页签）。
 *
 * ## 为什么不用 `toLocaleTimeString()`
 *
 * 一是**不稳定**：输出受运行环境的 locale / 时区 / Node ICU 裁剪影响，同一份快照在不同机器
 * 上给出 `10:05` / `10:05:00` / `上午10:05`，组件测试会变成"谁跑谁红"。
 * 二是**不可控**：历史行右侧只有一格宽度，必须固定 `HH:mm`。
 *
 * 所以这里手写补零：今天只显示 `HH:mm`（列表里绝大多数是今天的），跨天补上 `MM-DD`
 * （否则"昨天 10:05"和"今天 10:05"会读成同一时刻）。
 */

/** 两位补零（`5` → `"05"`）。 */
function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** 同一`year/month/day`（本地时区）即视为"今天"。 */
function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * 一步历史的时间文本：今天 → `HH:mm`；其它日期 → `MM-DD HH:mm`。
 *
 * @param at 毫秒时间戳（`HistoryEntry.at`）
 * @param now 参照时间（测试注入；缺省 = 此刻）
 */
export function formatStepTime(at: number, now: Date = new Date()): string {
  if (!Number.isFinite(at)) return "";
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  const clock = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  if (isSameLocalDay(date, now)) return clock;
  return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${clock}`;
}
