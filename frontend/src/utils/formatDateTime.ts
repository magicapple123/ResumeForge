// SPDX-License-Identifier: Apache-2.0
/**
 * 时间戳格式化的**唯一实现**（W03 历史步骤 + D20 导出核对卡，审计 R-22 合并）。
 *
 * ## 为什么不用 `toLocaleTimeString()`
 *
 * 一是**不稳定**：输出受运行环境的 locale / 时区 / Node ICU 裁剪影响，同一份快照在不同机器
 * 上给出 `10:05` / `10:05:00` / `上午10:05`，组件测试会变成"谁跑谁红"。
 * 二是**不可控**：这些位置只有一格宽度，必须固定 `HH:mm`。
 *
 * 所以这里手写补零。两个入口的"省略规则"不同，别合并成一个：
 * · 历史步骤（`formatStepTime`）：今天只显示 `HH:mm`（列表里绝大多数是今天的），跨天补 `MM-DD`；
 * · 导出核对（`formatStampTime`）：不显示"今天"惯例，一律 `MM-DD HH:mm`，**跨年**补 `YYYY-`。
 *
 * 两个函数的入参都接受 `Date | string | number`，字符串按浏览器 `Date` 解析——后端下发的
 * 是本地 naive ISO（`2026-10-28T17:40:00`），前端**不要**再猜它是 UTC。
 */

/** 两位补零（`5` → `"05"`）。 */
function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** 同一`year/month/day`（本地时区）即视为"同一天"。 */
function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function toDate(value: Date | string | number): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
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
  if (sameLocalDay(date, now)) return clock;
  return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${clock}`;
}

/**
 * 导出核对卡的时间文本（R-22）：`MM-DD HH:mm`，**跨年**时补年份 `YYYY-MM-DD HH:mm`。
 *
 * 为什么与历史步骤不同：核对卡上那一行是"这一版是什么时候定的"，用户隔几天回来复核时
 * 需要日期；而"今天/昨天"的相对写法在导出场景里没有意义（导出时间戳是给存档对应关系用的）。
 *
 * @param value 后端 `export_summary.updated_at`（ISO 字符串）或时间戳
 */
export function formatStampTime(value: Date | string | number, now: Date = new Date()): string {
  const date = toDate(value);
  if (!date) return "";
  const clock = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  const monthDay = `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  if (date.getFullYear() !== now.getFullYear()) {
    return `${date.getFullYear()}-${monthDay} ${clock}`;
  }
  return `${monthDay} ${clock}`;
}
